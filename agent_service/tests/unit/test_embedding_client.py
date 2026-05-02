import os
import unittest
from unittest.mock import MagicMock, patch

from app.clients import embedding_client


class TestEmbeddingClient(unittest.TestCase):
    def setUp(self):
        # Clear the lru_cache before each test so env changes take effect.
        embedding_client._build_client.cache_clear()

    def _mock_env(self, extra: dict | None = None) -> dict:
        base = {
            "NVIDIA_API_KEY": "test-key",
            "NVIDIA_EMBEDDING_MODEL": "nvidia/llama-3.2-nv-embedqa-1b-v2",
            "RAG_EMBEDDING_DIM": "4",
            "RAG_EMBED_BATCH_SIZE": "2",
        }
        if extra:
            base.update(extra)
        return base

    def test_embed_documents_batches_correctly(self):
        """embed_documents respects RAG_EMBED_BATCH_SIZE and concatenates results."""
        env = self._mock_env({"RAG_EMBED_BATCH_SIZE": "2", "RAG_EMBEDDING_DIM": "2"})
        mock_client = MagicMock()
        # Each call returns 2-dim vectors matching env dim.
        mock_client.embed_documents.side_effect = [
            [[0.1, 0.2], [0.3, 0.4]],
            [[0.5, 0.6]],
        ]

        with patch.dict(os.environ, env, clear=False), patch(
            "app.clients.embedding_client._build_client", return_value=mock_client
        ):
            result = embedding_client.embed_documents(["a", "b", "c"])

        self.assertEqual(len(result), 3)
        self.assertEqual(mock_client.embed_documents.call_count, 2)
        self.assertEqual(mock_client.embed_documents.call_args_list[0].args[0], ["a", "b"])
        self.assertEqual(mock_client.embed_documents.call_args_list[1].args[0], ["c"])

    def test_embed_documents_dim_mismatch_raises(self):
        """embed_documents raises RuntimeError when output dim does not match RAG_EMBEDDING_DIM."""
        env = self._mock_env({"RAG_EMBEDDING_DIM": "4"})
        mock_client = MagicMock()
        # Return 2-dim vectors when 4 are expected.
        mock_client.embed_documents.return_value = [[0.1, 0.2]]

        with patch.dict(os.environ, env, clear=False), patch(
            "app.clients.embedding_client._build_client", return_value=mock_client
        ):
            with self.assertRaises(RuntimeError) as ctx:
                embedding_client.embed_documents(["hello"])

        self.assertIn("dimension mismatch", str(ctx.exception).lower())

    def test_embed_documents_empty_returns_empty(self):
        """embed_documents with empty input returns empty list without calling the client."""
        mock_client = MagicMock()
        with patch("app.clients.embedding_client._build_client", return_value=mock_client):
            result = embedding_client.embed_documents([])

        self.assertEqual(result, [])
        mock_client.embed_documents.assert_not_called()

    def test_embed_query_dim_mismatch_raises(self):
        """embed_query raises RuntimeError when output dim does not match RAG_EMBEDDING_DIM."""
        env = self._mock_env({"RAG_EMBEDDING_DIM": "3"})
        mock_client = MagicMock()
        mock_client.embed_query.return_value = [0.1, 0.2]  # 2-dim, expected 3

        with patch.dict(os.environ, env, clear=False), patch(
            "app.clients.embedding_client._build_client", return_value=mock_client
        ):
            with self.assertRaises(RuntimeError):
                embedding_client.embed_query("what is the rubric?")

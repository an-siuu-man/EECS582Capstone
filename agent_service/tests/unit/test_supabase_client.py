import unittest
from unittest.mock import Mock, patch

from app.clients import supabase_client


class TestSupabaseClient(unittest.TestCase):
    def test_bulk_insert_rag_chunks_accepts_empty_minimal_response(self):
        response = Mock()
        response.content = b""
        response.raise_for_status.return_value = None

        with patch.dict(
            "os.environ",
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
            },
        ), patch("app.clients.supabase_client.httpx.post", return_value=response):
            result = supabase_client.bulk_insert_rag_chunks(
                [
                    {
                        "document_id": "doc-1",
                        "user_id": "user-1",
                        "assignment_uuid": "assignment-1",
                        "source_type": "guide_markdown",
                        "source_id": "guide-1",
                        "chunk_index": 0,
                        "text": "Chunk text",
                        "content_hash": "hash-1",
                        "embedding": [0.1, 0.2],
                        "metadata": {},
                    }
                ]
            )

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()

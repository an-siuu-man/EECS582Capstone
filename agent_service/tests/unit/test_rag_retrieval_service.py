import unittest
from unittest.mock import patch
from uuid import UUID

from app.services import rag_retrieval_service as svc

USER_ID = UUID("aaaaaaaa-0000-0000-0000-000000000001")
ASSIGNMENT_UUID = UUID("bbbbbbbb-0000-0000-0000-000000000002")


def _row(index: int, source_type: str, text: str | None = None) -> dict:
    return {
        "chunk_id": f"00000000-0000-0000-0000-{index:012d}",
        "document_id": f"11111111-1111-1111-1111-{index:012d}",
        "source_type": source_type,
        "source_id": f"source-{index}",
        "text": text or f"{source_type} chunk {index}",
        "metadata": {},
        "similarity": 1.0 - (index * 0.001),
    }


class TestRagRetrievalService(unittest.TestCase):
    def test_per_source_caps_are_respected(self):
        rows = (
            [_row(i, "assignment_pdf") for i in range(1, 10)]
            + [_row(i, "guide_markdown") for i in range(10, 16)]
            + [_row(i, "rubric") for i in range(16, 21)]
            + [_row(i, "assignment_payload") for i in range(21, 25)]
            + [_row(i, "user_upload_pdf") for i in range(25, 31)]
        )

        with patch.dict("os.environ", {"MMR_SIMILARITY_THRESHOLD": "1.1"}), patch(
            "app.services.rag_retrieval_service.embedding_client",
        ) as mock_emb, patch(
            "app.services.rag_retrieval_service.supabase_client",
        ) as mock_sb:
            mock_emb.embed_query.return_value = [1.0, 0.0]
            mock_emb.embed_documents.return_value = [[1.0, float(i)] for i in range(len(rows))]
            mock_sb.match_rag_chunks.return_value = rows

            result = svc.retrieve("rubric details", USER_ID, ASSIGNMENT_UUID, top_k=50)

        counts: dict[str, int] = {}
        for chunk in result:
            key = "user_upload" if chunk.source_type.startswith("user_upload") else chunk.source_type
            counts[key] = counts.get(key, 0) + 1

        self.assertEqual(counts["assignment_pdf"], 6)
        self.assertEqual(counts["guide_markdown"], 4)
        self.assertEqual(counts["rubric"], 3)
        self.assertEqual(counts["assignment_payload"], 2)
        self.assertEqual(counts["user_upload"], 4)

    def test_mmr_removes_near_duplicate_chunks(self):
        rows = [
            _row(1, "guide_markdown", "same guide text"),
            _row(2, "guide_markdown", "same guide text with tiny change"),
            _row(3, "rubric", "different rubric text"),
        ]

        with patch("app.services.rag_retrieval_service.embedding_client") as mock_emb, patch(
            "app.services.rag_retrieval_service.supabase_client",
        ) as mock_sb:
            mock_emb.embed_query.return_value = [1.0, 0.0]
            mock_emb.embed_documents.return_value = [[1.0, 0.0], [1.0, 0.0], [0.0, 1.0]]
            mock_sb.match_rag_chunks.return_value = rows

            result = svc.retrieve("guide", USER_ID, ASSIGNMENT_UUID, top_k=10)

        self.assertEqual([chunk.source_id for chunk in result], ["source-1", "source-3"])

    def test_empty_rpc_results_return_empty_list(self):
        with patch("app.services.rag_retrieval_service.embedding_client") as mock_emb, patch(
            "app.services.rag_retrieval_service.supabase_client",
        ) as mock_sb:
            mock_emb.embed_query.return_value = [1.0, 0.0]
            mock_sb.match_rag_chunks.return_value = []

            result = svc.retrieve("missing topic", USER_ID, ASSIGNMENT_UUID)

        self.assertEqual(result, [])
        mock_emb.embed_documents.assert_not_called()


if __name__ == "__main__":
    unittest.main()

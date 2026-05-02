import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

_VALID_BODY = {
    "user_id": "aaaaaaaa-0000-0000-0000-000000000001",
    "assignment_uuid": "bbbbbbbb-0000-0000-0000-000000000002",
    "session_id": "cccccccc-0000-0000-0000-000000000003",
    "sources": ["assignment_payload", "rubric"],
    "force_reindex": False,
}

_MOCK_RESPONSE = {
    "assignment_uuid": "bbbbbbbb-0000-0000-0000-000000000002",
    "indexed_documents": 2,
    "indexed_chunks": 5,
    "skipped_unchanged_chunks": 0,
    "embedding_model": "nvidia/llama-3.2-nv-embedqa-1b-v2",
    "status": "indexed",
}


class TestIndexAssignmentRoute(unittest.TestCase):
    def test_post_index_assignment_returns_200(self):
        """POST /api/v1/rag/index-assignment should return 200 with index response."""
        with patch("app.api.v1.routes.rag.index_assignment") as mock_index:
            from app.schemas.rag import IndexAssignmentResponse
            mock_index.return_value = IndexAssignmentResponse(**_MOCK_RESPONSE)
            resp = client.post("/api/v1/rag/index-assignment", json=_VALID_BODY)

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["assignment_uuid"], _VALID_BODY["assignment_uuid"])
        self.assertIn("indexed_chunks", body)
        self.assertIn("embedding_model", body)

    def test_post_index_assignment_missing_user_id_returns_422(self):
        """Request without user_id should fail Pydantic validation."""
        invalid = {k: v for k, v in _VALID_BODY.items() if k != "user_id"}
        resp = client.post("/api/v1/rag/index-assignment", json=invalid)
        self.assertEqual(resp.status_code, 422)

    def test_post_index_assignment_missing_assignment_uuid_returns_422(self):
        """Request without assignment_uuid should fail Pydantic validation."""
        invalid = {k: v for k, v in _VALID_BODY.items() if k != "assignment_uuid"}
        resp = client.post("/api/v1/rag/index-assignment", json=invalid)
        self.assertEqual(resp.status_code, 422)


class TestRagStatusRoute(unittest.TestCase):
    def test_get_status_no_chunks_returns_not_indexed(self):
        """GET /status/{uuid} with no chunks should return is_indexed=False."""
        with patch("app.api.v1.routes.rag.supabase_client") as mock_sb:
            mock_sb.get_rag_status.return_value = []
            resp = client.get(
                "/api/v1/rag/status/bbbbbbbb-0000-0000-0000-000000000002",
                params={"user_id": "aaaaaaaa-0000-0000-0000-000000000001"},
            )

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body["is_indexed"])
        self.assertEqual(body["chunk_count"], 0)

    def test_get_status_with_chunks_returns_indexed(self):
        """GET /status/{uuid} with rows should aggregate chunk counts by source_type."""
        rows = [
            {"id": "c1", "source_type": "guide_markdown", "document_id": "d1", "created_at": "2026-05-01T00:00:00Z"},
            {"id": "c2", "source_type": "guide_markdown", "document_id": "d1", "created_at": "2026-05-01T00:00:01Z"},
            {"id": "c3", "source_type": "rubric", "document_id": "d2", "created_at": "2026-05-01T00:00:02Z"},
        ]
        with patch("app.api.v1.routes.rag.supabase_client") as mock_sb:
            mock_sb.get_rag_status.return_value = rows
            resp = client.get(
                "/api/v1/rag/status/bbbbbbbb-0000-0000-0000-000000000002",
                params={"user_id": "aaaaaaaa-0000-0000-0000-000000000001"},
            )

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["is_indexed"])
        self.assertEqual(body["chunk_count"], 3)
        self.assertEqual(body["document_count"], 2)
        self.assertEqual(body["sources"]["guide_markdown"], 2)
        self.assertEqual(body["sources"]["rubric"], 1)

    def test_get_status_missing_user_id_returns_422(self):
        """GET /status without user_id query param should return 422."""
        resp = client.get("/api/v1/rag/status/bbbbbbbb-0000-0000-0000-000000000002")
        self.assertEqual(resp.status_code, 422)

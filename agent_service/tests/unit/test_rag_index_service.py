import unittest
from unittest.mock import MagicMock, patch
from uuid import UUID

from app.schemas.rag import IndexAssignmentRequest
from app.schemas.shared import PdfExtraction, PdfPageExtraction
from app.services import rag_index_service as svc


def _make_request(**kwargs) -> IndexAssignmentRequest:
    defaults = {
        "user_id": UUID("aaaaaaaa-0000-0000-0000-000000000001"),
        "assignment_uuid": UUID("bbbbbbbb-0000-0000-0000-000000000002"),
        "session_id": UUID("cccccccc-0000-0000-0000-000000000003"),
        "sources": ["assignment_payload", "rubric"],
        "force_reindex": False,
    }
    defaults.update(kwargs)
    return IndexAssignmentRequest(**defaults)


def _mock_supabase(
    ingest=None,
    snapshot=None,
    guide=None,
    pdf_files=None,
    existing_hashes=None,
):
    m = MagicMock()
    m.get_assignment_ingest.return_value = ingest or {
        "assignment_uuid": "bbbbbbbb-0000-0000-0000-000000000002",
        "assignment_snapshot_id": "snap-1",
    }
    m.get_assignment_snapshot.return_value = snapshot or {
        "id": "snap-1",
        "title": "Lab 4",
        "raw_payload": {"title": "Lab 4", "description": "Build a sorting algorithm implementation."},
        "rubric_json": [
            {"id": "c1", "description": "Algorithm correctness and efficiency", "points": 30},
            {"id": "c2", "description": "Code style and documentation quality", "points": 20},
        ],
    }
    m.get_latest_guide_version.return_value = guide or {
        "id": "guide-id-1",
        "content_text": "# Guide\n\n" + ("Some guide content. " * 20),
    }
    m.get_snapshot_files_with_extracted_text.return_value = pdf_files if pdf_files is not None else []
    m.get_existing_chunk_hashes.return_value = existing_hashes if existing_hashes is not None else set()
    m.upsert_rag_document.return_value = {"id": "doc-uuid-1"}
    m.bulk_insert_rag_chunks.return_value = None
    return m


class TestIndexAssignment(unittest.TestCase):

    def test_new_chunks_are_embedded_and_inserted(self):
        """Chunks with no matching content_hash should be embedded and inserted."""
        mock_sb = _mock_supabase()
        fake_vectors = [[0.1] * 2048]

        with patch("app.services.rag_index_service.supabase_client", mock_sb), \
             patch("app.services.rag_index_service.embedding_client") as mock_emb:
            mock_emb.embed_documents.return_value = [[0.1] * 2048] * 20

            req = _make_request(sources=["assignment_payload"])
            result = svc.index_assignment(req)

        mock_emb.embed_documents.assert_called()
        mock_sb.bulk_insert_rag_chunks.assert_called()
        self.assertGreater(result.indexed_chunks, 0)
        self.assertEqual(result.skipped_unchanged_chunks, 0)

    def test_unchanged_chunks_are_skipped(self):
        """Chunks whose content_hash is already in rag_chunks should be skipped."""
        from app.services.rag_chunking_service import chunk_rubric

        rubric = [
            {"id": "c1", "description": "Algorithm correctness and efficiency", "points": 30},
            {"id": "c2", "description": "Code style and documentation quality", "points": 20},
        ]
        real_chunks = chunk_rubric(rubric, "snap-1")
        all_hashes = {c.content_hash for c in real_chunks}

        mock_sb = _mock_supabase(existing_hashes=all_hashes)
        mock_sb.get_assignment_snapshot.return_value = {
            "id": "snap-1",
            "title": "Lab",
            "raw_payload": {},
            "rubric_json": rubric,
        }

        with patch("app.services.rag_index_service.supabase_client", mock_sb), \
             patch("app.services.rag_index_service.embedding_client") as mock_emb:
            req = _make_request(sources=["rubric"])
            result = svc.index_assignment(req)

        mock_emb.embed_documents.assert_not_called()
        self.assertEqual(result.indexed_chunks, 0)
        self.assertEqual(result.skipped_unchanged_chunks, len(real_chunks))

    def test_force_reindex_bypasses_hash_check(self):
        """force_reindex=True should embed all chunks even when hashes match."""
        from app.services.rag_chunking_service import chunk_rubric
        rubric = [
            {"id": "c1", "description": "Algorithm correctness and efficiency", "points": 30},
        ]
        real_chunks = chunk_rubric(rubric, "snap-1")
        all_hashes = {c.content_hash for c in real_chunks}

        mock_sb = _mock_supabase(existing_hashes=all_hashes)
        mock_sb.get_assignment_snapshot.return_value = {
            "id": "snap-1",
            "title": "Lab",
            "raw_payload": {},
            "rubric_json": rubric,
        }

        with patch("app.services.rag_index_service.supabase_client", mock_sb), \
             patch("app.services.rag_index_service.embedding_client") as mock_emb:
            mock_emb.embed_documents.return_value = [[0.1] * 2048] * 10
            req = _make_request(sources=["rubric"], force_reindex=True)
            result = svc.index_assignment(req)

        mock_emb.embed_documents.assert_called()
        self.assertGreater(result.indexed_chunks, 0)

    def test_missing_extracted_text_skips_pdf_source(self):
        """PDF files with null extracted_text should be skipped with a warning."""
        mock_sb = _mock_supabase(pdf_files=[])  # no files with extracted text

        with patch("app.services.rag_index_service.supabase_client", mock_sb), \
             patch("app.services.rag_index_service.embedding_client") as mock_emb:
            req = _make_request(sources=["assignment_pdf"])
            result = svc.index_assignment(req)

        mock_emb.embed_documents.assert_not_called()
        self.assertEqual(result.indexed_chunks, 0)

    def test_no_ingest_returns_no_sources_status(self):
        """Missing ingest row should return status='no_sources' immediately."""
        mock_sb = _mock_supabase(ingest=None)
        mock_sb.get_assignment_ingest.return_value = None

        with patch("app.services.rag_index_service.supabase_client", mock_sb):
            req = _make_request()
            result = svc.index_assignment(req)

        self.assertEqual(result.status, "no_sources")
        self.assertEqual(result.indexed_chunks, 0)

    def test_user_upload_pdf_triggers_extraction_and_upsert(self):
        mock_sb = _mock_supabase()
        extraction = PdfExtraction(
            filename="notes.pdf",
            source="user_upload",
            file_sha256="sha-pdf",
            full_text="",
            pages=[
                PdfPageExtraction(
                    page_number=1,
                    text="Important uploaded PDF instructions for the assignment.",
                    method="native",
                    confidence=1.0,
                )
            ],
        )

        with patch("app.services.rag_index_service.supabase_client", mock_sb), \
             patch("app.services.rag_index_service.embedding_client") as mock_emb, \
             patch(
                 "app.services.rag_index_service.extract_pdf_extractions_from_pdf_files",
                 return_value=[extraction],
             ) as mock_extract:
            mock_emb.embed_documents.return_value = [[0.1] * 2048] * 5
            req = _make_request(
                sources=["user_upload_pdf"],
                upload_files=[
                    {
                        "filename": "notes.pdf",
                        "storage_url": "https://signed.example/notes.pdf",
                        "file_sha256": "sha-pdf",
                        "mime_type": "application/pdf",
                        "session_id": "cccccccc-0000-0000-0000-000000000003",
                    }
                ],
            )
            result = svc.index_assignment(req)

        mock_extract.assert_called_once()
        mock_sb.bulk_insert_rag_chunks.assert_called_once()
        inserted = mock_sb.bulk_insert_rag_chunks.call_args.args[0]
        self.assertEqual(inserted[0]["source_type"], "user_upload_pdf")
        self.assertEqual(inserted[0]["metadata"]["session_id"], "cccccccc-0000-0000-0000-000000000003")
        self.assertEqual(inserted[0]["metadata"]["filename"], "notes.pdf")
        self.assertEqual(result.indexed_chunks, 1)

    def test_user_upload_pdf_skips_extraction_when_chunks_exist(self):
        mock_sb = _mock_supabase(existing_hashes={"existing-hash"})

        with patch("app.services.rag_index_service.supabase_client", mock_sb), \
             patch("app.services.rag_index_service.embedding_client") as mock_emb, \
             patch(
                 "app.services.rag_index_service.extract_pdf_extractions_from_pdf_files",
             ) as mock_extract:
            req = _make_request(
                sources=["user_upload_pdf"],
                upload_files=[
                    {
                        "filename": "notes.pdf",
                        "storage_url": "https://signed.example/notes.pdf",
                        "file_sha256": "sha-pdf",
                        "mime_type": "application/pdf",
                        "session_id": "cccccccc-0000-0000-0000-000000000003",
                    }
                ],
            )
            result = svc.index_assignment(req)

        mock_extract.assert_not_called()
        mock_emb.embed_documents.assert_not_called()
        mock_sb.bulk_insert_rag_chunks.assert_not_called()
        self.assertEqual(result.indexed_chunks, 0)
        self.assertEqual(result.skipped_unchanged_chunks, 1)

    def test_user_upload_image_indexes_vlm_description(self):
        mock_sb = _mock_supabase()
        image_result = type(
            "ImageResult",
            (),
            {
                "status": "success",
                "description": "EXTRACTED TEXT:\nUse Bayes theorem.\n\nCONTEXT:\nHandwritten notes.",
            },
        )()

        with patch("app.services.rag_index_service.supabase_client", mock_sb), \
             patch("app.services.rag_index_service.embedding_client") as mock_emb, \
             patch(
                 "app.services.rag_index_service.extract_image_from_file",
                 return_value=image_result,
             ) as mock_extract:
            mock_emb.embed_documents.return_value = [[0.1] * 2048] * 5
            req = _make_request(
                sources=["user_upload_image"],
                upload_files=[
                    {
                        "filename": "notes.png",
                        "storage_url": "https://signed.example/notes.png",
                        "file_sha256": "sha-image",
                        "mime_type": "image/png",
                        "session_id": "cccccccc-0000-0000-0000-000000000003",
                    }
                ],
            )
            result = svc.index_assignment(req)

        mock_extract.assert_called_once()
        inserted = mock_sb.bulk_insert_rag_chunks.call_args.args[0]
        self.assertEqual(inserted[0]["source_type"], "user_upload_image")
        self.assertEqual(inserted[0]["metadata"]["session_id"], "cccccccc-0000-0000-0000-000000000003")
        self.assertEqual(inserted[0]["metadata"]["mime_type"], "image/png")
        self.assertIn("Bayes theorem", inserted[0]["text"])
        self.assertEqual(result.indexed_chunks, 1)


class TestIndexAssignmentResponse(unittest.TestCase):
    def test_response_includes_embedding_model(self):
        mock_sb = _mock_supabase()
        with patch("app.services.rag_index_service.supabase_client", mock_sb), \
             patch("app.services.rag_index_service.embedding_client") as mock_emb:
            mock_emb.embed_documents.return_value = [[0.1] * 2048] * 20
            req = _make_request(sources=["assignment_payload"])
            result = svc.index_assignment(req)

        self.assertIsNotNone(result.embedding_model)
        self.assertIsNotNone(result.assignment_uuid)

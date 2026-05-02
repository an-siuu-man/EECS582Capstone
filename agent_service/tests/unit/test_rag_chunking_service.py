import os
import unittest
from unittest.mock import patch

from app.services import rag_chunking_service as svc


class TestComputeContentHash(unittest.TestCase):
    def test_hash_is_stable(self):
        h1 = svc.compute_content_hash("guide_markdown", "src-1", "some text")
        h2 = svc.compute_content_hash("guide_markdown", "src-1", "some text")
        self.assertEqual(h1, h2)

    def test_hash_differs_on_embedding_model_change(self):
        with patch.dict(os.environ, {"NVIDIA_EMBEDDING_MODEL": "model-a"}):
            h1 = svc.compute_content_hash("guide_markdown", "src-1", "text")
        with patch.dict(os.environ, {"NVIDIA_EMBEDDING_MODEL": "model-b"}):
            h2 = svc.compute_content_hash("guide_markdown", "src-1", "text")
        self.assertNotEqual(h1, h2)

    def test_hash_differs_on_source_type_change(self):
        h1 = svc.compute_content_hash("guide_markdown", "src-1", "text")
        h2 = svc.compute_content_hash("rubric", "src-1", "text")
        self.assertNotEqual(h1, h2)

    def test_whitespace_normalization(self):
        """Extra whitespace is collapsed before hashing so reformatted text matches."""
        h1 = svc.compute_content_hash("rubric", "s", "hello   world")
        h2 = svc.compute_content_hash("rubric", "s", "hello world")
        self.assertEqual(h1, h2)


class TestGuideMarkdownChunking(unittest.TestCase):
    def test_heading_preserved_in_metadata(self):
        md = "# Overview\n\nThis is the overview.\n\n## Details\n\nSome details here.\n"
        chunks = svc.chunk_guide_markdown(md, "guide-1")
        self.assertTrue(len(chunks) > 0)
        headings = [c.metadata.get("heading", "") for c in chunks]
        self.assertTrue(any("Overview" in h for h in headings))

    def test_chunks_meet_minimum_length(self):
        md = "# Title\n\nShort.\n\n## Section\n\n" + ("word " * 30)
        chunks = svc.chunk_guide_markdown(md, "guide-1")
        for chunk in chunks:
            self.assertGreaterEqual(len(chunk.text.split()), svc._MIN_WORDS)

    def test_empty_markdown_returns_empty(self):
        self.assertEqual(svc.chunk_guide_markdown("", "g"), [])


class TestPdfChunking(unittest.TestCase):
    def test_page_number_and_method_in_metadata(self):
        text = (
            "--- Page 1 (native) ---\nFirst page content with enough words here.\n"
            "--- Page 2 (hybrid) ---\nSecond page content with enough words too.\n"
        )
        chunks = svc.chunk_assignment_pdf(text, "sha256-abc", filename="lab.pdf")
        self.assertTrue(len(chunks) > 0)
        page_nums = {c.metadata.get("page_number") for c in chunks}
        methods = {c.metadata.get("extraction_method") for c in chunks}
        self.assertIn(1, page_nums)
        self.assertIn(2, page_nums)
        self.assertIn("native", methods)
        self.assertIn("hybrid", methods)

    def test_filename_in_metadata(self):
        text = "--- Page 1 (native) ---\nPage one content with enough words here.\n"
        chunks = svc.chunk_assignment_pdf(text, "sha256-abc", filename="rubric.pdf")
        self.assertTrue(all(c.metadata.get("filename") == "rubric.pdf" for c in chunks))

    def test_no_markers_falls_back_gracefully(self):
        text = "This is a PDF without any page markers. " * 10
        chunks = svc.chunk_assignment_pdf(text, "sha256-abc")
        self.assertTrue(len(chunks) > 0)


class TestRubricChunking(unittest.TestCase):
    def test_one_chunk_per_criterion(self):
        rubric = [
            {"id": "1", "description": "Code quality and readability", "points": 10},
            {"id": "2", "description": "Testing and coverage", "points": 15},
            {"id": "3", "description": "Documentation clarity", "points": 5},
        ]
        chunks = svc.chunk_rubric(rubric, "snap-1")
        self.assertEqual(len(chunks), 3)

    def test_criterion_id_in_metadata(self):
        rubric = [{"id": "crit-42", "description": "Correctness of output", "points": 20}]
        chunks = svc.chunk_rubric(rubric, "snap-1")
        self.assertEqual(chunks[0].metadata.get("criterion_id"), "crit-42")

    def test_plain_text_rubric_falls_back_to_splitter(self):
        rubric = "Students will be graded on clarity, depth, and originality. " * 15
        chunks = svc.chunk_rubric(rubric, "snap-1")
        self.assertTrue(len(chunks) > 0)

    def test_canvas_envelope_criteria_extracted(self):
        rubric = {"criteria": [
            {"id": "a", "description": "Correctness of algorithm implementation", "points": 5},
            {"id": "b", "description": "Code style and documentation quality", "points": 5},
        ]}
        chunks = svc.chunk_rubric(rubric, "snap-1")
        self.assertEqual(len(chunks), 2)


class TestPayloadChunking(unittest.TestCase):
    def test_produces_single_chunk(self):
        payload = {
            "title": "Lab 4: Sorting Algorithms",
            "course_name": "CS 101",
            "due_at": "2026-05-10T23:59:00Z",
            "points_possible": 100,
            "submission_types": ["online_upload"],
            "description": "Implement merge sort and quick sort.",
        }
        chunks = svc.chunk_assignment_payload(payload, "snap-2")
        self.assertEqual(len(chunks), 1)

    def test_description_truncated(self):
        payload = {"title": "Big Assignment", "description": "x" * 3000}
        chunks = svc.chunk_assignment_payload(payload, "snap-2")
        self.assertEqual(len(chunks), 1)
        self.assertLessEqual(len(chunks[0].text), 3000)

    def test_empty_payload_returns_empty(self):
        chunks = svc.chunk_assignment_payload({}, "snap-2")
        self.assertEqual(chunks, [])

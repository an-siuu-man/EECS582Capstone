import base64
import unittest
from unittest.mock import patch

from app.schemas.requests import RunAgentRequest
from app.schemas.shared import PdfFile
from app.services.pdf_text_service import (
    _normalize_page_text,
    _remove_repeated_headers_and_footers,
    _should_ocr_page,
    extract_all_pdf_text,
)


class TestPdfTextService(unittest.TestCase):
    def test_should_ocr_page_flags_symbol_heavy_text(self):
        text = "%%% $$$ ### @@ !! ?? **"
        self.assertTrue(_should_ocr_page(text))

    def test_should_ocr_page_accepts_good_native_text(self):
        text = (
            "This assignment asks you to compare two search algorithms, report runtime "
            "observations, and summarize tradeoffs with supporting examples."
        )
        self.assertFalse(_should_ocr_page(text))

    def test_normalize_page_text_dehyphenates_and_unwraps_paragraphs(self):
        raw = "This para-\ngraph wraps across\nmultiple lines.\n\nKEY POINTS:\n- Keep this bullet."
        normalized = _normalize_page_text(raw)
        self.assertIn("This paragraph wraps across multiple lines.", normalized)
        self.assertIn("KEY POINTS:", normalized)
        self.assertIn("- Keep this bullet.", normalized)

    def test_remove_repeated_headers_and_footers(self):
        pages = [
            "CS 582 Spring 2026\nProblem statement line one.\nPage 1 of 3",
            "CS 582 Spring 2026\nDetails and constraints.\nPage 2 of 3",
            "CS 582 Spring 2026\nSubmission notes.\nPage 3 of 3",
        ]
        cleaned = _remove_repeated_headers_and_footers(pages)
        self.assertEqual(len(cleaned), 3)
        for page in cleaned:
            self.assertNotIn("CS 582 Spring 2026", page)
            self.assertNotIn("Page", page)

    def test_extract_all_pdf_text_combines_legacy_and_file_sections(self):
        req = RunAgentRequest(
            assignment_uuid="abc-123",
            payload={"title": "HW1"},
            pdf_text="legacy context",
            pdf_files=[
                PdfFile(
                    filename="spec.pdf",
                    base64_data=base64.b64encode(b"placeholder").decode("utf-8"),
                )
            ],
        )

        with patch(
            "app.services.pdf_text_service.extract_text_from_pdf_bytes",
            return_value="--- Page 1 (native) ---\nspec text",
        ):
            out = extract_all_pdf_text(req)

        self.assertIn("legacy context", out)
        self.assertIn("--- File: spec.pdf ---", out)
        self.assertIn("--- Page 1 (native) ---", out)


if __name__ == "__main__":
    unittest.main()

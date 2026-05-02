import unittest
from uuid import UUID

from app.schemas.rag import RetrievedChunk
from app.services.rag_context_formatter import format_retrieved_context


def _chunk(index: int, source_type: str, text: str, similarity: float = 0.9, metadata=None):
    return RetrievedChunk(
        chunk_id=UUID(f"00000000-0000-0000-0000-{index:012d}"),
        document_id=UUID(f"11111111-1111-1111-1111-{index:012d}"),
        source_type=source_type,
        source_id=f"source-{index}",
        text=text,
        metadata=metadata or {},
        similarity=similarity,
    )


class TestRagContextFormatter(unittest.TestCase):
    def test_formats_labeled_metadata_blocks(self):
        result = format_retrieved_context(
            [
                _chunk(
                    1,
                    "guide_markdown",
                    "Follow the implementation milestones.",
                    metadata={"heading": "Implementation Plan"},
                ),
                _chunk(
                    2,
                    "assignment_pdf",
                    "Submit the lab report as a PDF.",
                    metadata={"filename": "Lab4.pdf", "page_number": 3, "extraction_method": "hybrid"},
                ),
            ],
        )

        self.assertIn('[A | guide_markdown | section="Implementation Plan"]', result.text)
        self.assertIn('[B | assignment_pdf | file="Lab4.pdf" | page=3 | method=hybrid]', result.text)
        self.assertEqual([source.label for source in result.sources], ["A", "B"])

    def test_budget_drops_lowest_scoring_chunks_first(self):
        result = format_retrieved_context(
            [
                _chunk(1, "guide_markdown", "High value context " * 10, similarity=0.9),
                _chunk(2, "rubric", "Low value context " * 10, similarity=0.1),
                _chunk(3, "assignment_payload", "Medium value context " * 10, similarity=0.5),
            ],
            char_budget=520,
        )

        self.assertIn("High value context", result.text)
        self.assertIn("Medium value context", result.text)
        self.assertNotIn("Low value context", result.text)
        self.assertEqual([source.source_type for source in result.sources], ["guide_markdown", "assignment_payload"])


if __name__ == "__main__":
    unittest.main()

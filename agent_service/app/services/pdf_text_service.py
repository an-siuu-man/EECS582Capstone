"""
Artifact: agent_service/app/services/pdf_text_service.py
Purpose: Decodes uploaded PDF binaries and extracts combined plain text for agent context.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Extracted PDF decode/text processing from main API module into a service. (Ansuman Sharma)
Preconditions:
- Request payload uses RunAgentRequest schema; PDF attachments are base64-encoded strings.
Inputs:
- Acceptable: Valid base64 PDF data and optional legacy `pdf_text` strings.
- Unacceptable: Corrupted base64 strings or non-PDF binary payloads.
Postconditions:
- Returns a combined text corpus from all available PDF sources and optional legacy text.
Returns:
- Concatenated string of extracted PDF text and legacy pdf_text input.
Errors/Exceptions:
- ImportError for missing PyMuPDF is handled with warning and empty extraction result.
- Decode/extraction errors are logged and skipped per file.
"""

import base64
import os

from ..core.logging import get_logger
from ..schemas.requests import RunAgentRequest

logger = get_logger("headstart.main")


def extract_text_from_pdf_bytes(pdf_bytes: bytes, filename: str) -> str:
    """Extract text from PDF binary data using PyMuPDF (fitz)."""
    try:
        import fitz
    except ImportError:
        logger.warning(
            "pymupdf not installed – cannot extract PDF text. Run: pip install pymupdf"
        )
        return ""

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = []
        for page in doc:
            pages.append(page.get_text())
        doc.close()
        text = "\n".join(pages).strip()
        logger.info(
            "Extracted %d chars from PDF %r (%d pages)",
            len(text),
            filename,
            len(pages),
        )
        return text
    except Exception as e:
        logger.warning("Failed to extract text from PDF %r: %s", filename, e)
        return ""


def extract_all_pdf_text(req: RunAgentRequest) -> str:
    """
    Build combined pdf_text from direct text and decoded PDF attachments.
    """
    parts = []

    if req.pdf_text:
        parts.append(req.pdf_text)

    for pdf_file in req.pdf_files or []:
        try:
            pdf_bytes = base64.b64decode(pdf_file.base64_data)
            logger.debug("Decoding PDF %r – %d bytes", pdf_file.filename, len(pdf_bytes))
        except Exception as e:
            logger.warning("Failed to decode base64 for %r: %s", pdf_file.filename, e)
            continue

        text = extract_text_from_pdf_bytes(pdf_bytes, pdf_file.filename)
        if text:
            logger.info("PDF %r preview: %r", pdf_file.filename, text[:200])
            parts.append(f"--- File: {pdf_file.filename} ---\\n{text}")

    if parts:
        dump_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "pdf_extracted_text.txt",
        )
        dump_path = os.path.normpath(dump_path)
        with open(dump_path, "w", encoding="utf-8") as f:
            f.write("\n\n\n".join(parts))
        logger.info("PDF text dumped to %s", dump_path)

    return "\n\n".join(parts)

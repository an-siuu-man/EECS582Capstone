"""
Artifact: agent_service/app/services/pdf_text_service.py
Purpose: Decodes uploaded PDF binaries and extracts combined plain text for agent context.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Extracted PDF decode/text processing from main API module into a service. (Ansuman Sharma)
- 2026-02-28: Added page-aware extraction with native-text classification, selective OCR fallback, and text normalization. (Ansuman Sharma)
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
import io
import math
import os
import re
from collections import Counter
from dataclasses import dataclass

from ..core.logging import get_logger
from ..schemas.requests import RunAgentRequest

logger = get_logger("headstart.main")

MIN_NATIVE_TEXT_CHARS = 48
MIN_NATIVE_WORDS = 8
MIN_ALNUM_RATIO = 0.45
MAX_SYMBOL_RATIO = 0.40

OCR_RENDER_DPI = 240
OCR_TESSERACT_CONFIG = "--oem 3 --psm 6"

HEADER_FOOTER_SAMPLE_LINES = 2
HEADER_FOOTER_REPEAT_RATIO = 0.60
HEADER_FOOTER_MIN_PAGES = 3


@dataclass
class ExtractedPage:
    number: int
    method: str
    text: str


def _compute_text_quality(text: str) -> dict:
    """Return lightweight metrics used to decide native extraction quality."""
    compact = "".join(ch for ch in (text or "") if not ch.isspace())
    chars = len(compact)
    alnum = sum(ch.isalnum() for ch in compact)
    symbols = sum(not ch.isalnum() for ch in compact)
    words = re.findall(r"[A-Za-z0-9]{2,}", text or "")
    return {
        "chars": chars,
        "words": len(words),
        "alnum_ratio": (alnum / chars) if chars else 0.0,
        "symbol_ratio": (symbols / chars) if chars else 1.0,
    }


def _should_ocr_page(native_text: str) -> bool:
    """Decide if a page should use OCR instead of native extraction."""
    metrics = _compute_text_quality(native_text)
    if metrics["chars"] < MIN_NATIVE_TEXT_CHARS:
        return True
    if metrics["words"] < MIN_NATIVE_WORDS:
        return True
    if metrics["alnum_ratio"] < MIN_ALNUM_RATIO:
        return True
    if metrics["symbol_ratio"] > MAX_SYMBOL_RATIO:
        return True
    return False


def _normalize_match_line(line: str) -> str:
    """Normalize line signatures for repeated header/footer detection."""
    normalized = re.sub(r"\d+", "#", (line or "").lower())
    normalized = re.sub(r"\s+", " ", normalized).strip(" .:-|_")
    return normalized


def _remove_repeated_headers_and_footers(page_texts: list[str]) -> list[str]:
    """
    Remove top/bottom lines that repeat on most pages.
    This reduces prompt noise from boilerplate headers, footers, and page counters.
    """
    total_pages = len(page_texts)
    if total_pages < HEADER_FOOTER_MIN_PAGES:
        return page_texts

    pattern_counts: Counter = Counter()

    for text in page_texts:
        lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
        sampled = lines[:HEADER_FOOTER_SAMPLE_LINES] + lines[-HEADER_FOOTER_SAMPLE_LINES:]
        patterns = {
            _normalize_match_line(ln)
            for ln in sampled
            if 4 <= len(ln.strip()) <= 140
        }
        for pattern in patterns:
            if pattern:
                pattern_counts[pattern] += 1

    min_occurrences = max(HEADER_FOOTER_MIN_PAGES, math.ceil(total_pages * HEADER_FOOTER_REPEAT_RATIO))
    repeated_patterns = {
        pattern for pattern, count in pattern_counts.items() if count >= min_occurrences
    }
    if not repeated_patterns:
        return page_texts

    cleaned_pages = []
    for text in page_texts:
        kept_lines = []
        for line in (text or "").splitlines():
            if _normalize_match_line(line) in repeated_patterns:
                continue
            kept_lines.append(line.rstrip())
        cleaned_pages.append("\n".join(kept_lines).strip())
    return cleaned_pages


def _looks_like_structural_line(line: str) -> bool:
    """Preserve line breaks for headings, bullets, numbered lists, and table-ish rows."""
    s = (line or "").strip()
    if not s:
        return False
    if re.match(r"^[-*\u2022]\s+", s):
        return True
    if re.match(r"^\d+[.)]\s+", s):
        return True
    if s.endswith(":") and len(s) <= 90:
        return True
    if "|" in s:
        return True
    if re.search(r"\S\s{2,}\S", s):
        return True
    if s.isupper() and 3 <= len(s) <= 80:
        return True
    return False


def _unwrap_hard_line_breaks(text: str) -> str:
    """
    Join wrapped lines into paragraphs while preserving obvious structure.
    This is intentionally conservative to avoid damaging table/list semantics.
    """
    out_lines = []
    paragraph_buffer = []

    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line:
            if paragraph_buffer:
                out_lines.append(" ".join(paragraph_buffer))
                paragraph_buffer = []
            if out_lines and out_lines[-1] != "":
                out_lines.append("")
            continue

        if _looks_like_structural_line(line):
            if paragraph_buffer:
                out_lines.append(" ".join(paragraph_buffer))
                paragraph_buffer = []
            out_lines.append(line)
            continue

        paragraph_buffer.append(line)

    if paragraph_buffer:
        out_lines.append(" ".join(paragraph_buffer))

    normalized = []
    prev_blank = False
    for line in out_lines:
        if not line:
            if not prev_blank:
                normalized.append("")
            prev_blank = True
            continue
        normalized.append(re.sub(r"[ \t]+", " ", line).strip())
        prev_blank = False

    return "\n".join(normalized).strip()


def _normalize_page_text(text: str) -> str:
    """Normalize extracted page text for better LLM readability and chunk stability."""
    if not text:
        return ""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    # Fix words broken by PDF line wrapping, e.g. "multi-\nline".
    normalized = re.sub(r"(?<=\w)-\n(?=\w)", "", normalized)
    normalized = _unwrap_hard_line_breaks(normalized)
    return normalized.strip()


def _extract_ocr_text_from_page(page, filename: str, page_number: int) -> str:
    """OCR fallback for image-heavy pages. Returns empty text if OCR is unavailable."""
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except ImportError:
        logger.warning(
            "OCR dependencies missing (pytesseract/Pillow); skipping OCR for %r page %d",
            filename,
            page_number,
        )
        return ""

    try:
        pix = page.get_pixmap(dpi=OCR_RENDER_DPI, alpha=False)
        image = Image.open(io.BytesIO(pix.tobytes("png")))
        processed = ImageOps.autocontrast(image.convert("L"))
        text = pytesseract.image_to_string(processed, config=OCR_TESSERACT_CONFIG)
        return (text or "").strip()
    except Exception as e:
        logger.warning("OCR failed for %r page %d: %s", filename, page_number, e)
        return ""


def _extract_pages(pdf_bytes: bytes, filename: str) -> list[ExtractedPage]:
    """Extract per-page text using native extraction first and OCR fallback when needed."""
    try:
        import fitz
    except ImportError:
        logger.warning(
            "pymupdf not installed – cannot extract PDF text. Run: pip install pymupdf"
        )
        return []

    pages: list[ExtractedPage] = []
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            for idx, page in enumerate(doc, start=1):
                native_text = page.get_text("text") or ""
                method = "native"
                page_text = native_text

                if _should_ocr_page(native_text):
                    ocr_text = _extract_ocr_text_from_page(page, filename=filename, page_number=idx)
                    if ocr_text:
                        method = "ocr"
                        page_text = ocr_text

                pages.append(
                    ExtractedPage(
                        number=idx,
                        method=method,
                        text=_normalize_page_text(page_text),
                    )
                )
        return pages
    except Exception as e:
        logger.warning("Failed to extract text from PDF %r: %s", filename, e)
        return []


def extract_text_from_pdf_bytes(pdf_bytes: bytes, filename: str) -> str:
    """Extract and normalize page-aware PDF text with selective OCR fallback."""
    pages = _extract_pages(pdf_bytes=pdf_bytes, filename=filename)
    if not pages:
        return ""

    normalized_pages = _remove_repeated_headers_and_footers([p.text for p in pages])
    merged_parts = []
    for page, page_text in zip(pages, normalized_pages):
        merged_parts.append(f"--- Page {page.number} ({page.method}) ---")
        if page_text:
            merged_parts.append(page_text)
        else:
            merged_parts.append("(no text extracted)")

    output = "\n".join(merged_parts).strip()
    logger.info(
        "Extracted %d chars from PDF %r (%d pages)",
        len(output),
        filename,
        len(pages),
    )
    return output


def _decode_pdf_base64(base64_data: str) -> bytes:
    """Decode raw base64 or data-URL style PDF payloads."""
    data = base64_data.strip()
    if "," in data and data.lower().startswith("data:"):
        data = data.split(",", 1)[1]
    return base64.b64decode(data)


def extract_all_pdf_text(req: RunAgentRequest) -> str:
    """
    Build combined pdf_text from direct text and decoded PDF attachments.
    """
    parts = []

    if req.pdf_text:
        parts.append(req.pdf_text)

    for pdf_file in req.pdf_files or []:
        try:
            pdf_bytes = _decode_pdf_base64(pdf_file.base64_data)
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

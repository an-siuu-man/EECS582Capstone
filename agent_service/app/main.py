import base64
import logging
import os
import traceback
from fastapi import FastAPI, HTTPException, Request
from dotenv import load_dotenv
from .schemas import RunAgentRequest
from .agent import run_headstart_agent

load_dotenv()

# ── Logging setup ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("headstart.main")
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Headstart Agent Service")


def extract_text_from_pdf_bytes(pdf_bytes: bytes, filename: str) -> str:
    """Extract text from PDF binary data using PyMuPDF (fitz)."""
    try:
        import fitz  # pymupdf
    except ImportError:
        logger.warning("pymupdf not installed – cannot extract PDF text. Run: pip install pymupdf")
        return ""

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = []
        for page in doc:
            pages.append(page.get_text())
        doc.close()
        text = "\n".join(pages).strip()
        logger.info("Extracted %d chars from PDF %r (%d pages)", len(text), filename, len(pages))
        return text
    except Exception as e:
        logger.warning("Failed to extract text from PDF %r: %s", filename, e)
        return ""


def extract_all_pdf_text(req: RunAgentRequest) -> str:
    """
    Build the combined pdf_text string from:
      1. Any directly provided pdf_text (legacy/manual)
      2. Base64-encoded pdf_files from the extension
    """
    parts = []

    # Legacy pdf_text field
    if req.pdf_text:
        parts.append(req.pdf_text)

    # Decode and extract text from each PDF file
    for pdf_file in (req.pdf_files or []):
        try:
            pdf_bytes = base64.b64decode(pdf_file.base64_data)
            logger.debug("Decoding PDF %r – %d bytes", pdf_file.filename, len(pdf_bytes))
        except Exception as e:
            logger.warning("Failed to decode base64 for %r: %s", pdf_file.filename, e)
            continue

        text = extract_text_from_pdf_bytes(pdf_bytes, pdf_file.filename)
        if text:
            logger.info("PDF %r preview: %r", pdf_file.filename, text[:200])
            parts.append(f"--- File: {pdf_file.filename} ---\n{text}")

    if parts:
        dump_path = os.path.join(os.path.dirname(__file__), "..", "pdf_extracted_text.txt")
        dump_path = os.path.normpath(dump_path)
        with open(dump_path, "w", encoding="utf-8") as f:
            f.write("\n\n\n".join(parts))
        logger.info("PDF text dumped to %s", dump_path)

    return "\n\n".join(parts)


@app.get("/health")
def health():
    logger.debug("GET /health")
    return {"ok": True}


@app.post("/run-agent")
def run_agent(req: RunAgentRequest):
    title = req.payload.get("title", "(no title)") if isinstance(req.payload, dict) else "(unknown)"
    course_id = req.payload.get("courseId", "?") if isinstance(req.payload, dict) else "?"
    num_pdf_files = len(req.pdf_files or [])

    logger.info(
        "POST /run-agent | title=%r | courseId=%s | pdf_text_len=%d | pdf_files=%d",
        title, course_id, len(req.pdf_text or ""), num_pdf_files,
    )

    try:
        # Extract text from all PDF sources
        pdf_text = extract_all_pdf_text(req)
        if pdf_text:
            logger.info("Combined PDF text: %d chars", len(pdf_text))

        result = run_headstart_agent(req.payload, pdf_text)
        logger.info(
            "Agent completed | keys=%s",
            list(result.keys()) if isinstance(result, dict) else type(result).__name__,
        )
        return result
    except Exception as e:
        logger.error("Agent error: %s", repr(e))
        logger.debug("Traceback:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

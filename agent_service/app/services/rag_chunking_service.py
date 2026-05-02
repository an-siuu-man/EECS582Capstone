import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

CHUNKING_VERSION = "1"

# Minimum quality thresholds — chunks below either are dropped.
_MIN_CHARS = 20
_MIN_WORDS = 4

# Page marker emitted by pdf_text_service: "--- Page N (method) ---"
_PAGE_MARKER_RE = re.compile(r"^---\s*Page\s+(\d+)\s+\(([^)]+)\)\s*---\s*$", re.MULTILINE)


@dataclass
class RagChunk:
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)
    content_hash: str = ""


# ---------------------------------------------------------------------------
# Content hashing
# ---------------------------------------------------------------------------


def _normalize(text: str) -> str:
    return " ".join(text.split())


def _embedding_model() -> str:
    return os.environ.get("NVIDIA_EMBEDDING_MODEL", "nvidia/llama-3.2-nv-embedqa-1b-v2")


def compute_content_hash(source_type: str, source_id: str, text: str) -> str:
    """Compute a stable SHA-256 dedup hash for a chunk.

    Hash input includes source_type, source_id, normalized text, CHUNKING_VERSION,
    and the active embedding model so that changing any of those forces a re-embed.

    Args:
        source_type: RAG source category (e.g. 'guide_markdown').
        source_id: Stable identifier for the source document.
        text: Raw chunk text (will be normalized before hashing).

    Returns:
        Hex SHA-256 digest.
    """
    normalized = _normalize(text)
    payload = "|".join([source_type, source_id, normalized, CHUNKING_VERSION, _embedding_model()])
    return hashlib.sha256(payload.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Chunk validation
# ---------------------------------------------------------------------------


def _is_valid_chunk(text: str) -> bool:
    normalized = _normalize(text)
    if len(normalized) < _MIN_CHARS:
        return False
    if len(normalized.split()) < _MIN_WORDS:
        return False
    return True


def _make_chunk(text: str, source_type: str, source_id: str, metadata: dict[str, Any]) -> RagChunk | None:
    if not _is_valid_chunk(text):
        return None
    return RagChunk(
        text=text,
        metadata=metadata,
        content_hash=compute_content_hash(source_type, source_id, text),
    )


# ---------------------------------------------------------------------------
# Guide markdown chunking
# ---------------------------------------------------------------------------

_MD_HEADERS = [("#", "h1"), ("##", "h2"), ("###", "h3")]


def chunk_guide_markdown(markdown: str, source_id: str) -> list[RagChunk]:
    """Split guide markdown by headers then by character length.

    Args:
        markdown: Full guide markdown text.
        source_id: Stable source identifier (e.g. guide version id or session id).

    Returns:
        List of RagChunk with heading path preserved in metadata.
    """
    header_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=_MD_HEADERS, strip_headers=False)
    char_splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=150)

    header_docs = header_splitter.split_text(markdown)
    chunks: list[RagChunk] = []

    for doc in header_docs:
        sub_texts = char_splitter.split_text(doc.page_content)
        heading_path = " > ".join(
            v for k in ("h1", "h2", "h3") if (v := doc.metadata.get(k))
        )
        for text in sub_texts:
            chunk = _make_chunk(
                text,
                "guide_markdown",
                source_id,
                {"heading": heading_path} if heading_path else {},
            )
            if chunk:
                chunks.append(chunk)

    return chunks


# ---------------------------------------------------------------------------
# Assignment PDF chunking
# ---------------------------------------------------------------------------


def chunk_assignment_pdf(full_text: str, source_id: str, filename: str = "") -> list[RagChunk]:
    """Split extracted PDF text by page markers then by character length.

    Args:
        full_text: Concatenated PDF text with '--- Page N (method) ---' markers.
        source_id: Stable source identifier (e.g. file_sha256).
        filename: Original PDF filename for metadata.

    Returns:
        List of RagChunk with page_number and extraction_method in metadata.
    """
    char_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=120)

    # Find all page marker positions.
    markers = list(_PAGE_MARKER_RE.finditer(full_text))
    chunks: list[RagChunk] = []

    if not markers:
        # No page markers — treat as a single page.
        for text in char_splitter.split_text(full_text):
            chunk = _make_chunk(text, "assignment_pdf", source_id, {"filename": filename})
            if chunk:
                chunks.append(chunk)
        return chunks

    # Extract text between consecutive markers.
    for i, marker in enumerate(markers):
        page_num = int(marker.group(1))
        method = marker.group(2)
        start = marker.end()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(full_text)
        page_text = full_text[start:end].strip()

        for text in char_splitter.split_text(page_text):
            meta: dict[str, Any] = {
                "page_number": page_num,
                "extraction_method": method,
            }
            if filename:
                meta["filename"] = filename
            chunk = _make_chunk(text, "assignment_pdf", source_id, meta)
            if chunk:
                chunks.append(chunk)

    return chunks


# ---------------------------------------------------------------------------
# Rubric chunking
# ---------------------------------------------------------------------------


def _criterion_to_text(criterion: dict[str, Any]) -> str:
    parts: list[str] = []
    if desc := criterion.get("description"):
        parts.append(str(desc))
    if pts := criterion.get("points"):
        parts.append(f"Points: {pts}")
    ratings = criterion.get("ratings") or criterion.get("rubric_ratings") or []
    if ratings:
        rating_lines = []
        for r in ratings:
            label = r.get("description") or r.get("long_description") or ""
            pts_r = r.get("points", "")
            rating_lines.append(f"  - {label} ({pts_r} pts)" if pts_r else f"  - {label}")
        parts.append("Ratings:\n" + "\n".join(rating_lines))
    return "\n".join(parts)


def chunk_rubric(rubric: Any, source_id: str) -> list[RagChunk]:
    """Split a rubric into one chunk per criterion when possible.

    Args:
        rubric: Rubric as a list of criterion dicts, a single dict, or plain text.
        source_id: Stable source identifier (e.g. assignment snapshot id).

    Returns:
        List of RagChunk, one per criterion or from character splitting for plain text.
    """
    chunks: list[RagChunk] = []

    if isinstance(rubric, str):
        # Plain-text rubric — character split.
        splitter = RecursiveCharacterTextSplitter(chunk_size=900, chunk_overlap=100)
        for text in splitter.split_text(rubric):
            chunk = _make_chunk(text, "rubric", source_id, {})
            if chunk:
                chunks.append(chunk)
        return chunks

    # JSON rubric: list of criteria or a Canvas rubric envelope.
    criteria: list[dict[str, Any]] = []
    if isinstance(rubric, list):
        criteria = [c for c in rubric if isinstance(c, dict)]
    elif isinstance(rubric, dict):
        # Canvas wraps criteria under 'criteria' or 'rubric_criteria'.
        for key in ("criteria", "rubric_criteria"):
            if isinstance(rubric.get(key), list):
                criteria = [c for c in rubric[key] if isinstance(c, dict)]
                break
        if not criteria:
            criteria = [rubric]

    for crit in criteria:
        text = _criterion_to_text(crit)
        crit_id = str(crit.get("id", ""))
        meta: dict[str, Any] = {}
        if crit_id:
            meta["criterion_id"] = crit_id
        chunk = _make_chunk(text, "rubric", source_id, meta)
        if chunk:
            chunks.append(chunk)

    return chunks


# ---------------------------------------------------------------------------
# Assignment payload chunking
# ---------------------------------------------------------------------------


def chunk_assignment_payload(payload: dict[str, Any], source_id: str) -> list[RagChunk]:
    """Produce a single compact summary chunk from the assignment payload.

    Args:
        payload: Raw assignment payload dict.
        source_id: Stable source identifier (e.g. assignment snapshot id).

    Returns:
        List with one RagChunk summary, or empty list if payload is empty.
    """
    parts: list[str] = []

    if title := payload.get("title") or payload.get("name"):
        parts.append(f"Title: {title}")
    if course := payload.get("course_name") or payload.get("context_title"):
        parts.append(f"Course: {course}")
    if due := payload.get("due_at") or payload.get("due_date"):
        parts.append(f"Due: {due}")
    if pts := payload.get("points_possible"):
        parts.append(f"Points: {pts}")
    if sub := payload.get("submission_types") or payload.get("submission_type"):
        sub_str = ", ".join(sub) if isinstance(sub, list) else str(sub)
        parts.append(f"Submission: {sub_str}")

    # Description capped at 2000 chars to keep the summary token-efficient.
    desc = payload.get("description") or payload.get("description_text") or ""
    if desc:
        desc = str(desc)[:2000]
        parts.append(f"Description:\n{desc}")

    # Brief rubric summary (just criterion names).
    rubric = payload.get("rubric") or payload.get("rubric_criteria")
    if rubric:
        try:
            criteria = rubric if isinstance(rubric, list) else json.loads(rubric) if isinstance(rubric, str) else []
            names = [c.get("description", "") for c in criteria if isinstance(c, dict)]
            if names:
                parts.append("Rubric criteria: " + "; ".join(n for n in names if n))
        except Exception:
            pass

    if url := payload.get("html_url") or payload.get("canvas_url"):
        parts.append(f"Canvas URL: {url}")

    if not parts:
        return []

    text = "\n".join(parts)
    chunk = _make_chunk(text, "assignment_payload", source_id, {})
    return [chunk] if chunk else []

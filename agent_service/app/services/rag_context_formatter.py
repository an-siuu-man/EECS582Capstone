import os
import string
from dataclasses import dataclass
from typing import Sequence

from ..schemas.rag import RetrievedChunk

DEFAULT_CONTEXT_CHAR_BUDGET = 16000


@dataclass(frozen=True)
class FormattedRagContext:
    text: str
    sources: list[RetrievedChunk]


def _context_budget() -> int:
    return int(os.environ.get("RAG_CONTEXT_CHAR_BUDGET", DEFAULT_CONTEXT_CHAR_BUDGET))


def _label_for_index(index: int) -> str:
    alphabet = string.ascii_uppercase
    label = ""
    n = index
    while True:
        label = alphabet[n % len(alphabet)] + label
        n = n // len(alphabet) - 1
        if n < 0:
            return label


def _metadata_value(metadata: dict, *keys: str) -> str:
    for key in keys:
        value = metadata.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _header_for_chunk(chunk: RetrievedChunk, label: str) -> str:
    metadata = chunk.metadata or {}
    parts = [label, chunk.source_type]

    filename = _metadata_value(metadata, "filename", "file", "name")
    if filename:
        parts.append(f'file="{_quote(filename)}"')

    page = _metadata_value(metadata, "page_number", "page")
    if page:
        parts.append(f"page={page}")

    method = _metadata_value(metadata, "extraction_method", "method")
    if method:
        parts.append(f"method={method}")

    heading = _metadata_value(metadata, "heading", "section", "title")
    if heading:
        parts.append(f'section="{_quote(heading)}"')

    criterion_id = _metadata_value(metadata, "criterion_id")
    if criterion_id:
        parts.append(f'criterion="{_quote(criterion_id)}"')

    return f"[{' | '.join(parts)}]"


def _format_block(chunk: RetrievedChunk) -> str:
    label = chunk.label or "?"
    header = _header_for_chunk(chunk, label)
    return f"{header}\n{chunk.text.strip()}\n"


def _within_budget(blocks: list[str], budget: int) -> bool:
    return len("\n".join(blocks)) <= budget


def _trim_single_block(chunk: RetrievedChunk, budget: int) -> str:
    header = _header_for_chunk(chunk, chunk.label or "?")
    available = max(0, budget - len(header) - len("\n...[truncated]\n"))
    text = chunk.text.strip()
    if len(text) > available:
        text = f"{text[:available]}\n...[truncated]"
    return f"{header}\n{text}\n"


def format_retrieved_context(
    chunks: Sequence[RetrievedChunk],
    char_budget: int | None = None,
) -> FormattedRagContext:
    """Format retrieved chunks as labeled context blocks within a character budget.

    Args:
        chunks: Retrieved chunks in preferred ranking order.
        char_budget: Optional total character budget override.

    Returns:
        Formatted context text plus the labeled chunks that fit in the budget.
    """
    budget = char_budget if char_budget is not None else _context_budget()
    labeled = [
        chunk.model_copy(update={"label": _label_for_index(index)})
        for index, chunk in enumerate(chunks)
        if chunk.text.strip()
    ]
    if not labeled:
        return FormattedRagContext(text="(none)", sources=[])

    included = list(labeled)
    while included:
        blocks = [_format_block(chunk) for chunk in included]
        if _within_budget(blocks, budget):
            return FormattedRagContext(text="\n".join(blocks), sources=included)
        if len(included) == 1:
            return FormattedRagContext(
                text=_trim_single_block(included[0], budget),
                sources=included,
            )
        lowest = min(range(len(included)), key=lambda i: included[i].similarity)
        included.pop(lowest)

    return FormattedRagContext(text="(none)", sources=[])

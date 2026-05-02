import math
import os
from collections import defaultdict
from typing import Sequence
from uuid import UUID

from ..clients import embedding_client, supabase_client
from ..core.logging import get_logger
from ..schemas.rag import RetrievedChunk

logger = get_logger("headstart.rag_retrieval")

DEFAULT_TOP_K = 12
MMR_SIMILARITY_THRESHOLD = 0.92
SOURCE_CAPS = {
    "assignment_pdf": 6,
    "guide_markdown": 4,
    "rubric": 3,
    "assignment_payload": 2,
    "user_upload": 4,
}


def _mmr_threshold() -> float:
    return float(os.environ.get("MMR_SIMILARITY_THRESHOLD", MMR_SIMILARITY_THRESHOLD))


def _source_cap_key(source_type: str) -> str:
    if source_type.startswith("user_upload"):
        return "user_upload"
    return source_type


def _cap_by_source(chunks: Sequence[RetrievedChunk]) -> list[RetrievedChunk]:
    counts: dict[str, int] = defaultdict(int)
    selected: list[RetrievedChunk] = []
    for chunk in chunks:
        cap_key = _source_cap_key(chunk.source_type)
        cap = SOURCE_CAPS.get(cap_key)
        if cap is not None and counts[cap_key] >= cap:
            continue
        selected.append(chunk)
        counts[cap_key] += 1
    return selected


def _cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def _remove_near_duplicates(chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
    threshold = _mmr_threshold()
    if len(chunks) < 2 or threshold <= 0 or threshold >= 1:
        return chunks

    try:
        vectors = embedding_client.embed_documents([chunk.text for chunk in chunks])
    except Exception:
        logger.warning("RAG MMR duplicate filtering failed; returning capped chunks", exc_info=True)
        return chunks
    if len(vectors) != len(chunks):
        logger.warning("RAG MMR vector count mismatch; returning capped chunks")
        return chunks

    selected_chunks: list[RetrievedChunk] = []
    selected_vectors: list[list[float]] = []
    for chunk, vector in zip(chunks, vectors):
        duplicate = any(
            _cosine_similarity(vector, selected_vector) > threshold
            for selected_vector in selected_vectors
        )
        if duplicate:
            continue
        selected_chunks.append(chunk)
        selected_vectors.append(vector)
    return selected_chunks


def retrieve(
    query: str,
    user_id: UUID,
    assignment_uuid: UUID,
    top_k: int = DEFAULT_TOP_K,
    source_types: list[str] | None = None,
) -> list[RetrievedChunk]:
    """Retrieve semantically relevant chunks for a scoped assignment chat query.

    Args:
        query: User query to embed and search.
        user_id: User UUID used to isolate RAG chunks.
        assignment_uuid: Assignment UUID used to isolate RAG chunks.
        top_k: Maximum number of chunks to return after caps and deduplication.
        source_types: Optional source type filter.

    Returns:
        Ranked retrieved chunks, possibly empty when no index rows match.
    """
    normalized_query = (query or "").strip()
    if not normalized_query:
        return []

    limit = max(1, top_k)
    query_embedding = embedding_client.embed_query(normalized_query)
    rows = supabase_client.match_rag_chunks(
        query_embedding=query_embedding,
        user_id=str(user_id),
        assignment_uuid=str(assignment_uuid),
        match_count=max(limit * 3, limit),
        source_types=source_types,
    )
    if not rows:
        return []

    chunks = [RetrievedChunk.model_validate(row) for row in rows]
    capped = _cap_by_source(chunks)
    deduped = _remove_near_duplicates(capped)
    return deduped[:limit]

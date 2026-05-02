import logging
import os
from typing import Any

from ..clients import embedding_client, supabase_client
from ..schemas.rag import IndexAssignmentRequest, IndexAssignmentResponse
from ..services.rag_chunking_service import (
    RagChunk,
    chunk_assignment_payload,
    chunk_assignment_pdf,
    chunk_guide_markdown,
    chunk_rubric,
)

logger = logging.getLogger(__name__)


def _embedding_model() -> str:
    return os.environ.get("NVIDIA_EMBEDDING_MODEL", "nvidia/llama-3.2-nv-embedqa-1b-v2")


def _build_rag_document(
    user_id: str,
    assignment_uuid: str,
    assignment_snapshot_id: str | None,
    source_type: str,
    source_id: str,
    title: str,
    content_hash: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "assignment_uuid": assignment_uuid,
        "assignment_snapshot_id": assignment_snapshot_id,
        "source_type": source_type,
        "source_id": source_id,
        "title": title,
        "content_hash": content_hash,
        "metadata": metadata,
    }


def _index_chunks(
    doc_id: str,
    user_id: str,
    assignment_uuid: str,
    source_type: str,
    source_id: str,
    chunks: list[RagChunk],
    existing_hashes: set[str],
    force_reindex: bool,
) -> tuple[int, int]:
    """Embed and insert new chunks; return (indexed_count, skipped_count)."""
    to_embed: list[RagChunk] = []
    skipped = 0

    for chunk in chunks:
        if not force_reindex and chunk.content_hash in existing_hashes:
            skipped += 1
        else:
            to_embed.append(chunk)

    if not to_embed:
        return 0, skipped

    texts = [c.text for c in to_embed]
    vectors = embedding_client.embed_documents(texts)

    rows = []
    for i, (chunk, vec) in enumerate(zip(to_embed, vectors)):
        rows.append({
            "document_id": doc_id,
            "user_id": user_id,
            "assignment_uuid": assignment_uuid,
            "source_type": source_type,
            "source_id": source_id,
            "chunk_index": i,
            "text": chunk.text,
            "token_count": len(chunk.text.split()),
            "content_hash": chunk.content_hash,
            "embedding": vec,
            "metadata": chunk.metadata,
        })

    supabase_client.bulk_insert_rag_chunks(rows)
    return len(rows), skipped


def index_assignment(request: IndexAssignmentRequest) -> IndexAssignmentResponse:
    """Index assignment sources into pgvector for RAG retrieval.

    Loads each requested source from Supabase, chunks and embeds it, and
    upserts into rag_documents / rag_chunks. Unchanged chunks (matching
    content_hash) are skipped unless force_reindex is True.

    Args:
        request: Validated indexing request with user_id, assignment_uuid,
                 optional session_id, source list, and force_reindex flag.

    Returns:
        Counts of indexed and skipped chunks, plus the active embedding model.
    """
    user_id = str(request.user_id)
    assignment_uuid = str(request.assignment_uuid)
    session_id = str(request.session_id) if request.session_id else None

    # Resolve assignment_snapshot_id via assignment_ingests.
    ingest = supabase_client.get_assignment_ingest(assignment_uuid)
    if not ingest:
        logger.warning("[rag-index] No ingest found for assignment_uuid=%s", assignment_uuid)
        return IndexAssignmentResponse(
            assignment_uuid=assignment_uuid,
            indexed_documents=0,
            indexed_chunks=0,
            skipped_unchanged_chunks=0,
            embedding_model=_embedding_model(),
            status="no_sources",
        )

    snapshot_id = ingest["assignment_snapshot_id"]
    snapshot = supabase_client.get_assignment_snapshot(snapshot_id)

    total_docs = 0
    total_indexed = 0
    total_skipped = 0

    for source_type in request.sources:
        chunks: list[RagChunk] = []
        source_id = snapshot_id
        title = source_type

        if source_type == "assignment_payload":
            if snapshot:
                payload = snapshot.get("raw_payload") or {}
                chunks = chunk_assignment_payload(payload, source_id)
                title = f"Assignment payload: {snapshot.get('title', '')}"

        elif source_type == "rubric":
            if snapshot:
                rubric = snapshot.get("rubric_json")
                if rubric:
                    chunks = chunk_rubric(rubric, source_id)
                    title = f"Rubric: {snapshot.get('title', '')}"
                else:
                    logger.debug("[rag-index] No rubric for snapshot_id=%s", snapshot_id)

        elif source_type == "guide_markdown":
            if not session_id:
                logger.debug("[rag-index] guide_markdown requested but no session_id provided")
            else:
                guide = supabase_client.get_latest_guide_version(session_id)
                if guide and guide.get("content_text"):
                    source_id = guide["id"]
                    chunks = chunk_guide_markdown(guide["content_text"], source_id)
                    title = f"Guide: {snapshot.get('title', '') if snapshot else assignment_uuid}"
                else:
                    logger.debug("[rag-index] No guide found for session_id=%s", session_id)

        elif source_type == "assignment_pdf":
            pdf_files = supabase_client.get_snapshot_files_with_extracted_text(snapshot_id)
            if not pdf_files:
                logger.debug("[rag-index] No extracted PDF text for snapshot_id=%s", snapshot_id)
            for pdf_file in pdf_files:
                extracted = pdf_file.get("extracted_text") or ""
                if not extracted.strip():
                    continue
                file_source_id = pdf_file["file_sha256"]
                file_chunks = chunk_assignment_pdf(
                    extracted, file_source_id, filename=pdf_file.get("filename", "")
                )
                if not file_chunks:
                    continue

                # Represent the content of this doc as the hash of all its chunk hashes.
                doc_content_hash = file_source_id
                doc = _build_rag_document(
                    user_id=user_id,
                    assignment_uuid=assignment_uuid,
                    assignment_snapshot_id=snapshot_id,
                    source_type="assignment_pdf",
                    source_id=file_source_id,
                    title=pdf_file.get("filename", "PDF"),
                    content_hash=doc_content_hash,
                    metadata={"filename": pdf_file.get("filename", "")},
                )
                persisted_doc = supabase_client.upsert_rag_document(doc)
                doc_id = persisted_doc["id"]
                existing = supabase_client.get_existing_chunk_hashes(doc_id) if not request.force_reindex else set()
                indexed, skipped = _index_chunks(
                    doc_id, user_id, assignment_uuid, "assignment_pdf", file_source_id,
                    file_chunks, existing, request.force_reindex,
                )
                total_docs += 1
                total_indexed += indexed
                total_skipped += skipped
            continue  # already processed per-file above

        else:
            logger.warning("[rag-index] Unknown source_type=%s, skipping", source_type)
            continue

        if not chunks:
            continue

        # Summarize the document by hashing all its chunk hashes.
        doc_content_hash = chunks[0].content_hash if len(chunks) == 1 else chunks[len(chunks) // 2].content_hash
        doc = _build_rag_document(
            user_id=user_id,
            assignment_uuid=assignment_uuid,
            assignment_snapshot_id=snapshot_id,
            source_type=source_type,
            source_id=source_id,
            title=title,
            content_hash=doc_content_hash,
            metadata={},
        )
        persisted_doc = supabase_client.upsert_rag_document(doc)
        doc_id = persisted_doc["id"]
        existing = supabase_client.get_existing_chunk_hashes(doc_id) if not request.force_reindex else set()
        indexed, skipped = _index_chunks(
            doc_id, user_id, assignment_uuid, source_type, source_id,
            chunks, existing, request.force_reindex,
        )
        total_docs += 1
        total_indexed += indexed
        total_skipped += skipped

    status = "indexed" if total_indexed > 0 or total_skipped > 0 else "no_sources"
    if total_indexed > 0 and total_skipped > 0:
        status = "partial"

    return IndexAssignmentResponse(
        assignment_uuid=assignment_uuid,
        indexed_documents=total_docs,
        indexed_chunks=total_indexed,
        skipped_unchanged_chunks=total_skipped,
        embedding_model=_embedding_model(),
        status=status,
    )

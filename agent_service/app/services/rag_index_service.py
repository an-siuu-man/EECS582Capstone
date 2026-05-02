import logging
import os
from typing import Any

from ..clients import embedding_client, supabase_client
from ..schemas.rag import IndexAssignmentRequest, IndexAssignmentResponse
from ..schemas.shared import ImageFile, PdfFile
from ..services.image_extraction_service import extract_image_from_file
from ..services.pdf_extraction_service import extract_pdf_extractions_from_pdf_files
from ..services.rag_chunking_service import (
    RagChunk,
    chunk_assignment_payload,
    chunk_assignment_pdf,
    chunk_guide_markdown,
    chunk_rubric,
    compute_content_hash,
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


def _tag_chunks(chunks: list[RagChunk], metadata: dict[str, Any]) -> list[RagChunk]:
    tagged: list[RagChunk] = []
    for chunk in chunks:
        tagged.append(
            RagChunk(
                text=chunk.text,
                metadata={**chunk.metadata, **metadata},
                content_hash=chunk.content_hash,
            )
        )
    return tagged


def _pdf_extraction_text_for_chunking(extraction: Any) -> str:
    page_blocks: list[str] = []
    for page in getattr(extraction, "pages", []) or []:
        text = (getattr(page, "text", "") or "").strip()
        if not text:
            continue
        page_number = getattr(page, "page_number", 1) or 1
        method = getattr(page, "method", "native") or "native"
        page_blocks.append(f"--- Page {page_number} ({method}) ---\n{text}")
    if page_blocks:
        return "\n\n".join(page_blocks)
    return (getattr(extraction, "full_text", "") or "").strip()


def _split_image_description(
    text: str,
    source_id: str,
    metadata: dict[str, Any],
) -> list[RagChunk]:
    normalized = (text or "").strip()
    if not normalized:
        return []

    chunk_size = 1200
    overlap = 150
    chunks: list[RagChunk] = []
    start = 0
    while start < len(normalized):
        piece = normalized[start : start + chunk_size].strip()
        if piece:
            chunks.append(
                RagChunk(
                    text=piece,
                    metadata={**metadata, "chunk_part": len(chunks) + 1},
                    content_hash=compute_content_hash("user_upload_image", source_id, piece),
                )
            )
        if start + chunk_size >= len(normalized):
            break
        start += chunk_size - overlap
    return chunks


def _upload_metadata(upload_file: Any, session_id: str) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "session_id": session_id,
        "filename": upload_file.filename,
    }
    if upload_file.file_sha256:
        metadata["file_sha256"] = upload_file.file_sha256
    if upload_file.mime_type:
        metadata["mime_type"] = upload_file.mime_type
    return metadata


def _index_upload_file(
    upload_file: Any,
    source_type: str,
    user_id: str,
    assignment_uuid: str,
    assignment_snapshot_id: str | None,
    fallback_session_id: str | None,
    force_reindex: bool,
) -> tuple[int, int, int]:
    session_id = str(upload_file.session_id or fallback_session_id or "")
    if not session_id:
        logger.debug("[rag-index] %s upload skipped: no session_id", source_type)
        return 0, 0, 0
    if not upload_file.storage_url:
        logger.debug("[rag-index] %s upload skipped: no storage_url", source_type)
        return 0, 0, 0

    upload_identity = upload_file.file_sha256 or upload_file.filename
    source_id = f"{session_id}:{upload_identity}"
    metadata = _upload_metadata(upload_file, session_id)
    title = upload_file.filename
    doc = _build_rag_document(
        user_id=user_id,
        assignment_uuid=assignment_uuid,
        assignment_snapshot_id=assignment_snapshot_id,
        source_type=source_type,
        source_id=source_id,
        title=title,
        content_hash=source_id,
        metadata=metadata,
    )
    persisted_doc = supabase_client.upsert_rag_document(doc)
    doc_id = persisted_doc["id"]
    existing = supabase_client.get_existing_chunk_hashes(doc_id) if not force_reindex else set()
    if existing and not force_reindex:
        return 1, 0, len(existing)

    if source_type == "user_upload_pdf":
        pdf_file = PdfFile(
            filename=upload_file.filename,
            storage_url=upload_file.storage_url,
            file_sha256=upload_file.file_sha256,
        )
        extractions = extract_pdf_extractions_from_pdf_files([pdf_file], source="user_upload")
        chunks: list[RagChunk] = []
        for extraction in extractions:
            extraction_text = _pdf_extraction_text_for_chunking(extraction)
            chunks.extend(chunk_assignment_pdf(extraction_text, source_id, filename=upload_file.filename))
        chunks = _tag_chunks(chunks, metadata)
    elif source_type == "user_upload_image":
        image_file = ImageFile(
            filename=upload_file.filename,
            mime_type=upload_file.mime_type or "image/png",
            storage_url=upload_file.storage_url,
            file_sha256=upload_file.file_sha256,
        )
        result = extract_image_from_file(image_file)
        if result.status not in ("success", "empty") or not result.description.strip():
            return 1, 0, 0
        chunks = _split_image_description(result.description, source_id, metadata)
    else:
        return 0, 0, 0

    if not chunks:
        return 1, 0, 0

    indexed, skipped = _index_chunks(
        doc_id,
        user_id,
        assignment_uuid,
        source_type,
        source_id,
        chunks,
        existing,
        force_reindex,
    )
    return 1, indexed, skipped


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

        elif source_type in ("user_upload_pdf", "user_upload_image"):
            upload_files = request.upload_files or []
            if not upload_files:
                logger.debug("[rag-index] %s requested but no upload_files provided", source_type)
                continue
            for upload_file in upload_files:
                doc_count, indexed, skipped = _index_upload_file(
                    upload_file=upload_file,
                    source_type=source_type,
                    user_id=user_id,
                    assignment_uuid=assignment_uuid,
                    assignment_snapshot_id=snapshot_id,
                    fallback_session_id=session_id,
                    force_reindex=request.force_reindex,
                )
                total_docs += doc_count
                total_indexed += indexed
                total_skipped += skipped
            continue

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

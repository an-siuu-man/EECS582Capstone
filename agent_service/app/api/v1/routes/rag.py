from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query

from ....clients import supabase_client
from ....schemas.rag import IndexAssignmentRequest, IndexAssignmentResponse, RagStatusResponse
from ....services.rag_index_service import index_assignment

router = APIRouter(prefix="/rag", tags=["rag"])


@router.post("/index-assignment", response_model=IndexAssignmentResponse)
def index_assignment_route(req: IndexAssignmentRequest) -> IndexAssignmentResponse:
    """Chunk and embed assignment sources into pgvector.

    Idempotent — unchanged chunks are skipped based on content hash.
    """
    return index_assignment(req)


@router.get("/status/{assignment_uuid}", response_model=RagStatusResponse)
def rag_status(
    assignment_uuid: str,
    user_id: str = Query(..., description="Owner user UUID"),
) -> RagStatusResponse:
    """Return the RAG index status for an assignment."""
    rows = supabase_client.get_rag_status(user_id, assignment_uuid)

    if not rows:
        return RagStatusResponse(
            assignment_uuid=assignment_uuid,
            is_indexed=False,
            document_count=0,
            chunk_count=0,
            last_indexed_at=None,
            sources={},
        )

    source_counts: dict[str, int] = defaultdict(int)
    doc_ids: set[str] = set()
    latest_at: str | None = None

    for row in rows:
        source_counts[row["source_type"]] += 1
        doc_ids.add(row["document_id"])
        ts = row.get("created_at")
        if ts and (latest_at is None or ts > latest_at):
            latest_at = ts

    return RagStatusResponse(
        assignment_uuid=assignment_uuid,
        is_indexed=True,
        document_count=len(doc_ids),
        chunk_count=len(rows),
        last_indexed_at=latest_at,
        sources=dict(source_counts),
    )

from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


RagSourceType = Literal[
    "assignment_payload",
    "rubric",
    "guide_markdown",
    "assignment_pdf",
    "user_upload_pdf",
    "user_upload_image",
]

ALL_MVP_SOURCES: List[RagSourceType] = [
    "assignment_payload",
    "rubric",
    "guide_markdown",
    "assignment_pdf",
]


class IndexAssignmentRequest(BaseModel):
    user_id: UUID
    assignment_uuid: UUID
    session_id: Optional[UUID] = None
    sources: List[str] = Field(default_factory=lambda: list(ALL_MVP_SOURCES))
    force_reindex: bool = False


class IndexAssignmentResponse(BaseModel):
    assignment_uuid: str
    indexed_documents: int
    indexed_chunks: int
    skipped_unchanged_chunks: int
    embedding_model: str
    status: Literal["indexed", "partial", "no_sources"]


class RagSourceStatus(BaseModel):
    document_count: int
    chunk_count: int


class RagStatusResponse(BaseModel):
    assignment_uuid: str
    is_indexed: bool
    document_count: int
    chunk_count: int
    last_indexed_at: Optional[str]
    sources: Dict[str, int]

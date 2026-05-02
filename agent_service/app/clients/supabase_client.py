import os
from typing import Any, Optional

import httpx

_TIMEOUT = 20.0


def _headers() -> dict[str, str]:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _base() -> str:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    return f"{url}/rest/v1"


def _get(path: str, params: dict[str, str] | None = None) -> Any:
    resp = httpx.get(f"{_base()}/{path}", headers=_headers(), params=params, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _post(path: str, body: Any, extra_headers: dict[str, str] | None = None) -> Any:
    headers = {**_headers(), **(extra_headers or {})}
    resp = httpx.post(f"{_base()}/{path}", headers=headers, json=body, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _patch(path: str, query: dict[str, str], body: Any) -> None:
    headers = {**_headers(), "Prefer": "return=minimal"}
    resp = httpx.patch(
        f"{_base()}/{path}",
        headers=headers,
        params=query,
        json=body,
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def get_assignment_ingest(assignment_uuid: str) -> dict[str, Any] | None:
    """Fetch the assignment_ingest row for the given assignment UUID.

    Args:
        assignment_uuid: The UUID identifying the ingest.

    Returns:
        Row dict or None if not found.
    """
    rows = _get(
        "assignment_ingests",
        {"assignment_uuid": f"eq.{assignment_uuid}", "select": "assignment_uuid,assignment_snapshot_id"},
    )
    return rows[0] if rows else None


def get_assignment_snapshot(assignment_snapshot_id: str) -> dict[str, Any] | None:
    """Fetch an assignment snapshot row including raw_payload and rubric_json.

    Args:
        assignment_snapshot_id: UUID of the snapshot.

    Returns:
        Row dict or None.
    """
    rows = _get(
        "assignment_snapshots",
        {
            "id": f"eq.{assignment_snapshot_id}",
            "select": "id,assignment_id,title,raw_payload,rubric_json,description_text",
        },
    )
    return rows[0] if rows else None


def get_latest_guide_version(session_id: str) -> dict[str, Any] | None:
    """Fetch the most recent guide version for a chat session.

    Args:
        session_id: Chat session UUID.

    Returns:
        Row dict with content_text, or None if no guide exists.
    """
    rows = _get(
        "guide_versions",
        {
            "session_id": f"eq.{session_id}",
            "select": "id,version_number,content_text,created_at",
            "order": "version_number.desc",
            "limit": "1",
        },
    )
    return rows[0] if rows else None


def get_snapshot_files_with_extracted_text(assignment_snapshot_id: str) -> list[dict[str, Any]]:
    """Return snapshot files that have cached extracted_text.

    Args:
        assignment_snapshot_id: UUID of the assignment snapshot.

    Returns:
        List of row dicts with filename, file_sha256, extracted_text.
    """
    return _get(
        "assignment_snapshot_files",
        {
            "assignment_snapshot_id": f"eq.{assignment_snapshot_id}",
            "extracted_text": "not.is.null",
            "select": "id,filename,file_sha256,extracted_text",
        },
    )


def get_existing_chunk_hashes(document_id: str) -> set[str]:
    """Return the set of content_hash values already stored for a rag_document.

    Args:
        document_id: UUID of the rag_document.

    Returns:
        Set of hex hash strings.
    """
    rows = _get(
        "rag_chunks",
        {"document_id": f"eq.{document_id}", "select": "content_hash"},
    )
    return {r["content_hash"] for r in rows}


def get_rag_status(user_id: str, assignment_uuid: str) -> list[dict[str, Any]]:
    """Return rag_chunks aggregated by source_type for a user+assignment pair.

    Args:
        user_id: Owner user UUID.
        assignment_uuid: Assignment UUID.

    Returns:
        List of rows from rag_chunks with source_type, count, and latest created_at.
    """
    # PostgREST doesn't support GROUP BY directly; fetch all and aggregate in Python.
    return _get(
        "rag_chunks",
        {
            "user_id": f"eq.{user_id}",
            "assignment_uuid": f"eq.{assignment_uuid}",
            "select": "id,source_type,document_id,created_at",
        },
    )


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------


def upsert_rag_document(doc: dict[str, Any]) -> dict[str, Any]:
    """Upsert a rag_document row, returning the persisted row.

    Args:
        doc: Dict matching rag_documents columns.

    Returns:
        Persisted row dict including the generated or existing id.
    """
    rows = _post(
        "rag_documents",
        doc,
        extra_headers={"Prefer": "return=representation,resolution=merge-duplicates"},
    )
    return rows[0] if isinstance(rows, list) else rows


def bulk_insert_rag_chunks(chunks: list[dict[str, Any]]) -> None:
    """Insert rag_chunk rows, ignoring conflicts on the unique constraint.

    Args:
        chunks: List of dicts matching rag_chunks columns.
    """
    if not chunks:
        return
    _post(
        "rag_chunks",
        chunks,
        extra_headers={"Prefer": "return=minimal,resolution=ignore-duplicates"},
    )

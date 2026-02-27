"""
Artifact: agent_service/app/services/run_agent_service.py
Purpose: Coordinates request-level run-agent workflow execution for API handlers.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Added service layer to orchestrate PDF extraction and agent execution. (Ansuman Sharma)
Preconditions:
- Incoming request is validated as RunAgentRequest.
Inputs:
- Acceptable: Normalized payload object with optional PDF text/files.
- Unacceptable: Non-dict payloads or malformed PDF structures bypassing schema validation.
Postconditions:
- Agent is executed with merged PDF context and returns generated guide result.
Returns:
- Dictionary response from Headstart orchestrator.
Errors/Exceptions:
- Propagates orchestration/runtime exceptions to API layer for HTTP error mapping.
"""

from ..core.logging import get_logger
from ..orchestrators.headstart_orchestrator import run_headstart_agent
from ..schemas.requests import RunAgentRequest
from .pdf_text_service import extract_all_pdf_text

logger = get_logger("headstart.main")


def run_agent_workflow(req: RunAgentRequest, route_path: str) -> dict:
    """Execute the full run-agent workflow for a validated request."""
    title = req.payload.get("title", "(no title)") if isinstance(req.payload, dict) else "(unknown)"
    course_id = req.payload.get("courseId", "?") if isinstance(req.payload, dict) else "?"
    num_pdf_files = len(req.pdf_files or [])

    logger.info(
        "POST %s | title=%r | courseId=%s | pdf_text_len=%d | pdf_files=%d",
        route_path,
        title,
        course_id,
        len(req.pdf_text or ""),
        num_pdf_files,
    )

    pdf_text = extract_all_pdf_text(req)
    if pdf_text:
        logger.info("Combined PDF text: %d chars", len(pdf_text))

    result = run_headstart_agent(req.payload, pdf_text)
    logger.info(
        "Agent completed | keys=%s",
        list(result.keys()) if isinstance(result, dict) else type(result).__name__,
    )
    return result

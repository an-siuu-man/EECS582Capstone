"""
Artifact: agent_service/app/api/v1/routes/runs.py
Purpose: Defines run creation route handlers and maps runtime failures to HTTP responses.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Added versioned runs route module with shared run handler function. (Ansuman Sharma)
Preconditions:
- Incoming request body conforms to RunAgentRequest schema.
Inputs:
- Acceptable: POST body containing payload and optional pdf_text/pdf_files.
- Unacceptable: Invalid schema payloads or malformed JSON bodies.
Postconditions:
- Executes run-agent workflow and returns model-generated structured guide response.
Returns:
- Dictionary containing description, keyRequirements, deliverables, milestones, studyPlan, and risks.
Errors/Exceptions:
- Raises HTTPException(500) when workflow/orchestrator execution fails.
"""

import traceback

from fastapi import APIRouter, HTTPException

from ....core.logging import get_logger
from ....schemas.requests import RunAgentRequest
from ....services.run_agent_service import run_agent_workflow

logger = get_logger("headstart.main")
router = APIRouter(tags=["runs"])


def handle_run_agent_request(req: RunAgentRequest, route_path: str):
    """Shared run-agent handler body used by v1 and legacy routes."""
    try:
        return run_agent_workflow(req, route_path=route_path)
    except Exception as e:
        logger.error("Agent error: %s", repr(e))
        logger.debug("Traceback:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/runs")
def create_run(req: RunAgentRequest):
    return handle_run_agent_request(req, route_path="/api/v1/runs")

"""
Artifact: agent_service/app/api/v1/routes/health.py
Purpose: Defines health-check route handlers for versioned API and shared health logic.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Added versioned health route module with reusable handler function. (Ansuman Sharma)
Preconditions:
- FastAPI routing context is initialized.
Inputs:
- Acceptable: HTTP GET requests without body.
- Unacceptable: Unsupported HTTP methods at the health route.
Postconditions:
- Returns static service health status payload.
Returns:
- Dictionary with `ok: true`.
Errors/Exceptions:
- No custom exceptions expected for normal route execution.
"""

from fastapi import APIRouter

from ....core.logging import get_logger

logger = get_logger("headstart.main")
router = APIRouter(tags=["health"])


def get_health_status(route_path: str) -> dict:
    """Shared health-check handler body used by v1 and legacy routes."""
    logger.debug("GET %s", route_path)
    return {"ok": True}


@router.get("/health")
def health_v1():
    return get_health_status("/api/v1/health")

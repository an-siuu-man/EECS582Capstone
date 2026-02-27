"""
Artifact: agent_service/app/api/v1/router.py
Purpose: Aggregates v1 API route modules for single include in app startup.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Added composed API router for versioned routes. (Ansuman Sharma)
Preconditions:
- Route modules under api/v1/routes are importable.
Inputs:
- Acceptable: FastAPI include_router integration.
- Unacceptable: Missing route modules or invalid router objects.
Postconditions:
- Exposes a composed APIRouter containing health and run routes.
Returns:
- `APIRouter` instance.
Errors/Exceptions:
- Import errors if route modules cannot be resolved.
"""

from fastapi import APIRouter

from .routes.health import router as health_router
from .routes.runs import router as runs_router

api_v1_router = APIRouter()
api_v1_router.include_router(health_router)
api_v1_router.include_router(runs_router)

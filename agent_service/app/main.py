"""
Artifact: agent_service/app/main.py
Purpose: FastAPI application entrypoint that wires versioned routes and legacy compatibility endpoints.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Refactored monolithic app into modular routers/services while preserving legacy endpoint behavior. (Ansuman Sharma)
Preconditions:
- FastAPI runtime is available and app package imports resolve.
Inputs:
- Acceptable: HTTP requests to health and run-agent endpoints with schema-valid payloads.
- Unacceptable: Invalid JSON/schema data for POST run routes.
Postconditions:
- App serves both v1 (`/api/v1/*`) and legacy (`/health`, `/run-agent`) endpoints.
Returns:
- FastAPI `app` instance for ASGI servers.
Errors/Exceptions:
- Endpoint handlers map runtime failures to HTTP 500 responses with error detail.
"""

from fastapi import FastAPI

from .api.v1.router import api_v1_router
from .api.v1.routes.health import get_health_status
from .api.v1.routes.runs import (
    handle_run_agent_request,
    handle_run_agent_stream_request,
)
from .core.config import settings
from .core.logging import configure_logging
from .schemas.requests import RunAgentRequest

configure_logging()

app = FastAPI(title=settings.app_title)
app.include_router(api_v1_router, prefix="/api/v1")


@app.get("/health")
def health_legacy():
    return get_health_status("/health")


@app.post("/run-agent")
def run_agent_legacy(req: RunAgentRequest):
    return handle_run_agent_request(req, route_path="/run-agent")


@app.post("/run-agent/stream")
def run_agent_stream_legacy(req: RunAgentRequest):
    return handle_run_agent_stream_request(req, route_path="/run-agent/stream")

"""
Artifact: agent_service/app/agent.py
Purpose: Backward-compatible adapter exposing the agent orchestrator entrypoint.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Replaced inline agent implementation with orchestrator compatibility export. (Ansuman Sharma)
Preconditions:
- Orchestrator module is present and importable.
Inputs:
- Acceptable: Assignment payload dictionary and optional PDF text string.
- Unacceptable: Invalid import path usage when orchestrator module is unavailable.
Postconditions:
- Existing imports of `run_headstart_agent` continue to work.
Returns:
- Forwards orchestrator function return value.
Errors/Exceptions:
- ImportError if orchestrator module cannot be loaded.
"""

def run_headstart_agent(payload: dict, pdf_text: str = "") -> dict:
    """Backward-compatible lazy adapter around the orchestrator implementation."""
    from .orchestrators.headstart_orchestrator import run_headstart_agent as _impl

    return _impl(payload, pdf_text)

__all__ = ["run_headstart_agent"]

"""
Artifact: agent_service/app/api/v1/routes/chats.py
Purpose: Defines follow-up chat streaming route handlers and maps runtime failures to SSE events.
Author: Ansuman Sharma
Created: 2026-03-02
Revised:
- 2026-03-02: Added chat streaming endpoint and shared stream handler. (Codex)
Preconditions:
- Incoming request body conforms to ChatStreamRequest schema.
Inputs:
- Acceptable: POST body containing assignment payload, guide markdown, history, retrieval context, and user message.
- Unacceptable: Invalid schema payloads or malformed JSON bodies.
Postconditions:
- Executes chat streaming workflow and returns SSE events.
Returns:
- StreamingResponse with `text/event-stream` payload.
Errors/Exceptions:
- Internal runtime failures are converted into terminal `chat.error` events.
"""

import json
import traceback

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ....core.logging import get_logger
from ....schemas.requests import ChatStreamRequest
from ....services.run_agent_service import stream_chat_workflow

logger = get_logger("headstart.main")
router = APIRouter(tags=["chats"])


def _format_sse(event: str, data: dict, event_id: int) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    lines = [f"id: {event_id}", f"event: {event}"]
    for line in payload.splitlines() or [""]:
        lines.append(f"data: {line}")
    lines.append("")
    return "\n".join(lines) + "\n"


def handle_chat_stream_request(req: ChatStreamRequest, route_path: str):
    """Shared chat streaming handler body used by v1 and legacy routes."""

    def event_stream():
        try:
            for event_id, event in enumerate(
                stream_chat_workflow(req, route_path=route_path), start=1
            ):
                event_name = str(event.get("event", "message"))
                event_data = event.get("data", {})
                if not isinstance(event_data, dict):
                    event_data = {"value": event_data}
                yield _format_sse(event_name, event_data, event_id)
        except Exception as e:
            logger.error("Chat stream route error: %s", repr(e))
            logger.debug("Traceback:\n%s", traceback.format_exc())
            yield _format_sse(
                "chat.error",
                {
                    "stage": "failed",
                    "progress_percent": 100,
                    "status_message": "Follow-up response failed",
                    "message": str(e),
                },
                event_id=999999,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chats/stream")
def create_chat_stream(req: ChatStreamRequest):
    return handle_chat_stream_request(req, route_path="/api/v1/chats/stream")

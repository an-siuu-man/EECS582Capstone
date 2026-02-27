"""
Artifact: agent_service/app/schemas/requests.py
Purpose: Defines transport request models accepted by the run-agent API workflow.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Extracted request schemas into dedicated module. (Ansuman Sharma)
Preconditions:
- Pydantic BaseModel and typing modules are available.
Inputs:
- Acceptable: JSON object containing payload and optional assignment_uuid/pdf fields.
- Unacceptable: Missing payload object or invalid field types.
Postconditions:
- Request data is validated into a typed model used by services/routes.
Returns:
- `RunAgentRequest` model instances.
Errors/Exceptions:
- Pydantic validation errors for malformed request bodies.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from .shared import PdfFile


class RunAgentRequest(BaseModel):
    assignment_uuid: Optional[str] = None
    payload: Dict[str, Any]
    pdf_text: Optional[str] = ""
    pdf_files: Optional[List[PdfFile]] = []

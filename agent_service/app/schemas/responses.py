"""
Artifact: agent_service/app/schemas/responses.py
Purpose: Defines typed response payloads returned by the Headstart run-agent workflow.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Extracted response schemas into dedicated module. (Ansuman Sharma)
- 2026-03-01: Simplified guide output contract to a single markdown body field. (Codex)
Preconditions:
- Pydantic BaseModel is available.
Inputs:
- Acceptable: A non-empty markdown guide string.
- Unacceptable: Missing or non-string guide body.
Postconditions:
- Response objects can be validated for contract-compliant output.
Returns:
- `RunAgentResponse` model instances.
Errors/Exceptions:
- Pydantic validation errors when LLM output does not match schema.
"""

from pydantic import BaseModel, Field


class RunAgentResponse(BaseModel):
    guideMarkdown: str = Field(
        description="Single markdown body containing all guide sections, headings, and actionable details."
    )

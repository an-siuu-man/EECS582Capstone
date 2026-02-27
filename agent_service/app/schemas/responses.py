"""
Artifact: agent_service/app/schemas/responses.py
Purpose: Defines typed response payloads returned by the Headstart run-agent workflow.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Extracted response schemas into dedicated module. (Ansuman Sharma)
Preconditions:
- Pydantic BaseModel and shared schema models are available.
Inputs:
- Acceptable: Structured guide fields with list/object values matching schema types.
- Unacceptable: Missing required top-level fields or incompatible nested item types.
Postconditions:
- Response objects can be validated for contract-compliant output.
Returns:
- `RunAgentResponse` model instances.
Errors/Exceptions:
- Pydantic validation errors when LLM output does not match schema.
"""

from typing import List

from pydantic import BaseModel

from .shared import Milestone, StudyBlock


class RunAgentResponse(BaseModel):
    description: str
    keyRequirements: List[str]
    deliverables: List[str]
    milestones: List[Milestone]
    studyPlan: List[StudyBlock]
    risks: List[str]

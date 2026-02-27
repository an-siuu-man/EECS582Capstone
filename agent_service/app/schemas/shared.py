"""
Artifact: agent_service/app/schemas/shared.py
Purpose: Defines reusable shared schema objects used across requests and responses.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Split shared schema models into dedicated module. (Ansuman Sharma)
Preconditions:
- Pydantic BaseModel is installed and importable.
Inputs:
- Acceptable: JSON-compatible values matching declared field types.
- Unacceptable: Missing required fields or incompatible value types.
Postconditions:
- Shared Pydantic models validate and serialize contract-compatible data.
Returns:
- Typed model instances for PDF files, milestones, and study blocks.
Errors/Exceptions:
- Pydantic validation errors for invalid payload data.
"""

from pydantic import BaseModel


class PdfFile(BaseModel):
    filename: str
    base64_data: str


class Milestone(BaseModel):
    date: str
    task: str


class StudyBlock(BaseModel):
    durationMin: int
    focus: str

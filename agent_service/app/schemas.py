from pydantic import BaseModel
from typing import Any, List, Optional, Dict

class RunAgentRequest(BaseModel):
    assignment_uuid: Optional[str] = None
    payload: Dict[str, Any]  # normalized payload from extension/webapp
    pdf_text: Optional[str] = ""  # for now; later you’ll pass extracted text

class Milestone(BaseModel):
    date: str
    task: str

class StudyBlock(BaseModel):
    durationMin: int
    focus: str

class RunAgentResponse(BaseModel):
    tldr: str
    keyRequirements: List[str]
    deliverables: List[str]
    milestones: List[Milestone]
    studyPlan: List[StudyBlock]
    risks: List[str]
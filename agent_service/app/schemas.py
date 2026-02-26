from pydantic import BaseModel
from typing import Any, List, Optional, Dict

class PdfFile(BaseModel):
    filename: str
    base64_data: str

class RunAgentRequest(BaseModel):
    assignment_uuid: Optional[str] = None
    payload: Dict[str, Any]  # normalized payload from extension/webapp
    pdf_text: Optional[str] = ""  # extracted text from PDFs (legacy / direct text)
    pdf_files: Optional[List[PdfFile]] = []  # base64-encoded PDF files from Canvas

class Milestone(BaseModel):
    date: str
    task: str

class StudyBlock(BaseModel):
    durationMin: int
    focus: str

class RunAgentResponse(BaseModel):
    description: str
    keyRequirements: List[str]
    deliverables: List[str]
    milestones: List[Milestone]
    studyPlan: List[StudyBlock]
    risks: List[str]
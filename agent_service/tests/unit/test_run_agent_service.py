import unittest
from unittest.mock import patch

from app.schemas.requests import RunAgentRequest
from app.services.run_agent_service import run_agent_workflow

SAMPLE_RESULT = {
    "description": "summary",
    "keyRequirements": ["req"],
    "deliverables": ["del"],
    "milestones": [{"date": "Feb 20", "task": "Draft"}],
    "studyPlan": [{"durationMin": 30, "focus": "Read prompt"}],
    "risks": ["Late start"],
}


class TestRunAgentService(unittest.TestCase):
    def _build_request(self):
        return RunAgentRequest(
            assignment_uuid="abc-123",
            payload={"title": "HW1", "courseId": "101"},
            pdf_text="legacy",
            pdf_files=[],
        )

    def test_run_agent_workflow_orchestrates_extraction_and_agent_call(self):
        req = self._build_request()
        visual_signals = [{"file": "spec.pdf", "page": 1, "text": "Q1", "signal_types": ["highlight"]}]

        with patch(
            "app.services.run_agent_service.extract_pdf_context",
            return_value=("pdf context", visual_signals),
        ) as mock_extract, patch(
            "app.services.run_agent_service._run_headstart_agent",
            return_value=SAMPLE_RESULT,
        ) as mock_agent:
            result = run_agent_workflow(req, route_path="/run-agent")

        self.assertEqual(result, SAMPLE_RESULT)
        mock_extract.assert_called_once_with(req)
        mock_agent.assert_called_once_with(req.payload, "pdf context", visual_signals=visual_signals)

    def test_run_agent_workflow_handles_empty_pdf_text(self):
        req = self._build_request()

        with patch(
            "app.services.run_agent_service.extract_pdf_context",
            return_value=("", []),
        ) as mock_extract, patch(
            "app.services.run_agent_service._run_headstart_agent",
            return_value=SAMPLE_RESULT,
        ) as mock_agent:
            result = run_agent_workflow(req, route_path="/api/v1/runs")

        self.assertEqual(result, SAMPLE_RESULT)
        mock_extract.assert_called_once_with(req)
        mock_agent.assert_called_once_with(req.payload, "", visual_signals=[])


if __name__ == "__main__":
    unittest.main()

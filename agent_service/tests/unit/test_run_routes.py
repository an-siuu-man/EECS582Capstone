import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.v1.routes.runs import create_run, handle_run_agent_request
from app.main import run_agent_legacy
from app.schemas.requests import RunAgentRequest

SAMPLE_RESULT = {
    "description": "summary",
    "keyRequirements": ["req"],
    "deliverables": ["del"],
    "milestones": [{"date": "Feb 20", "task": "Draft"}],
    "studyPlan": [{"durationMin": 30, "focus": "Read prompt"}],
    "risks": ["Late start"],
}


class TestRunRoutes(unittest.TestCase):
    def _build_request(self):
        return RunAgentRequest(
            assignment_uuid="abc-123",
            payload={"title": "HW1", "courseId": "101"},
            pdf_text="",
            pdf_files=[],
        )

    def test_handle_run_agent_request_success(self):
        req = self._build_request()

        with patch(
            "app.api.v1.routes.runs.run_agent_workflow",
            return_value=SAMPLE_RESULT,
        ) as mock_workflow:
            result = handle_run_agent_request(req, route_path="/api/v1/runs")

        self.assertEqual(result, SAMPLE_RESULT)
        mock_workflow.assert_called_once_with(req, route_path="/api/v1/runs")

    def test_handle_run_agent_request_maps_exceptions_to_http_500(self):
        req = self._build_request()

        with patch(
            "app.api.v1.routes.runs.run_agent_workflow",
            side_effect=RuntimeError("boom"),
        ):
            with self.assertRaises(HTTPException) as exc:
                handle_run_agent_request(req, route_path="/api/v1/runs")

        self.assertEqual(exc.exception.status_code, 500)
        self.assertEqual(exc.exception.detail, "boom")

    def test_create_run_forwards_expected_route_path(self):
        req = self._build_request()

        with patch(
            "app.api.v1.routes.runs.handle_run_agent_request",
            return_value=SAMPLE_RESULT,
        ) as mock_handler:
            result = create_run(req)

        self.assertEqual(result, SAMPLE_RESULT)
        mock_handler.assert_called_once_with(req, route_path="/api/v1/runs")

    def test_legacy_run_route_forwards_expected_route_path(self):
        req = self._build_request()

        with patch(
            "app.main.handle_run_agent_request",
            return_value=SAMPLE_RESULT,
        ) as mock_handler:
            result = run_agent_legacy(req)

        self.assertEqual(result, SAMPLE_RESULT)
        mock_handler.assert_called_once_with(req, route_path="/run-agent")


if __name__ == "__main__":
    unittest.main()

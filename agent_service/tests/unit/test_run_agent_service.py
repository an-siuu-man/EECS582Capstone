import unittest
from unittest.mock import patch
from uuid import UUID

from app.schemas.rag import RetrievedChunk
from app.schemas.requests import ChatStreamRequest, RunAgentRequest
from app.services.run_agent_service import (
    run_agent_workflow,
    stream_chat_workflow,
    stream_run_agent_workflow,
)

SAMPLE_RESULT = {
    "guideMarkdown": "## Assignment Overview\n\nWrite a concise draft.",
}


def _retrieved_chunk(index: int, source_type: str, text: str, similarity: float = 0.9):
    return RetrievedChunk(
        chunk_id=UUID(f"00000000-0000-0000-0000-{index:012d}"),
        document_id=UUID(f"11111111-1111-1111-1111-{index:012d}"),
        source_type=source_type,
        source_id=f"source-{index}",
        text=text,
        metadata={},
        similarity=similarity,
    )


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
            "app.services.run_agent_service.extract_pdf_extractions_with_file_map",
            return_value=([], {}),
        ) as mock_extract, patch(
            "app.services.run_agent_service.format_pdf_extractions_for_prompt",
            return_value="pdf context",
        ), patch(
            "app.services.run_agent_service.collect_visual_signals_from_extractions",
            return_value=visual_signals,
        ), patch(
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
            "app.services.run_agent_service.extract_pdf_extractions_with_file_map",
            return_value=([], {}),
        ) as mock_extract, patch(
            "app.services.run_agent_service.format_pdf_extractions_for_prompt",
            return_value="",
        ), patch(
            "app.services.run_agent_service.collect_visual_signals_from_extractions",
            return_value=[],
        ), patch(
            "app.services.run_agent_service._run_headstart_agent",
            return_value=SAMPLE_RESULT,
        ) as mock_agent:
            result = run_agent_workflow(req, route_path="/api/v1/runs")

        self.assertEqual(result, SAMPLE_RESULT)
        mock_extract.assert_called_once_with(req)
        mock_agent.assert_called_once_with(req.payload, "", visual_signals=[])

    def test_stream_run_agent_workflow_emits_reasoning_deltas_and_completion_thinking(self):
        req = self._build_request()

        with patch(
            "app.services.run_agent_service.extract_pdf_extractions_with_file_map",
            return_value=([], {}),
        ), patch(
            "app.services.run_agent_service.format_pdf_extractions_for_prompt",
            return_value="",
        ), patch(
            "app.services.run_agent_service.collect_visual_signals_from_extractions",
            return_value=[],
        ), patch(
            "app.services.run_agent_service._stream_headstart_agent_markdown",
            return_value=iter(
                [
                    {"content_delta": "", "reasoning_delta": "thinking-1"},
                    {"content_delta": "Guide body", "reasoning_delta": "thinking-2"},
                ]
            ),
        ), patch(
            "app.services.run_agent_service._classify_assignment",
            return_value="coding",
        ):
            events = list(stream_run_agent_workflow(req, route_path="/api/v1/runs/stream"))

        delta_events = [event for event in events if event.get("event") == "run.delta"]
        self.assertGreaterEqual(len(delta_events), 2)
        self.assertEqual(delta_events[0]["data"]["reasoning_delta"], "thinking-1")
        self.assertEqual(delta_events[1]["data"]["delta"], "Guide body")
        self.assertEqual(delta_events[1]["data"]["reasoning_delta"], "thinking-2")

        completed_events = [event for event in events if event.get("event") == "run.completed"]
        self.assertEqual(len(completed_events), 1)
        completed = completed_events[0]["data"]
        self.assertEqual(completed["guideMarkdown"], "Guide body")
        self.assertEqual(completed["assignment_category"], "coding")
        self.assertEqual(completed["thinking_content"], "thinking-1thinking-2")

        classifying_events = [
            event
            for event in events
            if event.get("event") == "run.stage"
            and event.get("data", {}).get("stage") == "classifying_assignment"
        ]
        self.assertEqual(len(classifying_events), 1)
        self.assertEqual(classifying_events[0]["data"]["status_message"], "Classifying assignment")
        classifying_index = events.index(classifying_events[0])
        first_delta_index = next(
            index for index, event in enumerate(events) if event.get("event") == "run.delta"
        )
        self.assertLess(classifying_index, first_delta_index)

    def test_stream_chat_workflow_emits_reasoning_deltas_and_completion_thinking(self):
        req = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[],
            user_message="What should I do first?",
        )

        with patch(
            "app.services.run_agent_service._stream_headstart_chat_answer",
            return_value=iter(
                [
                    {"content_delta": "", "reasoning_delta": "think-a"},
                    {"content_delta": "Start with milestone one.", "reasoning_delta": "think-b"},
                ]
            ),
        ) as mock_stream:
            events = list(stream_chat_workflow(req, route_path="/api/v1/chats/stream"))

        delta_events = [event for event in events if event.get("event") == "chat.delta"]
        self.assertGreaterEqual(len(delta_events), 2)
        self.assertEqual(delta_events[0]["data"]["reasoning_delta"], "think-a")
        self.assertEqual(delta_events[1]["data"]["delta"], "Start with milestone one.")
        self.assertEqual(delta_events[1]["data"]["reasoning_delta"], "think-b")

        completed_events = [event for event in events if event.get("event") == "chat.completed"]
        self.assertEqual(len(completed_events), 1)
        completed = completed_events[0]["data"]
        self.assertEqual(completed["assistant_message"], "Start with milestone one.")
        self.assertEqual(completed["thinking_content"], "think-athink-b")
        mock_stream.assert_called_once_with(
            assignment_payload={"title": "HW1"},
            assignment_category="",
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context_text="(none)",
            user_message="What should I do first?",
            include_thinking=False,
            calendar_context=None,
            assignment_pdf_text="",
            user_attachments_context="",
        )

    def test_chat_stream_request_defaults_thinking_mode_false(self):
        req = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[],
            user_message="Default mode?",
        )

        self.assertFalse(req.thinking_mode)

    def test_stream_chat_workflow_passes_thinking_mode_true(self):
        req = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[],
            user_message="Use thinking mode",
            thinking_mode=True,
        )

        with patch(
            "app.services.run_agent_service._stream_headstart_chat_answer",
            return_value=iter(
                [
                    {"content_delta": "Use milestones.", "reasoning_delta": ""},
                ]
            ),
        ) as mock_stream:
            events = list(stream_chat_workflow(req, route_path="/api/v1/chats/stream"))

        completed_events = [event for event in events if event.get("event") == "chat.completed"]
        self.assertEqual(len(completed_events), 1)
        mock_stream.assert_called_once_with(
            assignment_payload={"title": "HW1"},
            assignment_category="",
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context_text="(none)",
            user_message="Use thinking mode",
            include_thinking=True,
            calendar_context=None,
            assignment_pdf_text="",
            user_attachments_context="",
        )

    def test_stream_chat_workflow_passes_calendar_context_payload(self):
        req = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[],
            user_message="Schedule time blocks for me",
            calendar_context={
                "assignment_id": "assign-1",
                "timezone": "America/Chicago",
                "availability_reason": "available",
                "integration": {
                    "google": {
                        "status": "connected",
                        "connected": True,
                    }
                },
                "no_slots_found": False,
                "free_slots": [
                    {
                        "start_iso": "2026-03-27T15:00:00Z",
                        "end_iso": "2026-03-27T16:00:00Z",
                        "duration_minutes": 60,
                        "score": 90,
                        "reason": "Good afternoon block",
                    }
                ],
                "recommended_sessions": [
                    {
                        "start_iso": "2026-03-27T15:00:00Z",
                        "end_iso": "2026-03-27T16:00:00Z",
                        "focus": "Deep work",
                        "priority": "high",
                    }
                ],
            },
        )

        with patch(
            "app.services.run_agent_service._stream_headstart_chat_answer",
            return_value=iter(
                [
                    {"content_delta": "Use the open afternoon block.", "reasoning_delta": ""},
                ]
            ),
        ) as mock_stream:
            events = list(stream_chat_workflow(req, route_path="/api/v1/chats/stream"))

        completed_events = [event for event in events if event.get("event") == "chat.completed"]
        self.assertEqual(len(completed_events), 1)
        mock_stream.assert_called_once_with(
            assignment_payload={"title": "HW1"},
            assignment_category="",
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context_text="(none)",
            user_message="Schedule time blocks for me",
            include_thinking=False,
            calendar_context={
                "assignment_id": "assign-1",
                "timezone": "America/Chicago",
                "availability_reason": "available",
                "integration": {
                    "google": {
                        "status": "connected",
                        "connected": True,
                    }
                },
                "no_slots_found": False,
                "free_slots": [
                    {
                        "start_iso": "2026-03-27T15:00:00Z",
                        "end_iso": "2026-03-27T16:00:00Z",
                        "duration_minutes": 60,
                        "score": 90.0,
                        "reason": "Good afternoon block",
                    }
                ],
                "recommended_sessions": [
                    {
                        "start_iso": "2026-03-27T15:00:00Z",
                        "end_iso": "2026-03-27T16:00:00Z",
                        "focus": "Deep work",
                        "priority": "high",
                    }
                ],
            },
            assignment_pdf_text="",
            user_attachments_context="",
        )

    def test_stream_chat_workflow_passes_assignment_category(self):
        req = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            assignment_category="mathematics",
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[],
            user_message="How should I start?",
        )

        with patch(
            "app.services.run_agent_service._stream_headstart_chat_answer",
            return_value=iter(
                [
                    {"content_delta": "Start by naming the givens.", "reasoning_delta": ""},
                ]
            ),
        ) as mock_stream:
            events = list(stream_chat_workflow(req, route_path="/api/v1/chats/stream"))

        completed_events = [event for event in events if event.get("event") == "chat.completed"]
        self.assertEqual(len(completed_events), 1)
        mock_stream.assert_called_once_with(
            assignment_payload={"title": "HW1"},
            assignment_category="mathematics",
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context_text="(none)",
            user_message="How should I start?",
            include_thinking=False,
            calendar_context=None,
            assignment_pdf_text="",
            user_attachments_context="",
        )

    def test_chat_stream_request_accepts_review_window_reasons(self):
        available_review = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[],
            user_message="Can I review this next week?",
            calendar_context={
                "assignment_id": "assign-1",
                "timezone": "America/Chicago",
                "availability_reason": "available_review_window",
                "integration": {
                    "google": {
                        "status": "connected",
                        "connected": True,
                    }
                },
                "no_slots_found": False,
                "free_slots": [
                    {
                        "start_iso": "2026-03-30T15:00:00Z",
                        "end_iso": "2026-03-30T16:00:00Z",
                        "duration_minutes": 60,
                        "score": 90,
                        "reason": "Open review window slot",
                    }
                ],
                "recommended_sessions": [
                    {
                        "start_iso": "2026-03-30T15:00:00Z",
                        "end_iso": "2026-03-30T16:00:00Z",
                        "focus": "Concept review",
                        "priority": "medium",
                    }
                ],
            },
        )
        self.assertEqual(
            available_review.calendar_context.availability_reason,  # type: ignore[union-attr]
            "available_review_window",
        )

        no_slots_review = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[],
            user_message="Any time for review?",
            calendar_context={
                "assignment_id": "assign-1",
                "timezone": "America/Chicago",
                "availability_reason": "no_slots_in_review_window",
                "integration": {
                    "google": {
                        "status": "connected",
                        "connected": True,
                    }
                },
                "no_slots_found": True,
                "free_slots": [],
                "recommended_sessions": [],
            },
        )
        self.assertEqual(
            no_slots_review.calendar_context.availability_reason,  # type: ignore[union-attr]
            "no_slots_in_review_window",
        )

    def test_stream_chat_workflow_semantic_mode_uses_semantic_context(self):
        req = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[
                {
                    "chunk_id": "legacy-1",
                    "source": "guide_markdown",
                    "text": "Legacy lexical context",
                    "score": 0.4,
                }
            ],
            user_id="aaaaaaaa-0000-0000-0000-000000000001",
            assignment_uuid="bbbbbbbb-0000-0000-0000-000000000002",
            retrieval_mode="semantic",
            user_message="What does the rubric require?",
        )
        semantic = [_retrieved_chunk(1, "rubric", "Semantic rubric context")]

        with patch(
            "app.services.run_agent_service.retrieve_rag_chunks",
            return_value=semantic,
        ), patch(
            "app.services.run_agent_service._stream_headstart_chat_answer",
            return_value=iter([{"content_delta": "Use the rubric.", "reasoning_delta": ""}]),
        ) as mock_stream:
            events = list(stream_chat_workflow(req, route_path="/api/v1/chats/stream"))

        context = mock_stream.call_args.kwargs["retrieval_context_text"]
        self.assertIn("Semantic rubric context", context)
        self.assertNotIn("Legacy lexical context", context)
        completed = [event for event in events if event.get("event") == "chat.completed"][0]["data"]
        self.assertEqual(completed["sources"][0]["source_type"], "rubric")
        self.assertEqual(completed["sources"][0]["label"], "A")

    def test_stream_chat_workflow_hybrid_mode_merges_and_deduplicates(self):
        req = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[
                {
                    "chunk_id": "legacy-1",
                    "source": "guide_markdown",
                    "text": "Semantic guide context",
                    "score": 0.8,
                },
                {
                    "chunk_id": "legacy-2",
                    "source": "assignment_payload",
                    "text": "Unique lexical payload context",
                    "score": 0.6,
                },
            ],
            user_id="aaaaaaaa-0000-0000-0000-000000000001",
            assignment_uuid="bbbbbbbb-0000-0000-0000-000000000002",
            retrieval_mode="hybrid",
            user_message="What should I do?",
        )
        semantic = [_retrieved_chunk(1, "guide_markdown", "Semantic guide context")]

        with patch(
            "app.services.run_agent_service.retrieve_rag_chunks",
            return_value=semantic,
        ), patch(
            "app.services.run_agent_service._stream_headstart_chat_answer",
            return_value=iter([{"content_delta": "Start here.", "reasoning_delta": ""}]),
        ) as mock_stream:
            events = list(stream_chat_workflow(req, route_path="/api/v1/chats/stream"))

        context = mock_stream.call_args.kwargs["retrieval_context_text"]
        self.assertEqual(context.count("Semantic guide context"), 1)
        self.assertIn("Unique lexical payload context", context)
        completed = [event for event in events if event.get("event") == "chat.completed"][0]["data"]
        self.assertEqual(len(completed["sources"]), 2)

    def test_stream_chat_workflow_retrieval_exception_warns_and_uses_lexical(self):
        req = ChatStreamRequest(
            assignment_payload={"title": "HW1"},
            guide_markdown="Guide body",
            chat_history=[],
            retrieval_context=[
                {
                    "chunk_id": "legacy-1",
                    "source": "guide_markdown",
                    "text": "Fallback lexical context",
                    "score": 0.7,
                }
            ],
            user_id="aaaaaaaa-0000-0000-0000-000000000001",
            assignment_uuid="bbbbbbbb-0000-0000-0000-000000000002",
            retrieval_mode="hybrid",
            user_message="What should I do?",
        )

        with patch(
            "app.services.run_agent_service.retrieve_rag_chunks",
            side_effect=RuntimeError("index unavailable"),
        ), patch(
            "app.services.run_agent_service._stream_headstart_chat_answer",
            return_value=iter([{"content_delta": "Use fallback.", "reasoning_delta": ""}]),
        ) as mock_stream:
            events = list(stream_chat_workflow(req, route_path="/api/v1/chats/stream"))

        warning_events = [event for event in events if event.get("event") == "chat.retrieval_warning"]
        self.assertEqual(len(warning_events), 1)
        self.assertIn("index unavailable", warning_events[0]["data"]["message"])
        context = mock_stream.call_args.kwargs["retrieval_context_text"]
        self.assertIn("Fallback lexical context", context)


if __name__ == "__main__":
    unittest.main()

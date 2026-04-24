import os
import unittest
from unittest.mock import patch

from app.orchestrators.headstart_orchestrator import (
    stream_headstart_agent_markdown,
    stream_headstart_chat_answer,
)


class FakeChunk:
    def __init__(self, content: str, reasoning_content: str = ""):
        self.content = content
        self.additional_kwargs = {}
        if reasoning_content:
            self.additional_kwargs["reasoning_content"] = reasoning_content


class FakeStreamingClient:
    def __init__(self, chunks):
        self.chunks = chunks
        self.stream_calls = []

    def stream(self, messages, **kwargs):
        self.stream_calls.append((messages, kwargs))
        yield from self.chunks

    def invoke(self, *args, **kwargs):
        raise AssertionError("streaming paths must not use invoke fallback")


class TestHeadstartOrchestratorStreaming(unittest.TestCase):
    def test_stream_headstart_agent_markdown_uses_provider_stream(self):
        fake_client = FakeStreamingClient(
            [
                FakeChunk("", "thinking-1"),
                FakeChunk("## Assignment Overview\n\nStart here.", "thinking-2"),
            ]
        )

        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-key"}, clear=False), patch(
            "app.orchestrators.headstart_orchestrator.build_nvidia_chat_client",
            return_value=fake_client,
        ):
            chunks = list(stream_headstart_agent_markdown({"title": "HW1"}))

        self.assertEqual(
            chunks,
            [
                {"content_delta": "", "reasoning_delta": "thinking-1"},
                {
                    "content_delta": "## Assignment Overview\n\nStart here.",
                    "reasoning_delta": "thinking-2",
                },
            ],
        )
        self.assertEqual(len(fake_client.stream_calls), 1)
        self.assertEqual(fake_client.stream_calls[0][1], {})

    def test_stream_headstart_chat_answer_suppresses_reasoning_when_disabled(self):
        fake_client = FakeStreamingClient(
            [
                FakeChunk("Start with the rubric.", "private-thinking"),
            ]
        )

        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-key"}, clear=False), patch(
            "app.orchestrators.headstart_orchestrator.build_nvidia_chat_client",
            return_value=fake_client,
        ):
            chunks = list(
                stream_headstart_chat_answer(
                    assignment_payload={"title": "HW1"},
                    guide_markdown="Guide",
                    user_message="What first?",
                    include_thinking=False,
                )
            )

        self.assertEqual(
            chunks,
            [{"content_delta": "Start with the rubric.", "reasoning_delta": ""}],
        )
        self.assertEqual(len(fake_client.stream_calls), 1)


if __name__ == "__main__":
    unittest.main()

"""
Artifact: agent_service/app/orchestrators/headstart_orchestrator.py
Purpose: Runs the Headstart LLM orchestration flow and parses model output into structured guide data.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Moved agent workflow logic into orchestrator module with unchanged runtime behavior. (Ansuman Sharma)
Preconditions:
- NVIDIA_API_KEY is configured in environment.
- LangChain/NVIDIA dependencies are installed.
Inputs:
- Acceptable: Normalized assignment payload dictionary and optional extracted PDF text string.
- Unacceptable: Missing payload dictionary, empty model responses, or malformed JSON output.
Postconditions:
- Returns structured guide object parsed from model output.
Returns:
- Dictionary matching RunAgentResponse schema fields.
Errors/Exceptions:
- RuntimeError for missing API key or repeated parsing/generation failures.
- ValueError for irreparable malformed model JSON output.
"""

import ast
import json
import os
import re
import time
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate

from ..clients.llm_client import build_nvidia_chat_client
from ..core.logging import get_logger
from ..schemas.responses import RunAgentResponse

logger = get_logger("headstart.agent")

MODEL_NAME = "nvidia/nemotron-nano-12b-v2-vl"
TEMPERATURE = 0.3
MAX_OUTPUT_TOKENS = 8192
MAX_RETRIES = 2

SYSTEM_PROMPT = """\
You are an academic assistant helping a student understand a Canvas assignment.

Your job is to analyze the assignment details and any attached file contents,
then produce a structured guide that helps the student succeed.

Guidelines for the "description" field:
- Write in **markdown** format (use headings, bold, bullet lists).
- Start with a concise overview of what the assignment is about.
- Cover important details: topic, scope, expectations.
- If attached file contents are provided, add a section "### Referenced Materials"
  summarizing key information from those files and how they relate to the assignment.
- Be specific and actionable — avoid vague platitudes.

Guidelines for other fields:
- "keyRequirements": Specific requirements the student must fulfill.
- "deliverables": Concrete items the student must submit.
- "milestones": Suggested timeline working backwards from the due date.
  All dates and times MUST be expressed in the student's timezone (provided in the payload).
- "studyPlan": Suggested study blocks (duration in minutes + focus area).
- "risks": Potential pitfalls or common mistakes to watch for.

Important: When the payload includes a "userTimezone" field, use that timezone for ALL dates
and times in your output (milestones, deadlines, etc.). Format dates clearly, e.g.
"Feb 15, 11:59 PM EST". If no timezone is provided, use the due date as-is.\
"""

HUMAN_TEMPLATE = """\
Analyze the following assignment and produce a structured guide.

Assignment payload:
{payload}

Student's timezone: {timezone}

Attached file contents (may be empty):
{pdf_text}\
"""


def _to_text(x):
    """Normalize LangChain outputs into a plain string."""
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    if isinstance(x, list):
        return "\n".join(_to_text(i) for i in x)
    content = getattr(x, "content", None)
    if content is not None:
        return _to_text(content)
    return str(x)


def _maybe_unwrap_text_dict(text: str) -> str:
    """Unwrap google-genai text wrappers like {'type': 'text', 'text': '...'}."""
    if not text:
        return text
    s = text.strip()
    if not (s.startswith("{") or s.startswith("[")) and "{'type'" not in s:
        return text
    try:
        obj = ast.literal_eval(s)
        if isinstance(obj, dict) and "text" in obj and isinstance(obj["text"], str):
            return obj["text"]
        if isinstance(obj, list) and len(obj) > 0:
            first = obj[0]
            if isinstance(first, dict) and "text" in first and isinstance(first["text"], str):
                return first["text"]
    except Exception:
        pass
    return text


def _try_parse_json(text: str) -> dict:
    """Parse model output into JSON with repair heuristics."""
    if not text:
        raise ValueError("Empty model output; cannot extract JSON.")

    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in model output.")
    raw = text[start : end + 1]

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    repaired = (
        raw.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("'", '"')
    )
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)
    repaired = re.sub(r"[\x00-\x1F\x7F]", "", repaired)
    repaired = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*):', r'\1"\2"\3:', repaired)

    try:
        return json.loads(repaired)
    except json.JSONDecodeError as e:
        snippet = repaired[:500]
        raise ValueError(f"Could not parse model output as JSON. {e}. Snippet: {snippet}")


def _try_structured_output(llm, payload_str: str, pdf_text_str: str, timezone_str: str) -> Optional[dict]:
    """
    Use LangChain's with_structured_output() to get schema-conforming output.
    Returns None if this approach fails (so caller can fall back).
    """
    try:
        structured_llm = llm.with_structured_output(RunAgentResponse)

        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(
                content=HUMAN_TEMPLATE.format(
                    payload=payload_str,
                    pdf_text=pdf_text_str,
                    timezone=timezone_str,
                )
            ),
        ]

        logger.info("Invoking structured output chain…")
        t0 = time.time()

        response = structured_llm.invoke(messages)

        elapsed_ms = int((time.time() - t0) * 1000)
        logger.info("Structured output returned in %dms", elapsed_ms)

        if response is None:
            logger.warning("Structured output returned None")
            return None

        result = response.model_dump()
        logger.info("Structured output succeeded | keys=%s", list(result.keys()))
        return result

    except Exception as e:
        logger.warning("Structured output failed: %s", repr(e))
        return None


def _try_prompt_based(llm, payload_str: str, pdf_text_str: str, timezone_str: str) -> dict:
    """
    Fallback: use a prompt that asks the model to return JSON directly,
    then parse it with repair heuristics.
    """
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT),
            (
                "human",
                """\
Return STRICT JSON ONLY (no markdown fences wrapping the JSON, no commentary outside the object).
Use DOUBLE QUOTES for all keys and string values. No trailing commas.

Return a JSON object matching this schema:
{{
  "description": "markdown string",
  "keyRequirements": ["string"],
  "deliverables": ["string"],
  "milestones": [{{"date": "string", "task": "string"}}],
  "studyPlan": [{{"durationMin": 30, "focus": "string"}}],
  "risks": ["string"]
}}

Assignment payload:
{payload}

Student's timezone: {timezone}

Attached file contents:
{pdf_text}""",
            ),
        ]
    )

    chain = prompt | llm

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("Prompt-based attempt %d/%d…", attempt, MAX_RETRIES)
            t0 = time.time()

            res = chain.invoke(
                {
                    "payload": payload_str,
                    "pdf_text": pdf_text_str,
                    "timezone": timezone_str,
                }
            )

            elapsed_ms = int((time.time() - t0) * 1000)
            logger.info("LLM returned in %dms (attempt %d)", elapsed_ms, attempt)

            text = _to_text(res).strip()
            text = _maybe_unwrap_text_dict(text).strip()

            logger.debug("Model output (first 500 chars): %r", text[:500])

            result = _try_parse_json(text)
            logger.info("Prompt-based parse succeeded | keys=%s", list(result.keys()))
            return result

        except Exception as e:
            last_error = e
            logger.warning("Attempt %d failed: %s", attempt, repr(e))

    raise RuntimeError(f"All {MAX_RETRIES} attempts failed. Last error: {last_error}")


def run_headstart_agent(payload: dict, pdf_text: str = "") -> dict:
    """
    Run the Headstart AI agent using Nvidia Nemotron via LangChain.

    Strategy:
      1. Try structured output (with_structured_output) for reliable schema-conforming JSON.
      2. If structured output fails, fall back to prompt-based generation with manual parsing.
    """
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise RuntimeError("NVIDIA_API_KEY is not set")

    logger.info(
        "Initializing LLM | model=%s temperature=%s max_tokens=%d",
        MODEL_NAME,
        TEMPERATURE,
        MAX_OUTPUT_TOKENS,
    )

    llm = build_nvidia_chat_client(
        model_name=MODEL_NAME,
        temperature=TEMPERATURE,
        max_tokens=MAX_OUTPUT_TOKENS,
    )

    payload_str = json.dumps(payload, ensure_ascii=False)
    pdf_text_str = pdf_text or "(no attached files)"
    timezone_str = payload.get("userTimezone") or "Not specified (use due date as-is)"

    result = _try_structured_output(llm, payload_str, pdf_text_str, timezone_str)
    if result is not None:
        return result

    logger.info("Falling back to prompt-based generation")
    return _try_prompt_based(llm, payload_str, pdf_text_str, timezone_str)

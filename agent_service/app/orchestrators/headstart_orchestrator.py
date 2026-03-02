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
- Returns a validated markdown guide object parsed from model output.
Returns:
- Dictionary containing `guideMarkdown`.
Errors/Exceptions:
- RuntimeError for missing API key or repeated parsing/generation failures.
- ValueError for irreparable malformed model JSON output.
"""

import ast
import json
import os
import re
import time
from typing import Iterator, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate

from ..clients.llm_client import build_nvidia_chat_client
from ..core.logging import get_logger
from ..schemas.responses import RunAgentResponse

logger = get_logger("headstart.agent")

MODEL_NAME = "nvidia/llama-3.3-nemotron-super-49b-v1.5"
TEMPERATURE = 0.3
MAX_OUTPUT_TOKENS = 8192
MAX_RETRIES = 2

SYSTEM_PROMPT = """\
You are an academic assistant helping a student understand a Canvas assignment.

Your job is to analyze the assignment details and any attached file contents,
then produce a structured guide that helps the student succeed.

If visual emphasis context is provided (highlighted / underlined / style-emphasized text),
treat high-significance markers as likely important requirements and reflect that priority.

Output requirement:
- Return one markdown body in the `guideMarkdown` field.
- The markdown body must include headings/subheadings and bullets directly in the text.
- Do not return split section arrays like keyRequirements or milestones.
- Use this exact practical, student-friendly structure:
  - `## Assignment Overview`
  - `## Key Requirements`
  - `## Deliverables`
  - `## Milestones`
  - `## Study Plan`
  - `## Risks`
  - `## Referenced Materials` (when file context exists)
- Use concrete, actionable wording and avoid filler.

Important: When the payload includes a "userTimezone" field, use that timezone for ALL dates
and times in your output (milestones, deadlines, etc.). Format dates clearly, e.g.
"Feb 15, 11:59 PM EST". If no timezone is provided, use the due date as-is.\
"""

HUMAN_TEMPLATE = """\
Analyze the following assignment and produce a structured guide.

Assignment payload:
{payload}

Student's timezone: {timezone}

Visual emphasis context (high/medium significance markers from PDF annotations/styles):
{visual_signals}

Attached file contents (may be empty):
{pdf_text}\
"""

SYSTEM_PROMPT_MARKDOWN = """\
You are an academic assistant helping a student understand a Canvas assignment.

Produce one polished markdown guide body for this assignment.

Formatting requirements:
- Return MARKDOWN ONLY (no JSON, no code fences, no preamble).
- Include clear headings/subheadings directly in the markdown body.
- Use this practical structure and order:
  - `## Assignment Overview`
  - `## Key Requirements`
  - `## Deliverables`
  - `## Milestones`
  - `## Study Plan`
  - `## Risks`
  - `## Referenced Materials` (when file context exists)
- Use concise, student-friendly language with actionable bullets.

Important timezone rule:
- If the payload contains `userTimezone`, use that timezone for all dates/times.
- If timezone is not provided, keep due-date references as provided.
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


def _format_visual_signals_for_prompt(visual_signals: Optional[list[dict]]) -> str:
    if not visual_signals:
        return "(none)"

    ranked = sorted(
        [s for s in visual_signals if isinstance(s, dict)],
        key=lambda s: (
            -float(s.get("score", 0.0)),
            int(s.get("page", 0)),
            str(s.get("text", "")),
        ),
    )
    lines = []
    for sig in ranked[:40]:
        text = str(sig.get("text", "")).strip()
        if not text:
            continue
        lines.append(
            "- [{file} p{page}] {text} | signals={types} | significance={siglvl} | score={score}".format(
                file=sig.get("file", "?"),
                page=sig.get("page", "?"),
                text=text,
                types=",".join(sig.get("signal_types", [])) or "unknown",
                siglvl=sig.get("significance", "unknown"),
                score=sig.get("score", "?"),
            )
        )
    return "\n".join(lines) if lines else "(none)"


def _try_structured_output(
    llm,
    payload_str: str,
    pdf_text_str: str,
    timezone_str: str,
    visual_signals_str: str,
) -> Optional[dict]:
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
                    visual_signals=visual_signals_str,
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


def _try_prompt_based(
    llm,
    payload_str: str,
    pdf_text_str: str,
    timezone_str: str,
    visual_signals_str: str,
) -> dict:
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
  "guideMarkdown": "single markdown guide body with headings and bullet lists"
}}

Assignment payload:
{payload}

Student's timezone: {timezone}

Visual emphasis context:
{visual_signals}

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
                    "visual_signals": visual_signals_str,
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


def run_headstart_agent(payload: dict, pdf_text: str = "", visual_signals: Optional[list[dict]] = None) -> dict:
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
    visual_signals_str = _format_visual_signals_for_prompt(visual_signals)

    result = _try_structured_output(
        llm,
        payload_str,
        pdf_text_str,
        timezone_str,
        visual_signals_str,
    )
    if result is not None:
        return result

    logger.info("Falling back to prompt-based generation")
    return _try_prompt_based(
        llm,
        payload_str,
        pdf_text_str,
        timezone_str,
        visual_signals_str,
    )


def _strip_markdown_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        stripped = re.sub(r"^```(?:markdown|md)?\s*", "", stripped, flags=re.IGNORECASE)
        stripped = re.sub(r"\s*```$", "", stripped)
    return stripped.strip()


def _extract_markdown_payload(text: str) -> str:
    cleaned = _strip_markdown_fences(_maybe_unwrap_text_dict(text).strip())
    if not cleaned:
        return ""

    if cleaned.startswith("{") and '"guideMarkdown"' in cleaned:
        try:
            parsed = _try_parse_json(cleaned)
            markdown = parsed.get("guideMarkdown")
            if isinstance(markdown, str):
                return _strip_markdown_fences(markdown)
        except Exception:
            logger.debug("Unable to parse streamed markdown JSON wrapper; using raw text.")
    return cleaned


def _build_markdown_chain(llm):
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT_MARKDOWN),
            ("human", HUMAN_TEMPLATE),
        ]
    )
    return prompt | llm


def stream_headstart_agent_markdown(
    payload: dict,
    pdf_text: str = "",
    visual_signals: Optional[list[dict]] = None,
) -> Iterator[str]:
    """
    Stream markdown chunks from the model when provider streaming is available.
    Falls back to a single invoke split into chunks when needed.
    """
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise RuntimeError("NVIDIA_API_KEY is not set")

    logger.info(
        "Initializing streaming LLM | model=%s temperature=%s max_tokens=%d",
        MODEL_NAME,
        TEMPERATURE,
        MAX_OUTPUT_TOKENS,
    )

    llm = build_nvidia_chat_client(
        model_name=MODEL_NAME,
        temperature=TEMPERATURE,
        max_tokens=MAX_OUTPUT_TOKENS,
    )
    chain = _build_markdown_chain(llm)

    payload_str = json.dumps(payload, ensure_ascii=False)
    pdf_text_str = pdf_text or "(no attached files)"
    timezone_str = payload.get("userTimezone") or "Not specified (use due date as-is)"
    visual_signals_str = _format_visual_signals_for_prompt(visual_signals)
    inputs = {
        "payload": payload_str,
        "pdf_text": pdf_text_str,
        "timezone": timezone_str,
        "visual_signals": visual_signals_str,
    }

    has_streamed_content = False
    streamed_text = ""
    try:
        stream_fn = getattr(chain, "stream", None)
        if callable(stream_fn):
            logger.info("Streaming markdown response from provider")
            for chunk in stream_fn(inputs):
                chunk_text = _to_text(chunk)
                if not chunk_text:
                    continue
                if chunk_text.startswith(streamed_text):
                    delta = chunk_text[len(streamed_text) :]
                else:
                    delta = chunk_text

                if not delta:
                    continue

                streamed_text += delta
                has_streamed_content = True
                yield delta
    except Exception as exc:
        logger.warning("Provider streaming failed; falling back to single invoke: %s", repr(exc))
        has_streamed_content = False
        streamed_text = ""

    if has_streamed_content:
        return

    logger.info("Using single invoke markdown fallback")
    result = chain.invoke(inputs)
    markdown = _extract_markdown_payload(_to_text(result))
    if not markdown:
        raise RuntimeError("Model returned empty markdown output.")

    chunk_size = 900
    for start in range(0, len(markdown), chunk_size):
        yield markdown[start : start + chunk_size]

SYSTEM_PROMPT_CHAT = """\
You are an academic assistant helping a student with follow-up questions about an assignment.

Use the provided assignment payload, generated guide, retrieval snippets, and prior chat context.

Answer requirements:
- Return MARKDOWN ONLY (no JSON and no code fences).
- Be concise and actionable.
- If relevant context is missing, explicitly say what is uncertain.
- Prefer concrete next steps, checklists, or examples when useful.
"""

HUMAN_TEMPLATE_CHAT = """\
Assignment payload:
{payload}

Generated assignment guide:
{guide_markdown}

Retrieved context snippets:
{retrieval_context}

Recent chat history:
{chat_history}

Student question:
{user_message}
"""


def _format_chat_history_for_prompt(chat_history: Optional[list[dict]]) -> str:
    if not chat_history:
        return "(none)"

    lines = []
    for item in chat_history[-12:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "unknown")).strip() or "unknown"
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        lines.append(f"- {role}: {content}")

    return "\n".join(lines) if lines else "(none)"


def _format_retrieval_context_for_prompt(retrieval_context: Optional[list[dict]]) -> str:
    if not retrieval_context:
        return "(none)"

    lines = []
    for item in retrieval_context[:20]:
        if not isinstance(item, dict):
            continue

        text = str(item.get("text", "")).strip()
        if not text:
            continue

        chunk_id = str(item.get("chunk_id", "?"))
        source = str(item.get("source", "unknown"))
        score = item.get("score", "?")
        lines.append(
            f"- [{source} | {chunk_id} | score={score}] {text}"
        )

    return "\n".join(lines) if lines else "(none)"


def _build_followup_chat_chain(llm):
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT_CHAT),
            ("human", HUMAN_TEMPLATE_CHAT),
        ]
    )
    return prompt | llm


def stream_headstart_chat_answer(
    assignment_payload: dict,
    guide_markdown: str,
    chat_history: Optional[list[dict]] = None,
    retrieval_context: Optional[list[dict]] = None,
    user_message: str = "",
) -> Iterator[str]:
    """
    Stream follow-up chat answer chunks from the model when provider streaming is available.
    Falls back to single invoke chunking when needed.
    """
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise RuntimeError("NVIDIA_API_KEY is not set")

    logger.info(
        "Initializing follow-up chat LLM | model=%s temperature=%s max_tokens=%d",
        MODEL_NAME,
        TEMPERATURE,
        MAX_OUTPUT_TOKENS,
    )

    llm = build_nvidia_chat_client(
        model_name=MODEL_NAME,
        temperature=TEMPERATURE,
        max_tokens=MAX_OUTPUT_TOKENS,
    )
    chain = _build_followup_chat_chain(llm)

    payload_str = json.dumps(assignment_payload or {}, ensure_ascii=False)
    guide_markdown_str = guide_markdown or "(no generated guide available)"
    chat_history_str = _format_chat_history_for_prompt(chat_history)
    retrieval_context_str = _format_retrieval_context_for_prompt(retrieval_context)
    user_message_str = (user_message or "").strip()
    if not user_message_str:
        user_message_str = "Please summarize what I should do next."

    inputs = {
        "payload": payload_str,
        "guide_markdown": guide_markdown_str,
        "retrieval_context": retrieval_context_str,
        "chat_history": chat_history_str,
        "user_message": user_message_str,
    }

    has_streamed_content = False
    streamed_text = ""
    try:
        stream_fn = getattr(chain, "stream", None)
        if callable(stream_fn):
            logger.info("Streaming follow-up chat response from provider")
            for chunk in stream_fn(inputs):
                chunk_text = _to_text(chunk)
                if not chunk_text:
                    continue

                if chunk_text.startswith(streamed_text):
                    delta = chunk_text[len(streamed_text) :]
                else:
                    delta = chunk_text

                if not delta:
                    continue

                streamed_text += delta
                has_streamed_content = True
                yield delta
    except Exception as exc:
        logger.warning(
            "Provider follow-up chat streaming failed; falling back to single invoke: %s",
            repr(exc),
        )
        has_streamed_content = False
        streamed_text = ""

    if has_streamed_content:
        return

    logger.info("Using single invoke follow-up chat fallback")
    result = chain.invoke(inputs)
    content = _extract_markdown_payload(_to_text(result))
    if not content:
        raise RuntimeError("Model returned empty follow-up response.")

    chunk_size = 900
    for start in range(0, len(content), chunk_size):
        yield content[start : start + chunk_size]

# agent_service/app/agent.py

import os
import json
import re
import ast
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate


def to_text(x):
    """
    Normalize LangChain/Gemini outputs into a plain string.

    LangChain may return:
      - AIMessage objects with `.content`
      - raw strings
      - lists of messages/parts (depending on version/config)
      - sometimes nested objects where content can be dict/list
    """
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    if isinstance(x, list):
        return "\n".join(to_text(i) for i in x)

    content = getattr(x, "content", None)
    if content is not None:
        return to_text(content)

    return str(x)


def maybe_unwrap_text_dict(text: str) -> str:
    """
    Gemini/google-genai sometimes returns a python-ish dict string like:
      {'type': 'text', 'text': '...actual text...'}

    This function tries to parse and return the inner 'text' field.
    If it can't, it returns the original input unchanged.
    """
    if not text:
        return text

    s = text.strip()

    # Quick filter to avoid parsing random strings
    if not (s.startswith("{") or s.startswith("[")) and "{'type'" not in s:
        return text

    # If it looks like a python dict (single quotes), try literal_eval
    # Example: "{'type': 'text', 'text': '{\\n\"tldr\"...'}"
    try:
        obj = ast.literal_eval(s)
        if isinstance(obj, dict) and "text" in obj and isinstance(obj["text"], str):
            return obj["text"]
    except Exception:
        pass

    # Some versions return a list of parts: [{'type': 'text', 'text': '...'}]
    try:
        obj = ast.literal_eval(s)
        if isinstance(obj, list) and len(obj) > 0:
            first = obj[0]
            if isinstance(first, dict) and "text" in first and isinstance(first["text"], str):
                return first["text"]
    except Exception:
        pass

    return text


def extract_json_block(text: str) -> str:
    """
    Extract the outermost JSON object `{ ... }` from an LLM response.

    Handles common wrapping like:
      ```json
      { ... }
      ```
    """
    if not text:
        raise ValueError("Empty model output; cannot extract JSON.")

    text = text.strip()

    # Strip markdown code fences if present
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in model output.")

    return text[start : end + 1]


def try_parse_json(text: str) -> dict:
    """
    Parse model output into JSON with increasing levels of robustness.

    Strategy:
      1) Extract a JSON object block.
      2) Try strict json.loads
      3) Apply minimal repairs (quotes + trailing commas)
      4) Apply stronger repairs (quote unquoted keys, remove control chars)
    """
    raw = extract_json_block(text)

    # 1) Strict JSON
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Normalize smart quotes
    repaired = (
        raw.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )

    # 2) Common LLM mistake: single quotes
    repaired = repaired.replace("'", '"')

    # Remove trailing commas before } or ]
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)

    # Remove non-printing control characters
    repaired = re.sub(r"[\x00-\x1F\x7F]", "", repaired)

    # 3) Quote unquoted keys (simple identifiers)
    repaired = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*):', r'\1"\2"\3:', repaired)

    try:
        return json.loads(repaired)
    except json.JSONDecodeError as e:
        snippet = repaired[:500]
        raise ValueError(f"Could not parse model output as JSON. {e}. Snippet: {snippet}")


def run_headstart_agent(payload: dict, pdf_text: str = "") -> dict:
    """
    Run the Headstart AI agent using Gemini via LangChain.

    Inputs:
      - payload: normalized assignment payload from the extension/webapp
      - pdf_text: extracted text from PDFs (optional for now)

    Output:
      - dict matching the required JSON schema
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")

    llm = ChatGoogleGenerativeAI(
        model="gemini-flash-latest",
        temperature=0.2,
        google_api_key=api_key,
        # Prevent truncation (your output was cut off mid JSON)
        max_output_tokens=2048,
    )

    # IMPORTANT: braces in schema example must be escaped for ChatPromptTemplate
    prompt = ChatPromptTemplate.from_template(
        """
You are an academic assistant helping a student complete a Canvas assignment.

Return STRICT JSON ONLY (no markdown, no backticks, no commentary).
Rules:
- Use DOUBLE QUOTES for all JSON keys and string values.
- No trailing commas.
- Output must be a single JSON object.

Return JSON matching EXACTLY this schema:
{{
  "tldr": "string",
  "keyRequirements": ["string"],
  "deliverables": ["string"],
  "milestones": [{{ "date": "string", "task": "string" }}],
  "studyPlan": [{{ "durationMin": 30, "focus": "string" }}],
  "risks": ["string"]
}}

Assignment payload (JSON):
{payload}

PDF text (may be empty):
{pdf_text}
"""
    )

    chain = prompt | llm

    res = chain.invoke(
        {
            "payload": json.dumps(payload, ensure_ascii=False),
            "pdf_text": pdf_text or "",
        }
    )

    # Normalize and unwrap google-genai text wrapper if present
    text = to_text(res).strip()
    text = maybe_unwrap_text_dict(text).strip()

    # Debug (optional): uncomment if needed
    # print("MODEL OUTPUT (first 800):", text[:800])

    return try_parse_json(text)
# Agent Service Architecture

## Purpose

The FastAPI agent service receives normalized assignment payloads (plus optional PDF content), orchestrates LLM generation, and returns a structured study guide response.

## Runtime Components

- `app/main.py`: FastAPI entrypoint, route registration, legacy compatibility endpoints.
- `app/api/v1/routes/runs.py`: Request handler wrapper for run execution.
- `app/services/run_agent_service.py`: Request-level workflow orchestration.
- `app/services/pdf_text_service.py`: PDF decode and text extraction.
- `app/orchestrators/headstart_orchestrator.py`: LLM prompting, structured parsing, retry/fallback logic.
- `app/clients/llm_client.py`: LLM client factory (NVIDIA via LangChain).
- `app/schemas/*`: Pydantic request/response and shared models.

## API Surface

- `GET /health` (legacy)
- `POST /run-agent` (legacy)
- `GET /api/v1/health`
- `POST /api/v1/runs`

Both run endpoints share the same internal handler path through `handle_run_agent_request()`.

## Module Boundaries

- `api/v1/routes/*`: HTTP transport and error mapping only.
- `services/*`: Workflow orchestration and cross-module coordination.
- `orchestrators/*`: LLM-specific behavior and output shaping.
- `schemas/*`: Input/output contract definitions.
- `clients/*`: External provider initialization only.

## Request Contract

`RunAgentRequest`:

- `assignment_uuid?: string`
- `payload: Dict[str, Any]` (required)
- `pdf_text?: string`
- `pdf_files?: List[{ filename, base64_data }]`

## Response Contract

`RunAgentResponse`:

- `description: string`
- `keyRequirements: string[]`
- `deliverables: string[]`
- `milestones: { date, task }[]`
- `studyPlan: { durationMin, focus }[]`
- `risks: string[]`

## End-to-End Call Flow

1. Web app forwards request to `POST /run-agent` (or v1 route).
2. Route calls `run_agent_workflow()` from `services/run_agent_service.py`.
3. Service logs request metadata and calls `extract_all_pdf_text()`.
4. PDF service:
5. Decodes `pdf_files[*].base64_data`.
6. Uses PyMuPDF (`fitz`) to extract per-page text.
7. Merges extracted text with legacy `pdf_text`.
8. Writes combined debug dump to `agent_service/pdf_extracted_text.txt`.
9. Service calls `run_headstart_agent(payload, pdf_text)`.
10. Orchestrator builds NVIDIA chat client and attempts:
11. Structured output mode (`with_structured_output(RunAgentResponse)`).
12. Fallback prompt-based generation with JSON repair/parsing heuristics.
13. Service returns structured dictionary back through route layer.

## LLM Orchestration Strategy

- Primary mode: schema-bound structured output for reliable contract adherence.
- Fallback mode: strict JSON prompt with retries (`MAX_RETRIES`) and parser repair.
- Parsing safeguards: markdown fence stripping, quote normalization, trailing comma cleanup, control-character cleanup, key quoting heuristics.

## Configuration and Dependencies

- Required env var: `NVIDIA_API_KEY`.
- Core dependencies: FastAPI, Pydantic, LangChain, NVIDIA LangChain endpoint client.
- Optional but recommended: PyMuPDF for PDF extraction.

## Failure Behavior

- Missing `NVIDIA_API_KEY` raises runtime error.
- PDF decode/extract failures are logged and skipped per file.
- Route wrapper catches unhandled workflow exceptions and returns HTTP 500.
- Parsing failures after all retries raise explicit runtime errors with diagnostics.

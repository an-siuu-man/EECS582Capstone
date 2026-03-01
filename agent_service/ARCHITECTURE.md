# Agent Service Architecture

## Purpose

The FastAPI agent service receives normalized assignment payloads (plus optional PDF content), orchestrates LLM generation, and returns a structured study guide response.

## Runtime Components

- `app/main.py`: FastAPI entrypoint, route registration, legacy compatibility endpoints.
- `app/api/v1/routes/runs.py`: Request handler wrapper for run execution.
- `app/services/run_agent_service.py`: Request-level workflow orchestration.
- `app/services/pdf_text_service.py`: Page-aware PDF extraction (native-first classification, selective OCR fallback, normalization, visual-significance extraction).
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
3. Service logs request metadata and calls `extract_pdf_context()`.
4. PDF service decodes `pdf_files[*].base64_data` (raw base64 and data-URL payloads).
5. For each page, PDF service extracts native text via PyMuPDF (`fitz`).
6. A page-quality heuristic classifies each page as either:
   - `native` (good text layer)
   - `ocr` candidate (empty/short/symbol-heavy native extraction)
7. Only classified pages use OCR fallback:
   - render page image via PyMuPDF
   - preprocess with Pillow (grayscale + autocontrast)
   - OCR via pytesseract
8. Extracted text is normalized for LLM readability:
   - de-hyphenate line-break splits
   - unwrap hard line breaks into paragraphs
   - normalize whitespace
   - remove repeated headers/footers across pages
9. PDF service extracts visual-significance markers:
   - annotation-derived emphasis (`highlight`, `underline`, `strikeout`, `squiggly`)
   - conservative style-derived emphasis (`bold`, `colored_text`) for likely question markers
   - geometry mapping to nearest text + significance scoring (`high` / `medium` / `low`)
   - deduplication/ranking with capped prompt footprint
10. Service assembles text output with stable separators:
   - `--- File: <filename> ---`
   - `--- Page N (native|ocr) ---`
11. Service merges extracted text with legacy `pdf_text`, writes debug dump to `agent_service/pdf_extracted_text.txt`, then calls `run_headstart_agent(payload, pdf_text, visual_signals)`.
12. Orchestrator injects visual emphasis context into the prompt and attempts structured output mode (`with_structured_output(RunAgentResponse)`).
13. If needed, orchestrator falls back to prompt-based generation with JSON repair/parsing heuristics.
14. Service returns structured dictionary back through route layer.

## PDF Extraction Strategy

- Native text extraction is the default path for highest fidelity when a text layer exists.
- OCR is selective and page-scoped to reduce latency/cost compared to OCR-ing whole documents.
- Normalization preserves structure where useful (headings, bullets, table-like rows) while removing common PDF artifacts that confuse LLM prompts.
- Visual emphasis extraction captures likely-important marked text and sends ranked signal metadata to the orchestrator.
- `ENABLE_VISUAL_SIGNALS` feature flag controls visual-signal extraction (enabled by default).
- External API contract remains unchanged; visual signals are an internal service/orchestrator contract.

## LLM Orchestration Strategy

- Primary mode: schema-bound structured output for reliable contract adherence.
- Fallback mode: strict JSON prompt with retries (`MAX_RETRIES`) and parser repair.
- Parsing safeguards: markdown fence stripping, quote normalization, trailing comma cleanup, control-character cleanup, key quoting heuristics.

## Configuration and Dependencies

- Required env var: `NVIDIA_API_KEY`.
- Core dependencies: FastAPI, Pydantic, LangChain, NVIDIA LangChain endpoint client.
- Required for PDF extraction: PyMuPDF (`pymupdf`).
- Optional OCR dependencies: `pytesseract`, `pillow`, and a system Tesseract binary available on `PATH`.
- OCR path requires native `tesseract` executable installed and discoverable in environment `PATH`.

## Failure Behavior

- Missing `NVIDIA_API_KEY` raises runtime error.
- PDF decode/extract failures are logged and skipped per file.
- OCR dependency/runtime failures are logged and only affect OCR-candidate pages; pipeline continues with native extraction output when available.
- Visual-signal extraction failures are logged and skipped per page/file; text extraction and run generation continue.
- Route wrapper catches unhandled workflow exceptions and returns HTTP 500.
- Parsing failures after all retries raise explicit runtime errors with diagnostics.

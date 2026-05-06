# Agent Service Architecture

## Purpose

The FastAPI agent service powers Headstart's assignment guide and follow-up chat workflows. It receives normalized Canvas assignment payloads, optional cached file extractions, assignment files, user-uploaded files, and RAG metadata; extracts or formats document context; calls NVIDIA-hosted LLMs through LangChain; and returns either structured REST responses or Server-Sent Events (SSE) streams.

The preferred binary-file path is `storage_url` references to object storage. Base64 fields remain accepted for backward compatibility.

## Runtime Components

- `app/main.py`: FastAPI entrypoint, versioned router registration, and legacy compatibility endpoints.
- `app/api/v1/routes/health.py`: Shared health-check handler.
- `app/api/v1/routes/runs.py`: Non-stream and SSE guide-generation routes.
- `app/api/v1/routes/chats.py`: SSE follow-up chat route.
- `app/api/v1/routes/rag.py`: RAG indexing and indexing-status routes.
- `app/services/run_agent_service.py`: Request-level orchestration for guide generation, guide streaming, chat streaming, PDF/image attachment extraction, assignment classification, and retrieval-context assembly.
- `app/services/pdf_extraction_service.py`: Structured PDF extraction adapter that accepts cached extractions or raw files and returns `PdfExtraction` models.
- `app/services/pdf_text_service.py`: Low-level PDF download/decode, PyMuPDF native extraction, selective VLM page extraction, text normalization, visual-signal extraction, and attachment formatting.
- `app/services/image_extraction_service.py`: VLM-based user image description and text transcription.
- `app/services/classification_service.py`: Best-effort assignment category classifier for streamed guide/chat behavior.
- `app/services/rag_chunking_service.py`: Source-specific chunking and stable content hashing.
- `app/services/rag_index_service.py`: Supabase-backed RAG document/chunk indexing.
- `app/services/rag_retrieval_service.py`: Semantic retrieval using NVIDIA embeddings, Supabase RPC, source caps, and duplicate filtering.
- `app/services/rag_context_formatter.py`: Prompt formatting for retrieved chunks and source labels.
- `app/orchestrators/headstart_orchestrator.py`: LLM prompts, structured parsing, guide streaming, chat streaming, thinking-delta handling, chat prompt shaping, and calendar-context prompt rules.
- `app/clients/llm_client.py`: Strict NVIDIA `ChatNVIDIA` client factory pinned to `openai/gpt-oss-120b`.
- `app/clients/embedding_client.py`: NVIDIA embedding client and dimension validation.
- `app/clients/supabase_client.py`: PostgREST/RPC helper functions for RAG reads and writes.
- `app/schemas/*`: Pydantic request, response, shared attachment/extraction, and RAG models.
- `app/agent.py`: Backward-compatible lazy adapter exporting `run_headstart_agent`.

## API Surface

Legacy compatibility endpoints:

- `GET /health`
- `POST /run-agent`
- `POST /run-agent/stream`
- `POST /chat/stream`

Versioned endpoints:

- `GET /api/v1/health`
- `POST /api/v1/runs`
- `POST /api/v1/runs/stream`
- `POST /api/v1/chats/stream`
- `POST /api/v1/rag/index-assignment`
- `GET /api/v1/rag/status/{assignment_uuid}?user_id=<uuid>`

The legacy and v1 run/chat endpoints share the same internal handler paths. The RAG routes are versioned only.

## Module Boundaries

- `api/v1/routes/*`: HTTP transport, response framing, and error mapping.
- `services/*`: Workflow orchestration, extraction, retrieval, indexing, and cross-module coordination.
- `orchestrators/*`: LLM-specific prompts, provider calls, stream parsing, and output shaping.
- `schemas/*`: Input/output contract definitions.
- `clients/*`: External provider initialization and provider-specific IO helpers.
- `core/*`: Logging and environment-backed application configuration.

## Guide Request Contract

`RunAgentRequest`:

- `assignment_uuid?: string`
- `payload: Dict[str, Any]`
- `pdf_extractions?: List[PdfExtraction]`
- `pdf_files?: List[PdfFile]`
- `pdf_text?: string`

`PdfFile`:

- `filename: string`
- `base64_data?: string`
- `storage_url?: string`
- `file_sha256?: string`

Guide request behavior:

- `pdf_extractions` is the preferred reusable/cached extraction shape.
- `pdf_files[*].storage_url` is preferred when extraction must happen in the agent service.
- `pdf_files[*].base64_data` remains accepted for older callers.
- `file_sha256` is optional, but when present it lets the service skip duplicate extraction and return per-file extraction payloads for persistence.
- Legacy `pdf_text` is only used as a last-resort inline context when no structured/file extraction exists.

## Chat Request Contract

`ChatStreamRequest` includes:

- `assignment_payload: Dict[str, Any]`
- `assignment_category?: string`
- `guide_markdown?: string`
- `chat_history?: List[{ role, content }]`
- `retrieval_context?: List[{ chunk_id, source, text, score }]`
- `user_id?: UUID`
- `assignment_uuid?: UUID`
- `session_id?: UUID`
- `retrieval_mode?: "semantic" | "hybrid" | "lexical"` (default `hybrid`)
- `retrieval_top_k?: int` (default `12`)
- `source_types?: List[RagSourceType]`
- `user_message: string`
- `thinking_mode?: bool`
- `calendar_context?: CalendarContext`
- `assignment_pdf_extractions?: List[PdfExtraction]`
- `assignment_pdf_text?: string`
- `user_pdf_files?: List[PdfFile]`
- `user_image_files?: List[ImageFile]`

Chat retrieval behavior:

- `semantic` uses pgvector-backed retrieval only.
- `hybrid` merges semantic chunks with legacy lexical request chunks and removes near duplicates.
- `lexical` uses only caller-provided `retrieval_context`.
- Semantic retrieval runs only when `user_id` and `assignment_uuid` are present.
- `session_id` scopes user-upload chunks when available.

## Response Contracts

Non-stream guide response:

- `RunAgentResponse`
- `guideMarkdown: string`

Guide stream events are SSE-framed JSON payloads:

- `run.started`
- `run.stage`
- `run.delta`
- `run.completed`
- `run.error`

`run.completed` includes:

- `guideMarkdown`
- `assignment_category`
- `stage`
- `progress_percent`
- `status_message`
- optional `thinking_content`
- optional `pdf_file_extractions`
- optional legacy `pdf_file_texts`

Chat stream events are SSE-framed JSON payloads:

- `chat.started`
- `chat.retrieval_warning`
- `chat.delta`
- `chat.completed`
- `chat.error`

`chat.completed` includes:

- `assistant_message`
- `stage`
- `progress_percent`
- `status_message`
- `sources`
- optional `thinking_content`
- optional `snapshot_pdf_extractions`

RAG index response:

- `assignment_uuid`
- `indexed_documents`
- `indexed_chunks`
- `skipped_unchanged_chunks`
- `embedding_model`
- `status: "indexed" | "partial" | "no_sources"`

RAG status response:

- `assignment_uuid`
- `is_indexed`
- `document_count`
- `chunk_count`
- `last_indexed_at`
- `sources`

## Guide Generation Flow

1. Web app calls `POST /api/v1/runs`, `POST /api/v1/runs/stream`, or the legacy equivalent.
2. Route delegates to `run_agent_workflow()` or `stream_run_agent_workflow()`.
3. Service logs request metadata, including assignment title/course and attachment counts.
4. Service calls `extract_pdf_extractions_with_file_map(req)`.
5. Existing `pdf_extractions` are accepted first and indexed by `file_sha256`.
6. For each new `pdf_file`, the service fetches `storage_url` when present, otherwise decodes `base64_data`.
7. New PDFs are converted to `PdfExtraction` objects with per-page text, block metadata, visual signals, quality metadata, and optional `file_sha256`.
8. Assignment extractions are formatted into XML-like `<attachment ...>` prompt blocks.
9. Visual signals are collected, deduplicated, ranked, and capped.
10. Non-stream mode calls `run_headstart_agent(payload, pdf_text, visual_signals)`.
11. Stream mode emits progress events, classifies the assignment, streams markdown deltas from the LLM, validates final `guideMarkdown`, and returns extracted file snapshots when available.
12. Route returns either a REST dictionary or SSE response.

## PDF And Image Extraction Strategy

- PDF binary loading prefers `storage_url`; base64 is a compatibility fallback.
- PDF fetches enforce timeout and max-byte safeguards.
- PyMuPDF extracts native text for every page.
- A lightweight page-quality heuristic identifies pages with poor native text.
- Poor native pages are rendered to PNG with PyMuPDF/Pillow and sent to a NVIDIA-hosted vision-language model (VLM) for text extraction.
- Native and VLM candidates are scored; the service chooses `native`, `ocr`, `hybrid`, or `none` per page. In this codebase, `ocr` labels the VLM fallback result, not a local Tesseract dependency.
- Text normalization de-hyphenates wrapped words, preserves likely structural lines, unwraps hard line breaks, normalizes whitespace, and removes repeated headers/footers across pages.
- Visual emphasis extraction captures annotation-derived signals (`highlight`, `underline`, `strikeout`, `squiggly`) plus conservative style-derived signals (`bold`, `colored_text`) for likely question markers.
- `ENABLE_VISUAL_SIGNALS` controls visual-signal extraction and defaults to enabled.
- `ENABLE_PDF_DEBUG_DUMP` can write extracted text dumps to `PDF_DEBUG_DUMP_DIR` or the system temp directory. It is disabled by default.
- User-uploaded images are fetched from storage or decoded from base64, then described by the VLM with separate extracted-text and visual-context sections.

## LLM Orchestration Strategy

- Guide, chat, and classification calls use NVIDIA-hosted `openai/gpt-oss-120b` through LangChain `ChatNVIDIA`.
- `llm_client.py` registers the strict guide model locally if needed and does not fall back to another model.
- Non-stream guide mode first attempts `with_structured_output(RunAgentResponse)`.
- Non-stream fallback mode prompts for strict JSON and repairs/parses model output with bounded retries.
- Streamed guide mode uses a markdown-only prompt and emits provider deltas as `run.delta`.
- Streamed chat mode uses the guide, assignment payload, retrieved context, assignment PDF context, user attachments, chat history, optional assignment category, and optional calendar context.
- Thinking output is carried separately as `reasoning_delta` during streams and `thinking_content` on completion when requested/available.
- Assignment classification is fail-open and returns one of `coding`, `mathematics`, `science`, `speech`, `essay`, or `general`.
- Recognized assignment categories add category-specific guidance to follow-up chat prompts; the category is metadata, not user-visible boilerplate.
- Calendar context can guide scheduling answers, but the orchestrator must only select sessions from provided `recommended_sessions`.

## RAG Indexing And Retrieval

RAG indexing (`POST /api/v1/rag/index-assignment`) uses Supabase as the source of persisted assignment/session data and pgvector chunks.

Supported source types:

- `assignment_payload`
- `rubric`
- `guide_markdown`
- `assignment_pdf`
- `user_upload_pdf`
- `user_upload_image`

Indexing flow:

1. Resolve `assignment_uuid` to an assignment ingest and snapshot.
2. Load requested sources from Supabase or request-provided upload file refs.
3. Chunk each source with source-specific rules.
4. Compute a stable content hash using source type, source id, normalized text, chunking version, and embedding model.
5. Upsert `rag_documents`.
6. Skip unchanged chunks unless `force_reindex` is true.
7. Embed new chunks with NVIDIA embeddings.
8. Insert rows into `rag_chunks`, ignoring duplicate conflicts.

Retrieval flow during chat:

1. Embed the user query.
2. Call Supabase RPC `match_rag_chunks` scoped by user and assignment, optionally session and source type.
3. Apply source caps.
4. Run near-duplicate filtering with embedding cosine similarity.
5. Merge with legacy lexical context for `hybrid` mode.
6. Format labeled source blocks within `RAG_CONTEXT_CHAR_BUDGET`.
7. Return included source metadata in `chat.completed.sources`.

## Configuration And Dependencies

Required for LLM guide/chat/classification and VLM extraction:

- `NVIDIA_API_KEY`

Required for RAG indexing/retrieval:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional environment variables:

- `NVIDIA_BASE_URL` (embedding client override; default `https://integrate.api.nvidia.com/v1`)
- `NVIDIA_EMBEDDING_MODEL` (default `nvidia/llama-3.2-nv-embedqa-1b-v2`)
- `RAG_EMBEDDING_DIM` (default `2048`)
- `RAG_EMBED_BATCH_SIZE` (default `64`)
- `RAG_CONTEXT_CHAR_BUDGET` (default `16000`)
- `MMR_SIMILARITY_THRESHOLD` (default `0.92`)
- `PDF_FETCH_TIMEOUT_SECONDS` (default `15`)
- `PDF_FETCH_MAX_BYTES` (default `26214400`, 25 MB)
- `ENABLE_VISUAL_SIGNALS` (default `true`)
- `ENABLE_PDF_DEBUG_DUMP` (default `false`)
- `PDF_DEBUG_DUMP_DIR` (default system temp directory)
- `VLM_MODEL_ID` (default `meta/llama-3.2-90b-vision-instruct`)
- `VLM_TIMEOUT_SECONDS` (default `30`)
- `VLM_MAX_RETRIES` (default `2`)
- `VLM_MAX_CONCURRENT_PAGES` (default `4`)

Core Python dependencies:

- FastAPI
- Uvicorn
- Pydantic
- python-dotenv
- LangChain
- langchain-nvidia-ai-endpoints
- langchain-text-splitters
- PyMuPDF (`pymupdf`)
- Pillow
- httpx

## Failure Behavior

- Missing `NVIDIA_API_KEY` raises runtime errors on LLM, VLM, or embedding paths that need it.
- Missing Supabase environment variables raises errors on RAG paths that need Supabase.
- Strict guide model initialization failures are surfaced explicitly and do not fall back to a different model.
- PDF download/decode/extract failures are logged and skipped per file.
- Oversized or timed-out storage URL downloads are skipped per file.
- VLM page extraction failures are logged per page; native extraction is used when usable.
- Visual-signal extraction failures are logged and skipped per page/file; text extraction continues.
- Image fetch/decode/VLM failures produce failed extraction results and are omitted from prompt context.
- Assignment classification failures do not fail guide generation; the service uses `general`.
- Semantic RAG retrieval failures emit `chat.retrieval_warning` and fall back to lexical context.
- Stream workflow failures emit terminal `run.error` or `chat.error` SSE events.
- Non-stream route wrappers convert unhandled workflow exceptions to HTTP 500.
- Parsing failures after all non-stream retries raise explicit runtime errors with diagnostics.

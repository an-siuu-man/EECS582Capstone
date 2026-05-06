# Architecture Diagram

```mermaid
flowchart TB
  Student["Student Browser"]
  Canvas["Canvas LMS"]
  Google["Google Calendar API"]
  NVIDIA["NVIDIA AI Endpoints<br/>LLM + embeddings + VLM"]

  subgraph Extension["Chrome MV3 Extension"]
    CS["Content Script<br/>Canvas page detection"]
    Extract["Canvas API + DOM Extractors<br/>assignment, rubric, PDFs, modules"]
    Store["chrome.storage.local<br/>assignment::* records"]
    Widget["In-page Headstart Widget"]
    BG["Background Service Worker<br/>message router + webapp handoff"]
    Popup["Popup<br/>local assignment list"]

    CS --> Extract
    Extract --> Store
    CS --> Widget
    Widget <--> BG
    BG <--> Store
    Popup --> Store
  end

  subgraph WebApp["Next.js Web App<br/>Dashboard + BFF"]
    Pages["Dashboard Pages<br/>chat, assignments, resources, calendar, profile"]
    API["Route Handlers<br/>auth, chat sessions, assignments, resources, calendar"]
    AuthSession["Session Helpers<br/>HTTP-only Supabase auth cookies"]
    Repo["Repository Layer<br/>Supabase REST + Storage helpers"]
    Runtime["Runtime Store<br/>process-local SSE fanout"]
    Runner["Chat Session Runner<br/>agent stream orchestration"]
    Lexical["Lexical Retrieval<br/>local guide/payload/PDF chunks"]
    Calendar["Calendar Planner<br/>month view, proposals, scheduling"]

    Pages <--> API
    API --> AuthSession
    API --> Repo
    API --> Runtime
    API --> Runner
    Runner --> Runtime
    Runner --> Repo
    Runner --> Lexical
    Calendar --> Repo
    API --> Calendar
  end

  subgraph Agent["FastAPI Agent Service"]
    AgentAPI["API Routes<br/>/api/v1/runs, /chats, /rag"]
    RunSvc["Run Agent Service<br/>guide/chat orchestration"]
    ExtractSvc["PDF + Image Extraction<br/>PyMuPDF + VLM fallback"]
    Orchestrator["Headstart Orchestrator<br/>prompts, streaming, parsing"]
    RagSvc["RAG Index + Retrieval<br/>chunking, embeddings, pgvector RPC"]

    AgentAPI --> RunSvc
    RunSvc --> ExtractSvc
    RunSvc --> Orchestrator
    RunSvc --> RagSvc
  end

  subgraph Supabase["Supabase"]
    SupaAuth["Auth"]
    DB[("Postgres<br/>profiles, LMS/course/assignment records,<br/>snapshots, ingests, chat sessions,<br/>messages, guides, calendar integrations")]
    Storage[("Storage<br/>assignment PDFs, chat PDFs/images")]
    Vector[("pgvector<br/>rag_documents + rag_chunks")]

    DB --- Vector
  end

  Student -->|"views Canvas"| Canvas
  Canvas -->|"same-origin REST + DOM + file downloads"| Extract
  Widget -->|"guide status + create chat session<br/>/api/assignment-guide-status, /api/chat-session"| API
  BG -->|"opens dashboard session"| Pages
  Student -->|"uses dashboard"| Pages

  AuthSession <--> SupaAuth
  Repo <--> DB
  Repo <--> Storage

  Runner -->|"SSE guide stream<br/>/api/v1/runs/stream<br/>fallback /run-agent/stream"| AgentAPI
  Runner -->|"SSE chat/regeneration stream<br/>/api/v1/chats/stream<br/>fallback /chat/stream"| AgentAPI
  Runner -->|"fire-and-forget RAG indexing<br/>/api/v1/rag/index-assignment"| AgentAPI

  ExtractSvc -->|"signed file URLs"| Storage
  RagSvc <--> DB
  RagSvc <--> Vector
  Orchestrator --> NVIDIA
  ExtractSvc --> NVIDIA
  RagSvc --> NVIDIA

  Calendar <--> Google
  API <--> Google
  API -->|"SSE events<br/>/api/chat-session/:id/events"| Pages
  Runtime -->|"session/message/calendar events"| Pages
```

## Primary Flows

1. Canvas assignment pages are detected by the extension content script.
2. The extension extracts assignment data through Canvas REST APIs, DOM fallbacks, rubric parsing, module-resource lookup, and PDF downloads, then stores normalized records in `chrome.storage.local`.
3. The widget asks the web app whether a guide already exists. When the student starts a run, the background service worker posts the normalized payload to `POST /api/chat-session`.
4. The web app authenticates the user with Supabase Auth cookies, persists LMS/course/assignment/snapshot/session rows, deduplicates and uploads files to Supabase Storage, creates an in-memory runtime session, and starts the background runner.
5. The runner calls the FastAPI agent service over SSE. The agent service extracts PDF/image context, classifies the assignment, streams guide or chat deltas from NVIDIA-hosted models, and returns extracted file text and sources.
6. The web app relays progress to the dashboard through its own session SSE endpoint and persists final chat messages, guide versions, assignment category, PDF extraction text, and source metadata in Supabase.
7. The web app triggers RAG indexing fire-and-forget. The agent service chunks sources, embeds them with NVIDIA embeddings, and stores searchable chunks in Supabase pgvector tables.
8. Follow-up chat and guide regeneration are initiated from the dashboard. The web app builds context from durable session data, local lexical retrieval, optional RAG identifiers, optional uploaded files, and optional calendar context before calling the agent chat stream.
9. Calendar routes combine persisted assignment due dates with Google Calendar events, generate non-persistent study-block proposals, and schedule selected blocks directly in Google Calendar with private Headstart markers.

## Notes

- The extension does not call the Python agent service directly.
- The web app is the durable owner of session, guide, assignment, file, and dashboard state.
- The web app runtime store is process-local and only supports live SSE fanout; Supabase remains the source of truth after reloads or process restarts.
- Supabase Realtime is not part of the current dashboard update path.
- There is no always-on assignment watcher or separate worker queue in the current architecture.

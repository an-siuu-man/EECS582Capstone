# Extension ↔ Agent Service Interaction

> How the Chrome extension, Next.js webapp, and FastAPI agent service communicate — and where the architecture has gaps.

---

## 1. High-Level Overview

The system has **three runtime components**:

| Component             | Stack                                         | Port (dev) | Purpose                                                                       |
| --------------------- | --------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| **Browser Extension** | Chrome MV3 (content scripts + service worker) | n/a        | Scrapes Canvas LMS pages, builds a normalized payload, triggers AI generation |
| **Next.js Webapp**    | Next.js App Router (API routes)               | `3000`     | Dashboard UI + thin API proxy that sits between the extension and the agent   |
| **Agent Service**     | FastAPI + LangChain + Gemini                  | `8000`     | Runs the LLM-backed "Headstart" agent and returns a structured study guide    |

```
┌──────────────────────┐
│  Canvas LMS Page     │
│  (instructure.com)   │
└──────────┬───────────┘
           │ content script injected
           ▼
┌───────────────────────────────────────────────────────┐
│  Chrome Extension                                     │
│                                                       │
│  ┌──────────────┐   chrome.runtime   ┌──────────────┐│
│  │Content Script │◄────────────────►│Service Worker ││
│  │  • detectors  │  .sendMessage()   │  • storage    ││
│  │  • extractors │                   │  • payload    ││
│  │  • widget UI  │                   │    builder    ││
│  └──────────────┘                   └──────┬───────┘│
└─────────────────────────────────────────────┼────────┘
                                              │ fetch()
                                              ▼
                              ┌────────────────────────┐
                              │  Next.js Webapp        │
                              │  localhost:3000         │
                              │                        │
                              │  /api/ingest-assignment │
                              │  /api/run-agent (proxy) │
                              └───────────┬────────────┘
                                          │ fetch()
                                          ▼
                              ┌────────────────────────┐
                              │  FastAPI Agent Service  │
                              │  localhost:8000         │
                              │                        │
                              │  POST /run-agent        │
                              │  (Gemini via LangChain) │
                              └────────────────────────┘
```

---

## 2. Detailed Request Flow

### 2.1 Page Load — Detection & Extraction

1. User navigates to a Canvas assignment page (e.g. `https://canvas.ku.edu/courses/176517/assignments/1295092`).
2. The content script (`extension/src/content/index.js`) runs at `document_idle`.
3. **Page detector** (`detectors/page-detector.js`) matches the URL against regex patterns to determine `single_assignment` or `assignment_list`.
4. For a single assignment:
   - A `ASSIGNMENT_DETECTED` message is sent to the service worker with `{ courseId, assignmentId, courseName, url }`.
   - The DOM is scraped by `extractors/assignment-extractor.js` for title, description, due date, points, submission type, and rubric.
   - A `ASSIGNMENT_DATA` message is sent with the full extracted data.
5. The **service worker** (`background/service-worker.js`) stores/merges the record in `chrome.storage.local` under the key `assignment::<courseId>::<assignmentId>`.
6. The **widget injector** (`ui/widget-injector.js`) injects a floating sidebar into the Canvas page showing the scraped metadata.

### 2.2 "Generate Guide" — The Full Round-Trip

When the user clicks **"Generate Guide"** in the injected sidebar:

1. **Widget → Service Worker** — The content script sends a `START_HEADSTART_RUN` message via `chrome.runtime.sendMessage`.
2. **Service Worker** — `handleStartHeadstartRun()`:
   - Extracts `courseId` / `assignmentId` from the current tab URL.
   - Loads the stored record from `chrome.storage.local`.
   - Calls `buildHeadstartPayload()` to produce a normalized object with parsed due dates, timing flags (`isOverdue`, `isDueSoon`, `daysToDue`), description text, rubric, and PDF placeholders.
3. **Service Worker → Webapp (Ingest)** — `POST http://localhost:3000/api/ingest-assignment`
   - Sends the full payload.
   - The webapp route (`webapp/src/app/api/ingest-assignment/route.ts`) generates a `assignment_uuid` (random UUID) and returns it.
   - **Note:** The ingested payload is currently **discarded** — it is not persisted anywhere.
4. **Service Worker → Webapp (Run Agent)** — `POST http://localhost:3000/api/run-agent`
   - Sends `{ assignment_uuid, payload, pdf_text }`.
   - The webapp route (`webapp/src/app/api/run-agent/route.ts`) acts as a **reverse proxy**, forwarding the request body to the FastAPI agent service at `${AGENT_SERVICE_URL}/run-agent`.
5. **Webapp → Agent Service** — `POST http://localhost:8000/run-agent`
   - FastAPI validates the body against `RunAgentRequest` (Pydantic).
   - `run_headstart_agent()` constructs a LangChain prompt, calls Gemini (`gemini-flash-latest`), and parses the structured JSON response.
   - Returns a JSON object with: `tldr`, `keyRequirements`, `deliverables`, `milestones`, `studyPlan`, `risks`.
6. **Response bubbles back**: Agent → Webapp (passthrough) → Service Worker → Content Script.
7. **Widget displays result** — The service worker sends a `HEADSTART_RESULT` message to the content script tab, and `widget-injector.js` renders the guide in the chat UI via `buildGuideText()`.

### 2.3 Error Path

- If any step fails, the service worker catches exceptions and sends `HEADSTART_ERROR` to the content script.
- The widget injector has a **30-second timeout** (`GUIDE_TIMEOUT_MS`). If no response arrives within 30 s, it shows a timeout message.

---

## 3. Data Schemas

### 3.1 Normalized "Headstart Payload" (Extension → Webapp)

Built by `buildHeadstartPayload()` in the service worker:

```jsonc
{
  "courseId": "176517",
  "courseName": "EECS 582",
  "assignmentId": "1295092",
  "title": "Final Project Proposal",
  "url": "https://canvas.ku.edu/courses/176517/assignments/1295092",
  "detectedAt": "2026-02-20T10:00:00.000Z",
  "status": "extracted",
  "dueDateRaw": "Feb 25 at 11:59pm",
  "dueAtISO": "2026-02-25T23:59:00.000Z",
  "flags": {
    "daysToDue": 5,
    "isOverdue": false,
    "isDueSoon": false,
  },
  "descriptionText": "Write a 3-page proposal...",
  "rubric": {
    "title": "Rubric",
    "criteria": [
      /* ... */
    ],
  },
  "pdfs": [],
}
```

### 3.2 Agent Request (Webapp → Agent Service)

Pydantic model `RunAgentRequest`:

```jsonc
{
  "assignment_uuid": "c1e2f3...", // optional
  "payload": {
    /* Headstart payload */
  },
  "pdf_text": "", // optional extracted PDF text
}
```

### 3.3 Agent Response (Agent Service → Webapp → Extension)

```jsonc
{
  "tldr": "...",
  "keyRequirements": ["..."],
  "deliverables": ["..."],
  "milestones": [{ "date": "...", "task": "..." }],
  "studyPlan": [{ "durationMin": 30, "focus": "..." }],
  "risks": ["..."],
}
```

---

## 4. Messaging Protocol (Extension Internal)

All internal extension communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.

| Direction    | Message Type          | Trigger                      |
| ------------ | --------------------- | ---------------------------- |
| Content → SW | `ASSIGNMENT_DETECTED` | Page load (detection)        |
| Content → SW | `ASSIGNMENT_DATA`     | Page load (extraction)       |
| Content → SW | `START_HEADSTART_RUN` | User clicks "Generate Guide" |
| SW → Content | `HEADSTART_RESULT`    | Agent returned successfully  |
| SW → Content | `HEADSTART_ERROR`     | Any error in the pipeline    |

---

## 5. Identified Flaws & Architectural Gaps

### 5.1 Ingest Endpoint Is a No-Op

**File:** `webapp/src/app/api/ingest-assignment/route.ts`

The `/api/ingest-assignment` route receives the full assignment payload but only generates a UUID and returns it. **The payload is thrown away.** There is no database, file store, or in-memory cache. The `assignment_uuid` returned is never used to look anything up — the full payload is re-sent in the very next `/api/run-agent` call anyway.

**Impact:** The ingest step is currently dead weight. It adds latency (an extra HTTP round-trip) with no benefit.

---

### 5.2 No Persistence Layer Anywhere

- The **webapp** has no database. `data.ts` contains hard-coded mock data.
- The **agent service** is stateless — it receives a payload, runs the LLM, and returns.
- The **extension** stores data in `chrome.storage.local`, but this is per-browser and not accessible to the webapp or other devices.

**Impact:** Generated guides are lost on page refresh. There is no way to view past results in the dashboard. The dashboard and the extension operate on completely separate data sources.

---

### 5.3 Webapp Dashboard Is Disconnected from Real Data

The dashboard pages (`/dashboard`, `/dashboard/assignments`, etc.) render from hard-coded arrays in `webapp/src/lib/data.ts`. There is **zero integration** between the assignments scraped by the extension and what the dashboard shows. A student would see fake placeholder assignments, not their actual Canvas courses.

---

### 5.4 No Authentication or User Identity

- No auth on the webapp API routes — anyone can call `/api/run-agent`.
- No auth between the extension and the webapp.
- No auth between the webapp proxy and the agent service.
- The extension has no concept of which student is using it.

**Impact:** In production, any client could invoke the (paid) Gemini API calls. There's also no way to associate generated guides with a specific user.

---

### 5.5 Hardcoded `localhost` URLs

The service worker has `const BACKEND = "http://localhost:3000"` hardcoded inline. The webapp reads `AGENT_SERVICE_URL` from env (good), but the extension has no equivalent configuration mechanism.

**Impact:** There is no way to point the extension at a deployed staging/production webapp without modifying source code and rebuilding.

---

### 5.6 CORS Not Configured on Agent Service

The FastAPI app has no CORS middleware. The webapp's server-side API route proxies around this today (Node → Python, no browser involved), but if any client-side code ever calls the agent service directly, it will be blocked.

---

### 5.7 No Request Validation / Rate Limiting

- The agent service accepts arbitrarily large payloads (no size limit on `payload` dict or `pdf_text` string).
- No rate limiting on any endpoint.
- The Gemini API key is a single shared key with no usage controls.

**Impact:** A malicious or buggy client could exhaust the Gemini API quota or cause high costs.

---

### 5.8 Fire-and-Forget Messaging Pattern

The "Generate Guide" flow relies on a fire-and-forget message (`START_HEADSTART_RUN`) followed by a **separate listener** for `HEADSTART_RESULT` / `HEADSTART_ERROR`. There is no correlation ID tying a request to its response.

**Impact:** If a user clicks "Generate Guide" twice quickly, both responses arrive on the same listener with no way to match them. The widget could display stale or interleaved results.

---

### 5.9 `RunAgentResponse` Schema Is Defined but Never Enforced

`schemas.py` defines a `RunAgentResponse` Pydantic model, but the `/run-agent` endpoint returns `result` — a raw `dict` from `try_parse_json()`. FastAPI's response model validation is not used (`response_model=RunAgentResponse` is absent from the route decorator). If the LLM returns malformed JSON that passes `try_parse_json` but doesn't match the schema, the client receives garbage.

---

### 5.10 Widget Milestones Render Uses Wrong Fields

`buildGuideText()` in widget-injector.js renders the `milestones` array expecting `{ durationMin, focus }` fields (which are actually `studyPlan` fields). Milestones from the agent have `{ date, task }` but the rendering code ignores `date` and `task` in favor of `durationMin` / `focus`, causing milestones to display as blank bullets.

---

### 5.11 PDF Extraction Not Implemented

The agent service accepts `pdf_text` and the extension payload includes a `pdfs: []` array, but there is no code anywhere to actually download or extract text from PDF attachments linked in Canvas assignments.

---

### 5.12 Due Date Parsing Is Fragile

`parseCanvasDueDate()` in the service worker only handles one specific format (`"Feb 15 at 11:59pm"`). Canvas can display dates differently based on locale, institution settings, or timezone preferences. The function also assumes the current year, which breaks for assignments spanning a year boundary (e.g., assigned Dec → due Jan).

---

### 5.13 Content Script Registers Persistent Listeners

`widget-injector.js` adds a `chrome.runtime.onMessage` listener every time `injectSidebar()` is called but never removes it. If the widget were re-injected (e.g., SPA navigation within Canvas), duplicate listeners would accumulate, potentially processing each message multiple times.

---

## 6. Summary Table

| #    | Flaw                                  | Severity  | Effort to Fix                             |
| ---- | ------------------------------------- | --------- | ----------------------------------------- |
| 5.1  | Ingest endpoint is a no-op            | Medium    | Low — add persistence or remove the step  |
| 5.2  | No persistence layer                  | High      | Medium — add a DB (e.g., SQLite/Postgres) |
| 5.3  | Dashboard uses mock data              | High      | Medium — wire to real stored assignments  |
| 5.4  | No authentication                     | High      | Medium — add JWT/session auth             |
| 5.5  | Hardcoded localhost URLs              | Medium    | Low — use env/config in extension         |
| 5.6  | No CORS on agent service              | Low       | Low — add FastAPI `CORSMiddleware`        |
| 5.7  | No rate limiting / validation         | Medium    | Low–Medium                                |
| 5.8  | No request–response correlation       | Medium    | Low — add a `runId`                       |
| 5.9  | Response schema not enforced          | Medium    | Low — add `response_model`                |
| 5.10 | Milestones rendered with wrong fields | Low (bug) | Low — fix field access                    |
| 5.11 | PDF extraction not implemented        | Medium    | Medium — needs a PDF parser               |
| 5.12 | Fragile due date parsing              | Low       | Low — use multiple format patterns        |
| 5.13 | Listener accumulation on re-inject    | Low       | Low — guard or clean up listeners         |

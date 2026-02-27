# Web App Architecture

## Purpose

The Next.js web app serves two roles:

- Student-facing UI (landing pages and dashboard views).
- Backend-for-frontend API facade used by the extension, including forwarding AI run requests to the FastAPI agent service.

## Runtime Components

- `src/app/*`: App Router pages, layouts, and API routes.
- `src/app/api/ingest-assignment/route.ts`: Accepts normalized assignment payload and returns `assignment_uuid`.
- `src/app/api/run-agent/route.ts`: Proxies run requests to agent service.
- `src/components/*`: UI component library and layout components.
- `src/lib/data.ts`: Current demo/dashboard data source used by UI views.

## Module Boundaries

- `app/api/*`: Transport handlers (request parsing, logging, forwarding, response mapping).
- UI pages (`app/page.tsx`, `app/dashboard/*`): Client rendering and interaction.
- `lib/*`: Shared UI-side utilities and data helpers.
- Agent-service integration is isolated to `app/api/run-agent/route.ts`.

## API Surface

- `POST /api/ingest-assignment`
- Input: extension-normalized assignment payload.
- Output: `{ ok: true, assignment_uuid }`.

- `POST /api/run-agent`
- Input: `{ assignment_uuid, payload, pdf_text?, pdf_files? }`.
- Behavior: forwards request to `${AGENT_SERVICE_URL}/run-agent`.
- Output: raw JSON body returned by agent service (or mapped error).

## Flow 1: Ingest Assignment

1. Extension background workflow calls `/api/ingest-assignment`.
2. Route handler parses JSON body and logs assignment identifiers.
3. Handler creates `assignment_uuid` with `crypto.randomUUID()`.
4. Handler returns JSON acknowledgment with generated UUID.

## Flow 2: Run Agent Proxy

1. Extension calls `/api/run-agent` with assignment payload and optional PDF files.
2. Route validates `AGENT_SERVICE_URL` presence.
3. Route forwards request body to `${AGENT_SERVICE_URL}/run-agent`.
4. Route reads upstream status/body and logs latency.
5. On success, route returns upstream JSON body directly.
6. On upstream failure, route returns 500 with error metadata.

## UI Data Flow (Current State)

- Dashboard pages call `fetchDashboardData()` from `src/lib/data.ts`.
- The current dashboard data source is in-memory/demo data.
- UI components are separated into layout and reusable primitives under `src/components`.

## Configuration and Dependencies

- Runtime: Next.js App Router on Node.js runtime for API routes.
- Required env var: `AGENT_SERVICE_URL`.
- Optional local default for extension integration: web app runs on `http://localhost:3000`.

## Failure Behavior

- Missing `AGENT_SERVICE_URL` returns `500` with explicit error.
- Agent-service non-2xx response is mapped to `500` with `detail` containing upstream body excerpt.
- Network errors during forward call surface as route failures.

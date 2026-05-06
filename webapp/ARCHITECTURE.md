# Web App Architecture

## Purpose

The Next.js web app is Headstart's student-facing dashboard and backend-for-frontend (BFF). It provides authenticated pages for dashboard, chat, assignments, resources, profile/settings, and calendar planning. Its server route handlers persist assignment/chat data in Supabase, store assignment and chat-upload files in Supabase Storage, stream work to and from the Python agent service, and integrate with Google Calendar for scheduling.

The web app is the owner of session persistence and dashboard state. The browser extension hands Canvas assignment payloads to the web app, and the web app then coordinates agent-service guide generation, follow-up chat, RAG indexing, file extraction persistence, and calendar context.

## Runtime Components

- `src/app/*`: Next.js App Router pages, layouts, and API route handlers.
- `src/app/dashboard/*`: Authenticated dashboard UI for home, chat, assignments, resources, calendar, profile, and settings.
- `src/app/api/*`: Node runtime route handlers for auth, dashboard data, chat sessions, assignments, resources, storage signing, calendar planning, and Google Calendar integration.
- `src/lib/auth/session.ts`: Cookie-based session resolution, refresh, and route auth helpers.
- `src/lib/supabase-auth.ts`: Supabase Auth REST helpers for login, signup, refresh, user lookup, logout, and profile creation.
- `src/lib/supabase-rest.ts`: Supabase PostgREST and Storage helper layer using the service-role key.
- `src/lib/chat-repository.ts`: Main persistence repository for LMS/course/assignment records, snapshots, snapshot files, chat sessions, chat messages, guide versions, resources, submission state, and cleanup.
- `src/lib/chat-runtime-store.ts`: In-memory per-process runtime state and event fanout for currently running sessions.
- `src/lib/chat-session-runner.ts`: Background orchestration for initial guide streams, follow-up chat streams, guide regeneration, agent SSE parsing, PDF extraction persistence, and fire-and-forget RAG indexing.
- `src/lib/chat-types.ts`: Shared DTO and domain types for sessions, messages, guide versions, PDFs, RAG sources, and runtime state.
- `src/lib/sse.ts`: SSE parser used when consuming agent-service streams.
- `src/lib/rag/lexical-retriever.ts`: Local lexical/BM25-like fallback retrieval for guide/payload/PDF context.
- `src/lib/calendar-repository.ts`: Assignment list projection used by calendar planner routes.
- `src/lib/calendar-planner.ts`: Heuristic study-block proposals, free-slot detection, and recommended study sessions.
- `src/lib/assignment-calendar-context.ts`: Shared calendar context builder passed into agent follow-up chat.
- `src/lib/google-calendar.ts`: Google OAuth, token exchange/refresh/revoke, event listing, and event creation client.
- `src/lib/google-calendar-session.ts`: Google Calendar access-token resolution and refresh state handling.
- `src/lib/google-calendar-repository.ts`: Supabase persistence for Google Calendar integration state and assignment calendar metadata.
- `src/lib/calendar-google-markers.ts`: Private extended-property markers for Headstart-created study-block Google events.
- `src/components/*`: Dashboard layout, chat UI, calendar widgets, shadcn-style primitives, and shared visual components.
- `src/hooks/use-auth-user.ts`: Browser hook for current user state.

## Page Surface

Public pages:

- `/`
- `/login`
- `/signup`

Dashboard pages:

- `/dashboard`
- `/dashboard/chat`
- `/dashboard/assignments`
- `/dashboard/assignments/[slug]`
- `/dashboard/resources`
- `/dashboard/calendar`
- `/dashboard/profile`
- `/dashboard/settings`

The dashboard layout requires a server-resolved user. Unauthenticated users are redirected to `/login`.

## API Surface

Auth:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Extension and legacy compatibility:

- `POST /api/chat-session`
- `GET /api/assignment-guide-status`
- `POST /api/ingest-assignment` (legacy stub that returns a generated UUID)
- `POST /api/run-agent` (legacy proxy to `AGENT_SERVICE_URL/run-agent`)

Chat sessions:

- `GET /api/chat-session`
- `GET /api/chat-session/[sessionId]`
- `DELETE /api/chat-session/[sessionId]`
- `GET /api/chat-session/[sessionId]/events`
- `POST /api/chat-session/[sessionId]/messages`
- `PATCH /api/chat-session/[sessionId]/messages/[messageId]`
- `POST /api/chat-session/[sessionId]/attachments`
- `POST /api/chat-session/[sessionId]/regenerate-guide`
- `GET /api/chat-session/[sessionId]/guide-versions`
- `GET /api/chat-session/[sessionId]/guide-versions/[versionNumber]`

Assignments and resources:

- `GET /api/dashboard`
- `GET /api/assignments`
- `DELETE /api/assignments/[assignmentId]`
- `GET /api/assignments/[assignmentId]/detail`
- `POST /api/assignments/[assignmentId]/new-chat`
- `PATCH /api/assignments/[assignmentId]/submission`
- `GET /api/resources`
- `GET /api/storage/image-url`

Calendar planner:

- `GET /api/calendar/month`
- `POST /api/calendar/proposals/generate`
- `POST /api/calendar/schedule`
- `POST /api/calendar/slots`

Google Calendar integration:

- `GET /api/integrations/google-calendar`
- `GET /api/integrations/google-calendar/connect`
- `GET /api/integrations/google-calendar/callback`
- `POST /api/integrations/google-calendar/disconnect`
- `POST /api/integrations/google-calendar/events`

## Module Boundaries

- `app/api/*`: HTTP transport, auth resolution, input validation, response mapping, and side-effect kickoff.
- `app/dashboard/*`: Client/server UI composition and browser interactions.
- `lib/auth/*` and `lib/supabase-auth.ts`: Supabase Auth session management and cookie handling.
- `lib/supabase-rest.ts`: All direct Supabase REST and Storage calls.
- `lib/chat-repository.ts`: Durable domain persistence and cleanup.
- `lib/chat-runtime-store.ts`: Volatile runtime state and SSE event fanout only.
- `lib/chat-session-runner.ts`: Agent-service orchestration and persistence side effects driven by agent streams.
- `lib/calendar-*`: Calendar planning, assignment projections, event markers, and chat calendar context.
- `lib/google-calendar*`: OAuth and provider-specific Google Calendar API integration.
- `components/*`: Presentation components only; route handlers own persistence.

## Authentication And Sessions

- Auth is implemented with Supabase Auth REST endpoints.
- Login and signup set `headstart_access_token` and `headstart_refresh_token` HTTP-only cookies.
- Server route handlers call `resolveRequestUser(req)`, which accepts either a bearer token or cookies.
- If the access token is expired or invalid and a refresh token exists, routes refresh the session and re-apply cookies.
- Dashboard server pages use `requireServerUser()` and redirect to `/login` when missing.
- Signup uses Supabase admin user creation, confirms the email immediately, creates/updates `user_profiles`, and then signs the user in.
- Logout best-effort revokes the access token and clears both cookies.

## Persistence Model

Supabase PostgREST is accessed with `SUPABASE_SERVICE_ROLE_KEY`. Main persisted concepts include:

- `user_profiles`: User display profile rows.
- `lms_integrations`: Per-user LMS instance identity, including Canvas instance domain.
- `courses`: Course records scoped to an LMS integration.
- `assignments`: Canvas assignment records scoped to courses.
- `assignment_snapshots`: Normalized assignment payload snapshots, content hash, extracted assignment fields, rubric, and raw payload.
- `assignment_ingests`: Generated `assignment_uuid` values that point to a snapshot for a guide/chat run.
- `assignment_snapshot_files`: Snapshot PDF metadata and eventually extracted text returned by the agent service.
- `stored_pdf_blobs`: Deduplicated PDF blob records by SHA-256.
- `stored_image_blobs`: Deduplicated chat-upload image blob records by SHA-256.
- `chat_sessions`: User chat session status, assignment UUID, title, assignment category, and timestamps.
- `chat_messages`: Ordered persisted chat messages and metadata.
- `guide_versions`: Initial and regenerated guide markdown versions.
- `assignment_user_states`: User-local submission state.
- `google_calendar_integrations`: Google Calendar OAuth tokens and integration status.

Supabase Storage buckets:

- `SUPABASE_ASSIGNMENT_PDF_BUCKET` (default `assignment-pdfs`) stores assignment snapshot PDFs and chat-upload PDFs.
- `SUPABASE_ASSIGNMENT_IMAGE_BUCKET` (default falls back to the PDF bucket) stores chat-upload images.

File storage paths are content-addressed by SHA-256, and the web app creates short-lived signed URLs for the agent service and browser downloads.

## Initial Guide Flow

1. The extension or dashboard posts a normalized assignment `payload` to `POST /api/chat-session`.
2. The route authenticates the user. Extension callers may pass `user_id` only as a fallback, and it must be a valid UUID when no cookie session exists.
3. `createPersistedChatSession()` normalizes the payload, hashes and deduplicates PDF attachments, uploads missing PDF blobs, and upserts LMS integration, course, assignment, assignment snapshot, and snapshot file rows.
4. The repository creates a fresh `assignment_uuid` in `assignment_ingests` and a queued `chat_sessions` row.
5. The route creates an in-memory runtime session and calls `startChatSessionRun()` fire-and-forget.
6. The runner signs snapshot PDF URLs and calls the agent service streaming endpoint, preferring `POST /api/v1/runs/stream` and falling back to `POST /run-agent/stream` on 404.
7. Agent `run.started`, `run.stage`, and `run.delta` SSE events update the runtime store for dashboard SSE clients.
8. On `run.completed`, the runner persists session status `completed`, runtime result, assignment category, guide version 1, and per-file extracted PDF text when returned.
9. The runner starts RAG indexing fire-and-forget for `assignment_payload`, `rubric`, `guide_markdown`, and `assignment_pdf`.
10. On agent or stream failure, the session is marked `failed` and runtime clients receive the error state.

## Chat And Regeneration Flow

Follow-up chat:

1. The dashboard posts to `POST /api/chat-session/[sessionId]/messages`.
2. The route requires session ownership and waits until the guide is ready.
3. The route creates a user message plus empty streaming assistant message.
4. `startFollowupChatRun()` builds context from recent history, the latest guide, sanitized assignment payload, stored PDF extractions/text, lexical retrieval chunks, optional user-uploaded attachments, and optional calendar context.
5. The runner calls the agent chat stream, preferring `POST /api/v1/chats/stream` and falling back to `POST /chat/stream` on 404.
6. Assistant deltas are emitted to runtime SSE subscribers and periodically persisted to `chat_messages`.
7. On completion, sources returned by the agent are stored in message metadata. Agent-returned `snapshot_pdf_extractions` are persisted to self-heal older sessions.
8. `<calendar_proposal>...</calendar_proposal>` blocks are parsed into runtime `calendar.proposal` events and message metadata, then stripped from visible assistant content.

Guide regeneration:

1. `POST /api/chat-session/[sessionId]/regenerate-guide` requires a completed session and creates an empty assistant message.
2. The runner uses the agent chat stream with a guide-regeneration instruction and recent history.
3. The completed markdown is stored as the next `guide_versions` row and as the assistant message content.
4. The runner triggers RAG re-indexing for `guide_markdown` fire-and-forget.

## Runtime SSE Model

The web app exposes dashboard-facing SSE at:

- `GET /api/chat-session/[sessionId]/events`

The stream emits:

- `session.snapshot`
- `session.update`
- `chat.message.created`
- `chat.message.delta`
- `chat.message.completed`
- `chat.error`
- `calendar.proposal`
- `session.heartbeat`

The runtime store is in memory on `globalThis`. It is process-local and volatile, while durable session/message/guide state lives in Supabase. Polling `GET /api/chat-session/[sessionId]?since=<epoch>&wait_ms=<ms>` is also supported for long-poll style updates.

## Attachments And RAG

Assignment PDFs:

- Extension payloads may include base64 PDF attachments.
- The web app hashes, deduplicates, uploads, and replaces inline payload attachments with metadata.
- The agent receives signed URLs, not raw base64, during initial guide generation.
- Extracted PDF text returned by the agent is persisted to `assignment_snapshot_files.extracted_text`.

Chat uploads:

- `POST /api/chat-session/[sessionId]/attachments` accepts multipart uploads up to 10 MB.
- Accepted file types are PDF, PNG, and JPEG, detected by file signature.
- Uploaded files are SHA-256 deduplicated and stored as PDF or image blobs.
- The route returns attachment metadata to include in a subsequent chat message.
- Uploads trigger agent-service RAG indexing fire-and-forget for `user_upload_pdf` or `user_upload_image`.

Retrieval:

- The web app always supplies a local lexical retrieval context built from the guide, assignment payload, and sometimes long assignment PDF text.
- The agent service performs semantic retrieval when `retrieval_mode: "hybrid"` and scoped identifiers are present.
- The web app stores returned source metadata on assistant messages.

## Assignments And Resources

Assignments are derived from persisted chat/session data and grouped by stable assignment record id when available.

- `/api/assignments` returns grouped assignment cards with status, priority, submission state, latest session, due date, and attachment counts.
- `/api/assignments/[assignmentId]/detail` returns snapshot fields, guide sessions, guide versions, latest guide content, chat sessions, and signed PDF download URLs.
- `/api/assignments/[assignmentId]/new-chat` creates a new completed chat shell from the latest snapshot without immediately starting agent generation.
- `/api/assignments/[assignmentId]/submission` stores user-local submitted/unsubmitted state.
- `DELETE /api/assignments/[assignmentId]` deletes related sessions, ingests, snapshots, attachment records, runtime state, and submission state for the current user.
- `/api/resources` builds a cross-assignment library of guide links, signed PDF downloads, and Canvas assignment links.

## Calendar And Scheduling

Calendar month aggregation:

1. `/dashboard/calendar` requests `GET /api/calendar/month` for the visible FullCalendar range and browser timezone.
2. The route loads user assignment due dates from persisted sessions.
3. The route resolves Google Calendar access and lists Google events when connected.
4. Google events marked with Headstart private extended properties are classified as `study_time_block`; other Google events are `google_event`.
5. The response merges `assignment_due`, `study_time_block`, and `google_event` entries.

Proposal generation:

1. `POST /api/calendar/proposals/generate` loads in-range, unsubmitted assignments.
2. Google Calendar events become busy intervals when connected.
3. `generateHeuristicWorkBlocks()` creates non-overlapping draft sessions.
4. Suggestions are ephemeral and are not written to Supabase.

Scheduling:

- `POST /api/calendar/schedule` creates selected study sessions directly in the user's primary Google Calendar.
- Created study blocks include private extended properties so month aggregation can identify them later.
- Scheduling invalidates cached assignment calendar context.

Free-slot context:

- `POST /api/calendar/slots` returns the same assignment calendar context used by follow-up chat.
- `assignment-calendar-context.ts` caches context for 90 seconds per user/assignment/timezone/effort key.
- Context includes availability reason, Google integration state, free slots, and recommended sessions.

## Google Calendar Integration

- `GET /api/integrations/google-calendar` returns connection status and metadata.
- `GET /api/integrations/google-calendar/connect` creates an OAuth state cookie and redirects to Google OAuth.
- `GET /api/integrations/google-calendar/callback` validates state, exchanges code for tokens, persists connected integration state, and redirects to `/dashboard/profile`.
- `POST /api/integrations/google-calendar/disconnect` best-effort revokes a Google token and marks the integration disconnected.
- `POST /api/integrations/google-calendar/events` is a direct event-creation endpoint for an assignment-derived event window.
- Token refresh is centralized in `ensureGoogleCalendarAccessToken()`.
- Google 400/401/403 responses mark the integration `needs_attention` and clear/suppress Google-dependent results where appropriate.

## Configuration And Dependencies

Required environment variables:

- `AGENT_SERVICE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`

Required for Google Calendar integration:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

Optional environment variables:

- `SUPABASE_ASSIGNMENT_PDF_BUCKET` (default `assignment-pdfs`)
- `SUPABASE_ASSIGNMENT_IMAGE_BUCKET` (default PDF bucket)
- `SUPABASE_ASSIGNMENT_PDF_SIGNED_URL_TTL_SECONDS` (default `600`)
- `GOOGLE_OAUTH_REDIRECT_URI` (defaults from request URL)
- `GOOGLE_OAUTH_SCOPES` (defaults to calendar events, OpenID, email)

Core dependencies:

- Next.js 16 App Router
- React 19
- Tailwind CSS 4
- shadcn/Radix UI primitives
- FullCalendar
- date-fns
- framer-motion
- lucide-react
- react-markdown, remark-gfm, remark-math, rehype-katex
- html2pdf.js for guide export

## Failure Behavior

- Missing auth returns `401` from protected API routes and redirects protected pages to `/login`.
- Invalid inputs return `400`; ownership failures return `404`; in-progress conflicts return `409`.
- Missing Supabase or agent-service configuration raises route-level `500` errors on affected paths.
- Agent stream failures mark chat sessions `failed` for initial guide generation, or persist a failed assistant fallback message for follow-up/regeneration.
- Runtime SSE state is volatile; persisted Supabase rows remain the source of truth after reloads or process restarts.
- Guide version persistence, assignment category persistence, PDF extraction persistence, and RAG indexing are best-effort where noted and do not intentionally fail an otherwise completed guide.
- Storage upload/signing errors fail the file operation that needs them.
- Google auth/provider failures mark integrations `needs_attention` when appropriate and avoid returning stale Google event data.
- Calendar proposal generation is non-persistent; scheduling writes only to Google Calendar.

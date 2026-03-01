# Entity Relationship Diagram (Final BCNF Schema)

This schema aligns with:
- `internal/architecture/00_system_context.md`
- `internal/architecture/01_end_to_end_flows.md`
- `internal/architecture/02_extension_contracts.md`
- `internal/architecture/03_agent_service_contracts.md`

It is designed for the real pipeline:
`Canvas extraction -> ingest assignment -> run agent -> persist structured output`.

## Scope and Design Rules

- Postgres is assumed.
- Primary keys are `uuid` unless noted.
- All timestamps are `timestamptz` in UTC.
- Canvas is external and read-only.
- Structured LLM output is fully normalized (no arrays stored in one column).
- Opaque JSON is used only for audit/debug payload capture, not relational identity.

## Relationship Map

| Parent | Relationship | Child |
| --- | --- | --- |
| `auth.users` | 1 to 1 | `user_profiles` |
| `auth.users` | 1 to many | `lms_integrations` |
| `lms_integrations` | 1 to many | `courses` |
| `courses` | many to many (via join) | `auth.users` through `course_enrollments` |
| `courses` | 1 to many | `assignments` |
| `assignments` | 1 to many | `assignment_snapshots` |
| `assignment_snapshots` | 1 to many | `assignment_ingests` |
| `assignment_ingests` | 1 to many | `headstart_runs` |
| `headstart_runs` | 1 to many | `run_pdf_files` |
| `headstart_runs` | 1 to 1 | `headstart_documents` |
| `headstart_documents` | 1 to many | `doc_key_requirements` |
| `headstart_documents` | 1 to many | `doc_deliverables` |
| `headstart_documents` | 1 to many | `doc_risks` |
| `headstart_documents` | 1 to many | `doc_milestones` |
| `headstart_documents` | 1 to many | `doc_study_blocks` |

## SQL Schema (BCNF)

```sql
-- Optional helper for UUID generation if your Postgres setup needs it.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) Identity/profile
CREATE TABLE public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  timezone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) LMS integration per user/account
CREATE TABLE public.lms_integrations (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('canvas')),
  instance_domain text NOT NULL,
  external_user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('connected', 'expired', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, instance_domain, external_user_id)
);

-- 3) External courses mirrored from Canvas
CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.lms_integrations(id) ON DELETE CASCADE,
  provider_course_id text NOT NULL,
  name text,
  course_code text,
  term text,
  start_at timestamptz,
  end_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, provider_course_id)
);

-- 4) Enrollment join (supports future multi-user course views)
CREATE TABLE public.course_enrollments (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student', 'ta', 'instructor', 'observer')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);

-- 5) External assignments mirrored from Canvas
CREATE TABLE public.assignments (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  provider_assignment_id text NOT NULL,
  canvas_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, provider_assignment_id)
);

-- 6) Versioned captured assignment payloads from extension/sync
CREATE TABLE public.assignment_snapshots (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('extension_api', 'extension_dom', 'sync')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL,
  description_text text,
  description_html text,
  due_at timestamptz,
  points_possible numeric(10, 2),
  submission_type text,
  rubric_json jsonb,
  user_timezone text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  UNIQUE (assignment_id, content_hash)
);

-- 7) Ingest call identity (matches assignment_uuid contract)
CREATE TABLE public.assignment_ingests (
  assignment_uuid uuid PRIMARY KEY,
  assignment_snapshot_id uuid NOT NULL REFERENCES public.assignment_snapshots(id) ON DELETE RESTRICT,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id)
);

-- 8) Run attempts (async-ready)
CREATE TABLE public.headstart_runs (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  assignment_uuid uuid NOT NULL REFERENCES public.assignment_ingests(assignment_uuid) ON DELETE CASCADE,
  attempt_no integer NOT NULL CHECK (attempt_no >= 1),
  trigger_source text NOT NULL CHECK (trigger_source IN ('user_click', 'retry', 'api')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  model_name text,
  prompt_version text,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_uuid, attempt_no)
);

-- 9) Per-run attached PDF files (input/audit)
CREATE TABLE public.run_pdf_files (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.headstart_runs(id) ON DELETE CASCADE,
  filename text NOT NULL,
  file_sha256 char(64) NOT NULL,
  storage_uri text,
  extracted_text text,
  extraction_mode text NOT NULL CHECK (extraction_mode IN ('native', 'ocr', 'hybrid', 'none')),
  page_count integer CHECK (page_count IS NULL OR page_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, filename, file_sha256)
);

-- 10) Top-level agent output (1 document per successful run)
CREATE TABLE public.headstart_documents (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES public.headstart_runs(id) ON DELETE CASCADE,
  description text NOT NULL,
  response_schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 11) Normalized list outputs from RunAgentResponse
CREATE TABLE public.doc_key_requirements (
  doc_id uuid NOT NULL REFERENCES public.headstart_documents(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  requirement_text text NOT NULL,
  PRIMARY KEY (doc_id, position)
);

CREATE TABLE public.doc_deliverables (
  doc_id uuid NOT NULL REFERENCES public.headstart_documents(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  deliverable_text text NOT NULL,
  PRIMARY KEY (doc_id, position)
);

CREATE TABLE public.doc_risks (
  doc_id uuid NOT NULL REFERENCES public.headstart_documents(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  risk_text text NOT NULL,
  PRIMARY KEY (doc_id, position)
);

CREATE TABLE public.doc_milestones (
  doc_id uuid NOT NULL REFERENCES public.headstart_documents(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  milestone_date_text text NOT NULL,
  task text NOT NULL,
  PRIMARY KEY (doc_id, position)
);

CREATE TABLE public.doc_study_blocks (
  doc_id uuid NOT NULL REFERENCES public.headstart_documents(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  duration_min integer NOT NULL CHECK (duration_min > 0),
  focus text NOT NULL,
  PRIMARY KEY (doc_id, position)
);
```

## Why This Is BCNF

For each table, every non-trivial functional dependency has a determinant that is a candidate key:

- `user_profiles`: `user_id -> {display_name, timezone, ...}`.
- `lms_integrations`: `id` is key; natural candidate key is `(user_id, provider, instance_domain, external_user_id)`.
- `courses`: `id` key; natural candidate key `(integration_id, provider_course_id)`.
- `course_enrollments`: `id` key; natural candidate key `(course_id, user_id)`.
- `assignments`: `id` key; natural candidate key `(course_id, provider_assignment_id)`.
- `assignment_snapshots`: `id` key; alternate candidate key `(assignment_id, content_hash)`.
- `assignment_ingests`: `assignment_uuid` key.
- `headstart_runs`: `id` key; alternate candidate key `(assignment_uuid, attempt_no)`.
- `run_pdf_files`: `id` key; alternate candidate key `(run_id, filename, file_sha256)`.
- `headstart_documents`: `id` key; alternate candidate key `run_id` (1:1).
- Child list tables use `(doc_id, position)` as the key, so item text/date fields depend on the whole key only.

No table stores attributes that are transitively determined by another non-key attribute in that same table.

## Implementation Notes

- Keep `assignment_uuid` generated at ingest time to preserve current extension/webapp contract.
- Persist `assignment_snapshots` so each run is reproducible against the exact captured assignment state.
- The schema is async-ready: `headstart_runs.status` can represent queued/running/failed flows without redesign.

# Entity Relationship Diagram (BCNF-Adjusted)

## Design Notes / Improvements (vs attached)
- **BCNF fix**: `assignments` no longer stores `user_id`; users relate to courses via `course_enrollments`.
- **BCNF fix**: `headstart_docs` stores only `run_id` (no redundant `user_id` / `assignment_id`), since those are determined via `headstart_runs`.
- **Flexibility**: every “core” table has a `jsonb` column (`preferences`, `attrs`, `metadata`, `extra`, etc.) for **non-identifying** future fields.
- **Scalability**: optional `headstart_doc_sections` + `headstart_resources` normalize structured doc output for better UI/RAG.

---

## Relationships

| Parent            | Relationship          | Child                  | Label          |
| ---------------- | --------------------- | ---------------------- | -------------- |
| AUTH_USERS       | one-to-one            | PROFILES               | has            |
| AUTH_USERS       | one-to-many           | INTEGRATIONS           | connects       |
| INTEGRATIONS     | one-to-many           | CANVAS_COURSES         | syncs          |
| AUTH_USERS       | one-to-many           | COURSE_ENROLLMENTS     | enrolled_in    |
| CANVAS_COURSES   | one-to-many           | COURSE_ENROLLMENTS     | has_members    |
| CANVAS_COURSES   | one-to-many           | ASSIGNMENTS            | contains       |
| CANVAS_COURSES   | one-to-one (optional) | COURSE_SYNC_STATE      | poll_state     |
| ASSIGNMENTS      | one-to-many           | HEADSTART_RUNS         | triggers       |
| HEADSTART_RUNS   | one-to-many           | HEADSTART_DOCS         | produces       |
| HEADSTART_DOCS   | one-to-many (optional)| HEADSTART_DOC_SECTIONS | has_sections   |
| HEADSTART_DOCS   | one-to-many (optional)| HEADSTART_RESOURCES    | cites          |
| AUTH_USERS       | one-to-many           | STUDY_BLOCKS           | schedules      |
| ASSIGNMENTS      | one-to-many           | STUDY_BLOCKS           | time_for       |
| AUTH_USERS       | one-to-many           | NOTIFICATIONS          | receives       |
| AUTH_USERS       | one-to-many (optional)| EVENTS                 | emits          |

---

## Tables

### AUTH_USERS (Supabase: auth.users)

| Column | Type | Constraint |
| ------ | ---- | ---------- |
| id     | uuid | PK         |

### PROFILES

| Column       | Type        | Constraint |
| ------------ | ----------- | ---------- |
| user_id      | uuid        | PK, FK     |
| display_name | text        |            |
| timezone     | text        |            |
| preferences  | jsonb       |            |
| created_at   | timestamptz |            |
| updated_at   | timestamptz |            |

### INTEGRATIONS

| Column           | Type        | Constraint |
| ---------------- | ----------- | ---------- |
| id               | uuid        | PK         |
| user_id          | uuid        | FK         |
| provider         | text        |            |
| instance_domain  | text        |            |
| external_user_id | text        |            |
| status           | text        |            |
| scopes           | text[]      |            |
| metadata         | jsonb       |            |
| created_at       | timestamptz |            |
| updated_at       | timestamptz |            |

### CANVAS_COURSES

| Column           | Type        | Constraint |
| ---------------- | ----------- | ---------- |
| id               | uuid        | PK         |
| integration_id   | uuid        | FK         |
| canvas_course_id | bigint      |            |
| name             | text        |            |
| course_code      | text        |            |
| term             | text        |            |
| start_at         | timestamptz |            |
| end_at           | timestamptz |            |
| is_active        | boolean     |            |
| raw_payload      | jsonb       |            |
| attrs            | jsonb       |            |
| created_at       | timestamptz |            |
| updated_at       | timestamptz |            |

### COURSE_ENROLLMENTS

| Column     | Type        | Constraint |
| ---------- | ----------- | ---------- |
| id         | uuid        | PK         |
| user_id    | uuid        | FK         |
| course_id  | uuid        | FK         |
| role       | text        |            |
| is_active  | boolean     |            |
| attrs      | jsonb       |            |
| created_at | timestamptz |            |
| updated_at | timestamptz |            |

### COURSE_SYNC_STATE

| Column         | Type        | Constraint |
| -------------- | ----------- | ---------- |
| course_id      | uuid        | PK, FK     |
| cursor         | jsonb       |            |
| last_polled_at | timestamptz |            |
| created_at     | timestamptz |            |
| updated_at     | timestamptz |            |

### ASSIGNMENTS

| Column               | Type        | Constraint |
| -------------------- | ----------- | ---------- |
| id                   | uuid        | PK         |
| course_id            | uuid        | FK         |
| canvas_assignment_id | bigint      |            |
| title                | text        |            |
| description_html     | text        |            |
| due_at               | timestamptz |            |
| points_possible      | numeric     |            |
| canvas_url           | text        |            |
| published_at         | timestamptz |            |
| workflow_state       | text        |            |
| content_hash         | text        |            |
| raw_payload          | jsonb       |            |
| attrs                | jsonb       |            |
| last_synced_at       | timestamptz |            |
| created_at           | timestamptz |            |
| updated_at           | timestamptz |            |

### HEADSTART_RUNS

| Column         | Type        | Constraint |
| -------------- | ----------- | ---------- |
| id             | uuid        | PK         |
| user_id        | uuid        | FK         |
| assignment_id  | uuid        | FK         |
| trigger        | text        |            |
| status         | text        |            |
| model          | text        |            |
| prompt_version | text        |            |
| started_at     | timestamptz |            |
| ended_at       | timestamptz |            |
| error          | text        |            |
| metrics        | jsonb       |            |
| created_at     | timestamptz |            |

### HEADSTART_DOCS

| Column       | Type        | Constraint |
| ------------ | ----------- | ---------- |
| id           | uuid        | PK         |
| run_id       | uuid        | FK         |
| version      | int         |            |
| status       | text        |            |
| title        | text        |            |
| summary      | text        |            |
| content_md   | text        |            |
| content_html | text        |            |
| content_uri  | text        |            |
| extra        | jsonb       |            |
| created_at   | timestamptz |            |
| updated_at   | timestamptz |            |

### HEADSTART_DOC_SECTIONS (optional)

| Column       | Type        | Constraint |
| ------------ | ----------- | ---------- |
| id           | uuid        | PK         |
| doc_id       | uuid        | FK         |
| position     | int         |            |
| section_key  | text        |            |
| title        | text        |            |
| content_md   | text        |            |
| content_html | text        |            |
| extra        | jsonb       |            |
| created_at   | timestamptz |            |
| updated_at   | timestamptz |            |

### HEADSTART_RESOURCES (optional)

| Column     | Type        | Constraint |
| ---------- | ----------- | ---------- |
| id         | uuid        | PK         |
| doc_id     | uuid        | FK         |
| kind       | text        |            |
| title      | text        |            |
| url        | text        |            |
| note       | text        |            |
| rank       | int         |            |
| extra      | jsonb       |            |
| created_at | timestamptz |            |

### STUDY_BLOCKS

| Column            | Type        | Constraint |
| ----------------- | ----------- | ---------- |
| id                | uuid        | PK         |
| user_id           | uuid        | FK         |
| assignment_id     | uuid        | FK         |
| start_at          | timestamptz |            |
| end_at            | timestamptz |            |
| status            | text        |            |
| calendar_provider | text        |            |
| calendar_event_id | text        |            |
| notes             | text        |            |
| attrs             | jsonb       |            |
| created_at        | timestamptz |            |
| updated_at        | timestamptz |            |

### NOTIFICATIONS

| Column       | Type        | Constraint |
| ------------ | ----------- | ---------- |
| id           | uuid        | PK         |
| user_id      | uuid        | FK         |
| type         | text        |            |
| status       | text        |            |
| title        | text        |            |
| body         | text        |            |
| payload      | jsonb       |            |
| created_at   | timestamptz |            |
| sent_at      | timestamptz |            |
| dismissed_at | timestamptz |            |

### EVENTS (optional)

| Column     | Type        | Constraint |
| ---------- | ----------- | ---------- |
| id         | uuid        | PK         |
| user_id    | uuid        | FK (nullable) |
| type       | text        |            |
| payload    | jsonb       |            |
| created_at | timestamptz |            |
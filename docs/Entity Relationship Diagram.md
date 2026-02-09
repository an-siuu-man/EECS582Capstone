# Entity Relationship Diagram

## Relationships

| Parent         | Relationship          | Child             | Label       |
| -------------- | --------------------- | ----------------- | ----------- |
| AUTH_USERS     | one-to-one            | PROFILES          | has         |
| AUTH_USERS     | one-to-many           | INTEGRATIONS      | connects    |
| AUTH_USERS     | one-to-many           | COURSES           | enrolled_in |
| COURSES        | one-to-many           | ASSIGNMENTS       | contains    |
| COURSES        | one-to-one (optional) | COURSE_SYNC_STATE | poll_state  |
| ASSIGNMENTS    | one-to-many           | HEADSTART_RUNS    | triggers    |
| ASSIGNMENTS    | one-to-many           | HEADSTART_DOCS    | has_docs    |
| HEADSTART_RUNS | one-to-many           | HEADSTART_DOCS    | produces    |
| AUTH_USERS     | one-to-many           | STUDY_BLOCKS      | schedules   |
| ASSIGNMENTS    | one-to-many           | STUDY_BLOCKS      | time_for    |
| AUTH_USERS     | one-to-many           | NOTIFICATIONS     | receives    |

---

## Tables

### AUTH_USERS

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

### COURSES

| Column           | Type        | Constraint |
| ---------------- | ----------- | ---------- |
| id               | uuid        | PK         |
| user_id          | uuid        | FK         |
| canvas_course_id | bigint      |            |
| name             | text        |            |
| course_code      | text        |            |
| term             | text        |            |
| is_active        | boolean     |            |
| raw_payload      | jsonb       |            |
| created_at       | timestamptz |            |
| updated_at       | timestamptz |            |

### ASSIGNMENTS

| Column               | Type        | Constraint |
| -------------------- | ----------- | ---------- |
| id                   | uuid        | PK         |
| user_id              | uuid        | FK         |
| course_id            | uuid        | FK         |
| canvas_assignment_id | bigint      |            |
| title                | text        |            |
| description_html     | text        |            |
| due_at               | timestamptz |            |
| points_possible      | numeric     |            |
| canvas_url           | text        |            |
| published_at         | timestamptz |            |
| status               | text        |            |
| raw_payload          | jsonb       |            |
| last_synced_at       | timestamptz |            |
| created_at           | timestamptz |            |
| updated_at           | timestamptz |            |

### COURSE_SYNC_STATE

| Column         | Type        | Constraint |
| -------------- | ----------- | ---------- |
| id             | uuid        | PK         |
| user_id        | uuid        | FK         |
| course_id      | uuid        | FK         |
| cursor         | jsonb       |            |
| last_polled_at | timestamptz |            |
| created_at     | timestamptz |            |
| updated_at     | timestamptz |            |

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

| Column        | Type        | Constraint |
| ------------- | ----------- | ---------- |
| id            | uuid        | PK         |
| assignment_id | uuid        | FK         |
| run_id        | uuid        | FK         |
| status        | text        |            |
| title         | text        |            |
| content_md    | text        |            |
| content_html  | text        |            |
| summary       | text        |            |
| extra         | jsonb       |            |
| created_at    | timestamptz |            |
| updated_at    | timestamptz |            |

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

# Retrieval Eval Harness

These tests measure live RAG retrieval quality against a pre-indexed staging
assignment. They are marked `eval` and excluded from the default test run.

## Required Environment

- `EVAL_USER_ID` - UUID of the seeded staging user.
- `EVAL_ASSIGNMENT_UUID` - UUID of the pre-indexed staging assignment.
- `SUPABASE_URL` - staging Supabase URL.
- `SUPABASE_SERVICE_ROLE_KEY` - staging service-role key.
- `NVIDIA_API_KEY` - NVIDIA API key for query embeddings.
- `NVIDIA_EMBEDDING_MODEL` - optional; defaults to the app embedding model.

The staging assignment should have indexed chunks for assignment payload, rubric,
guide markdown, and at least one assignment PDF.

## Run

```bash
cd agent_service
EVAL_USER_ID=... EVAL_ASSIGNMENT_UUID=... ./myenv/bin/python -m pytest -m eval
```

Default unit tests remain offline:

```bash
cd agent_service
./myenv/bin/python -m pytest
```

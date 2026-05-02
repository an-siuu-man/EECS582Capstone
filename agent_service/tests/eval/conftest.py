import json
import os
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"
EVAL_ENV_VARS = [
    "EVAL_USER_ID",
    "EVAL_ASSIGNMENT_UUID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NVIDIA_API_KEY",
]


def _is_explicit_eval_run(config: pytest.Config) -> bool:
    markexpr = str(config.getoption("-m") or "")
    return "eval" in markexpr and "not eval" not in markexpr


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if _is_explicit_eval_run(config):
        return

    skip_eval = pytest.mark.skip(reason="eval tests require pytest -m eval and staging env")
    for item in items:
        if "eval" in item.keywords:
            item.add_marker(skip_eval)


@pytest.fixture(scope="session")
def eval_user_id() -> UUID:
    return UUID(os.environ["EVAL_USER_ID"])


@pytest.fixture(scope="session")
def eval_assignment_uuid() -> UUID:
    return UUID(os.environ["EVAL_ASSIGNMENT_UUID"])


@pytest.fixture(scope="session")
def eval_cases() -> list[dict[str, Any]]:
    path = FIXTURES_DIR / "eval_cases.json"
    with path.open("r", encoding="utf-8") as f:
        cases = json.load(f)
    if not isinstance(cases, list) or not cases:
        raise ValueError("eval_cases.json must contain a non-empty list")
    return cases


@pytest.fixture(scope="session", autouse=True)
def require_eval_environment(request: pytest.FixtureRequest) -> None:
    if not _is_explicit_eval_run(request.config):
        return

    missing = [name for name in EVAL_ENV_VARS if not os.environ.get(name)]
    if missing:
        pytest.fail(
            "Missing eval environment variables: "
            + ", ".join(missing)
            + ". See tests/eval/README.md."
        )

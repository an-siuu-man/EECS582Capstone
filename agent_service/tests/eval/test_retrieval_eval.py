from typing import Any

import pytest

from app.schemas.rag import RetrievedChunk
from app.services.rag_retrieval_service import retrieve

RECALL_AT_5_THRESHOLD = 0.6
SOURCE_TYPE_ACCURACY_THRESHOLD = 0.8


def _normalize_keywords(case: dict[str, Any]) -> list[str]:
    keywords = case.get("expected_keywords") or []
    if not isinstance(keywords, list):
        return []
    return [str(keyword).lower() for keyword in keywords if str(keyword).strip()]


def _has_keyword_hit(chunk: RetrievedChunk, keywords: list[str]) -> bool:
    if not keywords:
        return True
    text = f"{chunk.text} {chunk.source_type} {chunk.source_id}".lower()
    return any(keyword in text for keyword in keywords)


def _first_hit_rank(chunks: list[RetrievedChunk], keywords: list[str]) -> int | None:
    for rank, chunk in enumerate(chunks, start=1):
        if _has_keyword_hit(chunk, keywords):
            return rank
    return None


def _source_type_hit(chunks: list[RetrievedChunk], expected_source_type: str | None) -> bool:
    if not expected_source_type:
        return bool(chunks)
    top_5 = chunks[:5]
    return any(chunk.source_type == expected_source_type for chunk in top_5)


@pytest.mark.eval
def test_retrieval_quality(eval_user_id, eval_assignment_uuid, eval_cases, capsys):
    rows: list[dict[str, Any]] = []

    for case in eval_cases:
        query = str(case["query"])
        expected_source_type = case.get("expected_source_type")
        if expected_source_type is not None:
            expected_source_type = str(expected_source_type)
        keywords = _normalize_keywords(case)

        chunks = retrieve(
            query=query,
            user_id=eval_user_id,
            assignment_uuid=eval_assignment_uuid,
            top_k=10,
        )
        first_rank = _first_hit_rank(chunks, keywords)
        rows.append(
            {
                "id": case.get("id", query),
                "retrieved": len(chunks),
                "recall_at_5": first_rank is not None and first_rank <= 5,
                "recall_at_10": first_rank is not None and first_rank <= 10,
                "mrr": 0.0 if first_rank is None else 1.0 / first_rank,
                "source_type_hit": _source_type_hit(chunks, expected_source_type),
                "top_sources": [chunk.source_type for chunk in chunks[:5]],
            }
        )

    recall_at_5 = sum(1 for row in rows if row["recall_at_5"]) / len(rows)
    recall_at_10 = sum(1 for row in rows if row["recall_at_10"]) / len(rows)
    mrr = sum(float(row["mrr"]) for row in rows) / len(rows)
    source_type_cases = [row for row, case in zip(rows, eval_cases) if case.get("expected_source_type")]
    source_type_accuracy = (
        sum(1 for row in source_type_cases if row["source_type_hit"]) / len(source_type_cases)
        if source_type_cases
        else 1.0
    )

    print("\nRAG retrieval eval")
    print(f"cases={len(rows)}")
    print(f"recall@5={recall_at_5:.3f}")
    print(f"recall@10={recall_at_10:.3f}")
    print(f"mrr={mrr:.3f}")
    print(f"source_type_accuracy={source_type_accuracy:.3f}")
    for row in rows:
        print(
            f"- {row['id']}: retrieved={row['retrieved']} "
            f"r@5={row['recall_at_5']} r@10={row['recall_at_10']} "
            f"mrr={row['mrr']:.3f} source_hit={row['source_type_hit']} "
            f"top_sources={row['top_sources']}"
        )

    captured = capsys.readouterr()
    print(captured.out)

    assert recall_at_5 >= RECALL_AT_5_THRESHOLD
    assert source_type_accuracy >= SOURCE_TYPE_ACCURACY_THRESHOLD

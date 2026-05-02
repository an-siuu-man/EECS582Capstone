import os
from functools import lru_cache

from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings

_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

# Default model and dimension; override via env.
_DEFAULT_EMBEDDING_MODEL = "nvidia/llama-3.2-nv-embedqa-1b-v2"
_DEFAULT_EMBEDDING_DIM = 2048
_DEFAULT_BATCH_SIZE = 64


def _embedding_model() -> str:
    return os.environ.get("NVIDIA_EMBEDDING_MODEL", _DEFAULT_EMBEDDING_MODEL)


def _embedding_dim() -> int:
    return int(os.environ.get("RAG_EMBEDDING_DIM", _DEFAULT_EMBEDDING_DIM))


def _batch_size() -> int:
    return int(os.environ.get("RAG_EMBED_BATCH_SIZE", _DEFAULT_BATCH_SIZE))


@lru_cache(maxsize=1)
def _build_client() -> NVIDIAEmbeddings:
    return NVIDIAEmbeddings(
        model=_embedding_model(),
        base_url=os.environ.get("NVIDIA_BASE_URL", _NVIDIA_BASE_URL),
        api_key=os.environ["NVIDIA_API_KEY"],
    )


def _assert_dim(vectors: list[list[float]]) -> None:
    if not vectors:
        return
    actual = len(vectors[0])
    expected = _embedding_dim()
    if actual != expected:
        raise RuntimeError(
            f"Embedding dimension mismatch for model '{_embedding_model()}': "
            f"expected {expected}, got {actual}. "
            "Update RAG_EMBEDDING_DIM or change NVIDIA_EMBEDDING_MODEL."
        )


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed a list of documents in batches, validating output dimension on the first batch.

    Args:
        texts: Source text strings to embed.

    Returns:
        List of float vectors, one per input text.
    """
    if not texts:
        return []

    client = _build_client()
    size = _batch_size()
    results: list[list[float]] = []
    checked = False

    for i in range(0, len(texts), size):
        batch = texts[i : i + size]
        vecs = client.embed_documents(batch)
        if not checked:
            _assert_dim(vecs)
            checked = True
        results.extend(vecs)

    return results


def embed_query(text: str) -> list[float]:
    """Embed a single query string.

    Args:
        text: Query text to embed.

    Returns:
        Float vector for the query.
    """
    client = _build_client()
    vec = client.embed_query(text)
    _assert_dim([vec])
    return vec

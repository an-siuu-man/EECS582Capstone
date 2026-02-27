"""
Artifact: agent_service/app/clients/llm_client.py
Purpose: Wraps external LLM client construction for Nvidia-backed LangChain chat model calls.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Added dedicated client wrapper for ChatNVIDIA initialization. (Ansuman Sharma)
Preconditions:
- `langchain_nvidia_ai_endpoints` package is installed and credentials are configured externally.
Inputs:
- Acceptable: Model name string, numeric temperature, and max token values.
- Unacceptable: Unsupported model identifiers or non-numeric generation parameters.
Postconditions:
- Returns a configured ChatNVIDIA client instance for downstream orchestration.
Returns:
- `ChatNVIDIA` object.
Errors/Exceptions:
- Underlying provider/client initialization exceptions for invalid setup.
"""

from langchain_nvidia_ai_endpoints import ChatNVIDIA


def build_nvidia_chat_client(model_name: str, temperature: float, max_tokens: int) -> ChatNVIDIA:
    """Create a configured ChatNVIDIA client."""
    return ChatNVIDIA(
        model=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
    )

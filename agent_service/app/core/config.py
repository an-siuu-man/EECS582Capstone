"""
Artifact: agent_service/app/core/config.py
Purpose: Centralizes environment loading and static service configuration values.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Added centralized configuration module for agent service refactor. (Ansuman Sharma)
Preconditions:
- Environment variables may be present in process env and optional .env file.
Inputs:
- Acceptable: String environment variables such as NVIDIA_API_KEY.
- Unacceptable: Non-string values for expected environment variables.
Postconditions:
- Dotenv variables are loaded and configuration constants are available to callers.
Returns:
- Settings object with service title and helper accessors.
Errors/Exceptions:
- No explicit exceptions; missing env vars are handled by downstream runtime checks.
"""

import os

from dotenv import load_dotenv


load_dotenv()


class Settings:
    """Application-level configuration values."""

    app_title: str = "Headstart Agent Service"

    @staticmethod
    def nvidia_api_key() -> str:
        return os.getenv("NVIDIA_API_KEY", "")


settings = Settings()

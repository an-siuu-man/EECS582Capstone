"""Core package exports for configuration and logging."""

from .config import settings
from .logging import configure_logging, get_logger

__all__ = ["settings", "configure_logging", "get_logger"]

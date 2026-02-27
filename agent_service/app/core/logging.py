"""
Artifact: agent_service/app/core/logging.py
Purpose: Provides centralized logging configuration and named logger accessors.
Author: Ansuman Sharma
Created: 2026-02-27
Revised:
- 2026-02-27: Added shared logger configuration for modularized app components. (Ansuman Sharma)
Preconditions:
- Python logging module is available.
Inputs:
- Acceptable: Logger names as non-empty strings.
- Unacceptable: Invalid logger names that are not string-compatible.
Postconditions:
- Root logging is configured once and loggers can be retrieved by name.
Returns:
- `configure_logging` returns None; `get_logger` returns `logging.Logger`.
Errors/Exceptions:
- No custom exceptions; logging internals may raise standard runtime errors in rare cases.
"""

import logging


def configure_logging() -> None:
    """Apply process-wide logging configuration for the service."""
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def get_logger(name: str) -> logging.Logger:
    """Return a named logger instance."""
    return logging.getLogger(name)

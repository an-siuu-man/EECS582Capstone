#!/usr/bin/env python3
"""
Test Docling on a PDF and export a structured JSON output.

Usage:
    python test_docling_pdf_json.py path/to/file.pdf
    python test_docling_pdf_json.py path/to/file.pdf --out parsed.json --preview-md

Install:
    pip install docling
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from docling.document_converter import DocumentConverter


def _to_jsonable(obj: Any) -> Any:
    """Best-effort conversion of a Docling object to a JSON-serializable dict."""
    # Common patterns across versions
    for method_name in (
        "export_to_dict",
        "to_dict",
        "model_dump",   # pydantic v2 style
        "dict",         # pydantic v1 style
    ):
        method = getattr(obj, method_name, None)
        if callable(method):
            try:
                return method()
            except TypeError:
                # Some methods may require args in certain versions
                pass

    # Fallback: try __dict__
    if hasattr(obj, "__dict__"):
        return obj.__dict__

    raise TypeError(
        f"Could not convert object of type {type(obj).__name__} to JSON. "
        "Try checking Docling version/API methods."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse a PDF with Docling and export structured JSON."
    )
    parser.add_argument("pdf", type=str, help="Path to the input PDF")
    parser.add_argument(
        "--out",
        type=str,
        default=None,
        help="Output JSON file path (default: <pdf_stem>.docling.json)",
    )
    parser.add_argument(
        "--preview-md",
        action="store_true",
        help="Also print a short markdown preview (first ~1000 chars) if available.",
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    if not pdf_path.exists():
        print(f"Error: file not found: {pdf_path}", file=sys.stderr)
        return 1
    if pdf_path.suffix.lower() != ".pdf":
        print(f"Warning: file extension is not .pdf ({pdf_path.suffix})", file=sys.stderr)

    out_path = Path(args.out) if args.out else pdf_path.with_suffix(".docling.json")

    print(f"[1/3] Loading converter...")
    converter = DocumentConverter()

    print(f"[2/3] Converting PDF: {pdf_path}")
    result = converter.convert(str(pdf_path))

    # Some versions return a conversion result with `.document`, others may return document directly.
    document = getattr(result, "document", result)

    print(f"[3/3] Exporting structured JSON -> {out_path}")
    data = _to_jsonable(document)

    # Wrap with light metadata to make inspection easier
    payload = {
        "source_file": str(pdf_path),
        "docling_output": data,
    }

    out_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )

    print("\n✅ Done.")
    print(f"JSON saved to: {out_path}")

    # Optional quick preview
    if args.preview_md:
        export_md = getattr(document, "export_to_markdown", None)
        if callable(export_md):
            try:
                md = export_md()
                preview = md[:1000]
                print("\n--- Markdown preview (first ~1000 chars) ---")
                print(preview)
                if len(md) > len(preview):
                    print("... [truncated]")
            except Exception as e:
                print(f"\n(Markdown preview unavailable: {e})")
        else:
            print("\n(Markdown preview unavailable: export_to_markdown() not found)")

    # Optional quick structural hints
    if isinstance(data, dict):
        top_keys = list(data.keys())
        print("\nTop-level JSON keys:", top_keys[:25])
        if len(top_keys) > 25:
            print("...")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
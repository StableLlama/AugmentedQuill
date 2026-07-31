# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Generate a `tools.json` file from the canonical chat tool registry.

This ensures the tool schema stays in sync with the actual tool implementations.

Usage:
    python tools/generate_tools_json.py

By default this script writes to a temporary file and prints its path.
(Useful when a file is needed at runtime but should not be checked in.)

You can also pass an explicit output path:
    python tools/generate_tools_json.py /path/to/tools.json
"""

import argparse
import json
import tempfile
from pathlib import Path

from augmentedquill.services.chat.chat_tool_decorator import get_registered_tool_schemas


def _sort_schema_list(schemas: list[dict]) -> list[dict]:
    """Sort tool schemas deterministically by tool name."""

    def key(schema: dict):
        return schema.get("function", {}).get("name", "")

    return sorted(schemas, key=key)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="generate_tools_json",
        description="Generate tools JSON schema from the chat tool registry.",
    )
    parser.add_argument(
        "output",
        nargs="?",
        default=None,
        help="Optional output path. If omitted, a temp file is used.",
    )
    args = parser.parse_args(argv)

    schemas = get_registered_tool_schemas(model_type=None)
    schemas = _sort_schema_list(schemas)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        with tempfile.NamedTemporaryFile(
            prefix="augmentedquill-tools-", suffix=".json", delete=False
        ) as out_file:
            out_path = Path(out_file.name)

    out_path.write_text(
        json.dumps(schemas, indent=2, sort_keys=False) + "\n", encoding="utf-8"
    )

    print(f"Wrote {len(schemas)} tools to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

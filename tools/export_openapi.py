# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Export the FastAPI OpenAPI schema to openapi.json at the repository root.

Run from the repository root (with the venv active):

    python tools/export_openapi.py

The resulting openapi.json is consumed by the frontend type-generation step:

    cd src/frontend && npm run generate:types
"""

from __future__ import annotations

import importlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "src"

sys.path.insert(0, str(SRC_DIR))

create_app = importlib.import_module("augmentedquill.main").create_app


def main() -> None:
    app = create_app()
    schema = app.openapi()
    output = REPO_ROOT / "openapi.json"
    output.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    try:
        subprocess.run(
            ["npm", "exec", "prettier", "--", "--write", str(output)],
            cwd=REPO_ROOT / "src" / "frontend",
            check=True,
        )
    except FileNotFoundError:
        print(
            "Warning: npm is not installed; openapi.json was written without prettier formatting",
            file=sys.stderr,
        )
    print(f"OpenAPI schema written to {output}")


if __name__ == "__main__":
    main()

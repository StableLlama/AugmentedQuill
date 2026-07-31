#!/usr/bin/env python3
# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Enforces consistent legal and purpose headers across source files."""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

PY_HEADER = [
    "# Copyright (C) 2026 StableLlama",
    "#",
    "# This program is free software: you can redistribute it and/or modify",
    "# it under the terms of the GNU General Public License as published by",
    "# the Free Software Foundation, either version 3 of the License, or",
    "# (at your option) any later version.",
]

TS_HEADER = [
    "// Copyright (C) 2026 StableLlama",
    "//",
    "// This program is free software: you can redistribute it and/or modify",
    "// it under the terms of the GNU General Public License as published by",
    "// the Free Software Foundation, either version 3 of the License, or",
    "// (at your option) any later version.",
]

VALID_EXTENSIONS = {".py", ".ts", ".tsx", ".js"}
IGNORE_DIRS = {
    "venv",
    "node_modules",
    "__pycache__",
    ".git",
    "dist",
    "build",
    "AugmentedQuill.egg-info",
    ".pytest_cache",
    ".ruff_cache",
}


@dataclass
class FileUpdate:
    path: Path
    changed: bool


def split_pascal_camel(word: str) -> str:
    return re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", word)


def infer_purpose(path: Path) -> str:
    stem = (
        split_pascal_camel(path.stem.replace("_", " ").replace("-", " "))
        .lower()
        .strip()
    )
    stem = re.sub(r"\s+", " ", stem)
    if not stem:
        stem = "module"
    return f"Defines the {stem} unit so this responsibility stays isolated, testable, and easy to evolve."


def detect_shebang(lines: list[str], is_python: bool) -> tuple[str | None, list[str]]:
    if is_python and lines and lines[0].startswith("#!"):
        return lines[0], lines[1:]
    return None, lines


def strip_existing_header(lines: list[str], marker: str) -> list[str]:
    idx = 0
    if idx < len(lines) and re.match(
        rf"^{re.escape(marker)}\s*Copyright\s*\(C\)", lines[idx]
    ):
        idx += 1
        while idx < len(lines) and (
            lines[idx].startswith(marker) or lines[idx].strip() == ""
        ):
            idx += 1
        return lines[idx:]
    return lines


def extract_existing_purpose(lines: list[str], marker: str) -> str | None:
    purpose_re = re.compile(rf"^{re.escape(marker)}\s*Purpose:\s*(.+)$")
    for line in lines[:40]:
        match = purpose_re.match(line)
        if match:
            return match.group(1).strip()
    return None


def strip_leading_purpose(lines: list[str], marker: str) -> list[str]:
    idx = 0
    while idx < len(lines) and lines[idx].strip() == "":
        idx += 1
    if idx < len(lines) and re.match(rf"^{re.escape(marker)}\s*Purpose:", lines[idx]):
        idx += 1
    while idx < len(lines) and lines[idx].strip() == "":
        idx += 1
    return lines[idx:]


def normalize_file(path: Path) -> FileUpdate:
    text = path.read_text(encoding="utf-8")
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines()
    ext = path.suffix
    is_python = ext == ".py"
    marker = "#" if is_python else "//"
    header = PY_HEADER if is_python else TS_HEADER

    shebang, remaining = detect_shebang(lines, is_python)
    preserved_purpose = extract_existing_purpose(remaining, marker)

    remaining = strip_existing_header(remaining, marker)
    remaining = strip_leading_purpose(remaining, marker)

    purpose_text = preserved_purpose or infer_purpose(path)

    new_lines: list[str] = []
    if shebang:
        new_lines.append(shebang)
    new_lines.extend(header)
    new_lines.append("")

    has_docstring = False
    if is_python:
        if remaining and remaining[0].startswith('"""'):
            has_docstring = True
    else:
        if remaining and remaining[0].strip() == "/**":
            has_docstring = True

    if not has_docstring:
        if is_python:
            new_lines.append(f'"""{purpose_text}"""')
            new_lines.append("")
        else:
            new_lines.append("/**")
            new_lines.append(f" * {purpose_text}")
            new_lines.append(" */")
            new_lines.append("")

    new_lines.extend(remaining)

    new_text = newline.join(new_lines).rstrip() + newline
    changed = new_text != text
    if changed:
        path.write_text(new_text, encoding="utf-8")
    return FileUpdate(path=path, changed=changed)


def iter_code_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for filename in filenames:
            path = Path(dirpath) / filename
            if path.suffix in VALID_EXTENSIONS:
                yield path


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    updates: list[FileUpdate] = []
    for file_path in iter_code_files(root):
        updates.append(normalize_file(file_path))

    changed = [u.path for u in updates if u.changed]
    print(f"Scanned {len(updates)} code files.")
    print(f"Updated {len(changed)} files.")
    for path in changed:
        print(path.relative_to(root))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

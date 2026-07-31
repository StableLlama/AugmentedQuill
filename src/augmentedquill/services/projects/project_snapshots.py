# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project snapshots unit so this responsibility stays isolated, testable, and easy to evolve."""

import base64
import shutil
from pathlib import Path
from typing import Any


def iter_project_files(project_dir: Path) -> Any:
    """Yield relative file paths for snapshot-able project files."""
    for path in project_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(project_dir)
        if not _is_safe_relative_path(rel):
            continue
        yield rel


def _is_safe_relative_path(rel_path: Path) -> bool:
    """Return True if a relative path is safe for use inside a project directory."""
    # Reject absolute paths.
    if rel_path.is_absolute():
        return False

    parts = rel_path.parts
    if not parts:
        return False

    # Prevent traversal outside the project directory.
    if any(p == ".." for p in parts):
        return False

    # Prevent access to internal metadata and checkpoints.
    return parts[0] not in {".aq_history", "chats", "checkpoints"}


def capture_project_snapshot(project_dir: Path) -> dict[str, str]:
    """Capture project files as base64-encoded bytes keyed by relative path."""
    snapshot: dict[str, str] = {}
    for rel_path in iter_project_files(project_dir):
        abs_path = project_dir / rel_path
        snapshot[str(rel_path)] = base64.b64encode(abs_path.read_bytes()).decode(
            "ascii"
        )
    return snapshot


def restore_project_snapshot(project_dir: Path, snapshot: dict[str, str]) -> Any:
    """Replace project files with the exact snapshot content."""
    resolved_root = project_dir.resolve()
    expected = set(snapshot.keys())
    current = {str(rel): rel for rel in iter_project_files(project_dir)}

    for rel_str, rel_path in current.items():
        if rel_str not in expected:
            (resolved_root / rel_path).unlink(missing_ok=True)

    for rel_str, encoded in snapshot.items():
        # Reject any paths that could escape the project root.
        rel_path = Path(rel_str)
        if not _is_safe_relative_path(rel_path):
            continue

        # Construct destination path explicitly relative to resolved_root
        dst_path = (resolved_root / rel_path).resolve()
        if not dst_path.is_relative_to(resolved_root):
            continue

        dst_path.parent.mkdir(parents=True, exist_ok=True)
        dst_path.write_bytes(base64.b64decode(encoded.encode("ascii")))


def snapshot_to_directory(project_dir: Path, target_dir: Path) -> Any:
    """Copy all snapshot-able project files to a target directory structure."""
    # Resolve the project root and target directory for safety comparisons.
    resolved_root = project_dir.resolve()
    resolved_target = target_dir.resolve()

    # Ensure the target directory is strictly inside the checkpoints folder of that project.
    checkpoints_base = (resolved_root / "checkpoints").resolve()
    if not resolved_target.is_relative_to(checkpoints_base):
        raise ValueError(
            "Checkpoint target directory must be within the checkpoints folder"
        )
    if resolved_target == checkpoints_base:
        raise ValueError("Cannot snapshot directly into the checkpoints base folder")

    if resolved_target.exists():
        shutil.rmtree(resolved_target)
    resolved_target.mkdir(parents=True, exist_ok=True)

    for rel_path in iter_project_files(project_dir):
        # Additional safety check for the file source and destination.
        if not _is_safe_relative_path(rel_path):
            continue

        src_path = (resolved_root / rel_path).resolve()
        dst_path = (resolved_target / rel_path).resolve()

        # Ensure we're not copying anything that could escape or overwrite internal metadata.
        if not src_path.is_relative_to(resolved_root):
            continue
        if not dst_path.is_relative_to(resolved_target):
            continue

        dst_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dst_path)


def restore_from_directory(project_dir: Path, source_dir: Path) -> Any:
    """Restore project state from a checkpoint directory."""
    # Resolve the project root and source directory for safety comparisons.
    resolved_root = project_dir.resolve()
    resolved_source = source_dir.resolve()

    # Ensure the source directory is strictly inside the checkpoints folder of that project.
    checkpoints_base = (resolved_root / "checkpoints").resolve()
    if not resolved_source.is_relative_to(checkpoints_base):
        raise ValueError(
            "Checkpoint source directory must be within the checkpoints folder"
        )
    if resolved_source == checkpoints_base:
        raise ValueError("Cannot restore directly from the checkpoints base folder")

    # First delete existing files that should be overwritten or removed
    for rel_path in iter_project_files(project_dir):
        target_path = (resolved_root / rel_path).resolve()
        if target_path.is_relative_to(resolved_root) and _is_safe_relative_path(
            rel_path
        ):
            target_path.unlink(missing_ok=True)

    # Then copy all files from the snapshot directory
    if resolved_source.exists():
        for path in resolved_source.rglob("*"):
            if not path.is_file():
                continue

            # This file is coming from inside the source_dir.
            rel_path = path.relative_to(resolved_source)

            # Additional safety checks for relative destination path.
            if not _is_safe_relative_path(rel_path):
                continue

            # Construct destination path explicitly relative to resolved_root
            dst_path = (resolved_root / rel_path).resolve()
            if not dst_path.is_relative_to(resolved_root):
                continue

            dst_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dst_path)

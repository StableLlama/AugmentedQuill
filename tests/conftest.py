# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the conftest unit so this responsibility stays isolated, testable, and easy to evolve."""

import os
import tempfile
import pytest
from pathlib import Path

# Global temporary directory for the whole test session
# This acts as a safety net to prevent tests from writing to the real projects folder
# if an individual test forgets to redirect.
_SESSION_TEMP_DIR = None


@pytest.fixture(scope="session", autouse=True)
def session_temp_env():
    global _SESSION_TEMP_DIR
    _SESSION_TEMP_DIR = tempfile.TemporaryDirectory(prefix="augq_test_session_")

    temp_projects = Path(_SESSION_TEMP_DIR.name) / "projects"
    temp_projects.mkdir(parents=True, exist_ok=True)
    temp_registry = Path(_SESSION_TEMP_DIR.name) / "projects.json"

    # Store originals
    orig_root = os.environ.get("AUGQ_PROJECTS_ROOT")
    orig_reg = os.environ.get("AUGQ_PROJECTS_REGISTRY")

    # Set session-wide defaults
    os.environ["AUGQ_PROJECTS_ROOT"] = str(temp_projects)
    os.environ["AUGQ_PROJECTS_REGISTRY"] = str(temp_registry)

    yield

    # Clean up
    if _SESSION_TEMP_DIR:
        _SESSION_TEMP_DIR.cleanup()

    # Restore originals if they were there
    if orig_root is not None:
        os.environ["AUGQ_PROJECTS_ROOT"] = orig_root
    else:
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)

    if orig_reg is not None:
        os.environ["AUGQ_PROJECTS_REGISTRY"] = orig_reg
    else:
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

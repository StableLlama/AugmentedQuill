# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the project file locking unit so this responsibility stays isolated, testable, and easy to evolve.

Purpose: Provide per-project asyncio write locks to prevent concurrent writes
from corrupting project files.  Each project directory gets one dedicated
``asyncio.Lock``.  The registry is protected by a plain ``threading.Lock``
so it can be safely populated from any thread that creates new projects.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

_registry_lock = threading.Lock()
_project_locks: dict[Path, asyncio.Lock] = {}

_T = TypeVar("_T")


def get_project_lock(project_dir: Path) -> asyncio.Lock:
    """Return the ``asyncio.Lock`` for *project_dir*, creating it if needed.

    The lookup is thread-safe.  Multiple coroutines in the same event-loop
    that share the same *project_dir* will all receive the identical lock
    object and will therefore be serialised correctly.
    """
    key = project_dir.resolve()
    with _registry_lock:
        if key not in _project_locks:
            _project_locks[key] = asyncio.Lock()
        return _project_locks[key]


async def run_locked[T](project_dir: Path, fn: Callable[[], _T]) -> _T:
    """Acquire the per-project write lock, then execute *fn* in a thread pool.

    Using ``asyncio.to_thread`` keeps the event-loop free while synchronous
    file I/O is in progress.  The lock ensures that only one write operation
    per project runs at a time, preventing concurrent writes from corrupting
    project files.
    """
    lock = get_project_lock(project_dir)
    async with lock:
        return await asyncio.to_thread(fn)

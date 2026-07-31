# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the request body unit so this responsibility stays isolated, testable, and easy to evolve."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from fastapi import HTTPException, Request

TError = TypeVar("TError", bound=Exception)


async def parse_json_object_body(
    request: Request,
    *,
    error_factory: Callable[[Exception], TError] | None = None,
) -> dict:
    """Parse request JSON and return an object payload.

    Non-object payloads are normalized to an empty dict so route handlers can
    safely access keys without repeated type checks.
    """
    try:
        payload = await request.json()
    except (TypeError, ValueError) as exc:
        if error_factory is not None:
            raise error_factory(exc) from exc
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc
    return payload if isinstance(payload, dict) else {}

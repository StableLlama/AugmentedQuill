# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the projects api request ops unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

from fastapi import HTTPException, Request


async def parse_json_body(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    return payload or {}


def payload_value(payload: dict, key: str, default=None):
    return payload.get(key, default)


def required_payload_value(payload: dict, key: str, error_detail: str):
    value = payload.get(key)
    if value in (None, ""):
        raise HTTPException(status_code=400, detail=error_detail)
    return value

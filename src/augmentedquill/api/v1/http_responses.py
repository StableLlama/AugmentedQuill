# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the http responses unit so this responsibility stays isolated, testable, and easy to evolve.

from fastapi.responses import JSONResponse


def ok_json(content: dict | None = None, status_code: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=content or {"ok": True})


def error_json(detail: str, status_code: int = 400, **extra: object) -> JSONResponse:
    body: dict[str, object] = {"ok": False, "detail": detail}
    body.update(extra)
    return JSONResponse(status_code=status_code, content=body)

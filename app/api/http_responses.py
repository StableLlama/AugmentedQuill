from fastapi.responses import JSONResponse


def ok_json(content: dict | None = None, status_code: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=content or {"ok": True})


def error_json(detail: str, status_code: int = 400, **extra: object) -> JSONResponse:
    body: dict[str, object] = {"ok": False, "detail": detail}
    body.update(extra)
    return JSONResponse(status_code=status_code, content=body)

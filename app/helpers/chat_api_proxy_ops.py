from __future__ import annotations

import datetime

import httpx
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.llm import add_llm_log, create_log_entry


async def proxy_openai_models(payload: dict) -> JSONResponse:
    base_url = (payload or {}).get("base_url") or ""
    api_key = (payload or {}).get("api_key") or ""
    timeout_s = (payload or {}).get("timeout_s") or 60

    if not isinstance(base_url, str) or not base_url:
        raise HTTPException(status_code=400, detail="base_url is required")

    url = base_url.rstrip("/") + "/models"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    log_entry = create_log_entry(url, "GET", headers, None)
    add_llm_log(log_entry)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(float(timeout_s))) as client:
            response = await client.get(url, headers=headers)
            log_entry["response"]["status_code"] = response.status_code
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            content = (
                response.json()
                if response.headers.get("content-type", "").startswith(
                    "application/json"
                )
                else {"raw": response.text}
            )
            log_entry["response"]["body"] = content
            if response.status_code >= 400:
                return JSONResponse(
                    status_code=response.status_code,
                    content={
                        "error": "Upstream error",
                        "status": response.status_code,
                        "data": content,
                    },
                )
            return JSONResponse(status_code=200, content=content)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {exc}")

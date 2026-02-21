from fastapi import HTTPException, Request


async def parse_json_body(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc
    return payload if isinstance(payload, dict) else {}

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.story_routes.common import map_story_exception, parse_json_body
from app.services.story.story_generation_ops import (
    continue_chapter_from_summary,
    generate_chapter_summary,
    generate_story_summary,
    write_chapter_from_summary,
)

router = APIRouter(tags=["Story"])


@router.post("/api/story/story-summary")
async def api_story_story_summary(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)
        mode = (payload.get("mode") or "").lower()
        data = await generate_story_summary(mode=mode, payload=payload)
        return JSONResponse(status_code=200, content=data)
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/api/story/summary")
async def api_story_summary(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)
        chap_id = payload.get("chap_id")
        mode = (payload.get("mode") or "").lower()
        data = await generate_chapter_summary(
            chap_id=chap_id, mode=mode, payload=payload
        )
        return JSONResponse(status_code=200, content=data)
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/api/story/write")
async def api_story_write(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)
        chap_id = payload.get("chap_id")
        data = await write_chapter_from_summary(chap_id=chap_id, payload=payload)
        return JSONResponse(status_code=200, content=data)
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/api/story/continue")
async def api_story_continue(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)
        chap_id = payload.get("chap_id")
        data = await continue_chapter_from_summary(chap_id=chap_id, payload=payload)
        return JSONResponse(status_code=200, content=data)
    except Exception as exc:
        return map_story_exception(exc)

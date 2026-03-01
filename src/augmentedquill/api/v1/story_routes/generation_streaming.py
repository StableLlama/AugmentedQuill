# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the generation streaming unit so this responsibility stays isolated, testable, and easy to evolve."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from augmentedquill.core.config import BASE_DIR, save_story_config
from augmentedquill.core.prompts import get_user_prompt
from augmentedquill.services.llm import llm
from augmentedquill.services.story.story_api_prompt_ops import (
    resolve_model_runtime,
)
from augmentedquill.services.story.story_api_state_ops import (
    ensure_chapter_slot,
    get_active_story_or_raise,
    get_chapter_locator,
    get_normalized_chapters,
    read_text_or_raise,
)
from augmentedquill.services.story.story_generation_common import (
    prepare_chapter_summary_generation,
    prepare_continue_chapter_generation,
    prepare_story_summary_generation,
    prepare_write_chapter_generation,
)
from augmentedquill.services.story.story_api_stream_ops import (
    stream_collect_and_persist,
    stream_unified_chat_content,
)
from augmentedquill.services.exceptions import ServiceError
from augmentedquill.api.v1.story_routes.common import parse_json_body

router = APIRouter(tags=["Story"])


async def _create_gen_source(prepared: dict):
    """Create a generator source for streaming."""
    try:
        async for chunk in stream_unified_chat_content(
            messages=prepared["messages"],
            base_url=prepared["base_url"],
            api_key=prepared["api_key"],
            model_id=prepared["model_id"],
            timeout_s=prepared["timeout_s"],
        ):
            yield chunk
    except ServiceError as e:
        # Re-raise service errors as they are handled by the global exception handler for REST,
        # but for streaming we might need to yield an error event.
        yield f'data: {{"error": "{e.detail}"}}\n\n'
    except Exception:
        # Mask internal errors to avoid information exposure
        yield 'data: {"error": "An internal error occurred during generation."}\n\n'


def _as_streaming_response(gen_factory, media_type: str = "text/plain"):
    return StreamingResponse(gen_factory(), media_type=media_type)


@router.post("/story/suggest")
async def api_story_suggest(request: Request) -> StreamingResponse:
    """Api Story Suggest."""
    try:
        payload = await parse_json_body(request)

        chap_id = (payload or {}).get("chap_id")
        if not isinstance(chap_id, int):
            raise ServiceError("chap_id is required", status_code=400)

        _, path, pos = get_chapter_locator(chap_id)
        current_text = (payload or {}).get("current_text")
        if not isinstance(current_text, str):
            current_text = read_text_or_raise(path)

        _, _, story = get_active_story_or_raise()
        chapters_data = get_normalized_chapters(story)
        ensure_chapter_slot(chapters_data, pos)
        summary = chapters_data[pos].get("summary", "")
        title = chapters_data[pos].get("title") or path.name

        base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
            payload=payload,
            model_type="WRITING",
            base_dir=BASE_DIR,
        )

        prompt = get_user_prompt(
            "suggest_continuation",
            chapter_title=title or "",
            chapter_summary=summary or "",
            current_text=current_text or "",
            user_prompt_overrides=model_overrides,
        )

        extra_body = {
            "max_tokens": 500,
            "temperature": 1.0,
            "top_k": 0,
            "top_p": 1.0,
            "min_p": 0.02,
            "repeat_penalty": 1.0,
        }

        async def generate_suggestion():
            """Generate Suggestion."""
            try:
                startFound = False
                isNewParagraph = False
                async for chunk in llm.openai_completions_stream(
                    prompt=prompt,
                    base_url=base_url,
                    api_key=api_key,
                    model_id=model_id,
                    timeout_s=timeout_s,
                    extra_body=extra_body,
                ):
                    while chunk.lstrip(" \t").startswith("\n") and not startFound:
                        chunk = chunk.lstrip(" \t")[1:]
                        if not isNewParagraph:
                            yield "\n"
                        isNewParagraph = True
                    if chunk == "":
                        continue
                    startFound = True
                    lines = chunk.splitlines()
                    yield lines[0]
                    if len(lines) > 1:
                        break
            except Exception:
                # Mask internal errors
                yield "\n[Error occurred during suggestion]"

        return StreamingResponse(generate_suggestion(), media_type="text/plain")

    except ServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")


@router.post("/story/summary/stream")
async def api_story_summary_stream(request: Request):
    """Api Story Summary Stream."""
    try:
        payload = await parse_json_body(request)
        prepared = prepare_chapter_summary_generation(
            payload,
            payload.get("chap_id"),
            payload.get("mode") or "",
        )

        def _persist(new_summary: str) -> None:
            prepared["chapters_data"][prepared["pos"]]["summary"] = new_summary
            prepared["story"]["chapters"] = prepared["chapters_data"]
            save_story_config(prepared["story_path"], prepared["story"])

        return StreamingResponse(
            stream_collect_and_persist(lambda: _create_gen_source(prepared), _persist),
            media_type="text/event-stream",
        )
    except ServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")


@router.post("/story/write/stream")
async def api_story_write_stream(request: Request):
    """Api Story Write Stream."""
    try:
        payload = await parse_json_body(request)
        prepared = prepare_write_chapter_generation(payload, payload.get("chap_id"))

        def _persist(content: str) -> None:
            prepared["path"].write_text(content, encoding="utf-8")

        return StreamingResponse(
            stream_collect_and_persist(lambda: _create_gen_source(prepared), _persist),
            media_type="text/event-stream",
        )
    except ServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")


@router.post("/story/continue/stream")
async def api_story_continue_stream(request: Request):
    """Api Story Continue Stream."""
    try:
        payload = await parse_json_body(request)
        prepared = prepare_continue_chapter_generation(payload, payload.get("chap_id"))

        def _persist(appended: str) -> None:
            """Persist."""
            new_content = (
                prepared["existing"]
                + (
                    "\n"
                    if prepared["existing"] and not prepared["existing"].endswith("\n")
                    else ""
                )
                + appended
            )
            prepared["path"].write_text(new_content, encoding="utf-8")

        return _as_streaming_response(
            lambda: stream_collect_and_persist(
                lambda: _create_gen_source(prepared), _persist
            )
        )
    except ServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")


@router.post("/story/story-summary/stream")
async def api_story_story_summary_stream(request: Request):
    """Api Story Story Summary Stream."""
    try:
        payload = await parse_json_body(request)
        prepared = prepare_story_summary_generation(payload, payload.get("mode") or "")

        def _persist(new_summary: str) -> None:
            prepared["story"]["story_summary"] = new_summary
            save_story_config(prepared["story_path"], prepared["story"])

        return _as_streaming_response(
            lambda: stream_collect_and_persist(
                lambda: _create_gen_source(prepared), _persist
            )
        )
    except ServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")

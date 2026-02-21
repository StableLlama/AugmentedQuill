from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.config import save_story_config, BASE_DIR
from app.services.story.story_api_prompt_ops import (
    resolve_model_runtime,
    build_chapter_summary_messages,
    build_story_summary_messages,
    build_write_chapter_messages,
    build_continue_chapter_messages,
    build_suggest_prompt,
)
from app.services.story.story_api_state_ops import (
    get_active_story_or_http_error,
    get_chapter_locator,
    read_text_or_http_500,
    get_normalized_chapters,
    ensure_chapter_slot,
    collect_chapter_summaries,
)
from app.services.story.story_api_stream_ops import (
    stream_unified_chat_content,
    stream_collect_and_persist,
)
from app.services.llm import llm
from app.api.story_routes.common import (
    parse_json_body,
    StoryBadRequestError,
    StoryPersistenceError,
    map_story_exception,
)

router = APIRouter(tags=["Story"])


def _as_streaming_response(gen_factory, media_type: str = "text/plain"):
    return StreamingResponse(gen_factory(), media_type=media_type)


@router.post("/api/story/story-summary")
async def api_story_story_summary(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)

        mode = (payload.get("mode") or "").lower()
        if mode not in ("discard", "update", ""):
            raise StoryBadRequestError("mode must be discard|update")

        try:
            _, story_path, story = get_active_story_or_http_error()
        except HTTPException:
            raise StoryBadRequestError("No active project")

        chapters_data = get_normalized_chapters(story)
        current_story_summary = story.get("story_summary", "")
        chapter_summaries = collect_chapter_summaries(chapters_data)
        if not chapter_summaries:
            raise StoryBadRequestError("No chapter summaries available")

        base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
            payload=payload,
            model_type="EDITING",
            base_dir=BASE_DIR,
        )
        messages = build_story_summary_messages(
            mode=mode,
            current_story_summary=current_story_summary,
            chapter_summaries=chapter_summaries,
            model_overrides=model_overrides,
        )

        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )

        new_summary = data.get("content", "")
        story["story_summary"] = new_summary
        try:
            save_story_config(story_path, story)
        except Exception as exc:
            raise StoryPersistenceError(f"Failed to write story.json: {exc}") from exc

        return JSONResponse(
            status_code=200, content={"ok": True, "summary": new_summary}
        )
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/api/story/summary")
async def api_story_summary(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)

        chap_id = payload.get("chap_id")
        if not isinstance(chap_id, int):
            raise StoryBadRequestError("chap_id is required")

        mode = (payload.get("mode") or "").lower()
        if mode not in ("discard", "update", ""):
            raise StoryBadRequestError("mode must be discard|update")

        _, path, pos = get_chapter_locator(chap_id)
        chapter_text = read_text_or_http_500(path)

        try:
            _, story_path, story = get_active_story_or_http_error()
        except HTTPException:
            raise StoryBadRequestError("No active project")

        chapters_data = get_normalized_chapters(story)
        ensure_chapter_slot(chapters_data, pos)
        current_summary = chapters_data[pos].get("summary", "")

        base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
            payload=payload,
            model_type="EDITING",
            base_dir=BASE_DIR,
        )
        messages = build_chapter_summary_messages(
            mode=mode,
            current_summary=current_summary,
            chapter_text=chapter_text,
            model_overrides=model_overrides,
        )

        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )

        new_summary = data.get("content", "")
        chapters_data[pos]["summary"] = new_summary
        story["chapters"] = chapters_data

        try:
            save_story_config(story_path, story)
        except Exception as exc:
            raise StoryPersistenceError(f"Failed to write story.json: {exc}") from exc

        title_for_response = chapters_data[pos].get("title") or path.name
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "summary": new_summary,
                "chapter": {
                    "id": chap_id,
                    "title": title_for_response,
                    "filename": path.name,
                    "summary": new_summary,
                },
            },
        )
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/api/story/write")
async def api_story_write(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)
        chap_id = payload.get("chap_id")
        if not isinstance(chap_id, int):
            raise StoryBadRequestError("chap_id is required")

        _, path, pos = get_chapter_locator(chap_id)
        try:
            _, _, story = get_active_story_or_http_error()
        except HTTPException:
            raise StoryBadRequestError("No active project")

        chapters_data = get_normalized_chapters(story)
        if pos >= len(chapters_data):
            raise StoryBadRequestError("No summary available for this chapter")

        summary = chapters_data[pos].get("summary", "").strip()
        title = chapters_data[pos].get("title") or path.name

        base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
            payload=payload,
            model_type="WRITING",
            base_dir=BASE_DIR,
        )
        messages = build_write_chapter_messages(
            project_title=story.get("project_title", "Story"),
            chapter_title=title,
            chapter_summary=summary,
            model_overrides=model_overrides,
        )

        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )

        content = data.get("content", "")
        try:
            path.write_text(content, encoding="utf-8")
        except Exception as exc:
            raise StoryPersistenceError(f"Failed to write chapter: {exc}") from exc

        return JSONResponse(status_code=200, content={"ok": True, "content": content})
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/api/story/continue")
async def api_story_continue(request: Request) -> JSONResponse:
    try:
        payload = await parse_json_body(request)
        chap_id = payload.get("chap_id")
        if not isinstance(chap_id, int):
            raise StoryBadRequestError("chap_id is required")

        _, path, pos = get_chapter_locator(chap_id)
        existing = read_text_or_http_500(path)

        try:
            _, _, story = get_active_story_or_http_error()
        except HTTPException:
            raise StoryBadRequestError("No active project")

        chapters_data = get_normalized_chapters(story)
        if pos >= len(chapters_data):
            raise StoryBadRequestError("No summary available for this chapter")

        summary = chapters_data[pos].get("summary", "")
        title = chapters_data[pos].get("title") or path.name

        base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
            payload=payload,
            model_type="WRITING",
            base_dir=BASE_DIR,
        )
        messages = build_continue_chapter_messages(
            chapter_title=title,
            chapter_summary=summary,
            existing_text=existing,
            model_overrides=model_overrides,
        )

        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )

        appended = data.get("content", "")
        new_content = (
            existing
            + ("\n" if existing and not existing.endswith("\n") else "")
            + appended
        )

        try:
            path.write_text(new_content, encoding="utf-8")
        except Exception as exc:
            raise StoryPersistenceError(f"Failed to write chapter: {exc}") from exc

        return JSONResponse(
            status_code=200,
            content={"ok": True, "appended": appended, "content": new_content},
        )
    except Exception as exc:
        return map_story_exception(exc)


@router.post("/api/story/suggest")
async def api_story_suggest(request: Request) -> StreamingResponse:
    payload = await parse_json_body(request)

    chap_id = (payload or {}).get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")

    _, path, pos = get_chapter_locator(chap_id)
    current_text = (payload or {}).get("current_text")
    if not isinstance(current_text, str):
        current_text = read_text_or_http_500(path)

    _, _, story = get_active_story_or_http_error()
    chapters_data = get_normalized_chapters(story)
    ensure_chapter_slot(chapters_data, pos)
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="WRITING",
        base_dir=BASE_DIR,
    )

    prompt = build_suggest_prompt(
        chapter_title=title,
        chapter_summary=summary,
        current_text=current_text,
        model_overrides=model_overrides,
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

    return StreamingResponse(generate_suggestion(), media_type="text/plain")


@router.post("/api/story/summary/stream")
async def api_story_summary_stream(request: Request):
    payload = await parse_json_body(request)
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    mode = (payload.get("mode") or "").lower()
    if mode not in ("discard", "update", ""):
        raise HTTPException(status_code=400, detail="mode must be discard|update")

    _, path, pos = get_chapter_locator(chap_id)
    chapter_text = read_text_or_http_500(path)

    _, story_path, story = get_active_story_or_http_error()
    chapters_data = get_normalized_chapters(story)
    ensure_chapter_slot(chapters_data, pos)
    current_summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="EDITING",
        base_dir=BASE_DIR,
    )
    messages = build_chapter_summary_messages(
        mode=mode,
        current_summary=current_summary,
        chapter_text=chapter_text,
        model_overrides=model_overrides,
    )

    async def _gen_source():
        async for chunk in stream_unified_chat_content(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        ):
            yield chunk

    def _persist(new_summary: str) -> None:
        chapters_data[pos]["summary"] = new_summary
        story["chapters"] = chapters_data
        save_story_config(story_path, story)

    return _as_streaming_response(
        lambda: stream_collect_and_persist(_gen_source, _persist)
    )


@router.post("/api/story/write/stream")
async def api_story_write_stream(request: Request):
    payload = await parse_json_body(request)
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    _, path, pos = get_chapter_locator(chap_id)

    _, _, story = get_active_story_or_http_error()
    chapters_data = get_normalized_chapters(story)
    if pos >= len(chapters_data):
        raise HTTPException(
            status_code=400, detail="No summary available for this chapter"
        )

    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="WRITING",
        base_dir=BASE_DIR,
    )
    messages = build_write_chapter_messages(
        project_title=story.get("project_title", "Story"),
        chapter_title=title,
        chapter_summary=summary,
        model_overrides=model_overrides,
    )

    async def _gen_source():
        async for chunk in stream_unified_chat_content(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        ):
            yield chunk

    def _persist(content: str) -> None:
        path.write_text(content, encoding="utf-8")

    return _as_streaming_response(
        lambda: stream_collect_and_persist(_gen_source, _persist)
    )


@router.post("/api/story/continue/stream")
async def api_story_continue_stream(request: Request):
    payload = await parse_json_body(request)
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    _, path, pos = get_chapter_locator(chap_id)

    existing = read_text_or_http_500(path)

    _, _, story = get_active_story_or_http_error()
    chapters_data = get_normalized_chapters(story)
    if pos >= len(chapters_data):
        raise HTTPException(
            status_code=400, detail="No summary available for this chapter"
        )

    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="WRITING",
        base_dir=BASE_DIR,
    )
    messages = build_continue_chapter_messages(
        chapter_title=title,
        chapter_summary=summary,
        existing_text=existing,
        model_overrides=model_overrides,
    )

    async def _gen_source():
        async for chunk in stream_unified_chat_content(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        ):
            yield chunk

    def _persist(appended: str) -> None:
        new_content = (
            existing
            + ("\n" if existing and not existing.endswith("\n") else "")
            + appended
        )
        path.write_text(new_content, encoding="utf-8")

    return _as_streaming_response(
        lambda: stream_collect_and_persist(_gen_source, _persist)
    )


@router.post("/api/story/story-summary/stream")
async def api_story_story_summary_stream(request: Request):
    payload = await parse_json_body(request)

    mode = (payload.get("mode") or "").lower()
    if mode not in ("discard", "update", ""):
        raise HTTPException(status_code=400, detail="mode must be discard|update")

    _, story_path, story = get_active_story_or_http_error()
    chapters_data = get_normalized_chapters(story)
    current_story_summary = story.get("story_summary", "")

    chapter_summaries = collect_chapter_summaries(chapters_data)
    if not chapter_summaries:
        raise HTTPException(status_code=400, detail="No chapter summaries available")

    base_url, api_key, model_id, timeout_s, model_overrides = resolve_model_runtime(
        payload=payload,
        model_type="EDITING",
        base_dir=BASE_DIR,
    )
    messages = build_story_summary_messages(
        mode=mode,
        current_story_summary=current_story_summary,
        chapter_summaries=chapter_summaries,
        model_overrides=model_overrides,
    )

    async def _gen_source():
        async for chunk in stream_unified_chat_content(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        ):
            yield chunk

    def _persist(new_summary: str) -> None:
        story["story_summary"] = new_summary
        save_story_config(story_path, story)

    return _as_streaming_response(
        lambda: stream_collect_and_persist(_gen_source, _persist)
    )

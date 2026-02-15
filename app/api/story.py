# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

from fastapi import APIRouter, Request, HTTPException, Path as FastAPIPath
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import save_story_config
from app.helpers.project_helpers import normalize_story_for_frontend
from app.helpers.story_api_prompt_ops import (
    resolve_model_runtime,
    build_chapter_summary_messages,
    build_story_summary_messages,
    build_write_chapter_messages,
    build_continue_chapter_messages,
    build_suggest_prompt,
)
from app.helpers.story_api_state_ops import (
    get_active_story_or_http_error,
    get_chapter_locator,
    read_text_or_http_500,
    get_normalized_chapters,
    ensure_chapter_slot,
    collect_chapter_summaries,
)
from app.helpers.story_api_stream_ops import (
    stream_unified_chat_content,
    stream_collect_and_persist,
)
from app import llm
from pathlib import Path

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR / "config"


@router.post("/api/story/story-summary")
async def api_story_story_summary(request: Request) -> JSONResponse:
    """Generate or update the overall story summary based on chapter summaries.

    Body JSON: {"mode": "discard"|"update"|None, "model_name": str | None, overrides...}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    mode = (payload.get("mode") or "").lower()
    if mode not in ("discard", "update", ""):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "mode must be discard|update"},
        )

    try:
        _, story_path, story = get_active_story_or_http_error()
    except HTTPException:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    chapters_data = get_normalized_chapters(story)
    current_story_summary = story.get("story_summary", "")

    chapter_summaries = collect_chapter_summaries(chapters_data)

    if not chapter_summaries:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "No chapter summaries available"},
        )

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

    try:
        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": str(e)})

    new_summary = data.get("content", "")

    # Persist to story.json
    story["story_summary"] = new_summary
    try:
        save_story_config(story_path, story)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write story.json: {e}"},
        )

    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "summary": new_summary,
        },
    )


@router.post("/api/story/summary")
async def api_story_summary(request: Request) -> JSONResponse:
    """Generate or update a chapter summary using the story model.

    Body JSON:
       data = await llm.openai_chat_complete(
       // optional overrides: base_url, api_key, model, timeout_s}
    Returns: {ok: true, summary: str, chapter: {...}}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "chap_id is required"}
        )
    mode = (payload.get("mode") or "").lower()
    if mode not in ("discard", "update", ""):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "mode must be discard|update"},
        )

    _, path, pos = get_chapter_locator(chap_id)
    chapter_text = read_text_or_http_500(path)

    try:
        _, story_path, story = get_active_story_or_http_error()
    except HTTPException:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
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

    try:
        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": str(e)})

    # Extract content OpenAI-style
    new_summary = data.get("content", "")

    # Persist to story.json
    chapters_data[pos]["summary"] = new_summary
    story["chapters"] = chapters_data
    try:
        save_story_config(story_path, story)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write story.json: {e}"},
        )

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


@router.post("/api/story/write")
async def api_story_write(request: Request) -> JSONResponse:
    """Write/overwrite the full chapter from its summary using the story model.

    Body JSON: {"chap_id": int, "model_name": str | None, overrides...}
       data = await llm.openai_chat_complete(
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "chap_id is required"}
        )

    idx, path, pos = get_chapter_locator(chap_id)
    try:
        _, _, story = get_active_story_or_http_error()
    except HTTPException:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    chapters_data = get_normalized_chapters(story)
    if pos >= len(chapters_data):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "No summary available for this chapter"},
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

    try:
        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": str(e)})

    content = data.get("content", "")

    try:
        path.write_text(content, encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write chapter: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True, "content": content})


@router.post("/api/story/continue")
async def api_story_continue(request: Request) -> JSONResponse:
    """Continue the current chapter without modifying existing text, to align with the summary.

    Body JSON: {"chap_id": int, "model_name": str | None, overrides...}
       data = await llm.openai_chat_complete(
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "chap_id is required"}
        )

    idx, path, pos = get_chapter_locator(chap_id)
    existing = read_text_or_http_500(path)

    try:
        _, _, story = get_active_story_or_http_error()
    except HTTPException:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    chapters_data = get_normalized_chapters(story)
    if pos >= len(chapters_data):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "No summary available for this chapter"},
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

    try:
        data = await llm.unified_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": str(e)})

    appended = data.get("content", "")

    new_content = (
        existing + ("\n" if existing and not existing.endswith("\n") else "") + appended
    )
    try:
        path.write_text(new_content, encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to write chapter: {e}"},
        )

    return JSONResponse(
        status_code=200,
        content={"ok": True, "appended": appended, "content": new_content},
    )


@router.post("/api/story/suggest")
async def api_story_suggest(request: Request) -> StreamingResponse:
    """Return one alternative one-paragraph suggestion to continue the current chapter.

    Body JSON: {"chap_id": int, "model_name": str | None, "current_text": str | None, overrides...}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    chap_id = (payload or {}).get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")

    idx, path, pos = get_chapter_locator(chap_id)
    # Use current_text override if provided (to reflect unsaved editor state); otherwise read from disk
    current_text = (payload or {}).get("current_text")
    if not isinstance(current_text, str):
        try:
            current_text = read_text_or_http_500(path)
        except HTTPException as e:
            raise e

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
                break  # Stop at end of paragraph.

    return StreamingResponse(generate_suggestion(), media_type="text/plain")


def _as_streaming_response(gen_factory, media_type: str = "text/plain"):
    return StreamingResponse(gen_factory(), media_type=media_type)


@router.post("/api/story/summary/stream")
async def api_story_summary_stream(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
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
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = get_chapter_locator(chap_id)

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
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = get_chapter_locator(chap_id)

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
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

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


@router.post("/api/story/title")
async def api_story_title(request: Request) -> JSONResponse:
    """Update the project title.

    Body JSON: {"title": str}
    Returns: {"ok": true}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    title = str(payload.get("title", "")).strip()
    if not title:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "Title cannot be empty"}
        )

    try:
        _, story_path, story = get_active_story_or_http_error()
    except HTTPException:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    story["project_title"] = title
    save_story_config(story_path, story)

    return JSONResponse(content={"ok": True})


@router.post("/api/story/settings")
async def api_story_settings(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    try:
        _, story_path, story = get_active_story_or_http_error()
    except HTTPException:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    # Update allowed fields
    if "image_style" in payload:
        story["image_style"] = str(payload["image_style"])
    if "image_additional_info" in payload:
        story["image_additional_info"] = str(payload["image_additional_info"])

    try:
        save_story_config(story_path, story)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to save settings: {e}"},
        )

    return JSONResponse(
        status_code=200,
        content={"ok": True, "story": normalize_story_for_frontend(story)},
    )


@router.post("/api/story/metadata")
async def api_story_metadata(request: Request) -> JSONResponse:
    """Update general story metadata (title, summary, notes, private_notes)."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    try:
        get_active_story_or_http_error()
    except HTTPException:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    title = payload.get("title")
    summary = payload.get("summary")
    tags = payload.get("tags")
    notes = payload.get("notes")
    private_notes = payload.get("private_notes")

    from app.projects import update_story_metadata

    try:
        update_story_metadata(
            title=title,
            summary=summary,
            tags=tags,
            notes=notes,
            private_notes=private_notes,
        )
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "detail": str(e)})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update metadata: {e}"},
        )

    return JSONResponse(content={"ok": True})


@router.post("/api/books/{book_id}/metadata")
async def api_book_metadata(
    request: Request, book_id: str = FastAPIPath(...)
) -> JSONResponse:
    """Update metadata for a book (title, summary, notes, private_notes)."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    try:
        get_active_story_or_http_error()
    except HTTPException:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    title = payload.get("title")
    summary = payload.get("summary")
    notes = payload.get("notes")
    private_notes = payload.get("private_notes")

    from app.projects import update_book_metadata

    try:
        update_book_metadata(
            book_id,
            title=title,
            summary=summary,
            notes=notes,
            private_notes=private_notes,
        )
    except ValueError as e:
        return JSONResponse(status_code=404, content={"ok": False, "detail": str(e)})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to update book metadata: {e}"},
        )

    return JSONResponse(content={"ok": True})

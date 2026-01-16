# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import asyncio
from fastapi import APIRouter, Request, HTTPException, Path as FastAPIPath
from fastapi.responses import JSONResponse, StreamingResponse

from app.projects import get_active_project_dir
from app.config import load_story_config, load_machine_config
from app.helpers.chapter_helpers import _chapter_by_id_or_404, _normalize_chapter_entry
from app import llm
from app.prompts import get_system_message, get_user_prompt, load_model_prompt_overrides
import json as _json
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

    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    current_story_summary = story.get("story_summary", "")

    # Collect all chapter summaries
    chapter_summaries = []
    for i, chapter in enumerate(chapters_data):
        summary = chapter.get("summary", "").strip()
        title = chapter.get("title", "").strip() or f"Chapter {i + 1}"
        if summary:
            chapter_summaries.append(f"{title}:\n{summary}")

    if not chapter_summaries:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "No chapter summaries available"},
        )

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="EDITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="EDITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_summarizer", model_overrides),
    }
    if mode == "discard" or not current_story_summary:
        user_prompt = get_user_prompt(
            "story_summary_new",
            chapter_summaries="\n\n".join(chapter_summaries),
            user_prompt_overrides=model_overrides,
        )
    else:
        user_prompt = get_user_prompt(
            "story_summary_update",
            existing_summary=current_story_summary,
            chapter_summaries="\n\n".join(chapter_summaries),
            user_prompt_overrides=model_overrides,
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await llm.openai_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )
    except HTTPException as e:
        return JSONResponse(
            status_code=e.status_code, content={"ok": False, "detail": e.detail}
        )

    choices = (data or {}).get("choices") or []
    new_summary = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            new_summary = msg.get("content", "") or ""

    # Persist to story.json
    story["story_summary"] = new_summary
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
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

    _, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        chapter_text = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1)
        )
    current_summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="EDITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="EDITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    # Build messages
    sys_msg = {
        "role": "system",
        "content": get_system_message("chapter_summarizer", model_overrides),
    }
    if mode == "discard" or not current_summary:
        user_prompt = get_user_prompt(
            "chapter_summary_new",
            chapter_text=chapter_text,
            user_prompt_overrides=model_overrides,
        )
    else:
        user_prompt = get_user_prompt(
            "chapter_summary_update",
            existing_summary=current_summary,
            chapter_text=chapter_text,
            user_prompt_overrides=model_overrides,
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await llm.openai_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )
    except HTTPException as e:
        return JSONResponse(
            status_code=e.status_code, content={"ok": False, "detail": e.detail}
        )

    # Extract content OpenAI-style
    choices = (data or {}).get("choices") or []
    new_summary = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            new_summary = msg.get("content", "") or ""

    # Persist to story.json
    chapters_data[pos]["summary"] = new_summary
    story["chapters"] = chapters_data
    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
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

    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "No summary available for this chapter"},
        )
    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="WRITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="WRITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_writer", model_overrides),
    }
    user_prompt = get_user_prompt(
        "write_chapter",
        project_title=story.get("project_title", "Story"),
        chapter_title=title,
        chapter_summary=summary,
        user_prompt_overrides=model_overrides,
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await llm.openai_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )
    except HTTPException as e:
        return JSONResponse(
            status_code=e.status_code, content={"ok": False, "detail": e.detail}
        )

    choices = (data or {}).get("choices") or []
    content = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            content = msg.get("content", "") or ""

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

    idx, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        existing = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "No summary available for this chapter"},
        )
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="WRITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="WRITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_continuer", model_overrides),
    }
    user_prompt = get_user_prompt(
        "continue_chapter",
        chapter_title=title,
        chapter_summary=summary,
        existing_text=existing,
        user_prompt_overrides=model_overrides,
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await llm.openai_chat_complete(
            messages=messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
        )
    except HTTPException as e:
        return JSONResponse(
            status_code=e.status_code, content={"ok": False, "detail": e.detail}
        )

    choices = (data or {}).get("choices") or []
    appended = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            appended = msg.get("content", "") or ""

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

    idx, path, pos = _chapter_by_id_or_404(chap_id)
    # Use current_text override if provided (to reflect unsaved editor state); otherwise read from disk
    current_text = (payload or {}).get("current_text")
    if not isinstance(current_text, str):
        try:
            current_text = path.read_text(encoding="utf-8")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        # If summary is missing, still proceed with empty summary
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1)
        )
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="WRITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="WRITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    # Build prompt with title and summary
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

    _, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        chapter_text = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend(
            [{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1)
        )
    current_summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="EDITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="EDITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("chapter_summarizer", model_overrides),
    }
    if mode == "discard" or not current_summary:
        user_prompt = get_user_prompt(
            "chapter_summary_new",
            chapter_text=chapter_text,
            user_prompt_overrides=model_overrides,
        )
    else:
        user_prompt = get_user_prompt(
            "chapter_summary_update",
            existing_summary=current_summary,
            chapter_text=chapter_text,
            user_prompt_overrides=model_overrides,
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    # We'll aggregate to persist at the end if not cancelled
    async def _gen():
        buf = []
        try:
            async for chunk in llm.openai_chat_complete_stream(
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model_id=model_id,
                timeout_s=timeout_s,
            ):
                buf.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            # Do not persist on cancel
            return
        # Persist on normal completion
        try:
            new_summary = "".join(buf)
            chapters_data[pos]["summary"] = new_summary
            story["chapters"] = chapters_data
            story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
        except Exception:
            pass

    return _as_streaming_response(_gen)


@router.post("/api/story/write/stream")
async def api_story_write_stream(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        raise HTTPException(
            status_code=400, detail="No summary available for this chapter"
        )
    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="WRITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="WRITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_writer", model_overrides),
    }
    user_prompt = get_user_prompt(
        "write_chapter",
        project_title=story.get("project_title", "Story"),
        chapter_title=title,
        chapter_summary=summary,
        user_prompt_overrides=model_overrides,
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    async def _gen():
        buf = []
        try:
            async for chunk in llm.openai_chat_complete_stream(
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model_id=model_id,
                timeout_s=timeout_s,
            ):
                buf.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            return
        # Persist full overwrite on completion
        try:
            content = "".join(buf)
            path.write_text(content, encoding="utf-8")
        except Exception:
            pass

    return _as_streaming_response(_gen)


@router.post("/api/story/continue/stream")
async def api_story_continue_stream(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)

    try:
        existing = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        raise HTTPException(
            status_code=400, detail="No summary available for this chapter"
        )
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="WRITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="WRITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_continuer", model_overrides),
    }
    user_prompt = get_user_prompt(
        "continue_chapter",
        chapter_title=title,
        chapter_summary=summary,
        existing_text=existing,
        user_prompt_overrides=model_overrides,
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    async def _gen():
        buf = []
        try:
            async for chunk in llm.openai_chat_complete_stream(
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model_id=model_id,
                timeout_s=timeout_s,
            ):
                buf.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            return
        # Persist appended content on completion
        try:
            appended = "".join(buf)
            new_content = (
                existing
                + ("\n" if existing and not existing.endswith("\n") else "")
                + appended
            )
            path.write_text(new_content, encoding="utf-8")
        except Exception:
            pass

    return _as_streaming_response(_gen)


@router.post("/api/story/story-summary/stream")
async def api_story_story_summary_stream(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    mode = (payload.get("mode") or "").lower()
    if mode not in ("discard", "update", ""):
        raise HTTPException(status_code=400, detail="mode must be discard|update")

    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    current_story_summary = story.get("story_summary", "")

    # Collect all chapter summaries
    chapter_summaries = []
    for i, chapter in enumerate(chapters_data):
        summary = chapter.get("summary", "").strip()
        title = chapter.get("title", "").strip() or f"Chapter {i + 1}"
        if summary:
            chapter_summaries.append(f"{title}:\n{summary}")

    if not chapter_summaries:
        raise HTTPException(status_code=400, detail="No chapter summaries available")

    base_url, api_key, model_id, timeout_s = llm.resolve_openai_credentials(
        payload, model_type="EDITING"
    )

    # Load model-specific prompt overrides
    machine_config = load_machine_config(BASE_DIR / "config" / "machine.json") or {}
    selected_model_name = llm.get_selected_model_name(payload, model_type="EDITING")
    model_overrides = load_model_prompt_overrides(machine_config, selected_model_name)

    sys_msg = {
        "role": "system",
        "content": get_system_message("story_summarizer", model_overrides),
    }
    if mode == "discard" or not current_story_summary:
        user_prompt = get_user_prompt(
            "story_summary_new",
            chapter_summaries="\n\n".join(chapter_summaries),
            user_prompt_overrides=model_overrides,
        )
    else:
        user_prompt = get_user_prompt(
            "story_summary_update",
            existing_summary=current_story_summary,
            chapter_summaries="\n\n".join(chapter_summaries),
            user_prompt_overrides=model_overrides,
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    async def _gen():
        buf = []
        try:
            async for chunk in llm.openai_chat_complete_stream(
                messages=messages,
                base_url=base_url,
                api_key=api_key,
                model_id=model_id,
                timeout_s=timeout_s,
            ):
                buf.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            return
        # Persist on normal completion
        try:
            new_summary = "".join(buf)
            story["story_summary"] = new_summary
            story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
        except Exception:
            pass

    return _as_streaming_response(_gen)


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

    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    story["project_title"] = title
    story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")

    return JSONResponse(content={"ok": True})


@router.post("/api/story/settings")
async def api_story_settings(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    active = get_active_project_dir()
    if not active:
        return JSONResponse(
            status_code=400, content={"ok": False, "detail": "No active project"}
        )

    story_path = active / "story.json"
    story = load_story_config(story_path) or {}

    # Update allowed fields
    if "image_style" in payload:
        story["image_style"] = str(payload["image_style"])
    if "image_additional_info" in payload:
        story["image_additional_info"] = str(payload["image_additional_info"])

    try:
        story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "detail": f"Failed to save settings: {e}"},
        )

    return JSONResponse(status_code=200, content={"ok": True, "story": story})


@router.post("/api/story/metadata")
async def api_story_metadata(request: Request) -> JSONResponse:
    """Update general story metadata (title, summary, notes, private_notes)."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    active = get_active_project_dir()
    if not active:
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

    active = get_active_project_dir()
    if not active:
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

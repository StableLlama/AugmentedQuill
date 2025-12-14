import asyncio
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from app.projects import get_active_project_dir
from app.config import load_story_config
from app.helpers.chapter_helpers import _chapter_by_id_or_404, _normalize_chapter_entry
from app.helpers.story_helpers import _story_generate_summary_helper, _story_write_helper, _story_continue_helper
from app.llm_shims import _openai_completions_stream, _openai_chat_complete_stream
import json as _json

router = APIRouter()


@router.post("/api/story/summary")
async def api_story_summary(request: Request) -> JSONResponse:
    """Generate or update a chapter summary using the story model.

    Body JSON:
      {"chap_id": int, "mode": "discard"|"update"|None, "model_name": str | None,
       // optional overrides: base_url, api_key, model, timeout_s}
    Returns: {ok: true, summary: str, chapter: {...}}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "chap_id is required"})
    mode = (payload.get("mode") or "").lower()
    if mode not in ("discard", "update", ""):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "mode must be discard|update"})

    _, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        chapter_text = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})
    story_path = active / "story.json"
    story = load_story_config(story_path) or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    current_summary = chapters_data[pos].get("summary", "")

    from app.llm_shims import _resolve_openai_credentials
    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    # Build messages
    sys_msg = {
        "role": "system",
        "content": (
            "You are an expert story editor. Write a concise summary capturing plot, characters, tone, and open threads."
        ),
    }
    if mode == "discard" or not current_summary:
        user_prompt = f"Chapter text:\n\n{chapter_text}\n\nTask: Write a new summary (5-10 sentences)."
    else:
        user_prompt = (
            "Existing summary:\n\n" + current_summary +
            "\n\nChapter text:\n\n" + chapter_text +
            "\n\nTask: Update the summary to accurately reflect the chapter, keeping style and brevity."
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await _openai_chat_complete(
            messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s
        )
    except HTTPException as e:
        return JSONResponse(status_code=e.status_code, content={"ok": False, "detail": e.detail})

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
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write story.json: {e}"})

    title_for_response = chapters_data[pos].get("title") or path.name
    return JSONResponse(status_code=200, content={
        "ok": True,
        "summary": new_summary,
        "chapter": {"id": chap_id, "title": title_for_response, "filename": path.name, "summary": new_summary},
    })


@router.post("/api/story/write")
async def api_story_write(request: Request) -> JSONResponse:
    """Write/overwrite the full chapter from its summary using the story model.

    Body JSON: {"chap_id": int, "model_name": str | None, overrides...}
    Returns: {ok: true, content: str}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "chap_id is required"})

    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No summary available for this chapter"})
    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    from app.llm_shims import _resolve_openai_credentials, _openai_chat_complete
    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are a skilled novelist writing compelling prose based on a summary."}
    user_prompt = (
        f"Project: {story.get('project_title', 'Story')}\nTitle: {title}\n\nSummary:\n\n{summary}\n\n" 
        "Task: Write the full chapter as continuous prose. Maintain voice and pacing."
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await _openai_chat_complete(
            messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s
        )
    except HTTPException as e:
        return JSONResponse(status_code=e.status_code, content={"ok": False, "detail": e.detail})

    choices = (data or {}).get("choices") or []
    content = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            content = msg.get("content", "") or ""

    try:
        path.write_text(content, encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write chapter: {e}"})

    return JSONResponse(status_code=200, content={"ok": True, "content": content})


@router.post("/api/story/continue")
async def api_story_continue(request: Request) -> JSONResponse:
    """Continue the current chapter without modifying existing text, to align with the summary.

    Body JSON: {"chap_id": int, "model_name": str | None, overrides...}
    Returns: {ok: true, appended: str, content: str}
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    chap_id = payload.get("chap_id")
    if not isinstance(chap_id, int):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "chap_id is required"})

    idx, path, pos = _chapter_by_id_or_404(chap_id)
    try:
        existing = path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read chapter: {e}")

    active = get_active_project_dir()
    if not active:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No active project"})
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        return JSONResponse(status_code=400, content={"ok": False, "detail": "No summary available for this chapter"})
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    from app.llm_shims import _resolve_openai_credentials, _openai_chat_complete
    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are a skilled novelist continuing a chapter. Do not repeat or edit existing text; only continue."}
    user_prompt = (
        f"Title: {title}\n\nSummary:\n{summary}\n\nExisting chapter text (do not change):\n\n{existing}\n\n" 
        "Task: Continue the chapter from where it stops to advance the summary coherently."
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    try:
        data = await _openai_chat_complete(
            messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s
        )
    except HTTPException as e:
        return JSONResponse(status_code=e.status_code, content={"ok": False, "detail": e.detail})

    choices = (data or {}).get("choices") or []
    appended = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            appended = msg.get("content", "") or ""

    new_content = existing + ("\n" if existing and not existing.endswith("\n") else "") + appended
    try:
        path.write_text(new_content, encoding="utf-8")
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "detail": f"Failed to write chapter: {e}"})

    return JSONResponse(status_code=200, content={"ok": True, "appended": appended, "content": new_content})


@router.post("/api/story/suggest")
async def api_story_suggest(request: Request) -> StreamingResponse:
    """Return one alternative one-paragraph suggestion to continue the current chapter.

    Body JSON: {"chap_id": int, "model_name": str | None, "current_text": str | None, overrides...}
    Returns: Streaming text with the suggestion paragraph.
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
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    from app.llm_shims import _resolve_openai_credentials
    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    # Build prompt with title and summary
    prompt_parts = []
    if title:
        prompt_parts.append(title)
    if summary:
        prompt_parts.append(summary)
    if len(prompt_parts) > 0:
        prompt_parts.append("---")
    if current_text:
        prompt_parts.append(current_text)
    prompt = "\n\n".join(prompt_parts)

    extra_body = {
        "max_tokens": 500,
        "temperature": 1.0,
        "top_k": 0,
        "top_p": 1.0,
        "min_p": 0.02,
        "repeat_penalty": 1.0
    }

    async def generate_suggestion():
        startFound = False
        isNewParagraph = False
        async for chunk in _openai_completions_stream(
            prompt=prompt, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s, extra_body=extra_body
        ):
            while chunk.lstrip(' \t').startswith("\n") and not startFound:
                chunk = chunk.lstrip(' \t')[1:]
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
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    current_summary = chapters_data[pos].get("summary", "")

    from app.llm_shims import _resolve_openai_credentials
    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are an expert story editor. Write a concise summary capturing plot, characters, tone, and open threads."}
    if mode == "discard" or not current_summary:
        user_prompt = f"Chapter text:\n\n{chapter_text}\n\nTask: Write a new summary (5-10 sentences)."
    else:
        user_prompt = (
            "Existing summary:\n\n" + current_summary +
            "\n\nChapter text:\n\n" + chapter_text +
            "\n\nTask: Update the summary to accurately reflect the chapter, keeping style and brevity."
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    # We'll aggregate to persist at the end if not cancelled
    async def _gen():
        buf = []
        try:
            async for chunk in _openai_chat_complete_stream(messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s):
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
        raise HTTPException(status_code=400, detail="No summary available for this chapter")
    summary = chapters_data[pos].get("summary", "").strip()
    title = chapters_data[pos].get("title") or path.name

    from app.llm_shims import _resolve_openai_credentials
    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are a skilled novelist writing compelling prose based on a summary."}
    user_prompt = (
        f"Project: {story.get('project_title', 'Story')}\nTitle: {title}\n\nSummary:\n\n{summary}\n\n"
        "Task: Write the full chapter as continuous prose. Maintain voice and pacing."
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    async def _gen():
        buf = []
        try:
            async for chunk in _openai_chat_complete_stream(messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s):
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
        raise HTTPException(status_code=400, detail="No summary available for this chapter")
    summary = chapters_data[pos].get("summary", "")
    title = chapters_data[pos].get("title") or path.name

    from app.llm_shims import _resolve_openai_credentials
    base_url, api_key, model_id, timeout_s = _resolve_openai_credentials(payload)

    sys_msg = {"role": "system", "content": "You are a skilled novelist continuing a chapter. Do not repeat or edit existing text; only continue."}
    user_prompt = (
        f"Title: {title}\n\nSummary:\n{summary}\n\nExisting chapter text (do not change):\n\n{existing}\n\n"
        "Task: Continue the chapter from where it stops to advance the summary coherently."
    )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    async def _gen():
        buf = []
        try:
            async for chunk in _openai_chat_complete_stream(messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s):
                buf.append(chunk)
                yield chunk
        except asyncio.CancelledError:
            return
        # Persist appended content on completion
        try:
            appended = "".join(buf)
            new_content = existing + ("\n" if existing and not existing.endswith("\n") else "") + appended
            path.write_text(new_content, encoding="utf-8")
        except Exception:
            pass

    return _as_streaming_response(_gen)
import json as _json
from pathlib import Path
from typing import Dict
from fastapi import HTTPException

from app.projects import get_active_project_dir
from app.config import load_story_config
from app import llm as _llm
from .chapter_helpers import _chapter_by_id_or_404, _normalize_chapter_entry


async def _story_generate_summary_helper(*, chap_id: int, mode: str = "") -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")

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

    base_url, api_key, model_id, timeout_s = _llm.resolve_openai_credentials({})

    sys_msg = {
        "role": "system",
        "content": (
            "You are an expert story editor. Write a concise summary capturing plot, characters, tone, and open threads."
        ),
    }
    mode_l = (mode or "").lower()
    if mode_l == "discard" or not current_summary:
        user_prompt = f"Chapter text:\n\n{chapter_text}\n\nTask: Write a new summary (5-10 sentences)."
    else:
        user_prompt = (
            "Existing summary:\n\n" + current_summary +
            "\n\nChapter text:\n\n" + chapter_text +
            "\n\nTask: Update the summary to accurately reflect the chapter, keeping style and brevity."
        )
    messages = [sys_msg, {"role": "user", "content": user_prompt}]

    data = await _llm.openai_chat_complete(messages=messages, base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s)
    choices = (data or {}).get("choices") or []
    new_summary = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            new_summary = msg.get("content", "") or ""

    chapters_data[pos]["summary"] = new_summary
    story["chapters"] = chapters_data
    story_path.write_text(_json.dumps(story, indent=2), encoding="utf-8")
    title_for_response = chapters_data[pos].get("title") or path.name
    return {"ok": True, "summary": new_summary, "chapter": {"id": chap_id, "title": title_for_response, "filename": path.name, "summary": new_summary}}


async def _story_write_helper(*, chap_id: int) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    summary = chapters_data[pos].get("summary", "")

    base_url, api_key, model_id, timeout_s = _llm.resolve_openai_credentials({})
    sys_msg = {"role": "system", "content": "You are a skilled novelist. Write compelling, coherent prose in the voice and style of the project."}
    user_prompt = ("Project title: " + (story.get("project_title") or "") +
                   "\n\nChapter summary:\n" + summary +
                   "\n\nTask: Write the full chapter as markdown. Keep consistency with previous chapters if implied.")
    data = await _llm.openai_chat_complete(messages=[sys_msg, {"role": "user", "content": user_prompt}], base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s)
    choices = (data or {}).get("choices") or []
    content = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            content = msg.get("content", "") or ""
    path.write_text(content, encoding="utf-8")
    return {"ok": True, "content": content, "chapter": {"id": idx, "filename": path.name}}


async def _story_continue_helper(*, chap_id: int) -> dict:
    if not isinstance(chap_id, int):
        raise HTTPException(status_code=400, detail="chap_id is required")
    idx, path, pos = _chapter_by_id_or_404(chap_id)
    active = get_active_project_dir()
    if not active:
        raise HTTPException(status_code=400, detail="No active project")
    story = load_story_config(active / "story.json") or {}
    chapters_data = [_normalize_chapter_entry(c) for c in story.get("chapters", [])]
    if pos >= len(chapters_data):
        chapters_data.extend([{"title": "", "summary": ""}] * (pos - len(chapters_data) + 1))
    summary = chapters_data[pos].get("summary", "")
    current = path.read_text(encoding="utf-8") if path.exists() else ""

    base_url, api_key, model_id, timeout_s = _llm.resolve_openai_credentials({})
    sys_msg = {"role": "system", "content": "You are a helpful writing assistant. Continue the chapter, matching tone, characters, and style."}
    user_prompt = ("Chapter summary:\n" + summary +
                   "\n\nExisting chapter text (may be partial):\n" + current +
                   "\n\nTask: Continue the chapter. Avoid repeating text; ensure transitions are smooth.")
    data = await _llm.openai_chat_complete(messages=[sys_msg, {"role": "user", "content": user_prompt}], base_url=base_url, api_key=api_key, model_id=model_id, timeout_s=timeout_s)
    choices = (data or {}).get("choices") or []
    add = ""
    if choices:
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(msg, dict):
            add = msg.get("content", "") or ""
    new_content = (current + ("\n\n" if current and not current.endswith("\n\n") else "") + add).strip("\n") + "\n"
    path.write_text(new_content, encoding="utf-8")
    return {"ok": True, "appended": add, "chapter": {"id": idx, "filename": path.name}}
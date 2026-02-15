# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import httpx
import datetime
import base64
import app.llm as llm
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import load_machine_config, load_story_config
from app.projects import get_active_project_dir
from app.prompts import get_system_message, load_model_prompt_overrides
from app.llm import add_llm_log, create_log_entry
from app.helpers.chat_tool_dispatcher import _exec_chat_tool
from app.helpers.chat_tools_schema import STORY_TOOLS as CHAT_STORY_TOOLS
import json as _json
from typing import Any, Dict

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR = BASE_DIR / "config"

router = APIRouter()

# Prefer using `app.main.load_machine_config` when available so tests can monkeypatch it.
try:
    import app.main as _app_main  # type: ignore
except Exception:
    _app_main = None


def _load_machine_config(path):
    if _app_main and hasattr(_app_main, "load_machine_config"):
        return _app_main.load_machine_config(path)
    return load_machine_config(path)


STORY_TOOLS = CHAT_STORY_TOOLS


@router.get("/api/chat")
async def api_get_chat() -> dict:
    """Return initial state for chat view: models and current selection."""
    machine = _load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg = (machine.get("openai") or {}) if isinstance(machine, dict) else {}
    models_list = openai_cfg.get("models") if isinstance(openai_cfg, dict) else []

    model_names = []
    if isinstance(models_list, list):
        model_names = [
            m.get("name") for m in models_list if isinstance(m, dict) and m.get("name")
        ]

    selected = openai_cfg.get("selected", "") if isinstance(openai_cfg, dict) else ""
    # Coerce to a valid selection
    if model_names:
        if not selected:
            selected = model_names[0]
        elif selected not in model_names:
            selected = model_names[0]

    return {
        "models": model_names,
        "current_model": selected,
        "messages": [],  # History is client-managed; this is a placeholder.
    }


@router.post("/api/chat/tools")
async def api_chat_tools(request: Request) -> JSONResponse:
    """Execute OpenAI-style tool calls and return tool messages.

    The endpoint does not call the upstream LLM; it only executes provided tool_calls
    from the last assistant message and returns corresponding {role:"tool"} messages.

    Body JSON:
      {
        "model_name": str | null,
        "messages": [
          {"role":"user|assistant|system|tool", "content": str, "tool_calls"?: [{"id":str, "type":"function", "function": {"name": str, "arguments": str}}], "tool_call_id"?: str, "name"?: str}
        ],
        "active_chapter_id"?: int
      }
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = payload.get("messages") or []
    if not isinstance(messages, list):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "detail": "messages must be an array"},
        )

    last = messages[-1] if messages else None
    tool_calls: list = []
    if isinstance(last, dict):
        t = last.get("tool_calls")
        if isinstance(t, list):
            tool_calls = t

    appended: list[dict] = []
    mutations = {"story_changed": False}

    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        call_id = str(call.get("id") or "")
        func = call.get("function") or {}
        name = (func.get("name") if isinstance(func, dict) else None) or ""
        args_raw = (func.get("arguments") if isinstance(func, dict) else None) or "{}"
        try:
            args_obj = (
                _json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
            )
        except Exception:
            args_obj = {}
        if not name or not call_id:
            continue
        msg = await _exec_chat_tool(name, args_obj, call_id, payload, mutations)
        appended.append(msg)

    # Log tool execution if there were any
    if appended:
        log_entry = create_log_entry(
            "/api/chat/tools", "POST", {}, {"tool_calls": tool_calls}
        )
        log_entry["response"]["status_code"] = 200
        log_entry["response"]["body"] = {"appended_messages": appended}
        log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
        add_llm_log(log_entry)

    return JSONResponse(
        status_code=200,
        content={"ok": True, "appended_messages": appended, "mutations": mutations},
    )


async def _inject_project_images(messages: list[dict]):
    if not messages:
        return

    last_msg = messages[-1]
    if last_msg.get("role") != "user":
        return

    content = last_msg.get("content")
    if not isinstance(content, str):
        return

    active = get_active_project_dir()
    if not active:
        return

    images_dir = active / "images"
    if not images_dir.exists():
        return

    found_images = []
    # Scan for common image extensions
    allowed = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

    for f in images_dir.iterdir():
        if f.is_file() and f.suffix.lower() in allowed:
            # Check if filename is in content
            if f.name in content:
                found_images.append(f)

    if not found_images:
        return

    # Construct new content
    new_content = [{"type": "text", "text": content}]

    for path in found_images:
        try:
            mime = "image/png"
            if path.suffix.lower() in [".jpg", ".jpeg"]:
                mime = "image/jpeg"
            elif path.suffix.lower() == ".webp":
                mime = "image/webp"
            elif path.suffix.lower() == ".gif":
                mime = "image/gif"

            with open(path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")

            new_content.append(
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
            )
        except Exception:
            pass

    last_msg["content"] = new_content


@router.post("/api/chat/stream")
async def api_chat_stream(request: Request) -> StreamingResponse:
    """Stream chat with the configured OpenAI-compatible model.

    Body JSON:
      {
        "model_name": "name-of-configured-entry" | null,
        "model_type": "CHAT" | "WRITING" | "EDITING" | null,
        "messages": [{"role": "system|user|assistant", "content": str}, ...],
        // optional overrides (otherwise pulled from config/machine.json)
        "base_url": str,
        "api_key": str,
        "model": str,
        "timeout_s": int
      }

    Returns: Streaming text response with the assistant's message.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    def _normalize_chat_messages(val: Any) -> list[dict]:
        """Preserve OpenAI message fields including tool calls.

        Keeps: role, content (may be None), name, tool_call_id, tool_calls.
        """
        arr = val if isinstance(val, list) else []
        out: list[dict] = []
        for m in arr:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role", "")).strip().lower() or "user"
            msg: dict = {"role": role}
            # content can be None (e.g., assistant with tool_calls)
            if "content" in m:
                c = m.get("content")
                msg["content"] = None if c is None else str(c)
            # pass-through optional tool fields
            name = m.get("name")
            if isinstance(name, str) and name:
                msg["name"] = name
            tcid = m.get("tool_call_id")
            if isinstance(tcid, str) and tcid:
                msg["tool_call_id"] = tcid
            tcs = m.get("tool_calls")
            if isinstance(tcs, list) and tcs:
                msg["tool_calls"] = tcs
            out.append(msg)
        return out

    req_messages = _normalize_chat_messages((payload or {}).get("messages"))
    if not req_messages:
        raise HTTPException(status_code=400, detail="messages array is required")

    # Load config to determine model capabilities and overrides
    machine = _load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}

    model_type = (payload or {}).get("model_type") or "CHAT"
    # Resolve selected name
    selected_name = (
        (payload or {}).get("model_name")
        or openai_cfg.get(f"selected_{model_type.lower()}")
        or openai_cfg.get("selected")
    )

    base_url = (payload or {}).get("base_url")
    api_key = (payload or {}).get("api_key")
    model_id = (payload or {}).get("model")
    timeout_s = (payload or {}).get("timeout_s")

    # Resolve actual model entry
    chosen = None
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if isinstance(models, list) and models:
        allowed_models = models
        if selected_name:
            for m in allowed_models:
                if isinstance(m, dict) and (m.get("name") == selected_name):
                    chosen = m
                    break
        if chosen is None:
            chosen = allowed_models[0]

        base_url = chosen.get("base_url") or base_url
        api_key = chosen.get("api_key") or api_key
        model_id = chosen.get("model") or model_id
        timeout_s = chosen.get("timeout_s", 60) or timeout_s

    # Capability checks
    # Default to True/Auto unless explicitly disabled
    is_multimodal = True
    supports_function_calling = True
    if chosen:
        if chosen.get("is_multimodal") is False:
            is_multimodal = False
        if chosen.get("supports_function_calling") is False:
            supports_function_calling = False

    # Inject images if referenced in the last user message and supported
    if is_multimodal:
        await _inject_project_images(req_messages)

    # Prepend system message if not present
    has_system = any(msg.get("role") == "system" for msg in req_messages)
    if not has_system:
        # Map model_type to system message key
        sys_msg_key = "chat_llm"
        if model_type == "WRITING":
            sys_msg_key = "writing_llm"
        elif model_type == "EDITING":
            sys_msg_key = "editing_llm"

        model_overrides = load_model_prompt_overrides(machine, selected_name)

        system_content = get_system_message(sys_msg_key, model_overrides)
        req_messages.insert(0, {"role": "system", "content": system_content})

    if not base_url or not model_id:
        raise HTTPException(
            status_code=400, detail="Missing base_url or model in configuration"
        )

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Pull llm preferences for sensible defaults
    story = (
        load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    )
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = (
        float(prefs.get("temperature", 0.7))
        if isinstance(prefs.get("temperature", 0.7), (int, float, str))
        else 0.7
    )
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens", None)

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": req_messages,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens

    # Pass through OpenAI tool-calling fields if provided
    if supports_function_calling:
        tool_choice = (payload or {}).get("tool_choice")
        # If the client explicitly requests "none", do not send tools.
        # This prevents some models from hallucinating tool usage even when told not to.
        if tool_choice == "none":
            pass
        else:
            body["tools"] = STORY_TOOLS
            if tool_choice:
                body["tool_choice"] = tool_choice

    log_entry = create_log_entry(url, "POST", headers, body, streaming=True)
    log_entry["model_type"] = model_type
    add_llm_log(log_entry)

    async def _gen():
        async for chunk in llm.unified_chat_stream(
            messages=req_messages,
            base_url=base_url,
            api_key=api_key,
            model_id=model_id,
            timeout_s=timeout_s,
            supports_function_calling=supports_function_calling,
            tools=STORY_TOOLS,
            tool_choice=tool_choice if tool_choice != "none" else None,
            temperature=temperature,
            max_tokens=max_tokens,
            log_entry=log_entry,
        ):
            # Transform to client expected format
            if "content" in chunk:
                yield f"data: {_json.dumps({'content': chunk['content']})}\n\n"
            if "thinking" in chunk:
                yield f"data: {_json.dumps({'thinking': chunk['thinking']})}\n\n"
            if "tool_calls" in chunk:
                yield f"data: {_json.dumps({'tool_calls': chunk['tool_calls']})}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/api/openai/models")
async def proxy_list_models(request: Request) -> JSONResponse:
    """Fetch `${base_url}/models` using provided credentials.

    Body JSON:
      {"base_url": str, "api_key": str | None, "timeout_s": int | None}

    Returns the JSON payload from the upstream (expected to include a `data` array).
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

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
            resp = await client.get(url, headers=headers)
            log_entry["response"]["status_code"] = resp.status_code
            log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
            # Relay status code if not 2xx
            content = (
                resp.json()
                if resp.headers.get("content-type", "").startswith("application/json")
                else {"raw": resp.text}
            )
            log_entry["response"]["body"] = content
            if resp.status_code >= 400:
                return JSONResponse(
                    status_code=resp.status_code,
                    content={
                        "error": "Upstream error",
                        "status": resp.status_code,
                        "data": content,
                    },
                )
            return JSONResponse(status_code=200, content=content)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {e}")

# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the chat unit so this responsibility stays isolated, testable, and easy to evolve.

API endpoints for chat sessions and conversational interactions with the LLM writing partner.
"""

import datetime
import augmentedquill.services.llm.llm as llm
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from augmentedquill.core.config import load_machine_config, CONFIG_DIR
from augmentedquill.api.v1.http_responses import error_json, ok_json
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.services.llm.llm import add_llm_log, create_log_entry
from augmentedquill.services.chat.chat_tool_decorator import (
    execute_registered_tool,
    get_registered_tool_schemas,
)
from augmentedquill.services.chat.chat_api_helpers import inject_project_images
from augmentedquill.services.chat.chat_api_stream_ops import (
    normalize_chat_messages,
    resolve_stream_model_context,
    ensure_system_message_if_missing,
    resolve_story_llm_prefs,
)
from augmentedquill.services.chat.chat_api_session_ops import (
    list_active_chats,
    load_active_chat,
    save_active_chat,
    delete_active_chat,
    delete_all_active_chats,
)
import augmentedquill.services.chat.chat_api_proxy_ops as _chat_api_proxy_ops
import json as _json
from typing import Any, Dict
from augmentedquill.models.chat import ChatInitialStateResponse

router = APIRouter(tags=["Chat"])

proxy_openai_models = _chat_api_proxy_ops.proxy_openai_models
httpx = _chat_api_proxy_ops.httpx


@router.get("/chat", response_model=ChatInitialStateResponse)
async def api_get_chat() -> ChatInitialStateResponse:
    """Return initial state for chat view: models and current selection."""
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
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


@router.post("/chat/tools")
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
        return error_json("messages must be an array", status_code=400)

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
        msg = await execute_registered_tool(name, args_obj, call_id, payload, mutations)
        appended.append(msg)

    # Log tool execution if there were any
    if appended:
        log_entry = create_log_entry(
            "/api/v1/chat/tools", "POST", {}, {"tool_calls": tool_calls}
        )
        log_entry["response"]["status_code"] = 200
        log_entry["response"]["body"] = {"appended_messages": appended}
        log_entry["timestamp_end"] = datetime.datetime.now().isoformat()
        add_llm_log(log_entry)

    return ok_json(appended_messages=appended, mutations=mutations)


@router.post("/chat/stream")
async def api_chat_stream(request: Request) -> StreamingResponse:
    """Stream chat with the configured OpenAI-compatible model.

    Body JSON:
      {
        "model_name": "name-of-configured-entry" | null,
        "model_type": "CHAT" | "WRITING" | "EDITING" | null,
        "messages": [{"role": "system|user|assistant", "content": str}, ...],
        // optional overrides (otherwise pulled from resources/config/machine.json)
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

    req_messages = normalize_chat_messages((payload or {}).get("messages"))
    if not req_messages:
        raise HTTPException(status_code=400, detail="messages array is required")

    # Load config to determine model capabilities and overrides
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    stream_ctx = resolve_stream_model_context(payload, machine)
    model_type = stream_ctx["model_type"]
    selected_name = stream_ctx["selected_name"]
    base_url = stream_ctx["base_url"]
    api_key = stream_ctx["api_key"]
    model_id = stream_ctx["model_id"]
    timeout_s = stream_ctx["timeout_s"]
    is_multimodal = stream_ctx["is_multimodal"]
    supports_function_calling = stream_ctx["supports_function_calling"]

    # Inject images if referenced in the last user message and supported
    if is_multimodal:
        await inject_project_images(req_messages)

    # Prepend system message if not present
    ensure_system_message_if_missing(
        req_messages,
        model_type=model_type,
        machine=machine,
        selected_name=selected_name,
    )

    if not base_url or not model_id:
        raise HTTPException(
            status_code=400, detail="Missing base_url or model in configuration"
        )

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    temperature, max_tokens = resolve_story_llm_prefs(
        config_dir=CONFIG_DIR,
        active_project_dir=get_active_project_dir(),
    )

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": req_messages,
        "temperature": temperature,
        "stream": True,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens

    # Pass through OpenAI tool-calling fields if provided
    tool_choice = None
    story_tools = get_registered_tool_schemas()
    if supports_function_calling:
        tool_choice = (payload or {}).get("tool_choice")
        # If the client explicitly requests "none", do not send tools.
        # This prevents some models from hallucinating tool usage even when told not to.
        if tool_choice == "none":
            pass
        else:
            body["tools"] = story_tools
            if tool_choice:
                body["tool_choice"] = tool_choice

    log_entry = create_log_entry(url, "POST", headers, body, streaming=True)
    log_entry["model_type"] = model_type
    add_llm_log(log_entry)

    async def _gen():
        """Gen."""
        try:
            async for chunk in llm.unified_chat_stream(
                messages=req_messages,
                base_url=base_url,
                api_key=api_key,
                model_id=model_id,
                timeout_s=timeout_s,
                supports_function_calling=supports_function_calling,
                tools=story_tools,
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
        except Exception:
            # Mask internal errors to prevent information exposure
            yield f"data: {_json.dumps({'error': 'An internal chat stream error occurred.'})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.get("/chats")
async def api_list_chats():
    return list_active_chats()


@router.get("/chats/{chat_id}")
async def api_load_chat(chat_id: str):
    return load_active_chat(chat_id)


@router.post("/chats/{chat_id}")
async def api_save_chat(chat_id: str, request: Request):
    """Api Save Chat."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    save_active_chat(chat_id, data)
    return {"ok": True}


@router.delete("/chats/{chat_id}")
async def api_delete_chat(chat_id: str):
    delete_active_chat(chat_id)
    return {"ok": True}


@router.delete("/chats")
async def api_delete_all_chats():
    delete_all_active_chats()
    return {"ok": True}


@router.post("/openai/models")
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
    return await proxy_openai_models(payload)

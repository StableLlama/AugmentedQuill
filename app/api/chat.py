import os
import httpx
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from app.config import load_machine_config, load_story_config
from app.projects import get_active_project_dir
from app.helpers.project_helpers import _project_overview, _chapter_content_slice
from app.helpers.story_helpers import _story_generate_summary_helper, _story_write_helper, _story_continue_helper
from app.llm_shims import _resolve_openai_credentials, _openai_chat_complete, _openai_completions_stream
import json as _json
from typing import Any, Dict

router = APIRouter()


STORY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_project_overview",
            "description": "Get project title and a list of all chapters with their IDs, filenames, titles, and summaries.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_chapter_content",
            "description": "Get a slice of a chapter's content. If 'chap_id' is omitted, the application will attempt to use the currently active chapter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {"type": "integer", "description": "The ID of the chapter to read."},
                    "start": {"type": "integer", "description": "The starting character index. Default 0."},
                    "max_chars": {"type": "integer", "description": "Max characters to read. Default 8000, max 8000."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_summary",
            "description": "Generate and save a new summary for a chapter, or update its existing summary. This is a destructive action.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chap_id": {"type": "integer", "description": "The ID of the chapter to summarize."},
                    "mode": {
                        "type": "string",
                        "description": "If 'discard', generate a new summary from scratch. If 'update' or empty, refine the existing one.",
                        "enum": ["discard", "update"],
                    },
                },
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_chapter",
            "description": "Write the entire content of a chapter from its summary. This overwrites any existing content.",
            "parameters": {
                "type": "object",
                "properties": {"chap_id": {"type": "integer", "description": "The ID of the chapter to write."}},
                "required": ["chap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "continue_chapter",
            "description": "Append new content to a chapter, continuing from where it left off. This does not modify existing text.",
            "parameters": {
                "type": "object",
                "properties": {"chap_id": {"type": "integer", "description": "The ID of the chapter to continue."}},
                "required": ["chap_id"],
            },
        },
    },
]


async def _exec_chat_tool(name: str, args_obj: dict, call_id: str, payload: dict, mutations: dict) -> dict:
    """Helper to execute a single tool call."""
    try:
        if name == "get_project_overview":
            data = _project_overview()
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        if name == "get_chapter_content":
            chap_id = args_obj.get("chap_id")
            if chap_id is None:
                ac = payload.get("active_chapter_id")
                if isinstance(ac, int):
                    chap_id = ac
            if not isinstance(chap_id, int):
                return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": "chap_id is required"})}
            start = int(args_obj.get("start", 0) or 0)
            max_chars = int(args_obj.get("max_chars", 8000) or 8000)
            max_chars = max(1, min(8000, max_chars))
            data = _chapter_content_slice(chap_id, start=start, max_chars=max_chars)
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        if name == "write_summary":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": "chap_id is required"})}
            mode = str(args_obj.get("mode", "")).lower()
            data = await _story_generate_summary_helper(chap_id=chap_id, mode=mode)
            mutations["story_changed"] = True
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        if name == "write_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": "chap_id is required"})}
            data = await _story_write_helper(chap_id=chap_id)
            mutations["story_changed"] = True
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        if name == "continue_chapter":
            chap_id = args_obj.get("chap_id")
            if not isinstance(chap_id, int):
                return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": "chap_id is required"})}
            data = await _story_continue_helper(chap_id=chap_id)
            mutations["story_changed"] = True
            return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps(data)}
        return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": f"Unknown tool: {name}"})}
    except HTTPException as e:
        return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": f"Tool failed: {e.detail}"})}
    except Exception as e:
        return {"role": "tool", "tool_call_id": call_id, "name": name, "content": _json.dumps({"error": f"Tool failed with unexpected error: {e}"})}


@router.get("/api/chat")
async def api_get_chat() -> dict:
    """Return initial state for chat view: models and current selection."""
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg = (machine.get("openai") or {}) if isinstance(machine, dict) else {}
    models_list = openai_cfg.get("models") if isinstance(openai_cfg, dict) else []

    model_names = []
    if isinstance(models_list, list):
        model_names = [
            m.get("name") for m in models_list if isinstance(m, dict) and m.get("name")
        ]

    # If no named models configured, but legacy single model fields exist,
    # surface a synthetic default entry so the UI has a selectable option.
    if not model_names:
        legacy_model = openai_cfg.get("model")
        legacy_base = openai_cfg.get("base_url")
        if legacy_model or legacy_base:
            model_names = ["default"]

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


@router.post("/api/chat")
async def api_chat(request: Request) -> JSONResponse:
    """Chat with the configured OpenAI-compatible model.

    Body JSON:
      {
        "model_name": "name-of-configured-entry" | null,
        "messages": [{"role": "system|user|assistant", "content": str}, ...],
        // optional overrides (otherwise pulled from config/machine.json)
        "base_url": str,
        "api_key": str,
        "model": str,
        "timeout_s": int
      }

    Returns: { ok: true, message: {role:"assistant", content: str}, usage?: {...} }
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
                msg["content"] = (None if c is None else str(c))
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
        return JSONResponse(status_code=400, content={"ok": False, "detail": "messages array is required"})

    # Load machine config and pick selected model
    machine = load_machine_config(CONFIG_DIR / "machine.json") or {}
    openai_cfg: Dict[str, Any] = machine.get("openai") or {}
    selected_name = (payload or {}).get("model_name") or openai_cfg.get("selected")

    base_url = (payload or {}).get("base_url")
    api_key = (payload or {}).get("api_key")
    model_id = (payload or {}).get("model")
    timeout_s = (payload or {}).get("timeout_s")

    # If models list exists and a name is provided or selected, use it
    models = openai_cfg.get("models") if isinstance(openai_cfg, dict) else None
    if isinstance(models, list) and models:
        chosen = None
        if selected_name:
            for m in models:
                if isinstance(m, dict) and (m.get("name") == selected_name):
                    chosen = m
                    break
        if chosen is None:
            chosen = models[0]
        base_url = chosen.get("base_url") or base_url
        api_key = chosen.get("api_key") or api_key
        model_id = chosen.get("model") or model_id
        timeout_s = chosen.get("timeout_s", 60) or timeout_s

    if not base_url or not model_id:
        return JSONResponse(status_code=400, content={"ok": False, "detail": "Missing base_url or model in configuration"})

    url = str(base_url).rstrip("/") + "/chat/completions"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # Pull llm preferences for sensible defaults
    story = load_story_config((get_active_project_dir() or CONFIG_DIR) / "story.json") or {}
    prefs = (story.get("llm_prefs") or {}) if isinstance(story, dict) else {}
    temperature = float(prefs.get("temperature", 0.7)) if isinstance(prefs.get("temperature", 0.7), (int, float, str)) else 0.7
    try:
        temperature = float(temperature)
    except Exception:
        temperature = 0.7
    max_tokens = prefs.get("max_tokens", None)

    body: Dict[str, Any] = {
        "model": model_id,
        "messages": req_messages,
        "temperature": temperature,
    }
    if isinstance(max_tokens, int):
        body["max_tokens"] = max_tokens
    # Pass through OpenAI tool-calling fields if provided
    # Always include the available tools for the model to use.
    body["tools"] = STORY_TOOLS
    tool_choice = (payload or {}).get("tool_choice")
    if tool_choice:
        body["tool_choice"] = tool_choice
    else:
        body["tool_choice"] = "auto"

    # Backward-compat with legacy function calling (OpenAI functions API)
    # Some providers only recognize `functions` and `function_call`.
    # If tools of type function are provided, mirror them into `functions`.
    try:
        current_tools = body.get("tools")
        if isinstance(current_tools, list) and current_tools:
            functions: list[dict] = []
            for t in current_tools:
                if isinstance(t, dict) and t.get("type") == "function":
                    fn = t.get("function") or {}
                    name = fn.get("name")
                    if isinstance(name, str) and name:
                        # Keep only legacy-compatible fields
                        fdef = {
                            "name": name,
                        }
                        desc = fn.get("description")
                        if isinstance(desc, str) and desc:
                            fdef["description"] = desc
                        params = fn.get("parameters")
                        if isinstance(params, dict):
                            fdef["parameters"] = params
                        functions.append(fdef)
            if functions:
                body["functions"] = functions
                # Map tool_choice to function_call where meaningful
                fc = None
                current_tool_choice = body.get("tool_choice")
                if isinstance(current_tool_choice, str):
                    if current_tool_choice in ("auto", "none"):
                        fc = current_tool_choice
                elif isinstance(current_tool_choice, dict):
                    # {"type":"function","function":{"name":"..."}}
                    if current_tool_choice.get("type") == "function":
                        fn2 = (current_tool_choice.get("function") or {})
                        name2 = fn2.get("name")
                        if isinstance(name2, str) and name2:
                            fc = {"name": name2}
                if fc is None:
                    # default to auto if tools provided
                    fc = "auto"
                body["function_call"] = fc
    except Exception:
        # If anything goes wrong, we silently ignore and proceed with modern tools fields
        pass

    def _llm_debug_enabled() -> bool:
        env = os.getenv("AUGQ_DEBUG_LLM", "").strip()
        if env and env not in ("0", "false", "False"):
            return True
        try:
            machine_cfg = load_machine_config(CONFIG_DIR / "machine.json") or {}
            openai_cfg = (machine_cfg.get("openai") or {}) if isinstance(machine_cfg, dict) else {}
            return bool(openai_cfg.get("debug_llm"))
        except Exception:
            return False

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(float(timeout_s or 60))) as client:
            mutations = {"story_changed": False}
            # Limit tool call loops to prevent infinite cycles
            for _ in range(5):
                if _llm_debug_enabled():
                    try:
                        print("AUGQ DEBUG LLM → POST", url)
                        print("Headers:", headers)
                        print("Body:", _json.dumps(body, indent=2))
                    except Exception:
                        pass
                resp = await client.post(url, headers=headers, json=body)
                # Try to parse JSON regardless of status
                data = None
                try:
                    data = resp.json()
                except Exception:
                    data = {"raw": resp.text}

                if _llm_debug_enabled():
                    try:
                        print("AUGQ DEBUG LLM ← Status:", resp.status_code)
                        print("Response Text:", resp.text)
                    except Exception:
                        pass
                if resp.status_code >= 400:
                    return JSONResponse(status_code=resp.status_code, content={"ok": False, "detail": data})

                choices = (data or {}).get("choices") or []
                if not choices:
                    return JSONResponse(status_code=500, content={"ok": False, "detail": "LLM returned no choices"})

                message = choices[0].get("message")
                if not isinstance(message, dict):
                    return JSONResponse(status_code=500, content={"ok": False, "detail": "Invalid message format from LLM"})

                # Append assistant's response to messages
                req_messages.append(message)
                body["messages"] = req_messages

                # Decide if we need to call tools
                tool_calls = message.get("tool_calls")
                # Also handle legacy function_call
                if not tool_calls and isinstance(message.get("function_call"), dict):
                    fn_call = message["function_call"]
                    if isinstance(fn_call.get("name"), str):
                        name = fn_call.get("name")
                        args = fn_call.get("arguments", "{}")
                        if not isinstance(args, str):
                            try:
                                args = _json.dumps(args or "{}")
                            except Exception:
                                args = "{}"
                        tool_calls = [{"id": f"call_{name}", "type": "function", "function": {"name": name, "arguments": args}}]

                if not tool_calls or not isinstance(tool_calls, list):
                    # No tool calls, we are done. Return the last message.
                    usage = (data or {}).get("usage")
                    # Clean up response message for client
                    final_msg = {"role": "assistant", "content": message.get("content", "") or ""}
                    return JSONResponse(status_code=200, content={"ok": True, "message": final_msg, "usage": usage, "mutations": mutations})

                # We have tool calls, execute them
                tool_messages = []
                for call in tool_calls:
                    if not (isinstance(call, dict) and call.get("type") == "function"): continue
                    call_id = str(call.get("id") or "")
                    func = call.get("function") or {}
                    name = (func.get("name") if isinstance(func, dict) else "") or ""
                    args_raw = (func.get("arguments") if isinstance(func, dict) else "") or "{}"
                    try:
                        args_obj = _json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
                    except Exception:
                        args_obj = {}
                    if not name or not call_id: continue

                    tool_result_msg = await _exec_chat_tool(name, args_obj, call_id, payload, mutations)
                    tool_messages.append(tool_result_msg)

                req_messages.extend(tool_messages)
                body["messages"] = req_messages

            # If loop finishes (e.g. too many tool calls), return an error
            return JSONResponse(status_code=500, content={"ok": False, "detail": "Exceeded maximum tool call attempts"})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Chat request failed: {e}")


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
        return JSONResponse(status_code=400, content={"ok": False, "detail": "messages must be an array"})

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
            args_obj = _json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
        except Exception:
            args_obj = {}
        if not name or not call_id:
            continue
        msg = await _exec_chat_tool(name, args_obj, call_id, payload, mutations)
        appended.append(msg)

    return JSONResponse(status_code=200, content={"ok": True, "appended_messages": appended, "mutations": mutations})


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

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(float(timeout_s))) as client:
            resp = await client.get(url, headers=headers)
            # Relay status code if not 2xx
            content = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"raw": resp.text}
            if resp.status_code >= 400:
                return JSONResponse(status_code=resp.status_code, content={"error": "Upstream error", "status": resp.status_code, "data": content})
            return JSONResponse(status_code=200, content=content)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {e}")
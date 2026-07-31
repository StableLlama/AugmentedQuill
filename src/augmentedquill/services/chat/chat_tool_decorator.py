# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Decorator for defining chat tools with automatic schema generation from Pydantic models.

Decorator system for chat tools that maintains co-location of schemas and implementations.

This module provides a decorator that:
1. Extracts parameter schemas from Pydantic models
2. Auto-registers tools in a global registry
3. Generates OpenAI function calling schemas
4. Validates tool call arguments at runtime
5. Scopes tools to model roles so WRITING, EDITING, and CHAT can be isolated
"""

from __future__ import annotations

import inspect
import json as _json
from collections.abc import Callable
from copy import deepcopy
from typing import Any, get_args, get_origin

from pydantic import BaseModel, ConfigDict, ValidationError

from augmentedquill.services.exceptions import ServiceError

CHAT_ROLE = "CHAT"
EDITING_ROLE = "EDITING"
WRITING_ROLE = "WRITING"
MODEL_ROLES = (CHAT_ROLE, EDITING_ROLE, WRITING_ROLE)


class ToolModel(BaseModel):
    """Base model for chat tool argument classes that rejects unknown fields."""

    model_config = ConfigDict(extra="forbid")


_TOOL_REGISTRY: dict[str, dict[str, Any]] = {}


def normalize_model_role(role: str | None, default: str = CHAT_ROLE) -> str:
    """Normalize a model role to a supported uppercase value."""
    candidate = str(role or default).strip().upper()
    return candidate if candidate in MODEL_ROLES else default


def resolve_tool_role(payload: dict | None = None, tool_role: str | None = None) -> str:
    """Resolve the role under which a tool should be validated."""
    if tool_role:
        return normalize_model_role(tool_role)
    if isinstance(payload, dict):
        return normalize_model_role(
            payload.get("_tool_role") or payload.get("model_type")
        )
    return CHAT_ROLE


def _tool_message(name: str, call_id: str, content: Any) -> dict:
    """Format a tool response message."""
    return {
        "role": "tool",
        "tool_call_id": call_id,
        "name": name,
        "content": _json.dumps(content),
    }


def _tool_error(name: str, call_id: str, message: str) -> dict:
    """Format a tool error response message."""
    return _tool_message(name, call_id, {"error": message})


# Public aliases for use by tool implementations
tool_message = _tool_message
tool_error = _tool_error


def _simplify_schema(schema: Any) -> Any:
    """Recursively simplify JSON schemas for LLMs by flattening anyOf."""
    if not isinstance(schema, dict):
        return schema

    result = {}
    for key, value in schema.items():
        if key == "anyOf" and isinstance(value, list):
            non_null_types = [
                t for t in value if isinstance(t, dict) and t.get("type", "") != "null"
            ]
            if non_null_types:
                # Pick the first non-null type to avoid confusing models with unions
                for k, v in _simplify_schema(non_null_types[0]).items():
                    result[k] = v
        elif isinstance(value, dict):
            result[key] = _simplify_schema(value)
        elif isinstance(value, list):
            result[key] = [_simplify_schema(i) for i in value]
        else:
            result[key] = value
    return result


def _inline_local_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline local #/$defs references so tool schemas stay direct and LLM-friendly."""

    defs = schema.get("$defs", {}) if isinstance(schema, dict) else {}

    def _walk(node: Any, stack: tuple[str, ...] = ()) -> Any:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/"):
                key = ref.split("#/$defs/", 1)[1]
                if key in stack:
                    # Cycle fallback: keep original node to avoid infinite expansion.
                    return {k: _walk(v, stack) for k, v in node.items() if k != "$defs"}
                target = defs.get(key)
                if isinstance(target, dict):
                    merged = deepcopy(target)
                    for k, v in node.items():
                        if k == "$ref":
                            continue
                        merged[k] = v
                    return _walk(merged, stack + (key,))

            return {k: _walk(v, stack) for k, v in node.items() if k != "$defs"}

        if isinstance(node, list):
            return [_walk(item, stack) for item in node]

        return node

    inlined = _walk(schema)
    if isinstance(inlined, dict):
        inlined.pop("$defs", None)
        return inlined
    return schema


def _resolve_active_project_type() -> str | None:
    """Resolve the active project type for runtime tool gating."""
    from augmentedquill.core.config import load_story_config
    from augmentedquill.services.projects.projects import get_active_project_dir

    active = get_active_project_dir()
    if not active:
        return None
    story = load_story_config(active / "story.json") or {}
    project_type = story.get("project_type")
    return str(project_type) if isinstance(project_type, str) and project_type else None


def _project_type_error_payload(
    name: str, current_project_type: str, allowed_project_types: tuple[str, ...]
) -> dict[str, Any]:
    """Build a clear error payload when a tool is called in the wrong project context."""
    message_by_tool = {
        "create_new_chapter": (
            "Cannot create a chapter in a short-story project. "
            "Short-story projects use a single content file and do not allow chapter creation."
        ),
        "create_new_book": (
            "Cannot create a book in this project type. "
            "Book creation is only allowed for series projects."
        ),
    }
    message = message_by_tool.get(
        name,
        (
            f"Tool '{name}' is not allowed for project type '{current_project_type}'. "
            f"Allowed project types: {', '.join(allowed_project_types)}."
        ),
    )
    return {
        "error": "Tool unavailable for project type",
        "message": message,
        "details": {
            "tool": name,
            "project_type": current_project_type,
            "allowed_project_types": list(allowed_project_types),
        },
    }


def _sanitize_validation_details(details: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip oversized raw input values from validation details."""
    sanitized: list[dict[str, Any]] = []
    for detail in details:
        if not isinstance(detail, dict):
            continue
        sanitized.append(
            {
                "type": detail.get("type", "validation_error"),
                "loc": detail.get("loc", []),
                "msg": detail.get("msg", "Validation failed"),
            }
        )
    return sanitized


def chat_tool(
    description: str,
    name: str | None = None,
    allowed_roles: tuple[str, ...] | list[str] | None = None,
    capability: str | None = None,
    project_types: tuple[str, ...] | list[str] | None = None,
    opt_in: bool = False,
) -> Callable:
    """
    Decorator for chat tools with automatic schema generation from Pydantic models.

    Args:
        description: Description of what the tool does (shown to LLM)
        name: Optional explicit tool name (defaults to function name)
        allowed_roles: Model roles allowed to see and execute this tool
        capability: Optional internal capability label used for tests and routing
        project_types: If set, only expose this tool for the listed project types
            (e.g. ``("series",)``).  None means available for all project types.
        opt_in: If True, this tool is never included in the default schema.  It
            must be requested explicitly (e.g. via get_opt_in_tool_schemas) and
            is still executable when called.

    The decorated function should have signature:
        async def tool_fn(params: ParamsModel, payload: dict, mutations: dict) -> dict

    Where ParamsModel is a Pydantic BaseModel subclass defining the parameters.
    """

    def decorator(func: Callable) -> Callable:
        """Decorator."""
        tool_name = name or func.__name__
        normalized_roles = tuple(
            dict.fromkeys(
                normalize_model_role(role) for role in (allowed_roles or MODEL_ROLES)
            )
        )
        if not normalized_roles:
            raise ValueError(f"Tool function {tool_name} must allow at least one role")

        sig = inspect.signature(func)
        params_annotation = sig.parameters.get("params")
        if params_annotation is None:
            raise ValueError(
                f"Tool function {tool_name} must have a 'params' parameter"
            )

        params_type = params_annotation.annotation
        if params_type is inspect.Parameter.empty:
            raise ValueError(
                f"Tool function {tool_name} 'params' parameter must have a type annotation"
            )

        origin = get_origin(params_type)
        if origin is not None:
            args = get_args(params_type)
            for arg in args:
                if isinstance(arg, type) and issubclass(arg, BaseModel):
                    params_type = arg
                    break

        if not (isinstance(params_type, type) and issubclass(params_type, BaseModel)):
            raise ValueError(
                f"Tool function {tool_name} 'params' must be annotated with a Pydantic BaseModel"
            )

        original_schema = params_type.model_json_schema()
        simplified_schema = _inline_local_refs(
            _simplify_schema(deepcopy(original_schema))
        )
        tool_def = {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": simplified_schema.get("properties", {}),
                    "required": simplified_schema.get("required", []),
                    "additionalProperties": False,
                },
            },
        }

        allowed_params = set((simplified_schema.get("properties") or {}).keys())
        required_params = set(simplified_schema.get("required") or [])

        async def wrapper(
            args_obj: dict, call_id: str, payload: dict, mutations: dict
        ) -> dict:
            """Validate arguments and execute the tool implementation."""
            if not isinstance(args_obj, dict):
                return _tool_message(
                    tool_name,
                    call_id,
                    {
                        "error": "Invalid parameters",
                        "details": [
                            {
                                "type": "type_error.dict",
                                "loc": ["arguments"],
                                "msg": "Tool arguments must be a JSON object",
                            }
                        ],
                    },
                )

            unknown_keys = sorted(set(args_obj.keys()) - allowed_params)
            if unknown_keys:
                return _tool_message(
                    tool_name,
                    call_id,
                    {
                        "error": "Invalid parameters",
                        "details": [
                            {
                                "type": "extra_forbidden",
                                "loc": [key],
                                "msg": "Extra inputs are not permitted",
                            }
                            for key in unknown_keys
                        ],
                    },
                )

            missing_required = sorted(required_params - set(args_obj.keys()))
            if missing_required:
                return _tool_message(
                    tool_name,
                    call_id,
                    {
                        "error": "Invalid parameters",
                        "details": [
                            {
                                "type": "missing",
                                "loc": [key],
                                "msg": "Field required",
                            }
                            for key in missing_required
                        ],
                    },
                )

            try:
                params = params_type.model_validate(args_obj)
            except ValidationError as e:
                return _tool_message(
                    tool_name,
                    call_id,
                    {
                        "error": "Invalid parameters",
                        "details": _sanitize_validation_details(
                            e.errors(
                                include_url=False,
                                include_context=False,
                                include_input=False,
                            )
                        ),
                    },
                )
            except Exception as e:
                return _tool_message(
                    tool_name,
                    call_id,
                    {"error": f"Validation error: {e!s}"},
                )

            try:
                result = await func(params, payload, mutations)
                return _tool_message(tool_name, call_id, result)
            except Exception as e:
                return _tool_message(
                    tool_name,
                    call_id,
                    {"error": f"Execution error: {e!s}"},
                )

        _TOOL_REGISTRY[tool_name] = {
            "function": wrapper,
            "schema": tool_def,
            "params_model": params_type,
            "allowed_roles": normalized_roles,
            "capability": capability,
            "project_types": tuple(project_types) if project_types else None,
            "opt_in": opt_in,
            "module": func.__module__,
        }

        return wrapper

    return decorator


def get_tool_schemas(
    model_type: str | None = None,
    project_type: str | None = None,
) -> list[dict]:
    """Return registered tool schemas, optionally filtered by model role and project type."""
    normalized_role = normalize_model_role(model_type) if model_type else None
    schemas: list[dict] = []
    for info in _TOOL_REGISTRY.values():
        if info.get("opt_in"):
            continue
        if normalized_role and normalized_role not in info.get(
            "allowed_roles", MODEL_ROLES
        ):
            continue
        if project_type == "short-story" and str(info.get("module", "")).endswith(
            ".chapter_tools"
        ):
            allowed_project_types = info.get("project_types")
            if not allowed_project_types or "short-story" not in allowed_project_types:
                continue
        allowed_project_types = info.get("project_types")
        if project_type and allowed_project_types is not None:
            if project_type not in allowed_project_types:
                continue
        schema = deepcopy(info["schema"])
        func_name = schema.get("function", {}).get("name")
        params = schema.get("function", {}).get("parameters", {})
        properties = params.get("properties") if isinstance(params, dict) else None

        if func_name == "update_story_metadata" and project_type in ("novel", "series"):
            if properties is not None:
                properties.pop("conflicts", None)
                properties.pop("conflicts_patch", None)

        if func_name == "call_writing_llm" and properties is not None:
            chap_prop = properties.get("chap_id")
            if isinstance(chap_prop, dict):
                if project_type == "short-story":
                    chap_prop["description"] = (
                        "Chapter ID to write to. Use 1 or omit it and it will be auto-detected."
                    )
                else:
                    chap_prop["description"] = (
                        "Chapter ID to write to. Required when write_mode is set."
                    )

        if func_name == "add_sourcebook_relation" and properties is not None:
            if project_type == "short-story":
                properties.pop("start_chapter", None)
                properties.pop("end_chapter", None)
                properties.pop("start_book", None)
                properties.pop("end_book", None)
            elif project_type == "novel":
                properties.pop("start_book", None)
                properties.pop("end_book", None)

        if func_name == "manage_scenes" and properties is not None:
            create_data = properties.get("create_data")
            if isinstance(create_data, dict):
                create_props = create_data.get("properties")
                if isinstance(create_props, dict):
                    create_props.pop("prose_link", None)
                create_required = create_data.get("required")
                if isinstance(create_required, list):
                    create_data["required"] = [
                        item for item in create_required if item != "prose_link"
                    ]

            update_data = properties.get("update_data")
            if isinstance(update_data, dict):
                update_props = update_data.get("properties")
                if isinstance(update_props, dict):
                    update_props.pop("prose_link", None)
                update_required = update_data.get("required")
                if isinstance(update_required, list):
                    update_data["required"] = [
                        item for item in update_required if item != "prose_link"
                    ]

        if func_name == "reorder_scenes" and properties is not None:
            if project_type == "short-story":
                properties.pop("chapter_id", None)
                properties.pop("book_id", None)
            elif project_type == "novel":
                properties.pop("book_id", None)

        # Manager tools can expose role-scoped subsets of actions while remaining
        # a single canonical function at runtime.
        if normalized_role == EDITING_ROLE and properties is not None:
            action_prop = properties.get("action")
            if isinstance(action_prop, dict):
                allowed_actions_by_tool = {
                    "manage_project": ["get_overview"],
                    "manage_sourcebook": ["list", "get"],
                    "manage_images": ["list", "create_placeholder"],
                }
                allowed_actions = allowed_actions_by_tool.get(func_name)
                if allowed_actions is not None:
                    enum_values = action_prop.get("enum")
                    if isinstance(enum_values, list):
                        filtered = [
                            value for value in enum_values if value in allowed_actions
                        ]
                        if filtered:
                            action_prop["enum"] = filtered

        schemas.append(schema)
    return schemas


def get_opt_in_tool_schemas(capability: str) -> list[dict]:
    """Return schemas for opt-in tools matching a specific capability label."""
    ensure_tool_registry_loaded()
    return [
        deepcopy(info["schema"])
        for info in _TOOL_REGISTRY.values()
        if info.get("opt_in") and info.get("capability") == capability
    ]


def get_tool_function(name: str) -> Callable | None:
    """Get the wrapped function for a tool by name."""
    info = _TOOL_REGISTRY.get(name)
    return info["function"] if info else None


def ensure_tool_registry_loaded() -> None:
    """Ensure all chat tool modules are imported so decorator registration has run."""
    from augmentedquill.services.chat import chat_tools  # noqa: F401


def get_registered_tool_allowed_roles(name: str) -> tuple[str, ...] | None:
    """Return allowed roles for a tool from the canonical registry."""
    ensure_tool_registry_loaded()
    info = _TOOL_REGISTRY.get(name)
    if not info:
        return None
    return tuple(info.get("allowed_roles") or MODEL_ROLES)


def get_registered_tool_schemas(
    model_type: str | None = None,
    project_type: str | None = None,
) -> list[dict]:
    """Get OpenAI tool schemas from the canonical decorator registry."""
    ensure_tool_registry_loaded()
    return get_tool_schemas(model_type=model_type, project_type=project_type)


def write_tools_json_tempfile() -> str:
    """Write the current tool schema to a temporary tools.json file.

    Returns:
        The path to the temporary file.
    """

    import json
    import tempfile

    schemas = get_registered_tool_schemas(model_type=None)

    f = tempfile.NamedTemporaryFile(
        prefix="augmentedquill-tools-",
        suffix=".json",
        delete=False,
        mode="w",
        encoding="utf-8",
    )
    json.dump(schemas, f, indent=2)
    f.write("\n")
    f.flush()
    f.close()
    return f.name


async def execute_registered_tool(
    name: str,
    args_obj: dict,
    call_id: str,
    payload: dict,
    mutations: dict,
    tool_role: str | None = None,
) -> dict:
    """Execute a tool from the canonical decorator registry."""
    ensure_tool_registry_loaded()
    tool_fn = get_tool_function(name)
    if tool_fn is None:
        return _tool_error(name, call_id, f"Unknown tool: {name}")

    effective_role = resolve_tool_role(payload, tool_role)
    allowed_roles = get_registered_tool_allowed_roles(name) or MODEL_ROLES
    if effective_role not in allowed_roles:
        return _tool_message(
            name,
            call_id,
            {
                "error": "Tool unavailable for model role",
                "details": {
                    "tool": name,
                    "model_role": effective_role,
                    "allowed_roles": list(allowed_roles),
                },
            },
        )

    info = _TOOL_REGISTRY.get(name)
    allowed_project_types = tuple(info.get("project_types") or ()) if info else ()
    if allowed_project_types:
        current_project_type = _resolve_active_project_type()
        if (
            isinstance(current_project_type, str)
            and current_project_type not in allowed_project_types
        ):
            return _tool_message(
                name,
                call_id,
                _project_type_error_payload(
                    name,
                    current_project_type=current_project_type,
                    allowed_project_types=allowed_project_types,
                ),
            )

    try:
        return await tool_fn(args_obj, call_id, payload, mutations)
    except ServiceError as e:
        return _tool_error(name, call_id, f"Tool failed: {e.detail}")
    except Exception as e:
        return _tool_error(name, call_id, f"Tool failed with unexpected error: {e!s}")

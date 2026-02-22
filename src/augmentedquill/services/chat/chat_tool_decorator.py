# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Decorator for defining chat tools with automatic schema generation from Pydantic models.

"""
Decorator system for chat tools that maintains co-location of schemas and implementations.

This module provides a decorator that:
1. Extracts parameter schemas from Pydantic models
2. Auto-registers tools in a global registry
3. Generates OpenAI function calling schemas
4. Validates tool call arguments at runtime

Usage:
    from pydantic import BaseModel, Field

    class MyToolParams(BaseModel):
        name: str = Field(..., description="The name parameter")
        count: int | None = Field(None, description="Optional count")

    @chat_tool(description="Does something useful")
    async def my_tool(params: MyToolParams, payload: dict, mutations: dict):
        return {"result": params.name}
"""

from __future__ import annotations

import inspect
import json as _json
from collections.abc import Callable
from typing import Any, get_args, get_origin

from pydantic import BaseModel, ValidationError

# Global registry of all chat tools
_TOOL_REGISTRY: dict[str, dict[str, Any]] = {}


def _tool_message(name: str, call_id: str, content) -> dict:
    """Format a tool response message."""
    return {
        "role": "tool",
        "tool_call_id": call_id,
        "name": name,
        "content": _json.dumps(content),
    }


def _tool_error(name: str, call_id: str, message: str) -> dict:
    """Format a tool error message."""
    return _tool_message(name, call_id, {"error": message})


def chat_tool(
    description: str,
    name: str | None = None,
) -> Callable:
    """
    Decorator for chat tools with automatic schema generation from Pydantic models.

    Args:
        description: Description of what the tool does (shown to LLM)
        name: Optional explicit tool name (defaults to function name)

    The decorated function should have signature:
        async def tool_fn(params: ParamsModel, payload: dict, mutations: dict) -> dict

    Where ParamsModel is a Pydantic BaseModel subclass defining the parameters.
    """

    def decorator(func: Callable) -> Callable:
        tool_name = name or func.__name__

        # Extract parameter schema from function signature
        sig = inspect.signature(func)
        params_annotation = sig.parameters.get("params")

        if params_annotation is None:
            raise ValueError(
                f"Tool function {tool_name} must have a 'params' parameter"
            )

        params_type = params_annotation.annotation

        # Check if it's a Pydantic model
        if params_type is inspect.Parameter.empty:
            raise ValueError(
                f"Tool function {tool_name} 'params' parameter must have a type annotation"
            )

        # Handle Optional[ParamsModel] or ParamsModel | None
        origin = get_origin(params_type)
        if origin is not None:
            args = get_args(params_type)
            # Find the BaseModel in the union
            for arg in args:
                if isinstance(arg, type) and issubclass(arg, BaseModel):
                    params_type = arg
                    break

        if not (isinstance(params_type, type) and issubclass(params_type, BaseModel)):
            raise ValueError(
                f"Tool function {tool_name} 'params' must be annotated with a Pydantic BaseModel"
            )

        # Generate OpenAI function calling schema from Pydantic model
        schema = params_type.model_json_schema()

        # Build the OpenAI tool definition
        tool_def = {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": schema.get("properties", {}),
                    "required": schema.get("required", []),
                },
            },
        }

        # Create wrapper that validates and calls the original function
        async def wrapper(
            args_obj: dict, call_id: str, payload: dict, mutations: dict
        ) -> dict:
            try:
                # Validate and parse arguments using Pydantic
                params = params_type.model_validate(args_obj)
            except ValidationError as e:
                # Return validation error to LLM
                error_details = e.errors()
                return _tool_error(
                    tool_name,
                    call_id,
                    f"Invalid parameters: {error_details}",
                )
            except Exception as e:
                return _tool_error(tool_name, call_id, f"Validation error: {str(e)}")

            try:
                # Call the original function with validated params
                result = await func(params, payload, mutations)
                # Wrap the result in tool message format
                return _tool_message(tool_name, call_id, result)
            except Exception as e:
                return _tool_error(tool_name, call_id, f"Execution error: {str(e)}")

        # Register the tool
        _TOOL_REGISTRY[tool_name] = {
            "function": wrapper,
            "schema": tool_def,
            "params_model": params_type,
        }

        return wrapper

    return decorator


def get_tool_schemas() -> list[dict]:
    """Return all registered tool schemas for passing to LLM."""
    return [info["schema"] for info in _TOOL_REGISTRY.values()]


def get_tool_function(name: str) -> Callable | None:
    """Get the wrapped function for a tool by name."""
    info = _TOOL_REGISTRY.get(name)
    return info["function"] if info else None


def get_all_tool_names() -> list[str]:
    """Return list of all registered tool names."""
    return list(_TOOL_REGISTRY.keys())


def clear_registry():
    """Clear the tool registry (useful for testing)."""
    _TOOL_REGISTRY.clear()

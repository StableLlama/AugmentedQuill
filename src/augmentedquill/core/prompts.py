# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the prompts unit so this responsibility stays isolated, testable, and easy to evolve.

Centralized prompts configuration for LLM interactions.

This module contains all system messages and user prompt templates used throughout the application.
Prompts can be overridden on a per-model basis through the settings or per-project.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional

from augmentedquill.core.config import CONFIG_DIR

DEFAULTS_JSON_PATH = Path(__file__).resolve().parent / "prompts_defaults.json"
USER_PROMPTS_JSON_PATH = CONFIG_DIR / "prompts.json"


def _load_prompts() -> Dict[str, Any]:
    # 1. Load internal defaults
    """Load Prompts."""
    prompts = {"system_messages": {}, "user_prompts": {}, "prompt_types": {}}
    if DEFAULTS_JSON_PATH.exists():
        try:
            with open(DEFAULTS_JSON_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
                # Convert arrays to strings
                for section in ["system_messages", "user_prompts"]:
                    if section in raw:
                        for k, v in raw[section].items():
                            if isinstance(v, list):
                                prompts[section][k] = "\n".join(v)
                            else:
                                prompts[section][k] = v
                if "prompt_types" in raw:
                    prompts["prompt_types"] = raw["prompt_types"]
        except Exception:
            pass

    # 2. Overlay user global overrides from config/prompts.json
    if USER_PROMPTS_JSON_PATH.exists():
        try:
            with open(USER_PROMPTS_JSON_PATH, "r", encoding="utf-8") as f:
                user_overrides = json.load(f)
                for section in ["system_messages", "user_prompts"]:
                    if section in user_overrides:
                        for k, v in user_overrides[section].items():
                            if isinstance(v, list):
                                prompts[section][k] = "\n".join(v)
                            else:
                                prompts[section][k] = v
                if "prompt_types" in user_overrides:
                    prompts["prompt_types"].update(user_overrides["prompt_types"])
        except Exception:
            pass

    return prompts


_PROMPTS = _load_prompts()
DEFAULT_SYSTEM_MESSAGES = _PROMPTS.get("system_messages", {})
DEFAULT_USER_PROMPTS = _PROMPTS.get("user_prompts", {})
PROMPT_TYPES = _PROMPTS.get("prompt_types", {})


def ensure_string(v: Any) -> str:
    if isinstance(v, list):
        return "\n".join(v)
    return str(v) if v is not None else ""


def get_system_message(
    message_type: str, model_overrides: Optional[Dict[str, Any]] = None
) -> str:
    """
    Get a system message, checking for model-specific overrides first.

    Args:
        message_type: The type of system message (e.g., 'story_writer', 'chat_llm')
        model_overrides: Dictionary of model-specific prompt overrides

    Returns:
        The system message string
    """
    if model_overrides and message_type in model_overrides:
        return ensure_string(model_overrides[message_type])

    return ensure_string(DEFAULT_SYSTEM_MESSAGES.get(message_type, ""))


def get_user_prompt(prompt_type: str, **kwargs) -> str:
    """
    Get a formatted user prompt template.

    Args:
        prompt_type: The type of user prompt
        **kwargs: Variables to format into the prompt

    Returns:
        The formatted user prompt string
    """
    # Allow per-request prompt overrides without mutating global defaults.
    overrides = kwargs.get("user_prompt_overrides", {})
    template = overrides.get(prompt_type) or DEFAULT_USER_PROMPTS.get(prompt_type, "")

    if not template:
        return ""

    template = ensure_string(template)

    try:
        # Strip control keys so only template variables reach format().
        format_kwargs = {
            k: v for k, v in kwargs.items() if k != "user_prompt_overrides"
        }
        return template.format(**format_kwargs)
    except KeyError as e:
        raise ValueError(f"Missing required parameter for prompt {prompt_type}: {e}")


def load_model_prompt_overrides(
    machine_config: Dict[str, Any],
    selected_model: Optional[str] = None,
) -> Dict[str, str]:
    """
    Load prompt overrides for a specific model from machine config.

    Args:
        machine_config: The machine configuration dictionary
        selected_model: The selected model name

    Returns:
        Dictionary of prompt overrides
    """
    overrides = {}

    # 1. Load from machine config (provider/model-specific)
    if selected_model:
        openai_cfg = machine_config.get("openai", {})
        models = openai_cfg.get("models", [])

        for model in models:
            if isinstance(model, dict) and model.get("name") == selected_model:
                model_overrides = model.get("prompt_overrides", {})
                for k, v in model_overrides.items():
                    overrides[k] = ensure_string(v)
                break

    return overrides

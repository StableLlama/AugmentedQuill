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
from typing import Any

from augmentedquill.core.config import CONFIG_DIR

# new instructions file lives in resources/config so users can provide
# non-English translations later.  the older `prompts_defaults.json` is
# deprecated; nothing else in the repo should depend on it.
DEFAULTS_JSON_PATH = CONFIG_DIR / "instructions.json"
USER_PROMPTS_JSON_PATH = CONFIG_DIR / "prompts.json"


def _load_prompts() -> dict[str, Any]:
    """Load prompts."""
    # Load internal defaults from the multi-language instructions file.  The
    # resulting dictionary contains *all* prompt templates at the top level;
    # there is no structural distinction between system vs user prompts.
    prompts: dict[str, Any] = {}
    global _AVAILABLE_LANGUAGES

    if DEFAULTS_JSON_PATH.exists():
        try:
            with open(DEFAULTS_JSON_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)

                # collect languages set while parsing
                langs = set()

                def _parse_entries(entries: dict) -> None:
                    """Merge entries into `prompts` and update langs."""
                    for key, entry in entries.items():
                        if not isinstance(entry, dict):
                            prompts[key] = {"en": ensure_string(entry)}
                            langs.add("en")
                            continue
                        inner: dict[str, str] = {}
                        for lang_key, val in entry.items():
                            if lang_key.startswith("_"):
                                continue
                            inner[lang_key] = ensure_string(val)
                            langs.add(lang_key)
                        prompts[key] = inner

                # entries may either be under a wrapper or at top level
                if "system_messages" in raw and isinstance(
                    raw["system_messages"], dict
                ):
                    _parse_entries(raw["system_messages"])
                else:
                    # everything except user_prompts counts as system entry
                    _parse_entries(
                        {k: v for k, v in raw.items() if k != "user_prompts"}
                    )

                if "user_prompts" in raw and isinstance(raw["user_prompts"], dict):
                    _parse_entries(raw["user_prompts"])

                _AVAILABLE_LANGUAGES = sorted(langs)
        except Exception:
            pass

    # 2. Overlay user global overrides from config/prompts.json (not language aware)
    if USER_PROMPTS_JSON_PATH.exists():
        try:
            with open(USER_PROMPTS_JSON_PATH, "r", encoding="utf-8") as f:
                user_overrides = json.load(f)
                for section in ["system_messages", "user_prompts"]:
                    if section in user_overrides:
                        for k, v in user_overrides[section].items():
                            # treat override as english regardless of language
                            prompts[section].setdefault(k, {})["en"] = ensure_string(v)
        except Exception:
            pass

    return prompts


# after loading we have dictionaries mapping instruction key -> { lang: text }
# languages collected from the instructions file (english always present)
_AVAILABLE_LANGUAGES: list[str] = []

# helper to expose languages to other modules


def get_available_languages() -> list[str]:
    """Return sorted list of languages for which instructions exist.

    The list is extracted from the bundled instructions.json and does not
    include user or model overrides.
    """
    return list(_AVAILABLE_LANGUAGES)  # copy


def ensure_string(v: Any) -> str:
    """Ensure string."""
    if isinstance(v, list):
        return "\n".join(v)
    return str(v) if v is not None else ""


# initialize after helper definitions so they can be referenced without error
_PROMPTS = _load_prompts()
# unified prompt map containing every template entry; caller code may still
# distinguish between "system" vs "user" prompts if desired, but all
# entries are processed identically.
DEFAULT_PROMPTS = _PROMPTS

# The instructions file no longer supplies a standalone `prompt_types`
# mapping; each system message carries its mode in the `_use` field.  We do
# not keep any separate structure here, keeping the data model minimal.


def get_system_message(
    message_type: str,
    model_overrides: dict[str, Any] | None = None,
    language: str | None = None,
    **kwargs: Any,
) -> str:
    """
    Get a system message, checking for model-specific overrides first and
    falling back to a language-specific default.

    Precedence:
    1. Model override (regardless of language)
    2. Default text in requested language
    3. Default English text

    Args:
        message_type: The type of system message (e.g., 'story_writer',
            'chat_llm')
        model_overrides: Dictionary of model-specific prompt overrides
        language: Two‑letter language code. If omitted or not found, 'en' is
            used.

    Returns:
        The system message string
    """
    # both system and user prompts live in the same map; for system messages
    # we simply pull the raw template and ignore any kwargs.
    if model_overrides and message_type in model_overrides:
        template = ensure_string(model_overrides[message_type])
    else:
        lang = (language or "en").lower()
        entry = DEFAULT_PROMPTS.get(message_type, {})
        if isinstance(entry, dict):
            template = ensure_string(entry.get(lang) or entry.get("en") or "")
        else:
            template = ensure_string(entry)

    if not template:
        return ""

    try:
        format_kwargs = {
            k: v for k, v in kwargs.items() if k != "user_prompt_overrides"
        }
        if not template:
            return ""
        # if no format_kwargs, just return template to avoid KeyError
        if not format_kwargs:
            return template

        # Use double braces to prevent .format() from interpreting them
        safe_template = template.replace("{{", "DOUBLE_OPEN_BRACE").replace(
            "}}", "DOUBLE_CLOSE_BRACE"
        )
        formatted = safe_template.format(**format_kwargs)
        return formatted.replace("DOUBLE_OPEN_BRACE", "{").replace(
            "DOUBLE_CLOSE_BRACE", "}"
        )
    except KeyError:
        # If a placeholder is missing, return the unformatted template.
        # This prevents crashes when new placeholders are added to JSON but
        # not yet passed by all callsites.
        return template
    except Exception:
        return template


def get_user_prompt(
    prompt_type: str, language: str | None = None, **kwargs: Any
) -> str:
    """
    Get a formatted user prompt template in the requested language.

    Overrides behave the same as before (model/user overrides take precedence
    and are not language-aware).  The ``language`` parameter selects which
    translation to use when looking up the template; if the chosen language is
    not available the English version is used.

    Args:
        prompt_type: The type of user prompt
        language: two-letter language code for lookup
        **kwargs: Variables to format into the prompt (including
            ``user_prompt_overrides``)

    Returns:
        The formatted user prompt string
    """
    # Allow per-request prompt overrides without mutating global defaults.
    overrides = kwargs.get("user_prompt_overrides", {})
    if prompt_type in overrides:
        template = ensure_string(overrides[prompt_type])
    else:
        entry = DEFAULT_PROMPTS.get(prompt_type, {})
        lang = (language or "en").lower()
        if isinstance(entry, dict):
            template = ensure_string(entry.get(lang) or entry.get("en") or "")
        else:
            template = ensure_string(entry)

    if not template:
        return ""

    try:
        # Strip control keys so only template variables reach format().
        format_kwargs = {
            k: v for k, v in kwargs.items() if k != "user_prompt_overrides"
        }
        if not format_kwargs:
            return template

        # Use double braces to prevent .format() from interpreting them
        safe_template = template.replace("{{", "DOUBLE_OPEN_BRACE").replace(
            "}}", "DOUBLE_CLOSE_BRACE"
        )
        formatted = safe_template.format(**format_kwargs)
        return formatted.replace("DOUBLE_OPEN_BRACE", "{").replace(
            "DOUBLE_CLOSE_BRACE", "}"
        )
    except KeyError:
        # If a placeholder is missing, return the unformatted template.
        return template
    except Exception:
        return template


def load_model_prompt_overrides(
    machine_config: dict[str, Any],
    selected_model: str | None = None,
) -> dict[str, str]:
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

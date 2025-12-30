"""
Configuration loading utilities for AugmentedQuill.

Conventions:
- Machine-specific config: config/machine.json
- Story-specific config: config/story.json
- Environment variables override JSON values.
- JSON values can reference environment variables using ${VAR_NAME} placeholders.

Only generic JSON dicts are returned to keep things simple in early stages.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Mapping, Optional


_ENV_PATTERN = re.compile(r"\$\{([A-Z0-9_]+)\}")


def _interpolate_env(value: Any) -> Any:
    """Interpolate ${VAR} placeholders within strings using environment variables.

    Non-string types are returned unchanged.
    """
    if isinstance(value, str):

        def replace(match: re.Match[str]) -> str:
            var = match.group(1)
            return os.getenv(var, match.group(0))  # leave placeholder if unset

        return _ENV_PATTERN.sub(replace, value)
    if isinstance(value, dict):
        return {k: _interpolate_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_interpolate_env(v) for v in value]
    return value


def _deep_merge(base: Dict[str, Any], override: Mapping[str, Any]) -> Dict[str, Any]:
    """Deeply merge mapping 'override' into dict 'base'. Returns new dict.

    - For dict values, merges recursively.
    - For lists and scalars, override replaces base.
    """
    result: Dict[str, Any] = dict(base)
    for k, v in override.items():
        if isinstance(v, Mapping) and isinstance(result.get(k), Mapping):
            result[k] = _deep_merge(dict(result[k]), v)  # type: ignore[index]
        else:
            result[k] = v
    return result


def load_json_file(path: os.PathLike[str] | str) -> Dict[str, Any]:
    """Load JSON from path if it exists; return empty dict if missing.

    Raises ValueError for malformed JSON.
    """
    p = Path(path)
    if not p.exists():
        return {}
    try:
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON at {p}: {e}") from e


def _env_overrides_for_openai() -> Dict[str, Any]:
    """Collect OPENAI_* environment variables into a nested dict structure.

    Supported variables:
    - OPENAI_API_KEY -> openai.api_key
    - OPENAI_BASE_URL -> openai.base_url
    - OPENAI_MODEL -> openai.model
    - OPENAI_TIMEOUT_S -> openai.timeout_s (int if parseable)
    """
    result: Dict[str, Any] = {}
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL")
    model = os.getenv("OPENAI_MODEL")
    timeout_s = os.getenv("OPENAI_TIMEOUT_S")

    openai: Dict[str, Any] = {}
    if api_key is not None:
        openai["api_key"] = api_key
    if base_url is not None:
        openai["base_url"] = base_url
    if model is not None:
        openai["model"] = model
    if timeout_s is not None:
        try:
            openai["timeout_s"] = int(timeout_s)
        except ValueError:
            openai["timeout_s"] = timeout_s
    if openai:
        result["openai"] = openai
    return result


def load_machine_config(
    path: os.PathLike[str] | str = "config/machine.json",
    defaults: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Load machine configuration applying precedence and interpolation.

    Precedence: env overrides > JSON file > defaults
    """
    defaults = dict(defaults or {})
    json_config = load_json_file(path)
    json_config = _interpolate_env(json_config)
    # Merge JSON over defaults, then env over that
    merged = _deep_merge(defaults, json_config)
    merged = _deep_merge(merged, _env_overrides_for_openai())
    return merged


def load_story_config(
    path: os.PathLike[str] | str = "config/story.json",
    defaults: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Load story-specific configuration with env interpolation only.

    Currently we do not define env var names for story config. ${VAR} placeholders
    in the JSON will still resolve using environment variables.
    """
    defaults = dict(defaults or {})
    json_config = load_json_file(path)
    json_config = _interpolate_env(json_config)
    return _deep_merge(defaults, json_config)

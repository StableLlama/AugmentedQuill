# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

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

import jsonschema

CURRENT_SCHEMA_VERSION = 2


def _get_story_schema(version: int) -> Dict[str, Any]:
    """Get the JSON schema for a given story config version."""
    schema_path = (
        Path(__file__).parent.parent / "schemas" / f"story-v{version}.schema.json"
    )
    with open(schema_path, "r") as f:
        return json.load(f)


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


def load_json_file(path: os.PathLike[str] | str | None) -> Dict[str, Any]:
    """Load JSON from path if it exists; return empty dict if missing.

    Raises ValueError for malformed JSON.
    """
    if path is None:
        return {}
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
    path: os.PathLike[str] | str | None = "config/machine.json",
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
    path: os.PathLike[str] | str | None = "config/story.json",
    defaults: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Load story-specific configuration with env interpolation only.

    Currently we do not define env var names for story config. ${VAR} placeholders
    in the JSON will still resolve using environment variables.
    """
    defaults = dict(defaults or {})
    json_config = load_json_file(path)
    json_config = _interpolate_env(json_config)
    merged = _deep_merge(defaults, json_config)

    # Validate version and schema
    version = merged.get("metadata", {}).get("version", 0)
    if version < CURRENT_SCHEMA_VERSION:
        raise ValueError(
            f"Story config at {path} has outdated version {version}. Current version is {CURRENT_SCHEMA_VERSION}. Please update the config."
        )
    elif version > CURRENT_SCHEMA_VERSION:
        raise ValueError(
            f"Story config at {path} has unknown version {version}. Current supported version is {CURRENT_SCHEMA_VERSION}."
        )

    # Validate against schema
    schema = _get_story_schema(version)
    try:
        jsonschema.validate(merged, schema)
    except jsonschema.ValidationError as e:
        raise ValueError(f"Invalid story config at {path}: {e.message}")

    if "tags" in merged and not isinstance(merged["tags"], list):
        raise ValueError(f"Invalid story config at {path}: 'tags' must be an array")

    # Internal Normalization: Re-inject IDs that are stored under different names (like folder)
    # for consistent usage throughout the app.
    if merged.get("project_type") == "series" and "books" in merged:
        for book in merged["books"]:
            if isinstance(book, dict):
                # If we have id but no folder, assume folder = id (legacy/manual)
                if "id" in book and "folder" not in book:
                    book["folder"] = book["id"]
                # If we have folder but no id, inject it for runtime
                if "folder" in book and "id" not in book:
                    book["id"] = book["folder"]

    return merged


def save_story_config(path: os.PathLike[str] | str, config: Dict[str, Any]) -> None:
    p = Path(path)
    if not p.parent.exists():
        p.parent.mkdir(parents=True)

    # Strip internal IDs recursively before saving.
    # The requirement is that internal implementation details like UUIDs
    # should not be content in the file on disk.
    def _clean_for_disk(data, current_key=None):
        if isinstance(data, dict):
            res = {}
            for k, v in data.items():
                if k == "id":
                    continue
                if current_key == "sourcebook":
                    # For sourcebook entries, the key is the name.
                    # Dictionary values are the entry data; strip 'name' from within them.
                    entry_data = _clean_for_disk(v)
                    if isinstance(entry_data, dict):
                        entry_data.pop("name", None)
                    res[k] = entry_data
                else:
                    res[k] = _clean_for_disk(v, k)
            return res
        elif isinstance(data, list):
            # If sourcebook somehow arrives as a list, convert it to the expected dict format.
            if current_key == "sourcebook":
                res = {}
                for entry in data:
                    if isinstance(entry, dict) and "name" in entry:
                        name = entry["name"]
                        entry_copy = {
                            k: _clean_for_disk(v)
                            for k, v in entry.items()
                            if k not in ("id", "name")
                        }
                        res[name] = entry_copy
                return res
            return [_clean_for_disk(x) for x in data]
        return data

    clean_config = _clean_for_disk(config)

    with p.open("w", encoding="utf-8") as f:
        json.dump(clean_config, f, indent=2, ensure_ascii=False)

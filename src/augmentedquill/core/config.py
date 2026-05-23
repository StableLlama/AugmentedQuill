# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the config unit so this responsibility stays isolated, testable, and easy to evolve.

Configuration loading utilities for AugmentedQuill.

Conventions:
- Runtime user config: data/config/{machine,story,projects}.json
- Project-shipped config assets: resources/config/*.json (e.g., model presets)
- Environment variables override JSON values.
- JSON values can reference environment variables using ${VAR_NAME} placeholders.

Only generic JSON dicts are returned to keep things simple in early stages.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

import jsonschema

from augmentedquill.services.story.config_story_ops import (
    normalize_validate_story_config,
    clean_story_config_for_disk,
)

if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    # When running as a PyInstaller bundle, sys._MEIPASS is the temp folder for bundled data
    BASE_DIR = Path(sys._MEIPASS).resolve()
else:
    BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

CONFIG_DIR = BASE_DIR / "resources" / "config"
SCHEMAS_DIR = BASE_DIR / "resources" / "schemas"

_logger = logging.getLogger(__name__)
RESOURCES_DIR = BASE_DIR / "resources"
_ENV_USER_DATA_DIR = os.getenv("AUGQ_USER_DATA_DIR")
DATA_DIR = Path(_ENV_USER_DATA_DIR) if _ENV_USER_DATA_DIR else BASE_DIR / "data"
PROJECTS_ROOT = DATA_DIR / "projects"
LOGS_DIR = DATA_DIR / "logs"
STATIC_DIR = BASE_DIR / "static"

CURRENT_SCHEMA_VERSION = 7
USER_CONFIG_DIR = DATA_DIR / "config"
DEFAULT_MACHINE_CONFIG_PATH = (
    Path(os.getenv("AUGQ_MACHINE_CONFIG_PATH"))
    if os.getenv("AUGQ_MACHINE_CONFIG_PATH")
    else USER_CONFIG_DIR / "machine.json"
)
DEFAULT_STORY_CONFIG_PATH = (
    Path(os.getenv("AUGQ_STORY_CONFIG_PATH"))
    if os.getenv("AUGQ_STORY_CONFIG_PATH")
    else USER_CONFIG_DIR / "story.json"
)
DEFAULT_PROJECTS_REGISTRY_PATH = (
    Path(os.getenv("AUGQ_PROJECTS_REGISTRY"))
    if os.getenv("AUGQ_PROJECTS_REGISTRY")
    else USER_CONFIG_DIR / "projects.json"
)
DEFAULT_MODEL_PRESETS_PATH = CONFIG_DIR / "model_presets.json"


def _resolve_default_machine_config_path() -> Path:
    """Resolve machine config path from current environment at call time."""
    explicit = os.getenv("AUGQ_MACHINE_CONFIG_PATH")
    if explicit:
        return Path(explicit)

    user_data = os.getenv("AUGQ_USER_DATA_DIR")
    if user_data:
        return Path(user_data) / "config" / "machine.json"

    return USER_CONFIG_DIR / "machine.json"


def _get_story_schema(version: int) -> Dict[str, Any]:
    """Get the JSON schema for a given story config version."""
    schema_path = SCHEMAS_DIR / f"story-v{version}.schema.json"
    with open(schema_path, "r") as f:
        return json.load(f)


def _validate_machine_config(config: Dict[str, Any], path_label: str) -> None:
    """Validate machine config against the schema if openai key is present.

    Emits a warning log on failure instead of raising, because machine.json
    may legitimately be incomplete (e.g. on first startup before the user
    has configured any models).
    """
    if "openai" not in config:
        return
    schema_path = SCHEMAS_DIR / "machine.schema.json"
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(config, schema)
    except jsonschema.ValidationError as exc:
        _logger.warning("machine config at %s is invalid: %s", path_label, exc.message)
    except Exception as exc:  # noqa: BLE001 – schema file missing, etc.
        _logger.warning("Could not validate machine config at %s: %s", path_label, exc)


def _validate_projects_registry(data: Dict[str, Any], path_label: str) -> None:
    """Validate projects registry against the schema.

    Raises ValueError on schema violations so callers are forced to handle a
    corrupt registry rather than silently operating on bad data.
    """
    schema_path = SCHEMAS_DIR / "projects.schema.json"
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(data, schema)
    except jsonschema.ValidationError as exc:
        raise ValueError(
            f"Invalid projects registry at {path_label}: {exc.message}"
        ) from exc


_ENV_PATTERN = re.compile(r"\$\{([A-Z0-9_]+)\}")


def _interpolate_env(value: Any) -> Any:
    """Interpolate ${VAR} placeholders within strings using environment variables.

    Non-string types are returned unchanged.
    """
    if isinstance(value, str):
        return _ENV_PATTERN.sub(
            lambda match: os.getenv(match.group(1), match.group(0)), value
        )
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
    path: os.PathLike[str] | str | None = None,
    defaults: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Load machine configuration applying precedence and interpolation.

    Precedence: env overrides > JSON file > defaults
    """
    defaults = dict(defaults or {})
    resolved_path = _resolve_default_machine_config_path() if path is None else path
    json_config = load_json_file(resolved_path)
    json_config = _interpolate_env(json_config)
    # Merge JSON over defaults, then env over that
    merged = _deep_merge(defaults, json_config)
    merged = _deep_merge(merged, _env_overrides_for_openai())
    _validate_machine_config(merged, str(resolved_path))
    return merged


def load_story_config(
    path: os.PathLike[str] | str | None = DEFAULT_STORY_CONFIG_PATH,
    defaults: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Load story-specific configuration with env interpolation only.

    Currently we do not define env var names for story config. ${VAR} placeholders
    in the JSON will still resolve using environment variables.
    """
    defaults = dict(defaults or {})
    json_config = load_json_file(path)
    json_config = _interpolate_env(json_config)

    # Attempt to migrate any older story schema versions before normalizing.
    if Path(path).exists():
        try:
            from augmentedquill.updates.migrate_story_v5 import migrate_project_v5
            from augmentedquill.updates.migrate_story_v6 import migrate_project_v6
            from augmentedquill.updates.migrate_story_v7 import migrate_project_v7

            migrate_project_v5(Path(path).parent)
            migrate_project_v6(Path(path).parent)
            migrate_project_v7(Path(path).parent)
            json_config = load_json_file(path)
            json_config = _interpolate_env(json_config)
        except Exception:
            pass

    merged = _deep_merge(defaults, json_config)
    return normalize_validate_story_config(
        merged=merged,
        path_label=str(path),
        current_schema_version=CURRENT_SCHEMA_VERSION,
        schema_loader=_get_story_schema,
    )


def save_story_config(path: os.PathLike[str] | str, config: Dict[str, Any]) -> None:
    """Save Story Config."""
    p = Path(path)
    if not p.parent.exists():
        p.parent.mkdir(parents=True)

    clean_config = clean_story_config_for_disk(config)
    temp_path: Path | None = None
    replaced = False
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=p.parent, delete=False
    ) as tmp_file:
        json.dump(clean_config, tmp_file, indent=2, ensure_ascii=False)
        tmp_file.write("\n")
        temp_path = Path(tmp_file.name)
    try:
        os.replace(temp_path, p)
        replaced = True
    finally:
        if temp_path is not None and temp_path.exists() and not replaced:
            temp_path.unlink(missing_ok=True)


def load_model_presets_config(
    path: os.PathLike[str] | str | None = DEFAULT_MODEL_PRESETS_PATH,
) -> Dict[str, Any]:
    """Load global model preset database JSON."""
    return load_json_file(path)


def ensure_runtime_user_config_files() -> None:
    """Create missing runtime user config files with safe defaults.

    This keeps first startup usable without manual setup.
    """
    USER_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    machine_path = DEFAULT_MACHINE_CONFIG_PATH
    if not machine_path.exists():
        machine_path.write_text("{}\n", encoding="utf-8")

    story_path = DEFAULT_STORY_CONFIG_PATH
    if not story_path.exists():
        story_payload: Dict[str, Any] = {
            "project_title": "Untitled Project",
            "project_type": "novel",
            "chapters": [],
            "format": "markdown",
            "metadata": {"version": CURRENT_SCHEMA_VERSION},
            "llm_prefs": {"temperature": 0.7, "max_tokens": 16384},
            "sourcebook": {},
            "story_summary": "",
            "tags": [],
        }
        story_path.write_text(
            json.dumps(story_payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    projects_registry_path = DEFAULT_PROJECTS_REGISTRY_PATH
    if not projects_registry_path.exists():
        projects_registry_path.write_text(
            json.dumps({"current": "", "recent": []}, indent=2) + "\n",
            encoding="utf-8",
        )

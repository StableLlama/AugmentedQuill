# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Derived scene-field generation (summary from beats, beats from summary/prose).

This module is the single entry point for regenerating a scene's *derived*
fields.  It intentionally shares the story/scene prompt context with the scene
prose writer (see ``scene_generation_service.build_scene_generation_context``)
so every LLM-based scene generation flow stays consistent and free of
duplicated context assembly.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from augmentedquill.core.config import load_story_config
from augmentedquill.core.prompts import get_system_message, get_user_prompt
from augmentedquill.models.scene import SceneBeat, SceneFieldGenerateRequest
from augmentedquill.services.chat.chat_tool_decorator import EDITING_ROLE
from augmentedquill.services.llm import llm
from augmentedquill.services.scenes.scene_generation_service import (
    build_scene_generation_context,
    get_scene,
    resolve_scene_scope,
)
from augmentedquill.services.story.story_generation_common import sanitize_prompt

# Which user prompt derives a (target, source) pair.  Adding a new derived
# field is a one-line change here plus a matching prompt in instructions.json.
_FIELD_RECIPE_KEYS: dict[tuple[str, str], str] = {
    ("summary", "beats"): "scene_summary_from_beats",
    ("beats", "summary"): "scene_beats_from_summary",
    ("beats", "prose"): "scene_beats_from_prose",
}

_BEAT_LINE_PREFIX = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s*")


def parse_beats_text(text: str) -> list[SceneBeat]:
    """Parse a newline-delimited generated beat list into ``SceneBeat`` models."""
    beats: list[SceneBeat] = []
    for raw_line in text.splitlines():
        line = _BEAT_LINE_PREFIX.sub("", raw_line.strip()).strip()
        if line:
            beats.append(SceneBeat(text=line))
    return beats


def _beats_to_text(beats: Any) -> str:
    """Render beats (models or dicts) as a numbered plain-text list."""
    lines: list[str] = []
    if not isinstance(beats, list):
        return ""
    for index, beat in enumerate(beats, start=1):
        if isinstance(beat, dict):
            text = str(beat.get("text") or "").strip()
        else:
            text = str(getattr(beat, "text", "") or "").strip()
        if text:
            lines.append(f"{index}. {text}")
    return "\n".join(lines)


def _resolve_source_text(
    *,
    request: SceneFieldGenerateRequest,
    scene: dict[str, Any],
) -> str:
    """Return the source field text, preferring the client's unsaved content."""
    if request.source == "summary":
        raw = request.summary if request.summary is not None else scene.get("summary")
        return str(raw or "").strip()
    if request.source == "beats":
        beats = request.beats if request.beats is not None else scene.get("beats")
        return _beats_to_text(beats)
    if request.source == "prose":
        return str(request.prose or "").strip()
    return ""


def _prepare_field_generation(
    *,
    project_dir: Path,
    scene_id: int,
    request: SceneFieldGenerateRequest,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the LLM message pair for one derived scene-field regeneration."""
    scene = get_scene(project_dir, scene_id)
    if scene is None:
        raise LookupError(f"Scene '{scene_id}' not found")

    prompt_key = _FIELD_RECIPE_KEYS.get((request.target, request.source))
    if prompt_key is None:
        raise ValueError(
            f"Unsupported scene field generation: {request.target} from {request.source}"
        )

    source_text = _resolve_source_text(request=request, scene=scene)
    if not source_text:
        raise ValueError("Source field is empty")

    story = load_story_config(project_dir / "story.json") or {}
    scope_type, chapter_id, book_id = resolve_scene_scope(scene=scene, story=story)
    context = build_scene_generation_context(
        project_dir=project_dir,
        scene_id=scene_id,
        scope_type=scope_type,
        chapter_id=chapter_id,
        book_id=book_id,
        include_following_scenes=0,
        payload=payload,
        model_type=EDITING_ROLE,
    )

    prompt_kwargs: dict[str, Any] = {
        "language": context["language"],
        "story_title": context["story_title"],
        "story_summary": context["story_summary"],
        "story_notes_section": context["story_notes_section"],
        "background_section": context["background_section"],
        "scene_guidance_section": context["scene_guidance_section"],
    }
    source_key = {
        "beats": "beats_text",
        "summary": "summary_text",
        "prose": "prose_text",
    }[request.source]
    prompt_kwargs[source_key] = source_text

    system_msg = get_system_message(
        "scene_field_writer", context["model_overrides"], language=context["language"]
    )
    user_msg = sanitize_prompt(get_user_prompt(prompt_key, **prompt_kwargs))

    return {
        "target": request.target,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        "base_url": context["base_url"],
        "api_key": context["api_key"],
        "model_id": context["model_id"],
        "timeout_s": context["timeout_s"],
        "model_name": context["model_name"],
    }


def _build_result_event(target: str, text: str) -> dict[str, Any]:
    """Build the terminal SSE ``result`` event for a generated field."""
    clean = text.strip()
    beats = parse_beats_text(clean) if target == "beats" else []
    return {
        "type": "result",
        "target": target,
        "text": clean,
        "beats": [beat.model_dump(mode="json") for beat in beats],
    }


async def generate_scene_field(
    *,
    project_dir: Path,
    scene_id: int,
    request: SceneFieldGenerateRequest,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Regenerate one derived scene field and return the raw plus parsed result."""
    prepared = _prepare_field_generation(
        project_dir=project_dir,
        scene_id=scene_id,
        request=request,
        payload=payload,
    )
    response = await llm.unified_chat_complete(
        caller_id="scene_field_generation.generate_scene_field",
        model_type=EDITING_ROLE,
        messages=prepared["messages"],
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
        model_name=prepared["model_name"],
    )
    return _build_result_event(prepared["target"], str(response.get("content") or ""))


async def stream_scene_field_generation(
    *,
    project_dir: Path,
    scene_id: int,
    request: SceneFieldGenerateRequest,
    payload: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a derived scene-field regeneration.

    Yields:
    - ``{"type": "thinking", "accumulated": str}`` for every reasoning delta,
      so the client can show progress during long reasoning phases
    - ``{"type": "chunk", "accumulated": str}`` for every content delta
    - ``{"type": "result", "target": ..., "text": ..., "beats": [...]}`` once
      the full text has been generated
    """
    prepared = _prepare_field_generation(
        project_dir=project_dir,
        scene_id=scene_id,
        request=request,
        payload=payload,
    )
    accumulated = ""
    thinking = ""
    async for chunk_dict in llm.unified_chat_stream(
        caller_id="scene_field_generation.stream_scene_field_generation",
        model_type=EDITING_ROLE,
        messages=prepared["messages"],
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
        model_name=prepared["model_name"],
    ):
        reasoning = chunk_dict.get("thinking") or ""
        if reasoning:
            thinking += reasoning
            yield {"type": "thinking", "accumulated": thinking}

        content = chunk_dict.get("content") or ""
        if content:
            accumulated += content
            yield {"type": "chunk", "accumulated": accumulated}

    yield _build_result_event(prepared["target"], accumulated)

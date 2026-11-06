# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Scene-scoped prose editing tools for the EDITING role.

These tools are the only prose-writing surface an EDITING session may use when
it is scoped to a single scene.  Every write is confined to that scene's marker
span, so text owned by other scenes (or prose outside any scene) can never be
rewritten by accident.

All marker math and persistence delegates to ``scene_service``
(``update_prose_content``) and ``scene_markers`` helpers, so offsets, marker
exclusivity and annotation integrity keep running through the canonical
implementation instead of a second copy here.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import Field

from augmentedquill.models.scene import SceneUpdateProseContentRequest
from augmentedquill.services.chat.chat_tool_decorator import (
    EDITING_ROLE,
    ToolModel,
    chat_tool,
)
from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.services.scenes.scene_markers import (
    SceneSpan,
    find_scene_marker_span,
    internal_marker_spans,
    strip_internal_markers,
    visible_offset_map,
)
from augmentedquill.services.scenes.scene_service import (
    _scene_content_path,
    get_scene,
    scene_prose_is_linked,
    update_prose_content,
)

# Payload key carrying the scene an EDITING session is limited to.  It is set
# by ``call_editing_assistant`` and validated by every scene-scoped tool so a
# session can never edit prose that belongs to a different scene.
EDITING_SCENE_SCOPE_KEY = "_editing_scene_id"

# Tools that can rewrite prose outside a scene span.  They are removed from the
# schema of a scene-scoped EDITING session and rejected at execution time, so a
# hallucinated call cannot bypass the scope.
SCENE_SCOPED_FORBIDDEN_TOOLS: frozenset[str] = frozenset(
    {
        "apply_chapter_replacements",
        "call_writing_llm",
        "insert_image_in_chapter",
        "insert_text_at_marker",
        "replace_text_in_chapter",
        "write_book_content",
        "write_chapter_content",
        "write_story_content",
    }
)

# Tools that are safe for reading but contain a prose-writing action.  They stay
# available in a scene-scoped session, but the listed actions are rejected.
SCENE_SCOPED_FORBIDDEN_ACTIONS: dict[str, frozenset[str]] = {
    "search_and_replace": frozenset({"replace"}),
    # Metadata is read-only for a scene-scoped editor session; CHAT applies
    # scene metadata changes itself.
    "manage_scenes": frozenset({"create", "update", "delete"}),
}


def scene_scope_forbidden_reason(name: str, args: Any) -> str | None:
    """Return why *name* may not run in a scene-scoped session, else ``None``."""
    if name in SCENE_SCOPED_FORBIDDEN_TOOLS:
        return f"'{name}' can rewrite prose outside the scene."
    forbidden_actions = SCENE_SCOPED_FORBIDDEN_ACTIONS.get(name)
    if forbidden_actions:
        action = ""
        if isinstance(args, dict):
            action = str(args.get("action") or "").strip().lower()
        if action in forbidden_actions:
            return (
                f"'{name}' with action='{action}' can rewrite prose outside "
                "the scene."
            )
    return None


@dataclass(frozen=True)
class SceneProseTarget:
    """Resolved prose location for one scene."""

    scene: dict[str, Any]
    content_path: Path
    content: str
    span: SceneSpan

    @property
    def raw_prose(self) -> str:
        """Prose slice as stored on disk (scene markers excluded, annotations kept)."""
        return self.content[self.span.start : self.span.end]

    @property
    def visible_prose(self) -> str:
        """Marker-free prose safe to hand to an LLM."""
        return strip_internal_markers(self.raw_prose)

    @property
    def link(self) -> dict[str, Any]:
        link = self.scene.get("prose_link")
        return link if isinstance(link, dict) else {}


def _error(message: str, **details: Any) -> dict[str, Any]:
    """Build a tool error result with optional structured details."""
    payload: dict[str, Any] = {"error": message}
    if details:
        payload["details"] = details
    return payload


def _scope_violation(payload: dict, scene_id: int) -> dict[str, Any] | None:
    """Return an error when *scene_id* is outside the session's scene scope."""
    scoped_raw = payload.get(EDITING_SCENE_SCOPE_KEY)
    if scoped_raw is None:
        return None
    try:
        scoped_id = int(scoped_raw)
    except (TypeError, ValueError):
        return None
    if scoped_id == scene_id:
        return None
    return _error(
        "Scene out of scope",
        allowed_scene_id=scoped_id,
        requested_scene_id=scene_id,
        hint=(
            f"This editing session is limited to scene {scoped_id}. Edit that "
            "scene only; other scenes and chapter text are read-only."
        ),
    )


def load_scene_prose_target(
    project_dir: Path, scene_id: int
) -> SceneProseTarget | dict[str, Any]:
    """Resolve the prose span of *scene_id* or return a tool error payload."""
    scene = get_scene(project_dir, scene_id)
    if scene is None:
        return _error(
            f"Scene '{scene_id}' not found.",
            scene_id=scene_id,
        )
    if not scene_prose_is_linked(scene):
        return _error(
            f"Scene '{scene_id}' has no prose yet, so there is nothing to edit.",
            scene_id=scene_id,
            prose_linked=False,
        )

    link = scene.get("prose_link")
    content_path = _scene_content_path(
        project_dir, link if isinstance(link, dict) else {}
    )
    if content_path is None or not content_path.exists():
        return _error(
            f"Scene '{scene_id}' is linked to a prose file that no longer exists.",
            scene_id=scene_id,
        )

    content = content_path.read_text(encoding="utf-8")
    span = find_scene_marker_span(content, scene_id)
    if span is None:
        return _error(
            f"Scene '{scene_id}' has no scene markers in '{content_path.name}'.",
            scene_id=scene_id,
        )
    return SceneProseTarget(
        scene=scene,
        content_path=content_path,
        content=content,
        span=span,
    )


def _scope_label(link: dict[str, Any]) -> str:
    """Return a short human-readable label for a scene prose scope."""
    scope_type = str(link.get("scope_type") or "").strip()
    if scope_type == "chapter":
        chapter_id = link.get("chapter_id")
        book_id = link.get("book_id")
        if book_id:
            return f"chapter {chapter_id} of book {book_id}"
        return f"chapter {chapter_id}"
    return scope_type or "unknown"


# How many characters of neighbouring prose are shown to the editor.  A scene
# is a slice of a larger document, so without this the model rewrites the slice
# as a standalone passage and duplicates the surrounding narrative.
NEIGHBOUR_CONTEXT_CHARS = 600


def _tail_snippet(text: str, limit: int = NEIGHBOUR_CONTEXT_CHARS) -> str:
    """Return the last *limit* characters of *text*, snapped near a word boundary."""
    cleaned = text.strip()
    if not cleaned:
        return "(none)"
    if len(cleaned) <= limit:
        return cleaned
    snippet = cleaned[-limit:]
    space = snippet.find(" ")
    if 0 <= space < 200:
        snippet = snippet[space + 1 :]
    return f"…{snippet.strip()}"


def _head_snippet(text: str, limit: int = NEIGHBOUR_CONTEXT_CHARS) -> str:
    """Return the first *limit* characters of *text*, snapped near a word boundary."""
    cleaned = text.strip()
    if not cleaned:
        return "(none)"
    if len(cleaned) <= limit:
        return cleaned
    snippet = cleaned[:limit]
    space = snippet.rfind(" ")
    if space > len(snippet) - 200:
        snippet = snippet[:space]
    return f"{snippet.strip()}…"


def neighbour_prose_context(target: SceneProseTarget) -> tuple[str, str]:
    """Return marker-free prose immediately before and after the scene span.

    The editor needs this to keep the rewritten scene aligned with the text
    that a neighbouring scene owns.  These snippets are reference-only and must
    never be edited or repeated inside the scene.
    """
    before = _tail_snippet(strip_internal_markers(target.content[: target.span.start]))
    after = _head_snippet(strip_internal_markers(target.content[target.span.end :]))
    return before, after


def scene_prose_payload(target: SceneProseTarget) -> dict[str, Any]:
    """Build the tool payload describing one scene and its prose."""
    scene = target.scene
    beats = [
        {"id": beat.get("id"), "text": beat.get("text")}
        for beat in scene.get("beats") or []
        if isinstance(beat, dict)
    ]
    visible = target.visible_prose
    text_before, text_after = neighbour_prose_context(target)
    return {
        "scene_id": scene.get("id"),
        "summary": scene.get("summary") or "",
        "beats": beats,
        "active_characters": list(scene.get("active_characters") or []),
        "passive_characters": list(scene.get("passive_characters") or []),
        "sourcebook_entry_ids": list(scene.get("sourcebook_entry_ids") or []),
        "location": scene.get("location"),
        "time": scene.get("time"),
        "prose_scope": _scope_label(target.link),
        "prose": visible,
        "char_count": len(visible),
        "text_before": text_before,
        "text_after": text_after,
        "context_note": (
            "text_before/text_after are the neighbouring scenes' prose. They are "
            "context only: never edit them and never repeat their events inside "
            "this scene."
        ),
    }


def scene_scope_prompt_fields(target: SceneProseTarget) -> dict[str, str]:
    """Build the instructions.json placeholders for a scene-scoped session."""
    scene = target.scene
    beats = [
        str(beat.get("text") or "").strip()
        for beat in scene.get("beats") or []
        if isinstance(beat, dict)
    ]
    scene_time = scene.get("time") or ""
    scene_time_value = scene.get("scene_time")
    if isinstance(scene_time_value, dict):
        scene_time = (
            str(scene_time_value.get("temporal_zoned_datetime") or "") or scene_time
        )
    text_before, text_after = neighbour_prose_context(target)
    return {
        "scene_id": str(scene.get("id")),
        "scene_scope": _scope_label(target.link),
        "scene_summary": str(scene.get("summary") or "(none)"),
        "scene_beats": "\n".join(f"- {text}" for text in beats if text) or "(none)",
        "scene_active_characters": ", ".join(
            str(item) for item in scene.get("active_characters") or []
        )
        or "(none)",
        "scene_passive_characters": ", ".join(
            str(item) for item in scene.get("passive_characters") or []
        )
        or "(none)",
        "scene_location": str(scene.get("location") or "(none)"),
        "scene_time": scene_time or "(none)",
        "scene_before": text_before,
        "scene_after": text_after,
        "scene_prose": target.visible_prose.strip() or "(empty)",
    }


def _persist_scene_prose(
    project_dir: Path,
    target: SceneProseTarget,
    new_text: str,
    mutations: dict,
) -> dict[str, Any]:
    """Persist *new_text* as the scene's prose through the canonical service."""
    scene_id = int(target.scene.get("id") or 0)
    updated = update_prose_content(
        project_dir,
        scene_id,
        SceneUpdateProseContentRequest(text=new_text),
    )
    if updated is None:
        return _error(
            f"Scene '{scene_id}' could not be updated: its prose markers are gone.",
            scene_id=scene_id,
        )
    mutations["story_changed"] = True
    return {
        "scene_id": scene_id,
        "written": True,
        "prose_scope": _scope_label(target.link),
        "chapter_id": target.link.get("chapter_id"),
        "book_id": target.link.get("book_id"),
        "previous_char_count": len(target.visible_prose),
        "char_count": len(strip_internal_markers(new_text)),
        "other_scenes_unchanged": True,
    }


class GetSceneProseParams(ToolModel):
    """Parameters for reading the prose of a single scene."""

    scene_id: int = Field(..., description="Numeric ID of the scene to read.")


@chat_tool(
    description=(
        "Read the prose of ONE scene plus its summary, beats, characters, "
        "location and time. Also returns text_before/text_after: the prose of "
        "the neighbouring scenes. They are reference only — never edit or "
        "repeat them. Use this before editing a scene."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="prose-read",
)
async def get_scene_prose(
    params: GetSceneProseParams, payload: dict, mutations: dict
) -> Any:
    """Return one scene's prose and metadata."""
    violation = _scope_violation(payload, params.scene_id)
    if violation is not None:
        return violation

    active = get_active_project_dir()
    if active is None:
        return _error("No active project")

    target = load_scene_prose_target(active, params.scene_id)
    if isinstance(target, dict):
        return target
    return scene_prose_payload(target)


class ReplaceSceneTextParams(ToolModel):
    """Parameters for replacing an exact passage inside one scene."""

    scene_id: int = Field(
        ..., description="Numeric ID of the scene whose prose is edited."
    )
    old_text: str = Field(
        ...,
        description=(
            "Exact literal passage that currently exists inside this scene's "
            "prose. Copy it verbatim from get_scene_prose."
        ),
    )
    new_text: str = Field(..., description="Text that replaces the matched passage.")


@chat_tool(
    description=(
        "Replace one exact literal passage inside a SINGLE scene's prose. This "
        "is the preferred way to refine, correct or rewrite part of a scene "
        "because it can never touch prose that belongs to another scene. "
        "old_text must appear exactly once inside the scene; use get_scene_prose "
        "to read the current text first. Change only what the task requires: do "
        "not restate or duplicate events that already appear in the text "
        "before or after the scene."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
)
async def replace_text_in_scene(
    params: ReplaceSceneTextParams, payload: dict, mutations: dict
) -> Any:
    """Replace one passage inside a scene and persist it safely."""
    violation = _scope_violation(payload, params.scene_id)
    if violation is not None:
        return violation

    active = get_active_project_dir()
    if active is None:
        return _error("No active project")

    target = load_scene_prose_target(active, params.scene_id)
    if isinstance(target, dict):
        return target

    if not params.old_text:
        return _error(
            "old_text must not be empty.",
            scene_id=params.scene_id,
        )

    visible = target.visible_prose
    occurrences = visible.count(params.old_text)
    if occurrences == 0:
        return _error(
            f"old_text was not found inside the prose of scene {params.scene_id}.",
            scene_id=params.scene_id,
            hint=(
                "Copy the passage verbatim from get_scene_prose; the scene's "
                "prose is the only editable text in this session."
            ),
        )
    if occurrences > 1:
        return _error(
            f"old_text was found {occurrences} times inside scene "
            f"{params.scene_id}; include more surrounding text so exactly one "
            "passage matches.",
            scene_id=params.scene_id,
        )

    visible_start = visible.find(params.old_text)
    visible_end = visible_start + len(params.old_text)
    raw_prose = target.raw_prose
    offsets = visible_offset_map(raw_prose)
    raw_start = offsets[visible_start]
    raw_end = offsets[visible_end]

    overlapping = [
        (marker_start, marker_end)
        for marker_start, marker_end in internal_marker_spans(raw_prose)
        if marker_start < raw_end and marker_end > raw_start
    ]
    if overlapping:
        return _error(
            "The target passage contains an internal scene/annotation marker, "
            "so replacing it would corrupt the marker structure.",
            scene_id=params.scene_id,
            hint=(
                "Pick a passage that does not include an annotation boundary, "
                "or rewrite the whole scene with write_scene_prose."
            ),
        )

    new_raw_prose = raw_prose[:raw_start] + params.new_text + raw_prose[raw_end:]
    return _persist_scene_prose(active, target, new_raw_prose, mutations)


class WriteSceneProseParams(ToolModel):
    """Parameters for rewriting the complete prose of one scene."""

    scene_id: int = Field(
        ..., description="Numeric ID of the scene whose prose is replaced."
    )
    text: str = Field(
        ...,
        description=(
            "The complete new prose for this scene. Everything currently "
            "inside the scene is replaced; prose outside the scene is untouched."
        ),
    )


@chat_tool(
    description=(
        "Replace the COMPLETE prose of a single scene. Prose owned by other "
        "scenes, chapter text outside the scene, and all metadata are left "
        "untouched. Prefer replace_text_in_scene for targeted edits; use this "
        "only when the whole scene must be rewritten. The new prose must stay "
        "aligned with text_before/text_after: never repeat or summarise events "
        "that already belong to the neighbouring scenes."
    ),
    allowed_roles=(EDITING_ROLE,),
    capability="prose-write",
)
async def write_scene_prose(
    params: WriteSceneProseParams, payload: dict, mutations: dict
) -> Any:
    """Replace the whole prose of one scene and persist it safely."""
    violation = _scope_violation(payload, params.scene_id)
    if violation is not None:
        return violation

    active = get_active_project_dir()
    if active is None:
        return _error("No active project")

    target = load_scene_prose_target(active, params.scene_id)
    if isinstance(target, dict):
        return target

    if internal_marker_spans(target.raw_prose):
        return _error(
            "This scene's prose contains inline annotation markers, so a "
            "whole-scene rewrite would delete those annotations.",
            scene_id=params.scene_id,
            hint=(
                "Use replace_text_in_scene for targeted edits instead, or ask "
                "the user to remove the annotations first."
            ),
        )

    return _persist_scene_prose(active, target, params.text, mutations)

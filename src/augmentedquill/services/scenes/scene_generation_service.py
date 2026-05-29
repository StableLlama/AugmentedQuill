# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Scene generation service for scene writing and marker-based boundary linking."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from augmentedquill.core.config import BASE_DIR, load_story_config
from augmentedquill.core.prompts import get_system_message, get_user_prompt
from augmentedquill.models.scene import (
    SceneBoundaryAssignment,
    SceneDetectBoundariesRequest,
    SceneLinkProseRequest,
    SceneUpdateProseContentRequest,
    SceneWriteRequest,
)
from augmentedquill.services.chat.chat_tool_decorator import WRITING_ROLE
from augmentedquill.services.llm import llm
from augmentedquill.services.scenes.scene_service import (
    _scene_content_path,
    _write_text_atomic,
    get_scene,
    link_prose,
    list_scenes,
    relink_scope_prose,
    update_prose_content,
)
from augmentedquill.services.scenes.scene_markers import remove_markers
from augmentedquill.services.story.story_api_prompt_ops import resolve_model_runtime
from augmentedquill.services.story.story_generation_common import (
    gather_writing_context,
    get_scene_context_for_scope,
    get_scene_context_for_target,
    sanitize_prompt,
)


def _safe_int(raw: object) -> int | None:
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().isdigit():
        return int(raw.strip())
    return None


def _resolve_scope(
    *,
    scene: dict[str, Any],
    request: SceneWriteRequest,
    story: dict[str, Any],
) -> tuple[str, str | None, str | None]:
    link = scene.get("prose_link") if isinstance(scene.get("prose_link"), dict) else {}

    scope_type = request.scope_type or link.get("scope_type")
    chapter_id = request.chapter_id or link.get("chapter_id")
    book_id = request.book_id or link.get("book_id")

    if scope_type not in {"story", "chapter", "unlinked"}:
        project_type = str(story.get("project_type") or "").strip().lower()
        scope_type = "story" if project_type == "short-story" else "chapter"

    if scope_type == "chapter" and not chapter_id:
        chapters = story.get("chapters")
        if isinstance(chapters, list) and chapters:
            chapter_id = "1"

    return scope_type, chapter_id, book_id


def _read_scope_text(project_dir: Path, scope_link: dict[str, Any]) -> tuple[Path, str]:
    content_path = _scene_content_path(project_dir, scope_link)
    if content_path is None:
        raise ValueError("Cannot resolve prose scope path")
    text = content_path.read_text(encoding="utf-8") if content_path.exists() else ""
    return content_path, text


def _extract_scene_ids(scene_list: list[dict[str, Any]]) -> list[int]:
    result: list[int] = []
    for scene in scene_list:
        scene_id = _safe_int(scene.get("id"))
        if scene_id is None:
            continue
        if scene_id not in result:
            result.append(scene_id)
    return result


def _has_persisted_runtime_link(project_dir: Path, scene_id: int) -> bool:
    """Return whether *scene_id* currently has a non-unlinked prose marker span."""
    scene = get_scene(project_dir, scene_id)
    if not isinstance(scene, dict):
        return False
    link = scene.get("prose_link")
    if not isinstance(link, dict):
        return False
    scope_type = str(link.get("scope_type") or "").strip().lower()
    return scope_type not in {"", "unlinked"}


def _is_same_write_scope(
    link: dict[str, Any] | None,
    *,
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
) -> bool:
    if not isinstance(link, dict):
        return False

    link_scope_type = str(link.get("scope_type") or "").strip()
    if link_scope_type != scope_type:
        return False

    if scope_type != "chapter":
        return True

    link_chapter_id = str(link.get("chapter_id") or "").strip() or None
    request_chapter_id = str(chapter_id or "").strip() or None
    link_book_id = str(link.get("book_id") or "").strip() or None
    request_book_id = str(book_id or "").strip() or None
    return link_chapter_id == request_chapter_id and link_book_id == request_book_id


def _list_other_scenes_in_scope(
    project_dir: Path,
    *,
    scene_id: int,
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
) -> list[dict[str, Any]]:
    scoped_scenes: list[dict[str, Any]] = []
    for candidate in list_scenes(project_dir):
        candidate_id = _safe_int(candidate.get("id"))
        if candidate_id is None or candidate_id == scene_id:
            continue
        if _is_same_write_scope(
            (
                candidate.get("prose_link")
                if isinstance(candidate.get("prose_link"), dict)
                else None
            ),
            scope_type=scope_type,
            chapter_id=chapter_id,
            book_id=book_id,
        ):
            scoped_scenes.append(candidate)
    return scoped_scenes


def _paragraph_ranges(segment_text: str, absolute_start: int) -> list[tuple[int, int]]:
    """Split text into paragraph ranges in absolute offsets."""
    ranges: list[tuple[int, int]] = []
    cursor = 0
    for paragraph in segment_text.split("\n\n"):
        start = segment_text.find(paragraph, cursor)
        if start < 0:
            continue
        end = start + len(paragraph)
        if end > start:
            ranges.append((absolute_start + start, absolute_start + end))
        cursor = end
    return ranges


def _find_nearest_word_break(text: str, target: int, minimum: int, maximum: int) -> int:
    """Find a nearby word break index in [minimum, maximum]."""
    if not text:
        return minimum
    clamped_target = max(minimum, min(target, maximum))
    if clamped_target <= minimum:
        return minimum
    if clamped_target >= maximum:
        return maximum

    for radius in range(0, max(1, len(text))):
        left = clamped_target - radius
        right = clamped_target + radius
        if left > minimum and left < maximum and text[left].isspace():
            return left
        if right > minimum and right < maximum and text[right].isspace():
            return right
        if left <= minimum and right >= maximum:
            break

    return clamped_target


def _proportional_ranges(
    scene_ids: list[int],
    segment_start: int,
    segment_end: int,
    prose_text: str,
) -> list[SceneBoundaryAssignment]:
    """Build contiguous scene ranges by proportional split on word breaks."""
    total = max(0, segment_end - segment_start)
    if total <= 0 or not scene_ids:
        return []

    n = len(scene_ids)
    boundaries: list[int] = [segment_start]
    for i in range(1, n):
        raw_target = int(round((total * i) / n))
        global_target = segment_start + raw_target
        minimum = boundaries[-1] + 1
        maximum = segment_end - (n - i)
        if minimum >= maximum:
            boundary = minimum
        else:
            local_target = global_target - segment_start
            local_min = minimum - segment_start
            local_max = maximum - segment_start
            local_break = _find_nearest_word_break(
                prose_text,
                local_target,
                local_min,
                local_max,
            )
            boundary = segment_start + local_break
        boundaries.append(max(minimum, min(boundary, maximum)))
    boundaries.append(segment_end)

    assignments: list[SceneBoundaryAssignment] = []
    for i, scene_id in enumerate(scene_ids):
        start = boundaries[i]
        end = boundaries[i + 1]
        if end <= start:
            continue
        assignments.append(
            SceneBoundaryAssignment(
                scene_id=scene_id,
                start_offset=start,
                end_offset=end,
            )
        )
    return assignments


def _build_assignments(
    scene_ids: list[int],
    segment_start: int,
    segment_end: int,
    prose_text: str,
) -> list[SceneBoundaryAssignment]:
    """Deterministically map contiguous text ranges to scene IDs.

    Heuristic:
    - one scene -> full segment
    - multiple scenes -> distribute paragraph chunks in order
    """
    if not scene_ids or segment_end <= segment_start:
        return []
    if len(scene_ids) == 1:
        return [
            SceneBoundaryAssignment(
                scene_id=scene_ids[0],
                start_offset=segment_start,
                end_offset=segment_end,
            )
        ]

    paragraph_ranges = _paragraph_ranges(prose_text, segment_start)
    if not paragraph_ranges:
        return []

    if len(paragraph_ranges) < len(scene_ids):
        return _proportional_ranges(scene_ids, segment_start, segment_end, prose_text)

    chunk_size = max(1, len(paragraph_ranges) // len(scene_ids))
    assignments: list[SceneBoundaryAssignment] = []
    pindex = 0
    for sindex, scene_id in enumerate(scene_ids):
        start = paragraph_ranges[pindex][0]
        if sindex == len(scene_ids) - 1:
            end = paragraph_ranges[-1][1]
            pindex = len(paragraph_ranges)
        else:
            next_index = min(len(paragraph_ranges) - 1, pindex + chunk_size - 1)
            end = paragraph_ranges[next_index][1]
            pindex = next_index + 1
        if end > start:
            assignments.append(
                SceneBoundaryAssignment(
                    scene_id=scene_id,
                    start_offset=start,
                    end_offset=end,
                )
            )
        if pindex >= len(paragraph_ranges):
            break
    return assignments


async def detect_scene_boundaries_and_link(
    *,
    project_dir: Path,
    request: SceneDetectBoundariesRequest,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Detect scene boundaries in a prose segment and link scenes to ranges."""
    _ = payload or {}

    scope_link = {
        "scope_type": request.scope_type,
        "chapter_id": request.chapter_id,
        "book_id": request.book_id,
    }
    _, scope_text = _read_scope_text(project_dir, scope_link)

    segment_start = max(0, int(request.start_offset))
    if request.prose_text is not None:
        prose_text = request.prose_text
        segment_end = segment_start + len(prose_text)
    else:
        requested_end = (
            request.end_offset if request.end_offset is not None else len(scope_text)
        )
        segment_end = max(segment_start, min(len(scope_text), requested_end))
        prose_text = scope_text[segment_start:segment_end]

    if not prose_text:
        return {"assignments": [], "scenes": []}

    scene_ids = [int(scene_id) for scene_id in request.scene_ids if int(scene_id) > 0]
    assignments = _build_assignments(scene_ids, segment_start, segment_end, prose_text)

    modified: list[dict[str, Any]] = []
    seen_scene_ids: set[int] = set()
    # Apply from highest start_offset to lowest so marker insertion in one range
    # does not shift coordinates for yet-to-be-applied earlier ranges.
    for assignment in sorted(assignments, key=lambda a: a.start_offset, reverse=True):
        link_updates = link_prose(
            project_dir,
            assignment.scene_id,
            SceneLinkProseRequest(
                scope_type=request.scope_type,
                chapter_id=request.chapter_id,
                book_id=request.book_id,
                start_offset=assignment.start_offset,
                end_offset=assignment.end_offset,
            ),
        )
        for scene in link_updates:
            scene_id = _safe_int(scene.get("id"))
            if scene_id is None:
                continue
            if scene_id in seen_scene_ids:
                for index, existing in enumerate(modified):
                    if _safe_int(existing.get("id")) == scene_id:
                        modified[index] = scene
                        break
            else:
                modified.append(scene)
                seen_scene_ids.add(scene_id)

    return {"assignments": assignments, "scenes": modified}


async def write_scene_and_link(
    *,
    project_dir: Path,
    scene_id: int,
    request: SceneWriteRequest,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate prose for one scene and link generated text via markers."""
    payload = payload or {}
    scene = get_scene(project_dir, scene_id)
    if scene is None:
        raise LookupError(f"Scene '{scene_id}' not found")

    story = load_story_config(project_dir / "story.json") or {}
    scope_type, chapter_id, book_id = _resolve_scope(
        scene=scene, request=request, story=story
    )

    scope_link = {
        "scope_type": scope_type,
        "chapter_id": chapter_id,
        "book_id": book_id,
    }
    content_path, existing_text = _read_scope_text(project_dir, scope_link)

    chapter_index = _safe_int(chapter_id)
    title = str(story.get("project_title") or "").strip()
    summary = str(story.get("story_summary") or "").strip()
    chapters = story.get("chapters") if isinstance(story.get("chapters"), list) else []

    scoped_context = get_scene_context_for_target(
        story=story,
        scope=scope_type,
        chap_id=chapter_index,
        target_scene_id=scene_id,
        include_following_scenes=max(0, request.include_following_scenes),
    )

    checked_sourcebook_ids = scoped_context.get("sourcebook_ids") or []
    context_payload = dict(payload)
    context_payload["checked_sourcebook"] = checked_sourcebook_ids
    chapter_pos: int | None = None
    if chapter_index and chapter_index > 0 and isinstance(chapters, list):
        candidate_pos = chapter_index - 1
        if 0 <= candidate_pos < len(chapters):
            chapter_pos = candidate_pos
    context = gather_writing_context(
        story, chapters, chapter_pos, title, summary, context_payload
    )

    language = str(story.get("language") or "en").strip().lower() or "en"
    model_overrides = (
        story.get("llm_prefs", {}).get("prompt_overrides")
        if isinstance(story.get("llm_prefs"), dict)
        else {}
    )

    selected_scenes = scoped_context.get("scenes") or []

    chapter_title = title
    chapter_summary = ""
    if scope_type == "chapter" and chapter_index and isinstance(chapters, list):
        index = chapter_index - 1
        if 0 <= index < len(chapters) and isinstance(chapters[index], dict):
            chapter_title = str(chapters[index].get("title") or chapter_title)
            chapter_summary = str(chapters[index].get("summary") or "").strip()

    (
        base_url,
        api_key,
        model_id,
        timeout_s,
        model_name,
        resolved_model_overrides,
        _,
    ) = resolve_model_runtime(payload, WRITING_ROLE, BASE_DIR)
    if not model_overrides:
        model_overrides = resolved_model_overrides

    system_msg = get_system_message("story_writer", model_overrides, language=language)
    existing_tail_text = remove_markers(existing_text)
    story_notes = context.get("story_notes") or ""
    story_notes_section = f"## Story notes\n{story_notes}" if story_notes else ""

    background = context["background"] or ""
    background_section = f"## Background\n{background}" if background else ""

    chapter_notes = context.get("chapter_notes") or ""
    chapter_notes_section = f"## Draft notes\n{chapter_notes}" if chapter_notes else ""

    scene_guidance = scoped_context.get("scene_block") or ""
    scene_guidance_section = (
        f"# Scene guidance\n\n{scene_guidance}" if scene_guidance else ""
    )

    existing_tail = existing_tail_text[-2000:] if existing_tail_text else ""
    existing_tail_section = (
        f"## Recent prose tail (style continuity only, do not repeat):\n{existing_tail}"
        if existing_tail
        else ""
    )

    user_msg = get_user_prompt(
        "write_scene_prose",
        language=language,
        story_title=title,
        story_summary=summary,
        story_notes_section=story_notes_section,
        story_tags=context.get("story_tags") or "(none)",
        background_section=background_section,
        chapter_title=chapter_title,
        chapter_summary=chapter_summary,
        chapter_notes_section=chapter_notes_section,
        scene_guidance_section=scene_guidance_section,
        existing_tail_section=existing_tail_section,
    )
    user_msg = sanitize_prompt(user_msg)

    response = await llm.unified_chat_complete(
        caller_id="scene_generation.write_scene_and_link",
        model_type=WRITING_ROLE,
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
    )
    generated_text = str(response.get("content") or "").strip()

    existing_link = (
        scene.get("prose_link") if isinstance(scene.get("prose_link"), dict) else None
    )
    assignments: list[SceneBoundaryAssignment] = []
    updated_scenes: list[dict[str, Any]] = []

    if existing_link:
        updated_scene = update_prose_content(
            project_dir,
            scene_id,
            SceneUpdateProseContentRequest(text=generated_text),
        )
        if updated_scene is None:
            raise LookupError(f"Scene '{scene_id}' not found")
        updated_scenes = [
            updated_scene,
            *_list_other_scenes_in_scope(
                project_dir,
                scene_id=scene_id,
                scope_type=scope_type,
                chapter_id=chapter_id,
                book_id=book_id,
            ),
        ]
        link = updated_scene.get("prose_link") or {}
        start_offset = int(link.get("start_offset") or 0)
        end_offset = int(link.get("end_offset") or start_offset)
        assignments = [
            SceneBoundaryAssignment(
                scene_id=scene_id,
                start_offset=start_offset,
                end_offset=end_offset,
            )
        ]
    else:
        separator = "\n" if existing_text and not existing_text.endswith("\n") else ""
        insertion_start = len(existing_text) + len(separator)
        new_content = f"{existing_text}{separator}{generated_text}"
        _write_text_atomic(content_path, new_content)

        scene_ids = [scene_id]
        for candidate_scene_id in _extract_scene_ids(selected_scenes):
            if candidate_scene_id == scene_id:
                continue
            # Do not relink already-linked neighbour scenes when writing one
            # scene; otherwise marker ownership can shift and corrupt chapter
            # marker layout.
            if _has_persisted_runtime_link(project_dir, candidate_scene_id):
                continue
            scene_ids.append(candidate_scene_id)

        if request.detect_boundaries:
            detect_result = await detect_scene_boundaries_and_link(
                project_dir=project_dir,
                request=SceneDetectBoundariesRequest(
                    scope_type=scope_type,
                    chapter_id=chapter_id,
                    book_id=book_id,
                    scene_ids=scene_ids,
                    start_offset=insertion_start,
                    end_offset=insertion_start + len(generated_text),
                    prose_text=generated_text,
                ),
                payload=payload,
            )
            assignments = detect_result["assignments"]
            updated_scenes = detect_result["scenes"]
        else:
            fallback_updates = link_prose(
                project_dir,
                scene_id,
                SceneLinkProseRequest(
                    scope_type=scope_type,
                    chapter_id=chapter_id,
                    book_id=book_id,
                    start_offset=insertion_start,
                    end_offset=insertion_start + len(generated_text),
                ),
            )
            updated_scenes = fallback_updates
            assignments = [
                SceneBoundaryAssignment(
                    scene_id=scene_id,
                    start_offset=insertion_start,
                    end_offset=insertion_start + len(generated_text),
                )
            ]

    latest_scene = get_scene(project_dir, scene_id)
    if latest_scene is None:
        raise LookupError(f"Scene '{scene_id}' not found")

    return {
        "scene": latest_scene,
        "generated_text": generated_text,
        "assignments": assignments,
        "scenes": updated_scenes,
    }


async def auto_link_chapter_generation(
    *,
    project_dir: Path,
    chap_id: int,
    start_offset: int,
    end_offset: int,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Auto-link a generated chapter segment to relevant scenes in that chapter."""
    story = load_story_config(project_dir / "story.json") or {}
    context = get_scene_context_for_target(
        story=story,
        scope="chapter",
        chap_id=chap_id,
        target_scene_id=0,
        include_following_scenes=999,
    )
    chapter_scene_ids: list[int] = []
    for scene in context.get("scenes") or []:
        scene_id = _safe_int(scene.get("id"))
        if scene_id is not None:
            chapter_scene_ids.append(scene_id)

    if not chapter_scene_ids or end_offset <= start_offset:
        return {"assignments": [], "scenes": []}

    return await detect_scene_boundaries_and_link(
        project_dir=project_dir,
        request=SceneDetectBoundariesRequest(
            scope_type="chapter",
            chapter_id=str(chap_id),
            scene_ids=chapter_scene_ids,
            start_offset=start_offset,
            end_offset=end_offset,
        ),
        payload=payload,
    )


async def auto_link_scope_text(
    *,
    project_dir: Path,
    scope_type: str,
    chapter_id: str | None,
    book_id: str | None,
    current_text: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Auto-link a saved prose scope to all scene boundaries in that scope."""
    story = load_story_config(project_dir / "story.json") or {}
    chapter_numeric = _safe_int(chapter_id)
    scene_context = get_scene_context_for_scope(
        story=story,
        scope=scope_type,
        chap_id=chapter_numeric,
        current_text=current_text,
        include_all_scenes=True,
    )
    scene_ids: list[int] = []
    for scene in scene_context.get("scenes") or []:
        scene_id = _safe_int(scene.get("id"))
        if scene_id is not None and scene_id not in scene_ids:
            scene_ids.append(scene_id)

    if not scene_ids:
        return {"assignments": [], "scenes": []}

    # Build assignments against the persisted scope text, not caller-provided
    # current_text. The write path may normalize typography, which can shift
    # offsets relative to in-memory text.
    content_path, saved_text = _read_scope_text(
        project_dir,
        {
            "scope_type": scope_type,
            "chapter_id": chapter_id,
            "book_id": book_id,
        },
    )
    _ = content_path
    saved_plain = remove_markers(saved_text)
    assignments = _build_assignments(scene_ids, 0, len(saved_plain), saved_plain)
    modified = relink_scope_prose(
        project_dir,
        scope_type,
        chapter_id,
        book_id,
        [
            (assignment.scene_id, assignment.start_offset, assignment.end_offset)
            for assignment in assignments
        ],
    )
    return {"assignments": assignments, "scenes": modified}

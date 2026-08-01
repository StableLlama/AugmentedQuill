# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the generation streaming unit so this responsibility stays isolated, testable, and easy to evolve."""

import asyncio
import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from augmentedquill.api.v1.dependencies import ProjectDep
from augmentedquill.api.v1.story_routes.common import parse_json_body
from augmentedquill.core.config import BASE_DIR, save_story_config
from augmentedquill.core.prompts import get_system_message, get_user_prompt
from augmentedquill.services.chat.chat_tool_decorator import WRITING_ROLE
from augmentedquill.services.exceptions import ServiceError
from augmentedquill.services.llm import llm
from augmentedquill.services.projects.projects import read_story_content
from augmentedquill.services.scenes.scene_generation_service import (
    auto_link_scope_text,
)
from augmentedquill.services.story.story_api_prompt_ops import (
    resolve_model_runtime,
)
from augmentedquill.services.story.story_api_state_ops import (
    ensure_chapter_slot,
    get_active_story_or_raise,
    get_chapter_locator,
    get_normalized_chapters,
    read_text_or_raise,
)
from augmentedquill.services.story.story_api_stream_ops import (
    stream_collect_and_persist,
    stream_unified_chat_content,
)
from augmentedquill.services.story.story_generation_common import (
    _restore_summary_for_rewrite,
    gather_writing_context,
    get_scene_context_for_scope,
    prepare_ai_action_generation,
    prepare_chapter_summary_generation,
    prepare_continue_chapter_generation,
    prepare_story_summary_generation,
    prepare_write_chapter_generation,
    sanitize_prompt,
)

router = APIRouter(prefix="/projects/{project_name}", tags=["Story"])

SUGGEST_STREAM_IDLE_TIMEOUT_S = 2.5
SUGGEST_MAX_TOKENS = 500
SUGGESTION_MODE_GUIDED = "guided"
SUGGESTION_MODE_INSTRUCTED = "instructed"
SUGGESTION_MODE_ORIGINAL_ALIAS = "original"
SUGGESTION_MODE_PURE = "pure"


def _coerce_suggestion_mode(value: Any) -> str:
    """Return a supported suggestion mode with a safe guided fallback."""
    if not isinstance(value, str):
        return SUGGESTION_MODE_GUIDED
    mode = value.strip().lower()
    if mode in {
        SUGGESTION_MODE_GUIDED,
        SUGGESTION_MODE_INSTRUCTED,
        SUGGESTION_MODE_PURE,
    }:
        return mode
    if mode == SUGGESTION_MODE_ORIGINAL_ALIAS:
        return SUGGESTION_MODE_INSTRUCTED
    return SUGGESTION_MODE_GUIDED


def _tokenize_for_loop_guard(text: str) -> list[str]:
    """Return lowercase word tokens for lightweight repetition checks."""
    if not isinstance(text, str) or not text:
        return []
    return [token.lower() for token in re.findall(r"\w+", text, flags=re.UNICODE)]


def _has_repeated_ngram_loop(
    text: str,
    *,
    ngram_size: int = 3,
    min_repeats: int = 3,
) -> bool:
    """Detect repeated n-gram loops in generated prose.

    A loop is considered present if either:
    1) The same n-gram appears ``min_repeats`` or more times and at least one
       repeated occurrence happens in the final third of the text.
    2) The same n-gram is repeated contiguously 3 times.
    """
    tokens = _tokenize_for_loop_guard(text)
    if ngram_size < 2 or len(tokens) < ngram_size * 2:
        return False

    total_ngrams = len(tokens) - ngram_size + 1
    if total_ngrams <= 1:
        return False

    tail_threshold = max(0, (total_ngrams * 2) // 3)
    seen_counts: dict[tuple[str, ...], int] = {}
    seen_in_tail: dict[tuple[str, ...], bool] = {}

    for idx in range(total_ngrams):
        gram = tuple(tokens[idx : idx + ngram_size])
        seen_counts[gram] = seen_counts.get(gram, 0) + 1
        if idx >= tail_threshold:
            seen_in_tail[gram] = True

    for gram, count in seen_counts.items():
        if count >= min_repeats and seen_in_tail.get(gram, False):
            return True

    contiguous_window = ngram_size * 3
    for idx in range(len(tokens) - contiguous_window + 1):
        a = tuple(tokens[idx : idx + ngram_size])
        b = tuple(tokens[idx + ngram_size : idx + (2 * ngram_size)])
        c = tuple(tokens[idx + (2 * ngram_size) : idx + (3 * ngram_size)])
        if a == b == c:
            return True

    return False


def _coerce_loop_guard_int(
    value: Any,
    *,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    """Parse bounded integer payload values with safe fallback defaults."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def _build_loop_guard_retry_extra(attempt_index: int) -> dict[str, Any]:
    """Build conservative retry overrides to reduce repetition loops."""
    if attempt_index <= 0:
        return {}
    return {
        "presence_penalty": min(0.8, 0.3 + (0.1 * (attempt_index - 1))),
        "frequency_penalty": min(0.6, 0.15 + (0.1 * (attempt_index - 1))),
    }


def _find_loop_start(
    text: str,
    *,
    ngram_size: int = 3,
    min_repeats: int = 3,
) -> int:
    """Return the character offset where a repetition loop begins.

    Uses binary search: finds the latest position at which the prefix is
    still loop-free, then returns that offset.  Returns ``len(text)`` when
    no loop is detected.
    """
    if not _has_repeated_ngram_loop(
        text, ngram_size=ngram_size, min_repeats=min_repeats
    ):
        return len(text)

    lo, hi = 0, len(text)
    while hi - lo > 10:
        mid = (lo + hi) // 2
        if _has_repeated_ngram_loop(
            text[:mid], ngram_size=ngram_size, min_repeats=min_repeats
        ):
            hi = mid
        else:
            lo = mid
    return lo


def _truncate_at_loop(
    text: str,
    *,
    ngram_size: int = 3,
    min_repeats: int = 3,
) -> str:
    """Return *text* with any trailing repetition loop removed.

    Locates the approximate start of the loop, then trims to the nearest
    preceding sentence-ending punctuation so the result reads as a complete
    thought.  Returns the original text unchanged when no loop is present.
    """
    if not isinstance(text, str) or not text:
        return text

    loop_start = _find_loop_start(text, ngram_size=ngram_size, min_repeats=min_repeats)
    if loop_start >= len(text):
        return text

    clean_prefix = text[:loop_start]
    # Trim to last sentence-ending punctuation so it reads naturally.
    match = re.search(r'[.!?…]["\'"\')\]]*\s*$', clean_prefix.rstrip())
    if match:
        return clean_prefix[: match.end()].rstrip() + "\n"
    # No sentence boundary found — return whatever clean prefix exists.
    stripped = clean_prefix.rstrip()
    return stripped + "\n" if stripped else text


def _normalize_current_text_for_llm(text: str) -> str:
    """Normalise trailing newlines in the prose context sent to the LLM.

    The rules ensure the model receives a clean signal about where the author
    left off:

    * A single trailing ``\n`` is noise (auto-added by editors) and is stripped
      so the model does not mistakenly treat it as a paragraph break.
    * Two or more trailing ``\n`` represent an intentional paragraph separator;
      they are preserved as exactly ``\n\n``.
    """
    if not isinstance(text, str):
        return text
    rstripped = text.rstrip("\n")
    trailing_nl = len(text) - len(rstripped)
    if trailing_nl == 0:
        return text
    if trailing_nl == 1:
        return rstripped  # single trailing \n is noise — remove it
    return rstripped + "\n\n"  # 2+ trailing \n — normalise to exactly \n\n


def _is_low_quality_suggestion(text: str) -> bool:
    """Heuristic guard for obvious gibberish in a suggestion candidate."""
    if not isinstance(text, str):
        return True
    sample = text.strip()
    # Suggest-next-paragraph should never be a single short token/phrase.
    if len(sample) < 40:
        return True

    if re.search(r"(.)\1{5,}", sample):
        return True

    words = re.findall(r"\w+", sample, flags=re.UNICODE)
    if not words:
        return True

    if max((len(word) for word in words), default=0) >= 36:
        return True

    if len(words) >= 6:
        avg_word_len = sum(len(word) for word in words) / len(words)
        if avg_word_len > 14:
            return True

    allowed_symbol_chars = set(" .,;:!?'-\n\t\"()[]{}")
    letters_digits = sum(ch.isalnum() for ch in sample)
    allowed_symbols = sum(ch in allowed_symbol_chars for ch in sample)
    total = len(sample)
    if total > 0:
        noisy_ratio = 1.0 - ((letters_digits + allowed_symbols) / total)
        if noisy_ratio > 0.18:
            return True

    # If the paragraph is long enough but has no sentence-like ending,
    # treat it as likely truncated/poor quality and retry.
    return bool(len(sample) >= 80 and not re.search(r"[.!?…][\"'”’\)\]]*\s*$", sample))


def _normalize_suggestion_candidate(raw_text: str) -> str:
    """Normalize streamed suggestion text to one clean paragraph."""
    if not isinstance(raw_text, str):
        return ""

    text = raw_text.lstrip(" \t")
    if not text:
        return ""

    paragraph_break = re.search(r"\n\s*\n", text)
    if paragraph_break:
        text = text[: paragraph_break.start()]

    text = text.rstrip()
    if not text:
        return ""

    return text + "\n"


async def _collect_suggestion_candidate(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None,
    extra_body: dict[str, Any] | None = None,
) -> str:
    """Collect a single suggestion candidate from streamed chunks."""
    start_found = False
    out_chunks: list[str] = []

    stream_iter = llm.openai_completions_stream(
        caller_id="api.story.suggest",
        prompt=prompt,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        max_tokens=SUGGEST_MAX_TOKENS,
        extra_body=extra_body,
    ).__aiter__()

    while True:
        try:
            chunk = await asyncio.wait_for(
                stream_iter.__anext__(),
                timeout=SUGGEST_STREAM_IDLE_TIMEOUT_S,
            )
        except StopAsyncIteration:
            break
        except TimeoutError:
            # Some providers can emit one token and then keep the stream open.
            # Finalize what we have instead of leaving the suggestion request hanging.
            break

        if not chunk:
            continue

        # Remove formatting-only indentation at stream start.
        if not start_found:
            while chunk.startswith((" ", "\t")):
                chunk = chunk[1:]
            if chunk == "":
                continue

        # Preserve leading paragraph breaks until first prose token.
        while not start_found and chunk.startswith("\n"):
            newline_run = 0
            while newline_run < len(chunk) and chunk[newline_run] == "\n":
                newline_run += 1
            out_chunks.append(chunk[:newline_run])
            chunk = chunk[newline_run:]
            if chunk == "":
                break

        if chunk == "":
            continue

        start_found = True
        out_chunks.append(chunk)

        accumulated = "".join(out_chunks)
        # Stop once we have the first complete paragraph boundary.
        if re.search(r"\n\s*\n", accumulated):
            break

        # Fallback guardrails for models that never emit blank-line boundaries.
        # Prefer returning promptly once we likely have a complete sentence.
        if len(accumulated) >= 180 and re.search(
            r"[.!?…][\"'”’\)\]]*\s*$", accumulated.strip()
        ):
            break

        # Hard cap to avoid long waits when the model never emits a paragraph break.
        if len(accumulated) >= 420:
            break

    raw = _normalize_suggestion_candidate("".join(out_chunks))
    return _truncate_at_loop(raw) if raw else raw


async def _stream_suggestion_candidate(
    *,
    prompt: str,
    base_url: str,
    api_key: str | None,
    model_id: str,
    timeout_s: int,
    model_name: str | None,
    extra_body: dict[str, Any] | None = None,
) -> Any:
    """Yield suggestion chunks with start-trimming, stall safety, paragraph
    boundary detection, a hard token cap, and inline repetition-loop detection.

    A lookahead buffer of ``_STREAM_LOOKAHEAD`` characters is held back before
    being forwarded to the client.  When a repetition loop is detected in the
    accumulated text the buffer is flushed only up to the last clean sentence
    boundary, preventing garbled output from ever reaching the user without
    requiring a retry.
    """
    _STREAM_LOOKAHEAD = 10  # chars held back to allow loop detection before delivery

    start_found = False
    accumulated = ""
    yielded_chars = 0
    stream_iter = llm.openai_completions_stream(
        caller_id="api.story.suggest",
        prompt=prompt,
        base_url=base_url,
        api_key=api_key,
        model_id=model_id,
        timeout_s=timeout_s,
        model_name=model_name,
        max_tokens=SUGGEST_MAX_TOKENS,
        extra_body=extra_body,
    ).__aiter__()

    while True:
        try:
            chunk = await asyncio.wait_for(
                stream_iter.__anext__(),
                timeout=SUGGEST_STREAM_IDLE_TIMEOUT_S,
            )
        except StopAsyncIteration:
            break
        except TimeoutError:
            break

        if not chunk:
            continue

        if not start_found:
            chunk = chunk.lstrip(" \t")
            if chunk == "":
                continue

        # Pass leading newlines through to the client as a semantic signal:
        # \n  → hard line break within the same paragraph
        # \n\n → paragraph break
        # These are normalised away for display in the suggestion box but
        # are used by the accept logic to determine how to join the suggestion
        # to the existing prose. Accumulate them WITHOUT advancing yielded_chars
        # so the loop-detection offset remains correct.
        while not start_found and chunk.startswith("\n"):
            newline_run = 0
            while newline_run < len(chunk) and chunk[newline_run] == "\n":
                newline_run += 1
            to_yield = chunk[:newline_run]
            if to_yield:
                yield to_yield
            chunk = chunk[newline_run:]
            if chunk == "":
                break

        if chunk == "":
            continue

        start_found = True
        accumulated += chunk

        # Check for repetition loops once enough text has been collected.
        # The lookahead buffer guarantees we haven't forwarded the looping
        # section yet (unless the loop is anomalously short).
        if len(accumulated) >= 60 and _has_repeated_ngram_loop(accumulated):
            clean = _truncate_at_loop(accumulated)
            to_flush = clean[yielded_chars:]
            if to_flush:
                yield to_flush
            return

        # Flush the portion safely past the lookahead window.
        safe_up_to = max(yielded_chars, len(accumulated) - _STREAM_LOOKAHEAD)
        if safe_up_to > yielded_chars:
            yield accumulated[yielded_chars:safe_up_to]
            yielded_chars = safe_up_to

        # Stop streaming at the first complete paragraph boundary.
        if re.search(r"\n\s*\n", accumulated):
            break

        # Fallback: stop on a completed sentence once enough text is present.
        if len(accumulated) >= 180 and re.search(
            r"[.!?…][\"'”’\)\]]*\s*$", accumulated.strip()
        ):
            break

        # Hard character cap to guard against models that never emit paragraph breaks.
        if len(accumulated) >= 420:
            break

    # Stream ended cleanly — flush remaining buffered content with a final
    # loop check in case the loop only became apparent at the very end.
    if yielded_chars < len(accumulated):
        full_clean = _truncate_at_loop(accumulated)
        to_flush = full_clean[yielded_chars:]
        if not to_flush and not _has_repeated_ngram_loop(accumulated):
            to_flush = accumulated[yielded_chars:]
        if to_flush:
            # Normalise: ensure the suggestion ends with exactly one newline.
            if not to_flush.endswith("\n"):
                to_flush = to_flush.rstrip() + "\n"
            yield to_flush
    elif accumulated and not accumulated.endswith("\n"):
        # All accumulated content was already flushed inline but without a
        # trailing newline; append one now so callers get a consistent terminator.
        yield "\n"


async def _with_parsed_payload(
    request: Request,
    handler: Any,
    *,
    internal_error_prefix: str,
    include_exception_text: bool = True,
    use_raw_exception_detail: bool = False,
) -> Any:
    """Parse JSON body and normalize ServiceError/500 handling."""
    try:
        payload = await parse_json_body(request)
        return await handler(payload)
    except ServiceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e
    except Exception as e:
        if use_raw_exception_detail:
            detail = str(e)
        else:
            detail = (
                f"{internal_error_prefix}: {e}"
                if include_exception_text
                else internal_error_prefix
            )
        raise HTTPException(status_code=500, detail=detail) from e


async def _create_gen_source_pure(prepared: dict) -> Any:
    """Create a generator source for streaming."""
    async for chunk_dict in stream_unified_chat_content(
        messages=prepared["messages"],
        response_prefill=prepared.get("response_prefill"),
        base_url=prepared["base_url"],
        api_key=prepared["api_key"],
        model_id=prepared["model_id"],
        timeout_s=prepared["timeout_s"],
        model_name=prepared.get("model_name"),
        model_type=prepared.get("model_type"),
        tools=prepared.get("tools"),
        extra_body=prepared.get("extra_body"),
        max_rounds=prepared.get("max_rounds") or 4,
    ):
        yield chunk_dict


async def _create_gen_source(prepared: dict) -> Any:
    """Create a generator source for streaming wrapped in SSE data events."""
    try:
        async for chunk_dict in _create_gen_source_pure(prepared):
            yield f"data: {json.dumps(chunk_dict)}\n\n"
    except ServiceError as e:
        # Re-raise service errors as they are handled by the global exception handler for REST,
        # but for streaming we might need to yield an error event.
        # Security: Mask internal error details to prevent information exposure.
        yield f"data: {json.dumps({'error': f'A service error occurred during generation: {e.detail}'})}\n\n"
    except Exception as e:
        # Include the underlying reason so users can troubleshoot provider issues.
        yield f"data: {json.dumps({'error': f'An internal error occurred during generation. {e}'})}\n\n"
    finally:
        try:
            _restore_summary_for_rewrite(prepared)
        except Exception:
            # Do not fail the stream cleanup because of restore errors.
            pass


def _as_streaming_response(
    gen_factory: Any, media_type: str = "text/event-stream"
) -> Any:
    """Helper for streaming response.."""
    return StreamingResponse(gen_factory(), media_type=media_type)


@router.post("/story/sourcebook/relevance")
async def api_story_sourcebook_relevance(
    request: Request, project_dir: ProjectDep
) -> Any:
    """Return scene-derived sourcebook entries relevant to the active prose end.

    This runs in the background while the user types, so it must stay
    deterministic, cheap, and free of LLM latency.
    """
    try:
        payload = await parse_json_body(request)
        _, _, story = get_active_story_or_raise(active=project_dir)
        scope = str(
            (payload or {}).get("scope")
            or ("story" if story.get("project_type") == "short-story" else "chapter")
        ).lower()

        if scope == "story":
            path = None
        else:
            chap_id = (payload or {}).get("chap_id")
            if not isinstance(chap_id, int):
                raise ServiceError("chap_id is required", status_code=400)

            _, path, _pos = get_chapter_locator(chap_id, active=project_dir)
        current_text = (payload or {}).get("current_text")
        scope_text: str | None = None
        if not isinstance(current_text, str):
            current_text = (
                read_story_content(active=project_dir)
                if scope == "story"
                else read_text_or_raise(path)
            )
            scope_text = current_text
        elif scope == "chapter" and path is not None:
            scope_text = read_text_or_raise(path)
        scene_context = get_scene_context_for_scope(
            story=story,
            scope=scope,
            chap_id=(payload or {}).get("chap_id") if scope == "chapter" else None,
            current_text=current_text,
            scope_text=scope_text,
            include_all_scenes=False,
        )
        return {"relevant": scene_context.get("sourcebook_ids", [])}
    except ServiceError as e:
        raise HTTPException(
            status_code=e.status_code,
            detail=e.detail,
        )
    except (OSError, TypeError, ValueError, RuntimeError) as e:
        raise HTTPException(
            status_code=500, detail=f"An internal story relevance error occurred: {e}"
        )


@router.post("/story/suggest")
async def api_story_suggest(
    request: Request, project_dir: ProjectDep
) -> StreamingResponse:
    """Api Story Suggest."""
    try:
        payload = await parse_json_body(request)
        _, _, story = get_active_story_or_raise(active=project_dir)
        scope = str(
            (payload or {}).get("scope")
            or ("story" if story.get("project_type") == "short-story" else "chapter")
        ).lower()

        if scope == "story":
            path = None
            pos = None
            current_text = (payload or {}).get("current_text")
            if not isinstance(current_text, str):
                current_text = read_story_content(active=project_dir)
            chapters_data = []
            summary = story.get("story_summary", "")
            title = story.get("project_title") or ""
        else:
            chap_id = (payload or {}).get("chap_id")
            if not isinstance(chap_id, int):
                raise ServiceError("chap_id is required", status_code=400)

            _, path, pos = get_chapter_locator(chap_id, active=project_dir)
            current_text = (payload or {}).get("current_text")
            if not isinstance(current_text, str):
                current_text = read_text_or_raise(path)

            chapters_data = get_normalized_chapters(story)
            ensure_chapter_slot(chapters_data, pos)
            summary = chapters_data[pos].get("summary", "")
            title = chapters_data[pos].get("title") or path.name

        (
            base_url,
            api_key,
            model_id,
            timeout_s,
            model_name,
            model_overrides,
            _model_type,
        ) = resolve_model_runtime(
            payload=payload,
            model_type=WRITING_ROLE,
            base_dir=BASE_DIR,
        )

        suggestion_mode = _coerce_suggestion_mode((payload or {}).get("mode"))
        instructed_messages: list[dict[str, str]] | None = None

        if suggestion_mode == SUGGESTION_MODE_PURE:
            # Pure mode intentionally sends only chapter text without added
            # instructions or metadata context.
            prompt = current_text or ""
        elif suggestion_mode == SUGGESTION_MODE_INSTRUCTED:
            # Instructed mode uses a standard chat instruction shape
            # (system + user) so providers return assistant-role content.
            context = gather_writing_context(
                story=story,
                chapters_data=chapters_data,
                pos=pos,
                title=title or "",
                summary=summary or "",
                payload=payload,
            )

            prompt = get_user_prompt(
                "suggest_continuation_instructed",
                language=story.get("language", "en"),
                project_type_label=context["project_type_label"],
                story_title=context["story_title"],
                story_summary=context["story_summary"],
                story_tags=context["story_tags"],
                background=context["background"],
                chapter_notes=context["chapter_notes"],
                chapter_title=title or "",
                chapter_summary=summary or "",
                chapter_conflicts=context["chapter_conflicts"],
                current_text=current_text or "",
                user_prompt_overrides=model_overrides,
            )

            prompt = sanitize_prompt(prompt)
            instructed_messages = [
                {
                    "role": "system",
                    "content": get_system_message(
                        "story_continuer",
                        model_overrides,
                        language=story.get("language", "en"),
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ]
        else:
            context = gather_writing_context(
                story=story,
                chapters_data=chapters_data,
                pos=pos,
                title=title or "",
                summary=summary or "",
                payload=payload,
            )

            prompt = get_user_prompt(
                "suggest_continuation",
                language=story.get("language", "en"),
                project_type_label=context["project_type_label"],
                story_title=context["story_title"],
                story_summary=context["story_summary"],
                story_tags=context["story_tags"],
                background=context["background"],
                chapter_notes=context["chapter_notes"],
                chapter_title=title or "",
                chapter_summary=summary or "",
                chapter_conflicts=context["chapter_conflicts"],
                current_text=_normalize_current_text_for_llm(current_text or ""),
                user_prompt_overrides=model_overrides,
            )

            # Remove any sections that produced empty content to avoid blank
            # labels and collapse multiple blank lines to a single one. This
            # keeps the model input lean and stops it from seeing meaningless
            # placeholders.
            prompt = sanitize_prompt(prompt)

        async def generate_suggestion() -> Any:
            """Generate Suggestion."""
            try:
                async for chunk in _stream_suggestion_candidate(
                    prompt=prompt,
                    base_url=base_url,
                    api_key=api_key,
                    model_id=model_id,
                    timeout_s=timeout_s,
                    model_name=model_name,
                ):
                    yield chunk
            except (OSError, TypeError, ValueError, RuntimeError, AssertionError):
                # Mask internal errors
                yield "\n[Error occurred during suggestion]"

        async def generate_suggestion_instructed() -> Any:
            """Generate suggestion for instructed mode via role-based chat."""
            try:
                start_found = False
                async for chunk in llm.openai_chat_complete_stream(
                    caller_id="api.story.suggest.instructed",
                    messages=instructed_messages or [],
                    base_url=base_url,
                    api_key=api_key,
                    model_id=model_id,
                    timeout_s=timeout_s,
                    model_name=model_name,
                ):
                    if not chunk:
                        continue

                    # Remove any leading spaces/tabs that are purely formatting noise,
                    # but retain all newline characters to preserve paragraph boundaries.
                    if not start_found:
                        while chunk.startswith((" ", "\t")):
                            chunk = chunk[1:]
                        if chunk == "":
                            continue

                    # If this chunk starts with newlines and no non-newline content yet,
                    # emit them in full and keep waiting for actual prose.
                    while not start_found and chunk.startswith("\n"):
                        newline_run = 0
                        while newline_run < len(chunk) and chunk[newline_run] == "\n":
                            newline_run += 1
                        yield chunk[:newline_run]
                        chunk = chunk[newline_run:]
                        if chunk == "":
                            break

                    if chunk == "":
                        continue

                    start_found = True

                    # Preserve model-provided paragraph breaks (including trailing newlines)
                    first_newline = chunk.find("\n")
                    if first_newline == -1:
                        yield chunk
                        continue

                    # Keep all consecutive newline characters starting at first newline.
                    end_idx = first_newline + 1
                    while end_idx < len(chunk) and chunk[end_idx] == "\n":
                        end_idx += 1
                    yield chunk[:end_idx]
                    break
            except (OSError, TypeError, ValueError, RuntimeError, AssertionError):
                # Mask internal errors
                yield "\n[Error occurred during suggestion]"

        if suggestion_mode == SUGGESTION_MODE_INSTRUCTED:
            return StreamingResponse(
                generate_suggestion_instructed(), media_type="text/plain"
            )

        return StreamingResponse(generate_suggestion(), media_type="text/plain")

    except ServiceError as e:
        raise HTTPException(
            status_code=e.status_code,
            detail=e.detail,
        )
    except (OSError, TypeError, ValueError, RuntimeError) as e:
        raise HTTPException(
            status_code=500, detail=f"An internal story suggestion error occurred: {e}"
        )


@router.post("/story/summary/stream")
async def api_story_summary_stream(request: Request, project_dir: ProjectDep) -> Any:
    """Api Story Summary Stream."""

    async def _handler(payload: dict) -> Any:
        """Helper for the requested value.."""
        prepared = prepare_chapter_summary_generation(
            payload,
            payload.get("chap_id"),
            payload.get("mode") or "",
            active=project_dir,
        )

        def _persist(new_summary: str) -> None:
            """Persist the requested value.."""
            prepared["chapters_data"][prepared["pos"]]["summary"] = new_summary
            prepared["story"]["chapters"] = prepared["chapters_data"]
            save_story_config(prepared["story_path"], prepared["story"])

        return StreamingResponse(
            stream_collect_and_persist(
                lambda: _create_gen_source_pure(prepared),
                persist_on_complete=_persist,
            ),
            media_type="text/event-stream",
        )

    return await _with_parsed_payload(
        request,
        _handler,
        internal_error_prefix="An internal story summary error occurred",
    )


@router.post("/story/write/stream")
async def api_story_write_stream(request: Request, project_dir: ProjectDep) -> Any:
    """Api Story Write Stream."""

    async def _handler(payload: dict) -> Any:
        """Helper for the requested value.."""
        prepared = prepare_write_chapter_generation(
            payload, payload.get("chap_id"), active=project_dir
        )

        return StreamingResponse(
            stream_collect_and_persist(
                lambda: _create_gen_source_pure(prepared),
                persist_on_complete=lambda content: prepared["path"].write_text(
                    content, encoding="utf-8"
                ),
            ),
            media_type="text/event-stream",
        )

    return await _with_parsed_payload(
        request,
        _handler,
        internal_error_prefix="An internal story write error occurred",
    )


@router.post("/story/continue/stream")
async def api_story_continue_stream(request: Request, project_dir: ProjectDep) -> Any:
    """Api Story Continue Stream."""

    async def _handler(payload: dict) -> Any:
        """Helper for the requested value.."""
        prepared = prepare_continue_chapter_generation(
            payload,
            payload.get("chap_id"),
            active=project_dir,
        )

        return _as_streaming_response(
            lambda: stream_collect_and_persist(
                lambda: _create_gen_source_pure(prepared),
                persist_on_complete=lambda content: prepared["path"].write_text(
                    (read_text_or_raise(prepared["path"]) + content), encoding="utf-8"
                ),
            )
        )

    return await _with_parsed_payload(
        request,
        _handler,
        internal_error_prefix="An internal story continue error occurred",
    )


@router.post("/story/story-summary/stream")
async def api_story_story_summary_stream(
    request: Request, project_dir: ProjectDep
) -> Any:
    """Api Story Story Summary Stream."""

    async def _handler(payload: dict) -> Any:
        """Helper for the requested value.."""
        prepared = prepare_story_summary_generation(
            payload,
            payload.get("mode") or "",
            active=project_dir,
        )

        return _as_streaming_response(lambda: _create_gen_source(prepared))

    return await _with_parsed_payload(
        request,
        _handler,
        internal_error_prefix="An internal story-wide summary error occurred",
    )


@router.post("/story/action/stream")
async def api_story_action_stream(request: Request, project_dir: ProjectDep) -> Any:
    """Stream generic AI Actions (Extend/Rewrite/Summary update)."""

    async def _handler(payload: dict) -> Any:
        """Helper for the requested value.."""
        prepared = prepare_ai_action_generation(payload, active=project_dir)

        return _as_streaming_response(lambda: _create_gen_source(prepared))

    return await _with_parsed_payload(
        request,
        _handler,
        internal_error_prefix="",
        include_exception_text=False,
        use_raw_exception_detail=True,
    )


@router.post("/chapters/{chap_id}/rewrite-and-relink")
async def api_chapter_rewrite_and_relink(
    request: Request, project_dir: ProjectDep, chap_id: int
) -> Any:
    """Atomically rewrite a chapter and auto-link scenes in one transaction.

    This endpoint streams the generated content and persists it,
    then performs scene auto-linking on the resulting text.
    """

    async def _handler(payload: dict) -> Any:
        """Helper to stream, persist chapter text, then auto-link scenes."""
        prepared = prepare_write_chapter_generation(
            payload, chap_id, active=project_dir
        )

        # Collect streamed content, persist to file
        collected_content = ""
        async for item in stream_collect_and_persist(
            lambda: _create_gen_source_pure(prepared),
            persist_on_complete=lambda content: prepared["path"].write_text(
                content, encoding="utf-8"
            ),
        ):
            # Yield the stream data back to client
            yield item
            # Extract content from SSE data line if present
            if isinstance(item, str) and item.startswith("data: "):
                try:
                    chunk = json.loads(item[6:])
                    if isinstance(chunk, dict) and "choices" in chunk:
                        delta = chunk["choices"][0].get("delta", {})
                        if "content" in delta:
                            collected_content += delta["content"]
                except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                    pass

        # After stream completes, auto-link scenes in this chapter
        try:
            await auto_link_scope_text(
                project_dir,
                scope_type="chapter",
                chapter_id=chap_id,
                current_text=collected_content
                or prepared["path"].read_text(encoding="utf-8"),
            )
        except Exception:
            # Log but don't fail the response; scene linking is post-process
            pass

    return await _with_parsed_payload(
        request,
        _handler,
        internal_error_prefix="",
        include_exception_text=False,
        use_raw_exception_detail=True,
    )

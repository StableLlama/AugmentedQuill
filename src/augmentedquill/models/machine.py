# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Pydantic models for machine/settings API requests and responses.

These models define the transport contract between the backend settings
endpoints and the frontend.  Moving them here means FastAPI will include
them in the generated OpenAPI schema so the frontend can import
auto-generated TypeScript types instead of maintaining hand-written copies.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Machine model configuration (a single LLM provider entry)
# ---------------------------------------------------------------------------


class MachineModelConfig(BaseModel):
    """Configuration for a single LLM provider / model entry."""

    name: str
    base_url: str
    api_key: str | None = None
    model: str
    timeout_s: int | None = None
    context_window_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    stop: list[str] | None = None
    seed: int | None = None
    top_k: int | None = None
    min_p: float | None = None
    extra_body: str | None = None
    preset_id: str | None = None
    writing_warning: str | None = None
    is_multimodal: bool | None = None
    supports_function_calling: bool | None = None
    suggest_loop_guard_enabled: bool | None = None
    suggest_loop_guard_ngram: int | None = None
    suggest_loop_guard_min_repeats: int | None = None
    suggest_loop_guard_max_regens: int | None = None
    prompt_overrides: dict[str, str] | None = None


class MachineOpenAIConfig(BaseModel):
    """The ``openai`` section of the machine config."""

    models: list[MachineModelConfig] | None = None
    selected: str | None = None
    selected_chat: str | None = None
    selected_writing: str | None = None
    selected_editing: str | None = None


class MachineConfigResponse(BaseModel):
    """Response body for ``GET /api/v1/machine``."""

    gui_language: str | None = None
    openai: MachineOpenAIConfig | None = None


# ---------------------------------------------------------------------------
# Model presets
# ---------------------------------------------------------------------------


class ModelPresetWarning(BaseModel):
    """Warnings that should be surfaced to the user for a preset."""

    writing: str | None = None


class ModelPresetParameters(BaseModel):
    """Typed parameters for a model preset."""

    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    seed: int | None = None
    top_k: int | None = None
    min_p: float | None = None
    stop: list[str] | None = None
    extra_body: str | None = None


class ModelPresetEntry(BaseModel):
    """A single model-preset entry as loaded from *model_presets.json*.

    ``preset_type`` distinguishes two flavours:

    * ``"absolute"`` (default) – replaces **all** sampling parameters on the
      provider and locks manual editing.  Suitable for a named full profile
      tied to a specific model family.
    * ``"delta"`` – applies **only the non-null fields** in ``parameters`` on
      top of whatever is already configured.  Does not lock the provider or
      change ``preset_id``.  Suitable for cross-model tweaks such as "more
      creative" or "factual focus".
    """

    id: str
    name: str
    description: str
    model_id_patterns: list[str]
    preset_type: Literal["absolute", "delta"] = "absolute"
    parameters: ModelPresetParameters
    warnings: ModelPresetWarning | None = None


class MachinePresetsResponse(BaseModel):
    """Response body for ``GET /api/v1/machine/presets``."""

    presets: list[ModelPresetEntry]


# ---------------------------------------------------------------------------
# Machine test / test-model responses
# ---------------------------------------------------------------------------


class MachineTestResponse(BaseModel):
    """Response body for ``POST /api/v1/machine/test``."""

    ok: bool
    models: list[str] = []
    detail: str | None = None


class ModelCapabilities(BaseModel):
    """Subset of capabilities detected for a model (optional fields)."""

    multimodal: bool | None = None
    function_calling: bool | None = None


class MachineTestModelResponse(BaseModel):
    """Response body for ``POST /api/v1/machine/test_model``."""

    ok: bool
    model_ok: bool
    models: list[str] = []
    detail: str | None = None
    capabilities: ModelCapabilities | None = None


# ---------------------------------------------------------------------------
# Shared simple responses
# ---------------------------------------------------------------------------


class OkResponse(BaseModel):
    """Generic success response used by endpoints that return ``{ok: true}``."""

    ok: bool
    detail: str | None = None


class OkSelectedResponse(BaseModel):
    """Response for ``PUT /api/v1/machine`` – returns the new selected model name."""

    ok: bool
    selected: str | None = None
    detail: str | None = None


class StorySummaryResponse(BaseModel):
    """Response for ``PUT /api/v1/story/summary``."""

    ok: bool
    story_summary: str | None = None
    detail: str | None = None


class StoryTagsResponse(BaseModel):
    """Response for ``PUT /api/v1/story/tags``."""

    ok: bool
    tags: list[str] | None = None
    detail: str | None = None


class PromptsResponse(BaseModel):
    """Response for ``GET /api/v1/prompts``."""

    ok: bool
    system_messages: dict[str, str] | None = None
    user_prompts: dict[str, str] | None = None
    languages: list[str] | None = None
    project_language: str | None = None

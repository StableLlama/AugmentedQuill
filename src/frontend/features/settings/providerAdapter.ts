// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Centralize conversion between backend machine-model payloads and
 * frontend provider configs so settings logic remains consistent.
 */

import { LLMConfig } from '../../types';
import { MachineModelConfig } from '../../services/apiTypes';

export const normalizeProviderPrompts = (
  prompts?: Record<string, string> | null,
  fallback?: LLMConfig['prompts']
): LLMConfig['prompts'] => {
  const base = fallback || { system: '', continuation: '', summary: '' };
  const incoming = prompts || {};
  return {
    ...base,
    ...incoming,
    system: incoming.system ?? base.system,
    continuation: incoming.continuation ?? base.continuation,
    summary: incoming.summary ?? base.summary,
  };
};

export const toPromptOverrides = (
  prompts?: Record<string, string> | null
): Record<string, string> | undefined => {
  const cleaned = Object.fromEntries(
    Object.entries(prompts || {}).filter(
      ([, value]: [string, string]): boolean => String(value || '').trim() !== ''
    )
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

const toNumberOrUndefined = (value: unknown): number | undefined =>
  value === null || value === undefined ? undefined : Number(value);

const toNumberWithDefault = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toNumberWithOptionalDefault = (
  value: unknown,
  fallback?: number
): number | undefined => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toBooleanWithDefault = (value: unknown, fallback: boolean): boolean =>
  value === null || value === undefined ? fallback : Boolean(value);

const normalizeNgram = (value: unknown): 3 | 4 => (value === 4 ? 4 : 3);

export const machineModelToProvider = (
  model: MachineModelConfig,
  fallbackProvider: LLMConfig
): LLMConfig => {
  const name = String(model.name || '').trim() || fallbackProvider.name;
  const timeoutS = toNumberWithDefault(model.timeout_s, 60);

  return {
    ...fallbackProvider,
    id: name,
    name,
    baseUrl: String(model.base_url || '').trim(),
    apiKey: String(model.api_key || ''),
    timeout: Math.max(1, timeoutS),
    modelId: String(model.model || '').trim(),
    contextWindowTokens: toNumberOrUndefined(model.context_window_tokens),
    temperature: toNumberWithOptionalDefault(
      model.temperature,
      fallbackProvider.temperature
    ),
    topP: toNumberWithOptionalDefault(model.top_p, fallbackProvider.topP),
    maxTokens: toNumberWithOptionalDefault(
      model.max_tokens,
      fallbackProvider.maxTokens
    ),
    presencePenalty: toNumberWithOptionalDefault(
      model.presence_penalty,
      fallbackProvider.presencePenalty
    ),
    frequencyPenalty: toNumberWithOptionalDefault(
      model.frequency_penalty,
      fallbackProvider.frequencyPenalty
    ),
    stop: Array.isArray(model.stop)
      ? model.stop.map((entry: string): string => String(entry))
      : [],
    seed: toNumberOrUndefined(model.seed),
    topK: toNumberOrUndefined(model.top_k),
    minP: toNumberOrUndefined(model.min_p),
    extraBody: String(model.extra_body || ''),
    presetId: model.preset_id || null,
    writingWarning: model.writing_warning || null,
    isMultimodal: model.is_multimodal === null ? undefined : model.is_multimodal,
    supportsFunctionCalling:
      model.supports_function_calling === null
        ? undefined
        : model.supports_function_calling,
    suggestLoopGuardEnabled: toBooleanWithDefault(
      model.suggest_loop_guard_enabled,
      true
    ),
    suggestLoopGuardNgram: normalizeNgram(model.suggest_loop_guard_ngram),
    suggestLoopGuardMinRepeats: toNumberWithDefault(
      model.suggest_loop_guard_min_repeats,
      3
    ),
    suggestLoopGuardMaxRegens: toNumberWithDefault(
      model.suggest_loop_guard_max_regens,
      1
    ),
    prompts: normalizeProviderPrompts(model.prompt_overrides, fallbackProvider.prompts),
  };
};

export const providerToMachineModel = (provider: LLMConfig): MachineModelConfig => ({
  name: (provider.name || '').trim(),
  base_url: (provider.baseUrl || '').trim(),
  api_key: provider.apiKeyEnabled ? provider.apiKey || undefined : undefined,
  timeout_s: Math.max(1, Math.round(provider.timeout || 10)),
  model: (provider.modelId || '').trim(),
  context_window_tokens: provider.contextWindowTokens,
  temperature: provider.temperature,
  top_p: provider.topP,
  max_tokens: provider.maxTokens,
  presence_penalty: provider.presencePenalty,
  frequency_penalty: provider.frequencyPenalty,
  stop: provider.stop || [],
  seed: provider.seed,
  top_k: provider.topK,
  min_p: provider.minP,
  extra_body: provider.extraBody || '',
  preset_id: provider.presetId || undefined,
  writing_warning: provider.writingWarning || undefined,
  is_multimodal: provider.isMultimodal ?? undefined,
  supports_function_calling: provider.supportsFunctionCalling ?? undefined,
  suggest_loop_guard_enabled: provider.suggestLoopGuardEnabled ?? true,
  suggest_loop_guard_ngram: provider.suggestLoopGuardNgram ?? 3,
  suggest_loop_guard_min_repeats: provider.suggestLoopGuardMinRepeats ?? 3,
  suggest_loop_guard_max_regens: provider.suggestLoopGuardMaxRegens ?? 1,
  prompt_overrides: toPromptOverrides(provider.prompts),
});

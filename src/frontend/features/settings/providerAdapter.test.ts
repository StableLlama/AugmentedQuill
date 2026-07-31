// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Unit tests for provider adapter conversion helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  machineModelToProvider,
  normalizeProviderPrompts,
  providerToMachineModel,
  toPromptOverrides,
} from './providerAdapter';
import { DEFAULT_LLM_CONFIG } from '../../types';
import type { MachineModelConfig } from '../../services/apiTypes';

describe('normalizeProviderPrompts', () => {
  it('fills missing required prompt keys from fallback values', () => {
    const prompts = normalizeProviderPrompts(
      { custom: 'x', system: 'sys' },
      {
        system: 'fallback-system',
        continuation: 'fallback-continuation',
        summary: 'fallback-summary',
      }
    );

    expect(prompts.system).toBe('sys');
    expect(prompts.continuation).toBe('fallback-continuation');
    expect(prompts.summary).toBe('fallback-summary');
    expect(prompts.custom).toBe('x');
  });
});

describe('toPromptOverrides', () => {
  it('drops empty values and returns undefined for fully-empty maps', () => {
    expect(toPromptOverrides({ system: '', continuation: '   ' })).toBeUndefined();
    expect(toPromptOverrides({ system: 'keep', continuation: '   ' })).toEqual({
      system: 'keep',
    });
  });
});

describe('provider mapping roundtrip', () => {
  it('keeps optional null backend fields aligned with frontend defaults', () => {
    const model = {
      name: 'chat-model',
      base_url: 'https://api.example.com/v1',
      api_key: 'k',
      model: 'gpt-test',
      timeout_s: 22,
      is_multimodal: null,
      supports_function_calling: null,
      prompt_overrides: {
        system: 'S',
      },
    } as unknown as MachineModelConfig;

    const provider = machineModelToProvider(model, {
      ...DEFAULT_LLM_CONFIG,
      id: 'fallback',
      name: 'Fallback',
      prompts: { system: 'base-s', continuation: 'base-c', summary: 'base-sum' },
    });

    expect(provider.isMultimodal).toBeUndefined();
    expect(provider.supportsFunctionCalling).toBeUndefined();
    expect(provider.timeout).toBe(22);
    expect(provider.prompts).toMatchObject({
      system: 'S',
      continuation: 'base-c',
      summary: 'base-sum',
    });

    const back = providerToMachineModel(provider);
    expect(back.prompt_overrides).toEqual({
      system: 'S',
      continuation: 'base-c',
      summary: 'base-sum',
    });
    expect(back.is_multimodal).toBeUndefined();
    expect(back.supports_function_calling).toBeUndefined();
  });

  it('omits api_key when apiKeyEnabled is disabled', () => {
    const provider = {
      ...DEFAULT_LLM_CONFIG,
      id: 'disabled-key',
      name: 'Disabled Key',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      apiKeyEnabled: false,
      timeout: 10,
      modelId: 'gpt-test',
      prompts: DEFAULT_LLM_CONFIG.prompts,
    };

    const back = providerToMachineModel(provider);
    expect(back.api_key).toBeUndefined();
  });

  it('treats blank max_tokens as undefined and falls back to provider default', () => {
    const model = {
      name: 'chat-model',
      base_url: 'https://api.example.com/v1',
      api_key: 'k',
      model: 'gpt-test',
      timeout_s: 22,
      max_tokens: '',
      prompt_overrides: {
        system: 'S',
      },
    } as unknown as MachineModelConfig;

    const provider = machineModelToProvider(model, {
      ...DEFAULT_LLM_CONFIG,
      id: 'fallback',
      name: 'Fallback',
      prompts: { system: 'base-s', continuation: 'base-c', summary: 'base-sum' },
    });

    expect(provider.maxTokens).toBe(DEFAULT_LLM_CONFIG.maxTokens);
  });
});

// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Unit tests for provider health helpers.  We don't exercise the hook via a
 * full React render here because the existing frontend test suite is focused
 * on plain utility functions.  The core requirement is that the logic only
 * produces one network payload per unique model configuration, and the
 * helpers below allow us to verify that grouping and keying are correct.
 */

import { describe, it, expect } from 'vitest';
import { makeProviderKey, groupProviders } from './useProviderHealth';
import { AppSettings } from '../../types';

const exampleProviders: AppSettings['providers'] = [
  {
    id: 'a',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'key1',
    modelId: 'foo',
    timeout: 10,
  },
  {
    id: 'b',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'key1',
    modelId: 'foo',
    timeout: 10,
  },
  {
    id: 'c',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'key1',
    modelId: 'bar',
    timeout: 10,
  },
  {
    id: 'd',
    baseUrl: 'https://other.invalid',
    apiKey: 'key2',
    modelId: 'foo',
    timeout: 10,
  },
  {
    id: 'e',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'key1',
    apiKeyEnabled: false,
    modelId: 'foo',
    timeout: 10,
  },
];

describe('makeProviderKey', () => {
  it('produces identical keys for identical inputs', () => {
    const k1 = makeProviderKey('u', 'k', 'm');
    const k2 = makeProviderKey('u', 'k', 'm');
    expect(k1).toBe(k2);
  });

  it('normalizes whitespace and missing values', () => {
    expect(makeProviderKey(' u ', undefined, 'm')).toBe(makeProviderKey('u', '', 'm'));
  });
});

describe('groupProviders', () => {
  it('groups active providers by identical model keys', () => {
    const active = new Set(['a', 'b', 'c', 'd', 'e']);
    const groups = groupProviders(exampleProviders, active);

    // there should be four distinct keys: (foo,key1,example), (bar,key1,example), (foo,key2,other), (foo,no-key,example)
    expect(Object.keys(groups).length).toBe(4);

    // providers a and b share the same key
    const fooKey = makeProviderKey('https://api.example.com/v1', 'key1', 'foo');
    expect(groups[fooKey].ids.sort()).toEqual(['a', 'b']);

    const barKey = makeProviderKey('https://api.example.com/v1', 'key1', 'bar');
    expect(groups[barKey].ids).toEqual(['c']);

    const otherKey = makeProviderKey('https://other.invalid', 'key2', 'foo');
    expect(groups[otherKey].ids).toEqual(['d']);

    const noKeyKey = makeProviderKey(
      'https://api.example.com/v1',
      undefined,
      'foo',
      true
    );
    expect(groups[noKeyKey].ids).toEqual(['e']);
  });

  it('treats no-api-key providers as distinct from regular api key providers', () => {
    const active = new Set(['a', 'e']);
    const groups = groupProviders(exampleProviders, active);

    expect(Object.keys(groups).length).toBe(2);
    const regularKey = makeProviderKey('https://api.example.com/v1', 'key1', 'foo');
    const disabledKey = makeProviderKey(
      'https://api.example.com/v1',
      undefined,
      'foo',
      false
    );

    expect(groups[regularKey].ids).toEqual(['a']);
    expect(groups[disabledKey].ids).toEqual(['e']);
    expect(groups[disabledKey].payload.api_key).toBeUndefined();
  });

  it('ignores providers that are not active or that lack a modelId', () => {
    const active = new Set(['a', 'c']);
    const minimal = [...exampleProviders];
    minimal[0].modelId = '   ';
    const groups = groupProviders(minimal, active);

    // a is inactive due to blank modelId, c remains
    expect(Object.keys(groups).length).toBe(1);
    const barKey = makeProviderKey('https://api.example.com/v1', 'key1', 'bar');
    expect(groups[barKey].ids).toEqual(['c']);
  });
});

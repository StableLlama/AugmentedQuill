// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Vitest setup file for initializing i18n, mocking DOM APIs, and registering
 * the axe accessibility matchers (toHaveNoViolations).
 */

import './features/app/i18n';
import * as axeMatchers from 'vitest-axe/matchers';
import 'vitest-axe/extend-expect';
import { expect, vi } from 'vitest';

expect.extend(axeMatchers);

const useFakeTimers = vi.useFakeTimers.bind(vi);
vi.useFakeTimers = (
  ...args: Parameters<typeof useFakeTimers>
): ReturnType<typeof useFakeTimers> => {
  const temporalDescriptor: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  if (!temporalDescriptor?.configurable) return useFakeTimers(...args);

  Reflect.deleteProperty(globalThis, 'Temporal');
  try {
    return useFakeTimers(...args);
  } finally {
    Object.defineProperty(globalThis, 'Temporal', temporalDescriptor);
  }
};

// Mock getClientRects for CodeMirror tests in jsdom
Object.defineProperty(Range.prototype, 'getClientRects', {
  value: function () {
    return [];
  },
  writable: true,
});

// Mock getBoundingClientRect for elements
Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
  value: function () {
    return {
      width: 100,
      height: 20,
      top: 0,
      left: 0,
      bottom: 20,
      right: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  },
  writable: true,
});

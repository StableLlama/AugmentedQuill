// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Re-exports all frontend types from their respective sub-modules.
 *
 * Import from this barrel or directly from the sub-module:
 *   import { Story, Chapter } from '../types';          // via barrel
 *   import { Story } from '../types/domain';            // direct
 */

/** Shared debug flag used across the application for tracing prose ranges. */
declare global {
  interface Window {
    __AQ_DEBUG_RANGES?: boolean;
  }
}

export * from './domain';
export * from './chat';
export * from './ui';

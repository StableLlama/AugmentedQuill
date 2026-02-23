// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Centralises all derived theme CSS-class strings so components can
 */

import React, { createContext, useContext, useMemo } from 'react';
import { AppTheme } from '../../types';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export type ThemeContextValue = {
  /** The raw theme name (light | dark | mixed). */
  currentTheme: AppTheme;
  /** `true` when the active theme is 'light'. */
  isLight: boolean;

  // Computed Tailwind class strings
  headerBg: string;
  bgMain: string;
  textMain: string;
  iconColor: string;
  iconHover: string;
  dividerColor: string;
  buttonActive: string;
  sliderClass: string;
};

// Sensible dark-theme defaults for the initial context value so that consumers
// are never broken before the provider mounts.
const ThemeContext = createContext<ThemeContextValue>({
  currentTheme: 'mixed',
  isLight: false,
  headerBg: 'bg-brand-gray-900 border-brand-gray-800',
  bgMain: 'bg-brand-gray-950',
  textMain: 'text-brand-gray-300',
  iconColor: 'text-brand-gray-400',
  iconHover: 'hover:text-brand-gray-300',
  dividerColor: 'bg-brand-gray-800',
  buttonActive: 'bg-brand-900/40 text-brand-300 border border-brand-800/50',
  sliderClass:
    'w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-brand-gray-800 accent-brand-gray-500',
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type ThemeProviderProps = {
  currentTheme: AppTheme;
  children: React.ReactNode;
};

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  currentTheme,
  children,
}) => {
  const isLight = currentTheme === 'light';

  const value = useMemo<ThemeContextValue>(() => {
    return {
      currentTheme,
      isLight,
      headerBg: isLight
        ? 'bg-brand-gray-50 border-brand-gray-200'
        : 'bg-brand-gray-900 border-brand-gray-800',
      bgMain: isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950',
      textMain: isLight ? 'text-brand-gray-800' : 'text-brand-gray-300',
      iconColor: isLight ? 'text-brand-gray-600' : 'text-brand-gray-400',
      iconHover: isLight ? 'hover:text-brand-gray-900' : 'hover:text-brand-gray-300',
      dividerColor: isLight ? 'bg-brand-gray-300' : 'bg-brand-gray-800',
      buttonActive: isLight
        ? 'bg-brand-100 text-brand-700'
        : 'bg-brand-900/40 text-brand-300 border border-brand-800/50',
      sliderClass: `w-full h-1.5 rounded-lg appearance-none cursor-pointer ${
        isLight
          ? 'bg-brand-gray-200 accent-brand-600'
          : 'bg-brand-gray-800 accent-brand-gray-500'
      }`,
    };
  }, [currentTheme, isLight]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Returns the current theme tokens. Must be used inside a `<ThemeProvider>`. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

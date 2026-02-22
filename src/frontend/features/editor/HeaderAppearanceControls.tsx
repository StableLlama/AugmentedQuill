// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the header appearance controls unit so this responsibility stays isolated, testable, and easy to evolve.

import React, { RefObject } from 'react';
import {
  Bug,
  LayoutTemplate,
  Monitor,
  Moon,
  Palette,
  SplitSquareHorizontal,
  Sun,
  Type,
  X,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { AppTheme, EditorSettings } from '../../types';

type HeaderAppearanceControlsProps = {
  appearanceRef: RefObject<HTMLDivElement | null>;
  isAppearanceOpen: boolean;
  setIsAppearanceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isLight: boolean;
  textMain: string;
  buttonActive: string;
  currentTheme: AppTheme;
  setAppTheme: (theme: AppTheme) => void;
  editorSettings: EditorSettings;
  setEditorSettings: React.Dispatch<React.SetStateAction<EditorSettings>>;
  sliderClass: string;
  setIsDebugLogsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export const HeaderAppearanceControls: React.FC<HeaderAppearanceControlsProps> = ({
  appearanceRef,
  isAppearanceOpen,
  setIsAppearanceOpen,
  isLight,
  textMain,
  buttonActive,
  currentTheme,
  setAppTheme,
  editorSettings,
  setEditorSettings,
  sliderClass,
  setIsDebugLogsOpen,
}) => {
  return (
    <div className="relative" ref={appearanceRef}>
      <Button
        theme={currentTheme}
        variant={isAppearanceOpen ? 'secondary' : 'ghost'}
        size="sm"
        onClick={() => setIsAppearanceOpen(!isAppearanceOpen)}
        icon={<Type size={16} />}
        title="Page Appearance"
        className="hidden sm:inline-flex"
      >
        Appearance
      </Button>

      {isAppearanceOpen && (
        <div
          className={`absolute top-full right-0 mt-2 w-80 border rounded-lg shadow-2xl p-5 z-50 ${
            isLight
              ? 'bg-brand-gray-50 border-brand-gray-200'
              : 'bg-brand-gray-900 border-brand-gray-700'
          }`}
        >
          <div
            className={`flex justify-between items-center mb-4 border-b pb-2 ${
              isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
            }`}
          >
            <h3 className="text-xs font-semibold text-brand-gray-500 uppercase tracking-wider">
              Page Appearance
            </h3>
            <button
              onClick={() => setIsAppearanceOpen(false)}
              className="text-brand-gray-500 hover:text-brand-gray-400"
            >
              <X size={14} />
            </button>
          </div>
          <div className="space-y-5">
            <div className="space-y-2">
              <div className={`flex justify-between items-center text-sm ${textMain}`}>
                <span className="flex items-center gap-2">
                  <Palette size={14} /> Design Mode
                </span>
              </div>
              <div className="flex rounded-lg overflow-hidden border border-brand-gray-700">
                <button
                  onClick={() => setAppTheme('light')}
                  className={`flex-1 py-1.5 text-xs font-medium flex justify-center items-center gap-1 ${
                    currentTheme === 'light'
                      ? buttonActive
                      : 'bg-brand-gray-800 text-brand-gray-400 hover:text-brand-gray-300'
                  }`}
                >
                  <Sun size={12} /> Light
                </button>
                <button
                  onClick={() => setAppTheme('mixed')}
                  className={`flex-1 py-1.5 text-xs font-medium flex justify-center items-center gap-1 ${
                    currentTheme === 'mixed'
                      ? buttonActive
                      : 'bg-brand-gray-800 text-brand-gray-400 hover:text-brand-gray-300'
                  }`}
                >
                  <LayoutTemplate size={12} /> Mixed
                </button>
                <button
                  onClick={() => setAppTheme('dark')}
                  className={`flex-1 py-1.5 text-xs font-medium flex justify-center items-center gap-1 ${
                    currentTheme === 'dark'
                      ? buttonActive
                      : 'bg-brand-gray-800 text-brand-gray-400 hover:text-brand-gray-300'
                  }`}
                >
                  <Moon size={12} /> Dark
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className={`flex justify-between items-center text-sm ${textMain}`}>
                <span className="flex items-center gap-2">
                  <Sun size={14} /> Brightness
                </span>
                <span className="font-mono text-xs text-brand-gray-500">
                  {Math.round(editorSettings.brightness * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="100"
                value={editorSettings.brightness * 100}
                onChange={(event) =>
                  setEditorSettings({
                    ...editorSettings,
                    brightness: Number(event.target.value) / 100,
                  })
                }
                className={sliderClass}
              />
            </div>
            <div className="space-y-2">
              <div className={`flex justify-between items-center text-sm ${textMain}`}>
                <span className="flex items-center gap-2">
                  <Moon size={14} /> Contrast
                </span>
                <span className="font-mono text-xs text-brand-gray-500">
                  {Math.round(editorSettings.contrast * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="100"
                value={editorSettings.contrast * 100}
                onChange={(event) =>
                  setEditorSettings({
                    ...editorSettings,
                    contrast: Number(event.target.value) / 100,
                  })
                }
                className={sliderClass}
              />
            </div>
            <div className="space-y-2">
              <div className={`flex justify-between items-center text-sm ${textMain}`}>
                <span className="flex items-center gap-2">
                  <Type size={14} /> Font Size
                </span>
                <span className="font-mono text-xs text-brand-gray-500">
                  {editorSettings.fontSize}px
                </span>
              </div>
              <input
                type="range"
                min="12"
                max="32"
                value={editorSettings.fontSize}
                onChange={(event) =>
                  setEditorSettings({
                    ...editorSettings,
                    fontSize: Number(event.target.value),
                  })
                }
                className={sliderClass}
              />
            </div>
            <div className="space-y-2">
              <div className={`flex justify-between items-center text-sm ${textMain}`}>
                <span className="flex items-center gap-2">
                  <Monitor size={14} /> Line Width
                </span>
                <span className="font-mono text-xs text-brand-gray-500">
                  {editorSettings.maxWidth}ch
                </span>
              </div>
              <input
                type="range"
                min="40"
                max="100"
                value={editorSettings.maxWidth}
                onChange={(event) =>
                  setEditorSettings({
                    ...editorSettings,
                    maxWidth: Number(event.target.value),
                  })
                }
                className={sliderClass}
              />
            </div>
            <div className="space-y-2">
              <div className={`flex justify-between items-center text-sm ${textMain}`}>
                <span className="flex items-center gap-2">
                  <SplitSquareHorizontal size={14} /> Sidebar Width
                </span>
                <span className="font-mono text-xs text-brand-gray-500">
                  {editorSettings.sidebarWidth}px
                </span>
              </div>
              <input
                type="range"
                min="200"
                max="600"
                step="10"
                value={editorSettings.sidebarWidth}
                onChange={(event) =>
                  setEditorSettings({
                    ...editorSettings,
                    sidebarWidth: Number(event.target.value),
                  })
                }
                className={sliderClass}
              />
            </div>
          </div>
        </div>
      )}
      <Button
        theme={currentTheme}
        variant="ghost"
        size="sm"
        onClick={() => setIsDebugLogsOpen(true)}
        title="Debug Logs"
        className="mr-1"
      >
        <Bug size={18} />
      </Button>
    </div>
  );
};

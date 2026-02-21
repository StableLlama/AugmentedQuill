// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the settings prompts unit so this responsibility stays isolated, testable, and easy to evolve.

import React, { useState } from 'react';
import { MessageSquare, BookOpen, Edit2 } from 'lucide-react';
import { AppTheme, LLMConfig } from '../../../types';
import { PROMPT_GROUPS } from './constants';

interface SettingsPromptsProps {
  activeProvider: LLMConfig;
  defaultPrompts: {
    system_messages: Record<string, string>;
    user_prompts: Record<string, string>;
  };
  onUpdateProvider: (id: string, updates: Partial<LLMConfig>) => void;
  theme: AppTheme;
}

export const SettingsPrompts: React.FC<SettingsPromptsProps> = ({
  activeProvider,
  defaultPrompts,
  onUpdateProvider,
  theme,
}) => {
  const isLight = theme === 'light';

  return (
    <div
      className={`pt-4 border-t ${
        isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
      }`}
    >
      <h4
        className={`text-sm font-bold mb-3 uppercase tracking-wider ${
          isLight ? 'text-brand-gray-600' : 'text-brand-gray-400'
        }`}
      >
        Expert: Prompt Overrides
      </h4>
      <div className="space-y-4">
        {PROMPT_GROUPS.map((group) => (
          <div key={group.title} className="space-y-3">
            <h5
              className={`text-[10px] font-bold uppercase tracking-widest ${
                isLight ? 'text-brand-gray-400' : 'text-brand-gray-500'
              }`}
            >
              {group.title}
            </h5>
            <div className="space-y-3">
              {group.prompts.map((prompt) => {
                const Icon =
                  prompt.type === 'CHAT'
                    ? MessageSquare
                    : prompt.type === 'WRITING'
                      ? BookOpen
                      : Edit2;
                const colorClass =
                  prompt.type === 'CHAT'
                    ? 'text-blue-600'
                    : prompt.type === 'WRITING'
                      ? 'text-violet-600'
                      : 'text-fuchsia-600';
                const bgColorClass =
                  prompt.type === 'CHAT'
                    ? 'bg-blue-50'
                    : prompt.type === 'WRITING'
                      ? 'bg-violet-50'
                      : 'bg-fuchsia-50';
                const darkBgColorClass =
                  prompt.type === 'CHAT'
                    ? 'dark:bg-blue-900/20'
                    : prompt.type === 'WRITING'
                      ? 'dark:bg-violet-900/20'
                      : 'dark:bg-fuchsia-900/20';

                const promptValue = activeProvider.prompts?.[prompt.id] || '';

                return (
                  <div key={prompt.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={`p-1 rounded ${bgColorClass} ${darkBgColorClass}`}
                      >
                        <Icon size={10} className={colorClass} />
                      </div>
                      <label
                        className={`text-[10px] font-bold uppercase tracking-tight ${colorClass}`}
                      >
                        {prompt.label}
                        <span
                          className={
                            'ml-2 text-[8px] px-1 rounded border border-current opacity-70'
                          }
                        >
                          {prompt.type}
                        </span>
                      </label>
                    </div>
                    <textarea
                      rows={5}
                      value={promptValue}
                      onChange={(e) =>
                        onUpdateProvider(activeProvider.id, {
                          prompts: {
                            ...(activeProvider.prompts || {}),
                            [prompt.id]: e.target.value,
                          },
                        })
                      }
                      placeholder={
                        defaultPrompts.system_messages[prompt.id] ||
                        defaultPrompts.user_prompts[prompt.id] ||
                        'Default instruction...'
                      }
                      className={`w-full border rounded p-2 text-[11px] focus:border-brand-500 focus:outline-none ${
                        isLight
                          ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-800'
                          : 'bg-brand-gray-950 border-brand-gray-700 text-brand-gray-300'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

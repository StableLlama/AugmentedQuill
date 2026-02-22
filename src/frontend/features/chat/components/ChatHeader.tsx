// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the chat header controls so chat layout remains modular and maintainable.

import React from 'react';
import { Ghost, Globe, History, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react';

type ChatHeaderProps = {
  title: string;
  currentSessionId: string | null;
  isIncognito: boolean;
  showHistory: boolean;
  setShowHistory: (value: boolean) => void;
  showSystemPrompt: boolean;
  setShowSystemPrompt: (value: boolean) => void;
  allowWebSearch: boolean;
  onDeleteSession: (id: string) => void;
  onNewSession: (incognito?: boolean) => void;
  onToggleWebSearch: (value: boolean) => void;
};

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  currentSessionId,
  isIncognito,
  showHistory,
  setShowHistory,
  showSystemPrompt,
  setShowSystemPrompt,
  allowWebSearch,
  onDeleteSession,
  onNewSession,
  onToggleWebSearch,
}) => {
  return (
    <div className="p-4 border-b flex items-center justify-between bg-brand-gray-100 dark:bg-brand-gray-900 border-brand-gray-200 dark:border-brand-gray-800">
      <div className="flex items-center space-x-2 overflow-hidden">
        <Sparkles className="text-blue-600 shrink-0" size={20} />
        <h2 className="font-semibold truncate">{title}</h2>
      </div>
      <div className="flex items-center space-x-1">
        <button
          onClick={() => {
            if (currentSessionId) {
              onDeleteSession(currentSessionId);
            }
          }}
          className="p-1.5 rounded hover:bg-red-500/10 text-red-500/70 hover:text-red-500 transition-colors"
          title="Delete Current Chat"
          disabled={!currentSessionId}
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={() => onNewSession(false)}
          className="p-1.5 rounded hover:bg-brand-gray-200 dark:hover:bg-brand-gray-800 transition-colors text-brand-gray-500"
          title="New Chat"
        >
          <Plus size={16} />
        </button>
        <button
          onClick={() => onNewSession(true)}
          className={`p-1.5 rounded hover:bg-brand-gray-200 dark:hover:bg-brand-gray-800 transition-colors ${
            isIncognito ? 'text-purple-500 bg-purple-500/10' : 'text-brand-gray-500'
          }`}
          title="Incognito Chat (Not Saved)"
        >
          <Ghost size={16} />
        </button>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`p-1.5 rounded hover:bg-brand-gray-200 dark:hover:bg-brand-gray-800 transition-colors ${
            showHistory
              ? 'bg-brand-gray-200 dark:bg-brand-gray-800 text-brand-600'
              : 'text-brand-gray-500'
          }`}
          title="Chat History"
        >
          <History size={16} />
        </button>
        <button
          onClick={() => onToggleWebSearch(!allowWebSearch)}
          className={`p-1.5 rounded border transition-all ${
            allowWebSearch
              ? 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-500/20 dark:border-blue-500/30 shadow-sm'
              : 'text-brand-gray-500 border-transparent hover:bg-brand-gray-200 dark:hover:bg-brand-gray-800'
          }`}
          title={allowWebSearch ? 'Web Search Enabled' : 'Enable Web Search'}
        >
          <Globe size={16} />
        </button>
        <button
          onClick={() => setShowSystemPrompt(!showSystemPrompt)}
          className={`p-1.5 rounded hover:bg-brand-gray-200 dark:hover:bg-brand-gray-800 transition-colors ${
            showSystemPrompt
              ? 'bg-brand-gray-200 dark:bg-brand-gray-800 text-brand-600'
              : 'text-brand-gray-500'
          }`}
          title="Chat Settings"
        >
          <Settings2 size={16} />
        </button>
      </div>
    </div>
  );
};

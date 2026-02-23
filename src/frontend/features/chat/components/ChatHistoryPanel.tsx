// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the chat history panel so session management UI is isolated from message rendering.
 */

import React from 'react';
import { Ghost, Trash2, X } from 'lucide-react';
import { ChatSession } from '../../../types';

type ChatHistoryPanelProps = {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onDeleteAllSessions?: () => void;
  onClose: () => void;
};

export const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onDeleteAllSessions,
  onClose,
}) => {
  return (
    <div className="p-4 border-b max-h-60 overflow-y-auto bg-brand-gray-100 dark:bg-brand-gray-900 border-brand-gray-200 dark:border-brand-gray-800">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-gray-500">
            Recent Chats
          </h3>
          {sessions.length > 0 && onDeleteAllSessions && (
            <button
              onClick={onDeleteAllSessions}
              className="text-[10px] text-red-500 hover:text-red-600 font-bold uppercase hover:underline ml-2"
            >
              Clear All
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-brand-gray-500 hover:text-brand-gray-700"
        >
          <X size={14} />
        </button>
      </div>
      <div className="space-y-1">
        {sessions.length === 0 && (
          <div className="text-xs text-brand-gray-500 py-2 italic">
            No saved chats yet.
          </div>
        )}
        {sessions.map((session) => {
          const isSIncognito = session.isIncognito;
          return (
            <div
              key={session.id}
              className={`group flex items-center justify-between p-2 rounded text-sm cursor-pointer transition-colors ${
                currentSessionId === session.id
                  ? 'bg-brand-gray-200 dark:bg-brand-gray-800 text-brand-600 font-medium'
                  : 'hover:bg-brand-gray-200/50 dark:hover:bg-brand-gray-800/50'
              }`}
              onClick={() => {
                onSelectSession(session.id);
                onClose();
              }}
            >
              <div className="flex flex-col overflow-hidden">
                <div className="flex items-center space-x-1">
                  {isSIncognito && (
                    <Ghost size={12} className="text-purple-500 shrink-0" />
                  )}
                  <span className="truncate">{session.name}</span>
                </div>
                <span className="text-[10px] text-brand-gray-500">
                  {isSIncognito
                    ? 'Not saved to disk'
                    : session.updated_at
                      ? new Date(session.updated_at).toLocaleString()
                      : 'Unknown date'}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Delete this chat?')) {
                    onDeleteSession(session.id);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 hover:text-red-600 transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Renders a single chat message as a memoised component so that unchanged
 * messages are skipped during parent re-renders (e.g. while the AI is
 * streaming tokens or display-count increments progressively).
 */

import React, { useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatMessage, AppTheme } from '../../../types';
import {
  Bot,
  User,
  Settings2,
  Save,
  X,
  Edit2,
  Trash2,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { JsonSyntaxView } from '../../../components/ui/JsonSyntaxView';
import { MarkdownView } from '../../editor/MarkdownView';
import { CollapsibleToolSection } from './CollapsibleToolSection';
import { WebSearchResults, VisitPageResult } from './ToolResultViews';

// ---------------------------------------------------------------------------
// ToolCallArguments – tiny helper, kept here to avoid a circular import with
// Chat.tsx (where it previously lived).
// ---------------------------------------------------------------------------

type ToolCallArgumentsProps = { args: unknown };

const tryParseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const ToolCallArguments = React.memo(function ToolCallArguments({
  args,
}: ToolCallArgumentsProps) {
  const formattedArgs = useMemo((): unknown => tryParseJson(args), [args]);

  return (
    <div className="whitespace-pre-wrap break-all opacity-80 max-h-[300px] overflow-y-auto custom-scrollbar font-mono text-[11px]">
      {typeof formattedArgs === 'string' ? (
        formattedArgs
      ) : (
        <JsonSyntaxView data={formattedArgs} />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// ChatMessageItem
// ---------------------------------------------------------------------------

export interface ChatMessageItemProps {
  msg: ChatMessage;
  /** True when this is the last message in the visible list. */
  isLast: boolean;
  isLoading: boolean;
  isLight: boolean;
  msgUserBg: string;
  msgBotBg: string;
  inputBg: string;
  /** True when *this specific* message is in edit mode. */
  isEditing: boolean;
  /** Current edit textarea content; only meaningful when isEditing=true. */
  editContent: string;
  /** True when *any* message is being edited (hides action buttons). */
  anyMessageBeingEdited: boolean;
  /** Controlled expanded state for the thinking section; undefined = use default. */
  isThinkingExpanded: boolean | undefined;
  isModelAvailable: boolean;
  chatDisabledReason: string;
  storyLanguage?: string;
  theme?: AppTheme;
  onSwitchProject?: (
    id: string,
    options?: { preserveActiveChatSession?: boolean }
  ) => void | Promise<void>;
  onStartEditing: (msg: ChatMessage) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onSetEditContent: (value: string) => void;
  onDeleteMessage: (id: string) => void;
  onThinkingToggle: (id: string, next: boolean) => void;
}

// eslint-disable-next-line complexity
export const ChatMessageItem = React.memo(function ChatMessageItem({
  msg,
  isLast,
  isLoading,
  isLight,
  msgUserBg,
  msgBotBg,
  inputBg,
  isEditing,
  editContent,
  anyMessageBeingEdited,
  isThinkingExpanded,
  isModelAvailable,
  chatDisabledReason,
  storyLanguage,
  theme,
  onSwitchProject,
  onStartEditing,
  onCancelEdit,
  onSaveEdit,
  onSetEditContent,
  onDeleteMessage,
  onThinkingToggle,
}: ChatMessageItemProps) {
  const { t } = useTranslation();
  const hasAutoSwitchedRef = useRef(false);

  // Auto-switch to newly created projects from manage_project tool
  useEffect((): void => {
    if (
      isLoading &&
      isLast &&
      msg.role === 'tool' &&
      msg.name === 'manage_project' &&
      onSwitchProject &&
      !hasAutoSwitchedRef.current
    ) {
      try {
        const toolResult = tryParseJson(msg.text);
        if (
          typeof toolResult === 'object' &&
          toolResult !== null &&
          'project_name' in toolResult &&
          toolResult.project_name
        ) {
          hasAutoSwitchedRef.current = true;
          onSwitchProject(String(toolResult.project_name), {
            preserveActiveChatSession: true,
          });
        }
      } catch {
        /* ignore parsing errors */
      }
    }
  }, [isLoading, isLast, msg.id, msg.role, msg.name, onSwitchProject]);

  return (
    <div
      className={`group flex items-start space-x-3 ${
        msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'
      }`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border mt-1 ${
          msg.role === 'user'
            ? 'bg-blue-100 border-blue-200 text-blue-700'
            : msg.role === 'tool'
              ? 'bg-blue-500/10 border-blue-500/20 text-blue-500'
              : isLight
                ? 'bg-brand-gray-50 border-brand-gray-200 text-brand-gray-500'
                : 'bg-brand-gray-800 border-brand-gray-700 text-brand-gray-400'
        }`}
      >
        {msg.role === 'user' ? (
          <User size={16} />
        ) : msg.role === 'tool' ? (
          <Settings2 size={16} />
        ) : (
          <Bot size={16} />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 max-w-[85%] relative">
        {isEditing ? (
          /* ── Edit mode ── */
          <div
            className={`border rounded-lg p-3 shadow-lg ${
              isLight
                ? 'bg-brand-gray-50 border-brand-gray-200'
                : 'bg-brand-gray-800 border-brand-gray-600'
            }`}
          >
            <textarea
              lang={storyLanguage || 'en'}
              value={editContent}
              spellCheck={true}
              onChange={(
                e: React.ChangeEvent<HTMLTextAreaElement, HTMLTextAreaElement>
              ): void => onSetEditContent(e.target.value)}
              className={`w-full text-sm p-2 rounded border focus:outline-none focus:border-brand-500 min-h-[100px] ${inputBg}`}
            />
            <div className="flex justify-end space-x-2 mt-2">
              <button
                onClick={onCancelEdit}
                className="p-1 text-brand-gray-400 hover:text-brand-gray-600"
                aria-label={t('Cancel message edit')}
                title={t('Cancel edit')}
              >
                <X size={14} />
              </button>
              <button
                onClick={(): void => onSaveEdit(msg.id)}
                className="p-1 text-brand-500 hover:opacity-80"
                aria-label={t('Save message edit')}
                title={t('Save edit')}
              >
                <Save size={14} />
              </button>
            </div>
          </div>
        ) : (
          /* ── Display mode ── */
          <div
            className={`rounded-lg p-3 text-sm leading-relaxed ${
              msg.role === 'user'
                ? msgUserBg
                : msg.role === 'tool'
                  ? msg.name === 'web_search' ||
                    msg.name === 'wikipedia_search' ||
                    msg.name === 'visit_page'
                    ? 'bg-blue-500/5 border border-blue-500/30 shadow-sm'
                    : 'bg-blue-500/5 border border-blue-500/20 text-blue-600 dark:text-blue-400 font-mono text-xs'
                  : msgBotBg
            }`}
          >
            {msg.role === 'tool' ? (
              <>
                {msg.name === 'web_search' || msg.name === 'wikipedia_search' ? (
                  <WebSearchResults content={msg.text} name={msg.name} />
                ) : msg.name === 'visit_page' ? (
                  <VisitPageResult content={msg.text} />
                ) : (
                  <CollapsibleToolSection
                    title={t('Tool Result: {{name}}', { name: msg.name })}
                  >
                    {tryParseJson(msg.text) !== msg.text ? (
                      <JsonSyntaxView data={tryParseJson(msg.text)} />
                    ) : (
                      <MarkdownView content={msg.text} />
                    )}
                    {msg.name === 'create_project' &&
                      msg.text.includes('Project created:') &&
                      onSwitchProject && (
                        <div className="mt-2">
                          <Button
                            theme={theme}
                            size="sm"
                            variant="secondary"
                            onClick={(): void => {
                              if (!isModelAvailable) return;
                              let projectName = '';
                              try {
                                const parsed = JSON.parse(msg.text);
                                const innerMsg = parsed.message || '';
                                const match = innerMsg.match(/Project created: (.+)/);
                                if (match) projectName = match[1];
                              } catch {
                                /* ignore */
                              }
                              if (!projectName) {
                                const match = msg.text.match(
                                  /Project created: ([^"}\s]+)/
                                );
                                if (match) projectName = match[1];
                              }
                              if (projectName) {
                                onSwitchProject(projectName.trim(), {
                                  preserveActiveChatSession: true,
                                });
                              }
                            }}
                            icon={<ArrowRight size={14} />}
                            disabled={!isModelAvailable}
                            title={
                              !isModelAvailable
                                ? chatDisabledReason
                                : t('Switch to New Project')
                            }
                          >
                            {t('Switch to New Project')}
                          </Button>
                        </div>
                      )}
                  </CollapsibleToolSection>
                )}
              </>
            ) : (
              <>
                {msg.thinking && (
                  <CollapsibleToolSection
                    title={t('Thinking Process')}
                    isExpanded={
                      isThinkingExpanded !== undefined
                        ? isThinkingExpanded
                        : isLoading && isLast
                    }
                    onExpandedChange={(next: boolean): void =>
                      onThinkingToggle(msg.id, next)
                    }
                  >
                    <div className="text-xs italic text-brand-gray-500 whitespace-pre-wrap">
                      {msg.thinking}
                    </div>
                  </CollapsibleToolSection>
                )}
                <MarkdownView content={msg.text} />
                {msg.role === 'user' &&
                  msg.attachments &&
                  msg.attachments.length > 0 && (
                    <div className="mt-3 rounded-lg border border-brand-gray-200/80 bg-brand-gray-50/80 p-3 text-sm text-brand-gray-700 dark:border-brand-gray-700 dark:bg-brand-gray-950/60 dark:text-brand-gray-200">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-gray-500 dark:text-brand-gray-400">
                        {t('Attachments')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {msg.attachments.map(
                          (attachment: import('../../../types').ChatAttachment) => (
                            <div
                              key={attachment.id}
                              className="inline-flex items-center gap-2 rounded-full border border-brand-gray-300 bg-white px-3 py-1 text-xs text-brand-gray-700 dark:border-brand-gray-700 dark:bg-brand-gray-900 dark:text-brand-gray-200"
                              title={attachment.name}
                            >
                              <FileText size={14} />
                              <span className="truncate max-w-[10rem]">
                                {attachment.name}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                {msg.traceback && (
                  <CollapsibleToolSection
                    title={t('Stack Trace')}
                    defaultExpanded={false}
                  >
                    <div className="text-[10px] font-mono bg-black/5 dark:bg-black/40 p-2 rounded overflow-x-auto whitespace-pre border border-black/10 dark:border-white/10 text-red-600 dark:text-red-400">
                      {msg.traceback}
                    </div>
                  </CollapsibleToolSection>
                )}
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <CollapsibleToolSection
                    title={
                      t(
                        msg.tool_calls.length > 1
                          ? '{{count}} Tool Calls'
                          : '{{count}} Tool Call',
                        { count: msg.tool_calls.length }
                      ) +
                      ` [${msg.tool_calls.map((tc: import('../../../types').ChatToolCall): string => tc.name).join(', ')}]`
                    }
                  >
                    <div className="space-y-2">
                      {msg.tool_calls.map(
                        (tc: import('../../../types').ChatToolCall, i: number) => (
                          <div
                            key={i}
                            className="p-2 rounded bg-black/5 dark:bg-black/20 border border-black/10 dark:border-white/10 text-[10px] font-mono"
                          >
                            <div className="text-blue-600 dark:text-blue-400 font-bold mb-1">
                              {t('Call: ')}
                              {tc.name}
                            </div>
                            <ToolCallArguments args={tc.args} />
                          </div>
                        )
                      )}
                    </div>
                  </CollapsibleToolSection>
                )}
              </>
            )}
          </div>
        )}

        {/* Action buttons (shown on hover) */}
        {!anyMessageBeingEdited && !isLoading && (
          <div className="mt-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(): void => onStartEditing(msg)}
              className="p-1 text-brand-gray-400 hover:text-brand-gray-600 bg-brand-gray-950/5 rounded"
              title={!isModelAvailable ? chatDisabledReason : t('Edit')}
              disabled={!isModelAvailable}
            >
              <Edit2 size={12} />
            </button>
            <button
              onClick={(): void => onDeleteMessage(msg.id)}
              className="p-1 text-brand-gray-400 hover:text-red-500 bg-brand-gray-950/5 rounded"
              title={!isModelAvailable ? chatDisabledReason : t('Delete')}
              disabled={!isModelAvailable}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

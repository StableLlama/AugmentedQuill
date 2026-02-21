// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the chat unit so this responsibility stays isolated, testable, and easy to evolve.

import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, AppTheme, ChatSession } from '../../types';
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  Globe,
  RefreshCw,
  Trash2,
  Edit2,
  Save,
  X,
  Settings2,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Plus,
  Ghost,
  History,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { MarkdownView } from '../editor/MarkdownView';

type SearchResult = {
  title?: string;
  href?: string;
  url?: string;
  body?: string;
  snippet?: string;
};

const CollapsibleToolSection: React.FC<{
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}> = ({ title, children, defaultExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <div className="mt-2 border border-black/10 dark:border-white/10 rounded overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-2 py-1 bg-black/5 dark:bg-black/20 hover:bg-black/10 dark:hover:bg-black/30 transition-colors text-[10px] font-mono text-brand-gray-500"
      >
        <span className="flex items-center gap-1">
          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {title}
        </span>
      </button>
      {isExpanded && <div className="p-2 bg-transparent">{children}</div>}
    </div>
  );
};

interface ChatProps {
  messages: ChatMessage[];
  isLoading: boolean;
  systemPrompt: string;
  onSendMessage: (text: string) => void;
  onStop?: () => void;
  onRegenerate: () => void;
  onEditMessage: (id: string, newText: string) => void;
  onDeleteMessage: (id: string) => void;
  onUpdateSystemPrompt: (newPrompt: string) => void;
  onSwitchProject?: (id: string) => void;
  theme?: AppTheme;
  sessions: ChatSession[];
  currentSessionId: string | null;
  isIncognito: boolean;
  onSelectSession: (id: string) => void;
  onNewSession: (incognito?: boolean) => void;
  onDeleteSession: (id: string) => void;
  onDeleteAllSessions?: () => void;
  onToggleIncognito: (val: boolean) => void;
  allowWebSearch: boolean;
  onToggleWebSearch: (val: boolean) => void;
}

const WebSearchResults: React.FC<{ content: string; name: string }> = ({
  content,
  name,
}) => {
  try {
    const data = JSON.parse(content);
    const results = Array.isArray(data) ? data : data.results || [];
    const query = data.query || '';

    return (
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-2 pb-2 border-b border-blue-500/20">
          <Globe className="text-blue-500" size={16} />
          <span className="font-bold text-xs text-blue-700 dark:text-blue-400">
            {name === 'wikipedia_search' ? 'Wikipedia:' : 'Web Search:'}
          </span>
          <span className="italic text-brand-gray-600 dark:text-brand-gray-400 text-xs truncate">
            "{query}"
          </span>
        </div>

        {results.length === 0 ? (
          <div className="text-[11px] text-brand-gray-500 italic py-2">
            {data.error ? `Error: ${data.error}` : 'No relevant results found.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 py-2">
            {results.map((r: SearchResult, i: number) => (
              <div
                key={i}
                className="group flex flex-col p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-blue-500/20"
              >
                <a
                  href={r.href || r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-semibold text-sm line-clamp-1"
                >
                  {r.title}
                </a>
                <div className="text-[10px] text-green-700 dark:text-green-500 truncate mt-0.5">
                  {r.href || r.url}
                </div>
                {r.body || r.snippet ? (
                  <div className="text-brand-gray-600 dark:text-brand-gray-300 text-[11px] line-clamp-2 mt-1 leading-snug">
                    {r.body || r.snippet}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } catch (e) {
    return <MarkdownView content={content} />;
  }
};

const VisitPageResult: React.FC<{ content: string }> = ({ content }) => {
  try {
    const data = JSON.parse(content);
    return (
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-2 pb-2 border-b border-amber-500/20">
          <ArrowRight className="text-amber-500" size={14} />
          <span className="font-bold text-xs text-amber-700 dark:text-amber-400">
            Visited Page:
          </span>
        </div>

        <div className="bg-amber-500/5 border border-amber-500/10 rounded p-2 text-[10px] text-brand-gray-500 break-all font-mono">
          {data.url}
        </div>

        {data.error ? (
          <div className="text-[11px] text-red-500 italic p-1">
            Error loading page: {data.error}
          </div>
        ) : (
          <div className="bg-white/80 dark:bg-black/20 border border-black/5 dark:border-white/5 rounded-lg p-3">
            <div className="max-h-80 overflow-y-auto custom-scrollbar text-[11px] whitespace-pre-wrap opacity-90 font-sans leading-relaxed">
              {data.content}
            </div>
            <div className="mt-2 text-right">
              <span className="text-[9px] text-brand-gray-400 uppercase tracking-wider">
                Extracted Text ({Math.round(data.content.length / 1024)} KB)
              </span>
            </div>
          </div>
        )}
      </div>
    );
  } catch (e) {
    return <MarkdownView content={content} />;
  }
};

export const Chat: React.FC<ChatProps> = ({
  messages,
  isLoading,
  systemPrompt,
  onSendMessage,
  onStop,
  onRegenerate,
  onEditMessage,
  onDeleteMessage,
  onUpdateSystemPrompt,
  onSwitchProject,
  theme = 'mixed',
  sessions,
  currentSessionId,
  isIncognito,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onDeleteAllSessions,
  onToggleIncognito,
  allowWebSearch,
  onToggleWebSearch,
}) => {
  const [input, setInput] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [tempSystemPrompt, setTempSystemPrompt] = useState(systemPrompt);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const isLight = theme === 'light';
  const bgMain = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-900';
  const borderMain = isLight ? 'border-brand-gray-200' : 'border-brand-gray-800';
  const textMain = isLight ? 'text-brand-gray-800' : 'text-brand-gray-400';
  const headerBg = isLight ? 'bg-brand-gray-100' : 'bg-brand-gray-900';
  const msgUserBg = isLight
    ? 'bg-blue-600 text-white'
    : 'bg-blue-900/40 text-blue-300 border border-blue-800/50';
  const msgBotBg = isLight
    ? 'bg-brand-gray-50 border border-brand-gray-200 shadow-sm'
    : 'bg-brand-gray-800/50 border border-brand-gray-700 shadow-sm';
  const inputBg = isLight
    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-900'
    : 'bg-brand-gray-950 border-brand-gray-800 text-brand-gray-300';

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      // Consider "at bottom" if within 100px of the actual bottom to be more forgiving
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      isAtBottomRef.current = isAtBottom;
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, isLoading, editingMessageId]);

  // Always scroll to bottom on session switch
  useEffect(() => {
    isAtBottomRef.current = true;
    scrollToBottom('auto');
  }, [currentSessionId]);

  useEffect(() => {
    setTempSystemPrompt(systemPrompt);
  }, [systemPrompt]);

  // Handle textarea auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const maxHeight = window.innerHeight * 0.5;
      const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      // Force scroll to bottom on user message
      isAtBottomRef.current = true;
      setTimeout(() => scrollToBottom('auto'), 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const startEditing = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.text);
  };

  const saveEdit = (id: string) => {
    if (editContent.trim()) {
      onEditMessage(id, editContent.trim());
      setEditingMessageId(null);
      setEditContent('');
    }
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleSystemPromptSave = () => {
    onUpdateSystemPrompt(tempSystemPrompt);
    setShowSystemPrompt(false);
  };

  const lastMessage = messages[messages.length - 1];
  const canRegenerate = !isLoading && lastMessage?.role === 'model';

  return (
    <div
      className={`flex flex-col h-full border-l ${bgMain} ${borderMain} ${textMain}`}
    >
      <div
        className={`p-4 border-b flex items-center justify-between ${headerBg} ${borderMain}`}
      >
        <div className="flex items-center space-x-2 overflow-hidden">
          <Sparkles className="text-blue-600 shrink-0" size={20} />
          <h2 className="font-semibold truncate">
            {isIncognito ? 'Incognito Chat' : 'Writing Partner'}
          </h2>
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

      {showHistory && (
        <div
          className={`p-4 border-b max-h-60 overflow-y-auto ${headerBg} ${borderMain}`}
        >
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
              onClick={() => setShowHistory(false)}
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
            {sessions.map((s) => {
              const isSIncognito = s.isIncognito;
              return (
                <div
                  key={s.id}
                  className={`group flex items-center justify-between p-2 rounded text-sm cursor-pointer transition-colors ${
                    currentSessionId === s.id
                      ? 'bg-brand-gray-200 dark:bg-brand-gray-800 text-brand-600 font-medium'
                      : 'hover:bg-brand-gray-200/50 dark:hover:bg-brand-gray-800/50'
                  }`}
                  onClick={() => {
                    onSelectSession(s.id);
                    setShowHistory(false);
                  }}
                >
                  <div className="flex flex-col overflow-hidden">
                    <div className="flex items-center space-x-1">
                      {isSIncognito && (
                        <Ghost size={12} className="text-purple-500 shrink-0" />
                      )}
                      <span className="truncate">{s.name}</span>
                    </div>
                    <span className="text-[10px] text-brand-gray-500">
                      {isSIncognito
                        ? 'Not saved to disk'
                        : s.updated_at
                          ? new Date(s.updated_at).toLocaleString()
                          : 'Unknown date'}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this chat?')) {
                        onDeleteSession(s.id);
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
      )}

      {showSystemPrompt && (
        <div
          className={`p-4 border-b animate-in slide-in-from-top-2 ${bgMain} ${borderMain}`}
        >
          <label className="block text-xs font-medium text-brand-gray-500 uppercase tracking-wider mb-2">
            System Instruction
          </label>
          <textarea
            value={tempSystemPrompt}
            onChange={(e) => setTempSystemPrompt(e.target.value)}
            className={`w-full h-32 rounded-md p-3 text-sm focus:ring-1 focus:ring-brand-500 focus:outline-none resize-none mb-3 border ${inputBg}`}
            placeholder="Define the AI's persona and rules..."
          />
          <div className="flex justify-end space-x-2">
            <Button
              theme={theme}
              size="sm"
              variant="ghost"
              onClick={() => setShowSystemPrompt(false)}
            >
              Cancel
            </Button>
            <Button
              theme={theme}
              size="sm"
              variant="primary"
              onClick={handleSystemPromptSave}
            >
              Update Persona
            </Button>
          </div>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto p-4 space-y-4 ${
          isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950/30'
        }`}
      >
        {messages.length === 0 && !showSystemPrompt && (
          <div className="text-center text-brand-gray-500 mt-10 p-4">
            <Bot className="mx-auto mb-3 opacity-50" size={40} />
            <p className="text-sm">
              I'm your AI co-author. Ask me to write, edit, or brainstorm ideas for your
              story!
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={msg.id}
            className={`group flex items-start space-x-3 ${
              msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'
            }`}
          >
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

            <div className={'flex-1 max-w-[85%] relative'}>
              {editingMessageId === msg.id ? (
                <div
                  className={`border rounded-lg p-3 shadow-lg ${
                    isLight
                      ? 'bg-brand-gray-50 border-brand-gray-200'
                      : 'bg-brand-gray-800 border-brand-gray-600'
                  }`}
                >
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className={`w-full text-sm p-2 rounded border focus:outline-none focus:border-brand-500 min-h-[100px] ${inputBg}`}
                  />
                  <div className="flex justify-end space-x-2 mt-2">
                    <button
                      onClick={cancelEdit}
                      className="p-1 text-brand-gray-400 hover:text-brand-gray-600"
                    >
                      <X size={14} />
                    </button>
                    <button
                      onClick={() => saveEdit(msg.id)}
                      className="p-1 text-brand-500 hover:opacity-80"
                    >
                      <Save size={14} />
                    </button>
                  </div>
                </div>
              ) : (
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
                        <CollapsibleToolSection title={`Tool Result: ${msg.name}`}>
                          <MarkdownView content={msg.text} />
                          {msg.name === 'create_project' &&
                            msg.text.includes('Project created:') &&
                            onSwitchProject && (
                              <div className="mt-2">
                                <Button
                                  theme={theme}
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => {
                                    // Extract project name from either raw text or JSON message field
                                    let projectName = '';
                                    try {
                                      const parsed = JSON.parse(msg.text);
                                      const innerMsg = parsed.message || '';
                                      const match =
                                        innerMsg.match(/Project created: (.+)/);
                                      if (match) projectName = match[1];
                                    } catch (e) {
                                      /* ignore */
                                    }

                                    if (!projectName) {
                                      const match = msg.text.match(
                                        /Project created: ([^"}\s]+)/
                                      );
                                      if (match) projectName = match[1];
                                    }

                                    if (projectName) {
                                      onSwitchProject(projectName.trim());
                                    }
                                  }}
                                  icon={<ArrowRight size={14} />}
                                >
                                  Switch to New Project
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
                          title="Thinking Process"
                          defaultExpanded={isLoading && i === messages.length - 1}
                        >
                          <div className="text-xs italic text-brand-gray-500 whitespace-pre-wrap">
                            {msg.thinking}
                          </div>
                        </CollapsibleToolSection>
                      )}
                      <MarkdownView content={msg.text} />
                      {msg.traceback && (
                        <CollapsibleToolSection
                          title="Stack Trace"
                          defaultExpanded={false}
                        >
                          <div className="text-[10px] font-mono bg-black/5 dark:bg-black/40 p-2 rounded overflow-x-auto whitespace-pre border border-black/10 dark:border-white/10 text-red-600 dark:text-red-400">
                            {msg.traceback}
                          </div>
                        </CollapsibleToolSection>
                      )}
                      {msg.tool_calls && msg.tool_calls.length > 0 && (
                        <CollapsibleToolSection
                          title={`${msg.tool_calls.length} Tool Call${
                            msg.tool_calls.length > 1 ? 's' : ''
                          }`}
                        >
                          <div className="space-y-2">
                            {msg.tool_calls.map((tc, i) => (
                              <div
                                key={i}
                                className="p-2 rounded bg-black/5 dark:bg-black/20 border border-black/10 dark:border-white/10 text-[10px] font-mono"
                              >
                                <div className="text-blue-600 dark:text-blue-400 font-bold mb-1">
                                  Call: {tc.name}
                                </div>
                                <div className="whitespace-pre-wrap break-all opacity-80 max-h-[300px] overflow-y-auto custom-scrollbar">
                                  {typeof tc.args === 'string'
                                    ? tc.args
                                    : JSON.stringify(tc.args, null, 2)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CollapsibleToolSection>
                      )}
                    </>
                  )}
                </div>
              )}

              {!editingMessageId && !isLoading && (
                <div
                  className={`absolute top-0 ${
                    msg.role === 'user'
                      ? 'left-0 -translate-x-full pr-2'
                      : 'right-0 translate-x-full pl-2'
                  } opacity-0 group-hover:opacity-100 transition-opacity flex flex-col space-y-1`}
                >
                  <button
                    onClick={() => startEditing(msg)}
                    className="p-1 text-brand-gray-400 hover:text-brand-gray-600 bg-brand-gray-950/5 rounded"
                    title="Edit"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => onDeleteMessage(msg.id)}
                    className="p-1 text-brand-gray-400 hover:text-red-500 bg-brand-gray-950/5 rounded"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center space-x-3">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${
                isLight
                  ? 'bg-brand-gray-50 border-brand-gray-200'
                  : 'bg-brand-gray-900/30 border-brand-gray-800'
              }`}
            >
              <Bot size={16} className="text-brand-gray-400" />
            </div>
            <div
              className={`px-4 py-2 rounded-lg shadow-sm border ${
                isLight
                  ? 'bg-brand-gray-50 border-brand-gray-200'
                  : 'bg-brand-gray-800 border-brand-gray-700'
              }`}
            >
              <Loader2 className="animate-spin text-brand-500" size={16} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={`p-4 border-t ${bgMain} ${borderMain}`}>
        {(canRegenerate || isLoading) && (
          <div className="flex justify-center mb-4">
            {isLoading ? (
              <Button
                theme={theme}
                size="sm"
                variant="secondary"
                onClick={onStop}
                icon={<X size={12} />}
                className="text-xs py-1 h-7 border-dashed border-red-500/50 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                title="Stop generation"
              >
                Stop generation
              </Button>
            ) : (
              <Button
                theme={theme}
                size="sm"
                variant="secondary"
                onClick={onRegenerate}
                icon={<RefreshCw size={12} />}
                className="text-xs py-1 h-7 border-dashed"
                title="Regenerate last response (CHAT model)"
              >
                Regenerate last response
              </Button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your instruction..."
            className={`w-full pl-4 pr-12 py-3 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all text-sm placeholder-brand-gray-400 border resize-none overflow-y-auto ${inputBg}`}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 bottom-2 p-2 text-brand-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-brand-gray-200 dark:hover:bg-brand-gray-700 rounded-full transition-colors"
            title="Send Message (CHAT model)"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
};

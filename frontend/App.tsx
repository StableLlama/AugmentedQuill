// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStory } from './hooks/useStory';
import { StoryMetadata } from './components/StoryMetadata';
import { ChapterList } from './components/ChapterList';
import { Editor } from './components/Editor';
import { Chat } from './components/Chat';
import { ProjectImages } from './components/ProjectImages';
import { DebugLogs } from './components/DebugLogs';
import { Button } from './components/Button';
import { SettingsDialog } from './components/SettingsDialog';
import { CreateProjectDialog } from './components/CreateProjectDialog';
import { ModelSelector } from './components/ModelSelector';
import {
  ChatMessage,
  Chapter,
  EditorSettings,
  ViewMode,
  AppSettings,
  ProjectMetadata,
  StoryState,
  AppTheme,
} from './types';
import {
  createChatSession,
  generateSimpleContent,
  generateContinuations,
} from './services/openaiService';
import {
  Undo,
  Redo,
  Wand2,
  FileText,
  Settings as SettingsIcon,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Sun,
  Moon,
  Bug,
  Type,
  Monitor,
  X,
  Code,
  Eye,
  Bold,
  Italic,
  Pilcrow,
  SplitSquareHorizontal,
  Menu,
  MessageSquare,
  BookOpen,
  FileEdit,
  Quote,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  SquareAsterisk,
  ChevronDown,
  MoreHorizontal,
  LayoutTemplate,
  Palette,
} from 'lucide-react';
import { api } from './services/api';

// Default Settings
const DEFAULT_APP_SETTINGS: AppSettings = {
  providers: [
    {
      id: 'default',
      name: 'OpenAI (Default)',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      timeout: 30000,
      modelId: 'gpt-4o',
      temperature: 0.7,
      topP: 0.95,
      prompts: { system: '', continuation: '', summary: '' },
    },
  ],
  activeChatProviderId: 'default',
  activeWritingProviderId: 'default',
  activeEditingProviderId: 'default',
};

const App: React.FC = () => {
  const {
    story,
    currentChapterId,
    selectChapter,
    updateStoryMetadata,
    updateStoryImageSettings,
    updateChapter,
    updateBook,
    addChapter,
    deleteChapter,
    loadStory,
    refreshStory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useStory();

  const currentChapter = story.chapters.find((c) => c.id === currentChapterId);
  const editorRef = useRef<any>(null);
  const appearanceRef = useRef<HTMLDivElement>(null);

  // App State
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('augmentedquill_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migration: if we have activeStoryProviderId but not the new ones
        if (parsed.activeStoryProviderId && !parsed.activeWritingProviderId) {
          return {
            ...parsed,
            activeWritingProviderId: parsed.activeStoryProviderId,
            activeEditingProviderId: parsed.activeStoryProviderId,
          };
        }
        // Migration: if we only have activeProviderId (very old)
        if (!parsed.activeWritingProviderId && parsed.activeProviderId) {
          return {
            ...parsed,
            activeChatProviderId: parsed.activeProviderId,
            activeWritingProviderId: parsed.activeProviderId,
            activeEditingProviderId: parsed.activeProviderId,
          };
        }
        return parsed.activeWritingProviderId ? parsed : DEFAULT_APP_SETTINGS;
      } catch (e) {
        return DEFAULT_APP_SETTINGS;
      }
    }
    return DEFAULT_APP_SETTINGS;
  });

  const [modelConnectionStatus, setModelConnectionStatus] = useState<
    Record<string, 'idle' | 'success' | 'error' | 'loading'>
  >({});
  const [detectedCapabilities, setDetectedCapabilities] = useState<
    Record<string, { is_multimodal: boolean; supports_function_calling: boolean }>
  >({});

  useEffect(() => {
    let cancelled = false;
    const checkProviders = async () => {
      // Check active providers first, or all. Checking all might be slow if many.
      // Let's check unique active providers.
      const activeIds = new Set([
        appSettings.activeChatProviderId,
        appSettings.activeWritingProviderId,
        appSettings.activeEditingProviderId,
      ]);

      const providersToCheck = appSettings.providers.filter((p) => activeIds.has(p.id));

      for (const p of providersToCheck) {
        if (cancelled) return;
        // Don't re-check if already success? User says "currently working or not", implying live check on load.
        // We will check.
        setModelConnectionStatus((prev) => ({ ...prev, [p.id]: 'loading' }));

        try {
          // 1. Connection check
          const modelId = p.modelId || '';
          if (!modelId) {
            setModelConnectionStatus((prev) => ({ ...prev, [p.id]: 'idle' }));
            continue;
          }

          const res = await api.machine.testModel({
            base_url: p.baseUrl,
            api_key: p.apiKey,
            timeout_s: Math.round((p.timeout || 10000) / 1000),
            model_id: modelId,
          });

          if (cancelled) return;

          if (res.model_ok && res.capabilities) {
            setDetectedCapabilities((prev) => ({ ...prev, [p.id]: res.capabilities! }));
          }

          setModelConnectionStatus((prev) => ({
            ...prev,
            [p.id]: res.model_ok ? 'success' : 'error',
          }));
        } catch (e) {
          if (cancelled) return;
          setModelConnectionStatus((prev) => ({ ...prev, [p.id]: 'error' }));
        }
      }
    };

    // Simple debounce/dedupe: only run if providers change or IDs change
    checkProviders();

    return () => {
      cancelled = true;
    };
  }, [
    appSettings.providers,
    appSettings.activeChatProviderId,
    appSettings.activeEditingProviderId,
    appSettings.activeWritingProviderId,
  ]);

  const [projects, setProjects] = useState<ProjectMetadata[]>(() => {
    const saved = localStorage.getItem('augmentedquill_projects_meta');
    return saved
      ? JSON.parse(saved)
      : [{ id: story.id, title: story.title, updatedAt: Date.now() }];
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const stopSignalRef = useRef(false);
  const [isAiActionLoading, setIsAiActionLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        appearanceRef.current &&
        !appearanceRef.current.contains(event.target as Node)
      ) {
        setIsAppearanceOpen(false);
      }
    }

    if (isAppearanceOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAppearanceOpen]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isImagesOpen, setIsImagesOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isDebugLogsOpen, setIsDebugLogsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('raw');
  const [showWhitespace, setShowWhitespace] = useState<boolean>(false);
  const [activeFormats, setActiveFormats] = useState<string[]>([]);

  // UI State for Header Dropdowns
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
  const [isMobileFormatMenuOpen, setIsMobileFormatMenuOpen] = useState(false);

  // Suggestion State
  const [continuations, setContinuations] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSuggestionMode, setIsSuggestionMode] = useState(false);
  const [suggestCursor, setSuggestCursor] = useState<number | null>(null);
  const [suggestUndoStack, setSuggestUndoStack] = useState<
    Array<{ content: string; cursor: number }>
  >([]);

  // Prompts State
  const [prompts, setPrompts] = useState<{
    system_messages: Record<string, string>;
    user_prompts: Record<string, string>;
  }>({ system_messages: {}, user_prompts: {} });

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const data = await api.settings.getPrompts();
        if (data.ok) {
          setPrompts({
            system_messages: data.system_messages,
            user_prompts: data.user_prompts,
          });
        }
      } catch (e) {
        console.error('Failed to fetch prompts', e);
      }
    };
    fetchPrompts();
  }, [story.id]); // Re-fetch when project changes

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const data = await api.projects.list();
        if (data.available) {
          setProjects(
            data.available.map((p: any) => ({
              id: p.name,
              title: p.title || p.name,
              type: p.type || 'novel',
              updatedAt: Date.now(),
            }))
          );
        }
      } catch (e) {
        console.error('Failed to fetch projects', e);
      }
    };
    fetchProjects();
  }, []);

  // Editor Appearance Settings
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(() => {
    const saved = localStorage.getItem('augmentedquill_editor_settings');
    const defaults: EditorSettings = {
      fontSize: 18,
      maxWidth: 60,
      brightness: 0.95,
      contrast: 0.9,
      theme: 'mixed', // Default: Dark UI + Light Paper
      sidebarWidth: 320,
    };
    if (saved) {
      try {
        return { ...defaults, ...JSON.parse(saved) };
      } catch (e) {
        return defaults;
      }
    }
    return defaults;
  });

  // Persist Settings
  useEffect(() => {
    localStorage.setItem('augmentedquill_settings', JSON.stringify(appSettings));
  }, [appSettings]);

  useEffect(() => {
    localStorage.setItem(
      'augmentedquill_editor_settings',
      JSON.stringify(editorSettings)
    );
  }, [editorSettings]);

  // Persist Current Project Logic
  useEffect(() => {
    if (story && story.id) {
      localStorage.setItem(`project_${story.id}`, JSON.stringify(story));
      setProjects((prev) => {
        const exists = prev.find((p) => p.id === story.id);
        if (
          exists &&
          exists.title === story.title &&
          exists.type === story.projectType
        ) {
          return prev.map((p) =>
            p.id === story.id ? { ...p, updatedAt: Date.now() } : p
          );
        } else if (exists) {
          return prev.map((p) =>
            p.id === story.id
              ? {
                  ...p,
                  title: story.title,
                  type: story.projectType,
                  updatedAt: Date.now(),
                }
              : p
          );
        } else {
          return [
            ...prev,
            {
              id: story.id,
              title: story.title,
              type: story.projectType,
              updatedAt: Date.now(),
            },
          ];
        }
      });
    }
  }, [story.title, story.chapters, story.summary, story.styleTags]);

  useEffect(() => {
    localStorage.setItem('augmentedquill_projects_meta', JSON.stringify(projects));
  }, [projects]);

  // Project Management Functions
  const handleLoadProject = async (id: string) => {
    try {
      const res = await api.projects.select(id);
      if (res.ok) {
        await refreshStory();
        setChatMessages([]);
      }
    } catch (e) {
      console.error('Failed to load project', e);
    }
  };

  const handleImportProject = async (file: File) => {
    try {
      const res = await api.projects.import(file);
      if (res.ok) {
        const available = res.available;
        if (available) {
          setProjects(
            available.map((p: any) => ({
              id: p.name,
              title: p.title || p.name,
              type: p.type || 'novel',
              updatedAt: Date.now(),
            }))
          );
        }
      }
    } catch (e: any) {
      console.error(e);
      alert(`Import failed: ${e.message}`);
    }
  };

  const handleCreateProject = () => {
    setIsCreateProjectOpen(true);
  };

  const handleCreateProjectConfirm = async (name: string, type: string) => {
    try {
      const result = await api.projects.create(name, type);
      if (result.ok) {
        // Refresh list
        const data = await api.projects.list();
        if (data.projects) {
          setProjects(
            data.projects.map((p: any) => ({
              id: p.name, // Use folder name as ID if ID not in metadata?
              // Wait, backend list_projects returns {name:..., path:..., title:...}
              // Previously App used story.id. Backend story.json doesn't strictly enforce ID but frontend uses uuid.
              // Let's rely on backend 'story' object returned by create.
              title: p.title || p.name,
              updatedAt: Date.now(),
            }))
          );
        }
        if (result.story) {
          // Ensure story object has the correct ID (folder name) and matches StoryState structure
          const mappedStory: StoryState = {
            id: name, // Vital: Use the directory name as ID for subsequent API calls
            title: result.story.project_title || name,
            summary: result.story.story_summary || '',
            projectType: result.story.project_type || 'novel',
            styleTags: result.story.tags || [],
            chapters: (result.story.chapters || []).map((c: any, i: number) => ({
              id: String(i + 1),
              title: c.title || '',
              summary: c.summary || '',
              content: '',
            })),
            currentChapterId: null,
            lastUpdated: Date.now(),
          };

          // For short-story projects (empty chapters in JSON), add the virtual chapter manually
          // so the UI doesn't look empty before fetchStory kicks in
          if (type === 'short-story' && mappedStory.chapters.length === 0) {
            mappedStory.chapters = [
              {
                id: '1',
                title: mappedStory.title,
                summary: '',
                content: '',
              },
            ];
            mappedStory.currentChapterId = '1';
          }

          loadStory(mappedStory as any);
          setChatMessages([]);
        }
        setIsCreateProjectOpen(false);
        if (isSettingsOpen) setIsSettingsOpen(false);
      }
    } catch (e) {
      console.error('Failed to create project', e);
      alert('Failed to create project: ' + e);
    }
  };

  const handleDeleteProject = (id: string) => {
    if (projects.length <= 1) return;
    const newProjects = projects.filter((p) => p.id !== id);
    setProjects(newProjects);
    localStorage.removeItem(`project_${id}`);
    if (id === story.id) {
      handleLoadProject(newProjects[0].id);
    }
  };

  const handleRenameProject = (id: string, newName: string) => {
    if (id === story.id) {
      updateStoryMetadata(newName, story.summary, story.styleTags);
    } else {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, title: newName } : p))
      );
      const saved = localStorage.getItem(`project_${id}`);
      if (saved) {
        const loaded = JSON.parse(saved);
        loaded.title = newName;
        localStorage.setItem(`project_${id}`, JSON.stringify(loaded));
      }
    }
  };

  // Get Active LLM Configs
  const activeChatConfig =
    appSettings.providers.find((p) => p.id === appSettings.activeChatProviderId) ||
    appSettings.providers[0];
  const activeWritingConfig =
    appSettings.providers.find((p) => p.id === appSettings.activeWritingProviderId) ||
    appSettings.providers[0];
  const activeEditingConfig =
    appSettings.providers.find((p) => p.id === appSettings.activeEditingProviderId) ||
    appSettings.providers[0];

  const getSystemPrompt = () => {
    return prompts.system_messages.chat_llm || '';
  };

  const [systemPrompt, setSystemPrompt] = useState(getSystemPrompt());

  useEffect(() => {
    setSystemPrompt(getSystemPrompt());
  }, [story.title, story.summary, story.styleTags, prompts]);

  const executeChatRequest = async (userText: string, history: ChatMessage[]) => {
    setIsChatLoading(true);
    stopSignalRef.current = false;
    try {
      let currentHistory = [...history];
      const session = createChatSession(
        systemPrompt,
        currentHistory,
        activeChatConfig,
        'CHAT'
      );

      let promptWithContext = userText;

      const updateMessage = (
        msgId: string,
        update: { text?: string; thinking?: string; traceback?: string }
      ) => {
        if (stopSignalRef.current) return;
        setChatMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === msgId);
          if (idx !== -1) {
            const newMsgs = [...prev];
            newMsgs[idx] = {
              ...newMsgs[idx],
              text: update.text ?? newMsgs[idx].text,
              thinking: update.thinking ?? newMsgs[idx].thinking,
              traceback: update.traceback ?? newMsgs[idx].traceback,
            };
            return newMsgs;
          } else {
            return [
              ...prev,
              {
                id: msgId,
                role: 'model',
                text: update.text ?? '',
                thinking: update.thinking ?? '',
                traceback: update.traceback ?? '',
              },
            ];
          }
        });
      };

      let currentMsgId = uuidv4();
      let result = await session.sendMessage({ message: promptWithContext }, (update) =>
        updateMessage(currentMsgId, update)
      );

      while (result.functionCalls && result.functionCalls.length > 0) {
        if (stopSignalRef.current) break;

        // 1. Update assistant message with tool calls in history
        const assistantMsg: ChatMessage = {
          id: currentMsgId,
          role: 'model',
          text: result.text || '',
          thinking: result.thinking,
          tool_calls: result.functionCalls,
        };

        // Replace or add
        setChatMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === currentMsgId);
          if (idx !== -1) {
            const newMsgs = [...prev];
            newMsgs[idx] = assistantMsg;
            return newMsgs;
          }
          return [...prev, assistantMsg];
        });

        currentHistory.push(assistantMsg);

        // 2. Execute tools via backend
        const toolResponse = await api.chat.executeTools({
          messages: currentHistory.map((m) => ({
            role: m.role === 'model' ? 'assistant' : m.role,
            content: m.text || null, // Ensure content is null if empty for tool calls
            tool_calls: m.tool_calls?.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args),
              },
            })),
          })),
          active_chapter_id: currentChapterId ? Number(currentChapterId) : undefined,
        });

        if (stopSignalRef.current) break;

        if (toolResponse.ok) {
          // 3. Add tool results to history
          for (const msg of toolResponse.appended_messages) {
            currentHistory.push({
              id: uuidv4(),
              role: 'tool',
              text: msg.content,
              name: msg.name,
              tool_call_id: msg.tool_call_id,
            });
          }
          setChatMessages([...currentHistory]);

          if (toolResponse.mutations?.story_changed) {
            await refreshStory();
          }

          if (stopSignalRef.current) break;

          // 4. Call LLM again with tool results
          // We create a new session with updated history
          const nextSession = createChatSession(
            systemPrompt,
            currentHistory,
            activeChatConfig,
            'CHAT'
          );
          currentMsgId = uuidv4();
          result = await nextSession.sendMessage({ message: '' }, (update) =>
            updateMessage(currentMsgId, update)
          );

          // If the new result also has function calls, the while loop continues.
          // If it's just text, the loop ends and we fall through to final update.
        } else {
          break;
        }
      }

      if (!stopSignalRef.current) {
        // Final message update
        const botMessage: ChatMessage = {
          id: currentMsgId,
          role: 'model',
          text: result.text || '',
          thinking: result.thinking,
          tool_calls: result.functionCalls, // Ensure tool calls are preserved in final state
        };
        setChatMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === currentMsgId);
          if (idx !== -1) {
            const newMsgs = [...prev];
            newMsgs[idx] = botMessage;
            return newMsgs;
          }
          return [...prev, botMessage];
        });
      }
    } catch (error: any) {
      if (stopSignalRef.current && error.name === 'AbortError') {
        // Ignored
      } else {
        let errorText = `AI Error: ${error.message || 'An unexpected error occurred'}`;
        if (error.data) {
          const detail =
            typeof error.data === 'string'
              ? error.data
              : JSON.stringify(error.data, null, 2);
          errorText += `\n\n**Details:**\n${detail}`;
        }

        const errorMessage: ChatMessage = {
          id: uuidv4(),
          role: 'model',
          text: errorText,
          isError: true,
          traceback: error.traceback,
        };
        setChatMessages((prev) => [...prev, errorMessage]);
      }
    } finally {
      setIsChatLoading(false);
      stopSignalRef.current = false;
    }
  };

  const handleSendMessage = async (text: string) => {
    const newMessage: ChatMessage = { id: uuidv4(), role: 'user', text };
    const newHistory = [...chatMessages, newMessage];
    setChatMessages(newHistory);
    await executeChatRequest(text, newHistory);
  };

  const handleStopChat = () => {
    stopSignalRef.current = true;
    setIsChatLoading(false);
  };

  const handleRegenerate = async () => {
    const lastMsgIndex = chatMessages.length - 1;
    if (lastMsgIndex < 0) return;
    const lastMsg = chatMessages[lastMsgIndex];
    if (lastMsg.role !== 'model') return;
    const userMsgIndex = lastMsgIndex - 1;
    if (userMsgIndex < 0) return;
    const userMsg = chatMessages[userMsgIndex];
    if (userMsg.role !== 'user') return;

    const newHistory = chatMessages.slice(0, userMsgIndex);
    setChatMessages([...newHistory, userMsg]);
    await executeChatRequest(userMsg.text, newHistory);
  };

  const handleEditMessage = (id: string, newText: string) => {
    setChatMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, text: newText } : msg))
    );
  };

  const handleDeleteMessage = (id: string) => {
    setChatMessages((prev) => prev.filter((msg) => msg.id !== id));
  };

  const clampCursor = (cursor: number, content: string) => {
    if (!Number.isFinite(cursor)) return content.length;
    return Math.max(0, Math.min(Math.floor(cursor), content.length));
  };

  const handleTriggerSuggestions = async (
    cursor?: number,
    contentOverride?: string,
    enableSuggestionMode: boolean = true
  ) => {
    if (!currentChapter) return;
    if (isSuggesting) return;

    const baseContent = contentOverride ?? currentChapter.content;
    const c = clampCursor(cursor ?? baseContent.length, baseContent);

    if (enableSuggestionMode) setIsSuggestionMode(true);
    setSuggestCursor(c);

    setIsSuggesting(true);
    setContinuations([]);
    try {
      const storyContext = `Title: ${story.title}\nSummary: ${
        story.summary
      }\nTags: ${story.styleTags.join(', ')}`;
      const options = await generateContinuations(
        baseContent.slice(0, c),
        storyContext,
        systemPrompt,
        activeWritingConfig,
        currentChapter.id
      );
      setContinuations(options);
    } catch (e: any) {
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'model',
        text: `Suggestion Error: ${e.message || 'Failed to generate suggestions'}`,
        isError: true,
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleAcceptContinuation = async (text: string) => {
    if (!currentChapterId || !currentChapter) return;

    // Dismiss
    if (!text) {
      setContinuations([]);
      setIsSuggestionMode(false);
      setSuggestCursor(null);
      setSuggestUndoStack([]);
      return;
    }

    const currentContent = currentChapter.content;
    const c = clampCursor(suggestCursor ?? currentContent.length, currentContent);
    const prefix = currentContent.slice(0, c);
    const suffix = currentContent.slice(c);

    // Preserve all whitespace provided by the model. Compute only the minimal
    // extra characters required so the resulting Markdown is valid and not
    // accidentally concatenated.
    const startsWithWhitespace = text.length > 0 && /^\s/.test(text);
    const endsWithWhitespace = prefix.length > 0 && /\s$/.test(prefix);

    const needsTokenBoundary =
      prefix.length > 0 && !endsWithWhitespace && !startsWithWhitespace;

    const countTrailingNewlines = (s: string) => {
      let i = s.length - 1;
      let count = 0;
      while (i >= 0 && s[i] === '\n') {
        count++;
        i--;
      }
      return count;
    };
    const countLeadingNewlines = (s: string) => {
      let i = 0;
      let count = 0;
      while (i < s.length && s[i] === '\n') {
        count++;
        i++;
      }
      return count;
    };

    let separator = '';

    if (prefix.length === 0) {
      // Inserting at document start: do not prepend newlines.
      separator = '';
    } else if (viewMode === 'raw') {
      // Raw mode: preserve model whitespace and only add a single space if
      // concatenation would merge tokens unintentionally.
      separator = needsTokenBoundary ? ' ' : '';
    } else {
      // Markdown / WYSIWYG rules: paragraphs need an empty line ("\n\n");
      // single line breaks are ignored in Markdown rendering. Compute how
      // many newlines already exist at the boundary and add the minimal
      // amount (or a single space if continuation should be inline).
      const preNewlines = countTrailingNewlines(prefix);
      const textNewlines = countLeadingNewlines(text);
      const totalBoundaryNewlines = preNewlines + textNewlines;

      if (totalBoundaryNewlines >= 2) {
        separator = '';
      } else if (preNewlines > 0 || textNewlines > 0) {
        // One side already has at least one newline: add the remainder.
        separator = '\n'.repeat(Math.max(0, 2 - totalBoundaryNewlines));
      } else {
        // No newlines on either side. If this looks like an inline
        // continuation (no surrounding whitespace), add a space. Otherwise
        // start a new paragraph.
        separator = needsTokenBoundary ? ' ' : '\n\n';
      }
    }

    const newContent = prefix + separator + text + suffix;

    setSuggestUndoStack((prev) => [...prev, { content: currentContent, cursor: c }]);
    updateChapter(currentChapterId, { content: newContent });

    const newCursor = c + separator.length + text.length;
    setSuggestCursor(newCursor);
    setIsSuggestionMode(true);

    // Continue generating from the insertion point
    await handleTriggerSuggestions(newCursor, newContent, true);
  };

  const handleKeyboardSuggestionAction = async (
    action: 'trigger' | 'chooseLeft' | 'chooseRight' | 'regenerate' | 'undo' | 'exit',
    cursor?: number
  ) => {
    if (!currentChapterId || !currentChapter) return;
    if (isSuggesting && action !== 'exit') return;

    if (action === 'exit') {
      setContinuations([]);
      setIsSuggestionMode(false);
      setSuggestCursor(null);
      setSuggestUndoStack([]);
      return;
    }

    if (action === 'trigger') {
      await handleTriggerSuggestions(cursor, undefined, true);
      return;
    }

    if (action === 'chooseLeft') {
      if (continuations[0]) await handleAcceptContinuation(continuations[0]);
      return;
    }

    if (action === 'chooseRight') {
      if (continuations[1]) await handleAcceptContinuation(continuations[1]);
      return;
    }

    if (action === 'regenerate') {
      const c = clampCursor(
        suggestCursor ?? cursor ?? currentChapter.content.length,
        currentChapter.content
      );
      await handleTriggerSuggestions(c, undefined, true);
      return;
    }

    if (action === 'undo') {
      const last = suggestUndoStack[suggestUndoStack.length - 1];
      if (!last) return;
      const nextStack = suggestUndoStack.slice(0, -1);
      setSuggestUndoStack(nextStack);

      updateChapter(currentChapterId, { content: last.content });
      setSuggestCursor(last.cursor);
      setIsSuggestionMode(true);
      await handleTriggerSuggestions(last.cursor, last.content, true);
    }
  };

  const handleAiAction = async (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => {
    if (!currentChapter) return;
    setIsAiActionLoading(true);
    let prompt = '';
    let sysMsg = systemPrompt;

    if (target === 'summary') {
      if (action === 'update') {
        sysMsg = prompts.system_messages.ai_action_summary_update || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_summary_update_user ||
          'Current Summary: {current_summary}\n\nChapter Content:\n{chapter_content}';
        prompt = template
          .replace('{current_summary}', currentChapter.summary)
          .replace('{chapter_content}', currentChapter.content);
      } else {
        // rewrite
        sysMsg = prompts.system_messages.ai_action_summary_rewrite || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_summary_rewrite_user ||
          'Chapter Content:\n{chapter_content}';
        prompt = template.replace('{chapter_content}', currentChapter.content);
      }
    } else {
      // chapter
      if (action === 'extend') {
        sysMsg = prompts.system_messages.ai_action_chapter_extend || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_chapter_extend_user ||
          'Summary: {chapter_summary}\n\nExisting Content:\n{chapter_content}';
        prompt = template
          .replace('{chapter_summary}', currentChapter.summary)
          .replace('{chapter_content}', currentChapter.content);
      } else {
        // rewrite
        sysMsg = prompts.system_messages.ai_action_chapter_rewrite || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_chapter_rewrite_user ||
          'Summary: {chapter_summary}\nStyle: {style_tags}';
        prompt = template
          .replace('{chapter_summary}', currentChapter.summary)
          .replace('{style_tags}', story.styleTags.join(', '));
      }
    }

    try {
      const modelType = target === 'summary' ? 'EDITING' : 'WRITING';
      const config = target === 'summary' ? activeEditingConfig : activeWritingConfig;
      const result = await generateSimpleContent(prompt, sysMsg, config, modelType, {
        tool_choice: 'none',
      });

      if (target === 'summary') {
        updateChapter(currentChapter.id, { summary: result });
      } else {
        if (action === 'extend') {
          const separator =
            currentChapter.content.length > 0 && !currentChapter.content.endsWith('\n')
              ? '\n\n'
              : '';
          updateChapter(currentChapter.id, {
            content: currentChapter.content + separator + result,
          });
        } else {
          updateChapter(currentChapter.id, { content: result });
        }
      }
    } catch (e: any) {
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'model',
        text: `AI Action Error: ${e.message || 'Failed to perform AI action'}`,
        isError: true,
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsAiActionLoading(false);
    }
  };

  const handleSidebarAiAction = async (
    type: 'chapter' | 'book',
    id: string,
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void
  ): Promise<string | undefined> => {
    setIsAiActionLoading(true);
    try {
      let prompt = '';
      let sysMsg = '';

      let currentSummary = '';
      let contentContext = '';

      if (type === 'chapter') {
        const ch = story.chapters.find((c) => c.id === id);
        if (!ch) return;
        currentSummary = ch.summary;
        contentContext = ch.content || '';
      } else {
        const bk = story.books.find((b) => b.id === id);
        if (!bk) return;
        currentSummary = bk.summary || '';

        // Aggregate chapter summaries
        const bookChapters = story.chapters.filter((c) => c.book_id === id);
        const chaptersText = bookChapters
          .map((c) => `Chapter: ${c.title}\nSummary: ${c.summary || 'No summary'}`)
          .join('\n\n');
        contentContext = `Book Title: ${bk.title}\n\nChapters:\n${chaptersText}`;
      }

      // Force 'write' mode if we are trying to update but have no summary
      if (action === 'update' && !currentSummary.trim()) {
        action = 'write';
      }

      const modelType = 'EDITING';
      const config = activeEditingConfig;

      if (action === 'update') {
        sysMsg = prompts.system_messages.ai_action_summary_update || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_summary_update_user ||
          'Current Summary: {current_summary}\n\nContent:\n{chapter_content}';

        prompt = template
          .replace('{current_summary}', currentSummary)
          .replace('{chapter_content}', contentContext);
      } else {
        // write or rewrite - treat as fresh generation from content
        sysMsg = prompts.system_messages.ai_action_summary_rewrite || systemPrompt;
        const template =
          prompts.user_prompts.ai_action_summary_rewrite_user ||
          'Content:\n{chapter_content}';
        prompt = template.replace('{chapter_content}', contentContext);
      }

      // Helper to strip artifacts from the stream
      const cleanText = (t: string) => {
        // Remove common prefixes: "Summary:", "Updated Summary:", "**Summary:**", etc.
        return t.replace(/^(\*\*?|##\s*)?(Updated )?Summary:?\**\s*/i, '');
      };

      const result = await generateSimpleContent(prompt, sysMsg, config, modelType, {
        tool_choice: 'none',
        onUpdate: onProgress
          ? (partial) => {
              onProgress(cleanText(partial));
            }
          : undefined,
      });

      return cleanText(result);
    } catch (e: any) {
      console.error(e);
      alert(`AI Action Failed: ${e.message}`);
    } finally {
      setIsAiActionLoading(false);
    }
  };

  const handleFormat = (type: string) => {
    if (editorRef.current) {
      editorRef.current.format(type);
      setIsFormatMenuOpen(false);
      setIsMobileFormatMenuOpen(false);
    }
  };

  const handleChapterSelect = (id: string) => {
    selectChapter(id);
    setIsSidebarOpen(false);
  };

  const ViewModeIcon = {
    raw: FileText,
    markdown: Code,
    wysiwyg: Eye,
  }[viewMode];

  const currentTheme = editorSettings.theme || 'mixed';
  const isLight = currentTheme === 'light';

  useEffect(() => {
    document.body.className = currentTheme;
  }, [currentTheme]);

  // Styles based on theme (Light vs Dark/Mixed for UI elements)
  const bgMain = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950';
  const textMain = isLight ? 'text-brand-gray-800' : 'text-brand-gray-300';
  const headerBg = isLight
    ? 'bg-brand-gray-50 border-brand-gray-200'
    : 'bg-brand-gray-900 border-brand-gray-800';
  const iconColor = isLight ? 'text-brand-gray-600' : 'text-brand-gray-400';
  const iconHover = isLight ? 'hover:text-brand-gray-900' : 'hover:text-brand-gray-300';
  const dividerColor = isLight ? 'bg-brand-gray-300' : 'bg-brand-gray-800';
  const buttonBg = isLight
    ? 'bg-brand-gray-100 text-brand-gray-700 hover:bg-brand-gray-200'
    : 'bg-brand-gray-800/50 text-brand-gray-400 hover:bg-brand-gray-800 hover:text-brand-gray-300';
  const buttonActive = isLight
    ? 'bg-brand-100 text-brand-700'
    : 'bg-brand-900/40 text-brand-300 border border-brand-800/50';

  const getFormatButtonClass = (type: string) => {
    const isActive = activeFormats.includes(type);
    if (isActive) return `p-1.5 rounded-md transition-colors ${buttonActive}`;
    return `p-1.5 rounded-md transition-colors ${
      isLight
        ? 'text-brand-gray-500 hover:bg-brand-gray-100 hover:text-brand-gray-700'
        : 'text-brand-gray-500 hover:bg-brand-gray-800 hover:text-brand-gray-300'
    }`;
  };

  const handleConvertProject = async (newType: string) => {
    try {
      await api.projects.convert(newType);
      await refreshStory();
    } catch (e: any) {
      alert(`Failed to convert project: ${e.message}`);
    }
  };

  const handleBookCreate = async (title: string) => {
    try {
      await api.books.create(title);
      await refreshStory();
    } catch (e: any) {
      console.error(e);
      alert(`Failed to create book: ${e.message}`);
    }
  };

  const handleBookDelete = async (id: string) => {
    try {
      await api.books.delete(id);
      await refreshStory();
    } catch (e: any) {
      console.error(e);
      alert(`Failed to delete book: ${e.message}`);
    }
  };

  const handleReorderChapters = async (chapterIds: number[], bookId?: string) => {
    try {
      await api.chapters.reorder(chapterIds, bookId);
      await refreshStory();
    } catch (e: any) {
      console.error(e);
      alert(`Failed to reorder chapters: ${e.message}`);
    }
  };

  const handleReorderBooks = async (bookIds: string[]) => {
    try {
      await api.books.reorder(bookIds);
      await refreshStory();
    } catch (e: any) {
      console.error(e);
      alert(`Failed to reorder books: ${e.message}`);
    }
  };

  const handleOpenImages = () => {
    if (editorRef.current && editorRef.current.openImageManager) {
      editorRef.current.openImageManager();
    }
  };

  const setAppTheme = (t: AppTheme) => {
    setEditorSettings((prev) => ({ ...prev, theme: t }));
  };

  const sliderClass = `w-full h-1.5 rounded-lg appearance-none cursor-pointer ${
    isLight
      ? 'bg-brand-gray-200 accent-brand-600'
      : 'bg-brand-gray-800 accent-brand-gray-500'
  }`;

  return (
    <div
      className={`flex flex-col h-screen font-sans overflow-hidden ${bgMain} ${textMain}`}
      style={
        {
          '--sidebar-width': `${editorSettings.sidebarWidth}px`,
        } as React.CSSProperties
      }
    >
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={appSettings}
        onSaveSettings={setAppSettings}
        projects={projects}
        activeProjectId={story.id}
        onLoadProject={handleLoadProject}
        onCreateProject={handleCreateProject}
        onImportProject={handleImportProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
        onConvertProject={handleConvertProject}
        activeProjectType={story.projectType}
        activeProjectStats={{
          chapterCount: story.chapters.length,
          bookCount: story.books?.length || 0,
        }}
        theme={currentTheme}
        defaultPrompts={prompts}
      />

      <ProjectImages
        isOpen={isImagesOpen}
        onClose={() => setIsImagesOpen(false)}
        theme={currentTheme}
        settings={appSettings}
        prompts={prompts}
        imageStyle={story.image_style}
        imageAdditionalInfo={story.image_additional_info}
        onUpdateSettings={updateStoryImageSettings}
        onInsert={(filename, url, altText) => {
          if (url && editorRef.current) {
            editorRef.current.insertImage(filename, url, altText);
            setIsImagesOpen(false);
          }
        }}
      />

      <CreateProjectDialog
        isOpen={isCreateProjectOpen}
        onClose={() => setIsCreateProjectOpen(false)}
        onCreate={handleCreateProjectConfirm}
        theme={currentTheme}
      />

      {/* Header / Toolbar */}
      <header
        className={`h-14 border-b flex items-center justify-between px-3 md:px-4 shadow-sm z-40 relative shrink-0 ${headerBg}`}
      >
        {/* Left: Branding & Navigation */}
        <div className="flex items-center space-x-2 md:space-x-4 shrink-0">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={`lg:hidden p-1 ${iconColor} ${iconHover}`}
          >
            <Menu size={24} />
          </button>

          <div
            className="flex items-center space-x-2 cursor-pointer"
            onClick={() => setIsSettingsOpen(true)}
          >
            <div
              className={`rounded-md p-1 shadow-lg ${
                isLight
                  ? 'bg-brand-gray-100 border border-brand-gray-200 shadow-brand-900/10'
                  : 'bg-brand-gray-600 border border-brand-gray-500 shadow-none'
              }`}
            >
              <img
                src="/static/images/icon.svg"
                className="w-6 h-6"
                alt="AugmentedQuill Logo"
              />
            </div>
            <div className="flex flex-col">
              <span
                className={`font-bold tracking-tight leading-none hidden sm:inline ${textMain}`}
              >
                AugmentedQuill
              </span>
              <span className="text-[10px] text-brand-gray-500 font-mono leading-none hidden sm:inline">
                {story.title}
              </span>
            </div>
          </div>

          <div className={`h-6 w-px hidden sm:block ${dividerColor}`}></div>

          <div className="flex space-x-1">
            <Button
              theme={currentTheme}
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              title="Undo"
            >
              <Undo size={16} />
            </Button>
            <Button
              theme={currentTheme}
              variant="ghost"
              size="sm"
              onClick={redo}
              disabled={!canRedo}
              title="Redo"
            >
              <Redo size={16} />
            </Button>
          </div>
        </div>

        {/* Center: Editor Toolbar */}
        <div className="flex-1 flex justify-center items-center min-w-0 px-2 space-x-2 md:space-x-4">
          {/* VIEW MODE SWITCHER */}
          <div className="relative">
            <div
              className={`hidden lg:flex items-center p-1 rounded-lg border ${
                isLight
                  ? 'bg-brand-gray-100 border-brand-gray-200'
                  : 'bg-brand-gray-800 border-brand-gray-700'
              }`}
            >
              <button
                onClick={() => setViewMode('raw')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'raw' ? buttonActive : `${iconColor} ${iconHover}`
                }`}
              >
                <FileText size={13} />
                <span>Raw</span>
              </button>
              <button
                onClick={() => setViewMode('markdown')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'markdown' ? buttonActive : `${iconColor} ${iconHover}`
                }`}
              >
                <Code size={13} />
                <span>MD</span>
              </button>
              <button
                onClick={() => setViewMode('wysiwyg')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'wysiwyg' ? buttonActive : `${iconColor} ${iconHover}`
                }`}
              >
                <Eye size={13} />
                <span>Visual</span>
              </button>
              <div
                className={`w-px h-4 mx-2 ${
                  isLight ? 'bg-brand-gray-300' : 'bg-brand-gray-700'
                }`}
              />
              <button
                onClick={() => setShowWhitespace((s) => !s)}
                title="Toggle whitespace characters"
                className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                  showWhitespace ? buttonActive : `${iconColor} ${iconHover}`
                }`}
              >
                <Pilcrow size={13} />
                <span>WS</span>
              </button>
            </div>

            {/* Mobile/Tablet View Mode Dropdown */}
            <div className="lg:hidden relative">
              <button
                onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium border ${
                  isLight
                    ? 'bg-brand-gray-50 border-brand-gray-200 text-brand-gray-700'
                    : 'bg-brand-gray-900 border-brand-gray-700 text-brand-gray-300'
                }`}
              >
                {viewMode === 'raw' && (
                  <>
                    <FileText size={14} />
                    <span>Raw</span>
                  </>
                )}
                {viewMode === 'markdown' && (
                  <>
                    <Code size={14} />
                    <span>MD</span>
                  </>
                )}
                {viewMode === 'wysiwyg' && (
                  <>
                    <Eye size={14} />
                    <span>Visual</span>
                  </>
                )}
                <ChevronDown size={12} className="opacity-50" />
              </button>

              {isViewMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsViewMenuOpen(false)}
                  ></div>
                  <div
                    className={`absolute top-full left-0 mt-2 w-32 rounded-lg shadow-lg border p-1 z-20 flex flex-col gap-1 ${
                      isLight
                        ? 'bg-brand-gray-50 border-brand-gray-200'
                        : 'bg-brand-gray-800 border-brand-gray-700'
                    }`}
                  >
                    <button
                      onClick={() => {
                        setViewMode('raw');
                        setIsViewMenuOpen(false);
                      }}
                      className={`flex items-center space-x-2 px-2 py-1.5 rounded text-xs text-left ${
                        viewMode === 'raw'
                          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                          : 'hover:bg-brand-gray-100 dark:hover:bg-brand-gray-700'
                      }`}
                    >
                      <FileText size={14} />
                      <span>Raw</span>
                    </button>
                    <button
                      onClick={() => {
                        setViewMode('markdown');
                        setIsViewMenuOpen(false);
                      }}
                      className={`flex items-center space-x-2 px-2 py-1.5 rounded text-xs text-left ${
                        viewMode === 'markdown'
                          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                          : 'hover:bg-brand-gray-100 dark:hover:bg-brand-gray-700'
                      }`}
                    >
                      <Code size={14} />
                      <span>MD</span>
                    </button>
                    <button
                      onClick={() => {
                        setViewMode('wysiwyg');
                        setIsViewMenuOpen(false);
                      }}
                      className={`flex items-center space-x-2 px-2 py-1.5 rounded text-xs text-left ${
                        viewMode === 'wysiwyg'
                          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                          : 'hover:bg-brand-gray-100 dark:hover:bg-brand-gray-700'
                      }`}
                    >
                      <Eye size={14} />
                      <span>Visual</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* FORMATTING TOOLBAR */}

          {/* Desktop/Tablet (md+): Inline Basic + Dropdown Advanced */}
          <div className="hidden md:flex items-center space-x-0.5">
            <div className={`w-px h-4 mx-2 ${dividerColor}`}></div>

            {/* Always visible on md+ */}
            <button
              onClick={() => handleFormat('bold')}
              className={getFormatButtonClass('bold')}
              title="Bold"
            >
              <Bold size={16} />
            </button>
            <button
              onClick={() => handleFormat('italic')}
              className={getFormatButtonClass('italic')}
              title="Italic"
            >
              <Italic size={16} />
            </button>
            <button
              onClick={() => handleFormat('link')}
              className={getFormatButtonClass('link')}
              title="Link"
            >
              <LinkIcon size={16} />
            </button>

            {/* Separator for advanced */}
            <div className={`w-px h-4 mx-1 ${dividerColor}`}></div>

            {/* XL+: Inline Advanced */}
            <div className="hidden xl:flex items-center space-x-0.5">
              <button
                onClick={() => handleFormat('h1')}
                className={`${getFormatButtonClass(
                  'h1'
                )} font-serif font-bold text-xs w-8`}
                title="Heading 1"
              >
                H1
              </button>
              <button
                onClick={() => handleFormat('h2')}
                className={`${getFormatButtonClass(
                  'h2'
                )} font-serif font-bold text-xs w-8`}
                title="Heading 2"
              >
                H2
              </button>
              <button
                onClick={() => handleFormat('h3')}
                className={`${getFormatButtonClass(
                  'h3'
                )} font-serif font-bold text-xs w-8`}
                title="Heading 3"
              >
                H3
              </button>
              <div className={`w-px h-4 mx-1 ${dividerColor}`}></div>
              <button
                onClick={() => handleFormat('quote')}
                className={getFormatButtonClass('quote')}
                title="Blockquote"
              >
                <Quote size={16} />
              </button>
              <button
                onClick={() => handleFormat('ul')}
                className={getFormatButtonClass('ul')}
                title="List"
              >
                <List size={16} />
              </button>
              <button
                onClick={() => handleFormat('ol')}
                className={getFormatButtonClass('ol')}
                title="Numbered List"
              >
                <ListOrdered size={16} />
              </button>
            </div>

            {/* MD -> XL: Paragraph Menu Dropdown */}
            <div className="xl:hidden relative">
              <button
                onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)}
                className={`p-1.5 rounded-md transition-colors flex items-center gap-1 ${
                  isFormatMenuOpen
                    ? buttonActive
                    : isLight
                      ? 'text-brand-gray-500 hover:bg-brand-gray-100'
                      : 'text-brand-gray-400 hover:bg-brand-gray-800'
                }`}
                title="Formatting"
              >
                <Type size={16} />
                <ChevronDown size={10} />
              </button>
              {isFormatMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsFormatMenuOpen(false)}
                  ></div>
                  <div
                    className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 rounded-lg shadow-xl border p-2 z-20 grid grid-cols-3 gap-1 ${
                      isLight
                        ? 'bg-brand-gray-50 border-brand-gray-200'
                        : 'bg-brand-gray-800 border-brand-gray-700'
                    }`}
                  >
                    <button
                      onClick={() => handleFormat('h1')}
                      className={`${getFormatButtonClass(
                        'h1'
                      )} font-serif font-bold text-xs`}
                    >
                      H1
                    </button>
                    <button
                      onClick={() => handleFormat('h2')}
                      className={`${getFormatButtonClass(
                        'h2'
                      )} font-serif font-bold text-xs`}
                    >
                      H2
                    </button>
                    <button
                      onClick={() => handleFormat('h3')}
                      className={`${getFormatButtonClass(
                        'h3'
                      )} font-serif font-bold text-xs`}
                    >
                      H3
                    </button>
                    <button
                      onClick={() => handleFormat('quote')}
                      className={getFormatButtonClass('quote')}
                    >
                      <Quote size={16} />
                    </button>
                    <button
                      onClick={() => handleFormat('ul')}
                      className={getFormatButtonClass('ul')}
                    >
                      <List size={16} />
                    </button>
                    <button
                      onClick={() => handleFormat('ol')}
                      className={getFormatButtonClass('ol')}
                    >
                      <ListOrdered size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Mobile (< md): Everything in one Menu */}
          <div className="md:hidden relative">
            <button
              onClick={() => setIsMobileFormatMenuOpen(!isMobileFormatMenuOpen)}
              className={`p-2 rounded-md border flex items-center gap-2 text-xs font-medium ${
                isMobileFormatMenuOpen
                  ? buttonActive
                  : isLight
                    ? 'bg-brand-gray-50 border-brand-gray-200 text-brand-gray-700'
                    : 'bg-brand-gray-900 border-brand-gray-700 text-brand-gray-300'
              }`}
            >
              <Type size={16} />
              <span>Format</span>
            </button>

            {isMobileFormatMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setIsMobileFormatMenuOpen(false)}
                ></div>
                <div
                  className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 rounded-xl shadow-2xl border p-3 z-50 flex flex-col gap-3 ${
                    isLight
                      ? 'bg-brand-gray-50 border-brand-gray-200'
                      : 'bg-brand-gray-900 border-brand-gray-700'
                  }`}
                >
                  <div>
                    <div className="text-[10px] font-bold uppercase text-brand-gray-500 mb-1">
                      Style
                    </div>
                    <div className="flex gap-1 justify-between">
                      <button
                        onClick={() => handleFormat('bold')}
                        className={`flex-1 flex justify-center ${getFormatButtonClass(
                          'bold'
                        )}`}
                      >
                        <Bold size={16} />
                      </button>
                      <button
                        onClick={() => handleFormat('italic')}
                        className={`flex-1 flex justify-center ${getFormatButtonClass(
                          'italic'
                        )}`}
                      >
                        <Italic size={16} />
                      </button>
                      <button
                        onClick={() => handleFormat('link')}
                        className={`flex-1 flex justify-center ${getFormatButtonClass(
                          'link'
                        )}`}
                      >
                        <LinkIcon size={16} />
                      </button>
                    </div>
                  </div>
                  <div
                    className={`h-px w-full ${
                      isLight ? 'bg-brand-gray-100' : 'bg-brand-gray-800'
                    }`}
                  ></div>
                  <div>
                    <div className="text-[10px] font-bold uppercase text-brand-gray-500 mb-1">
                      Paragraph
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      <button
                        onClick={() => handleFormat('h1')}
                        className={`${getFormatButtonClass(
                          'h1'
                        )} font-serif font-bold text-xs`}
                      >
                        H1
                      </button>
                      <button
                        onClick={() => handleFormat('h2')}
                        className={`${getFormatButtonClass(
                          'h2'
                        )} font-serif font-bold text-xs`}
                      >
                        H2
                      </button>
                      <button
                        onClick={() => handleFormat('h3')}
                        className={`${getFormatButtonClass(
                          'h3'
                        )} font-serif font-bold text-xs`}
                      >
                        H3
                      </button>
                      <button
                        onClick={() => handleFormat('quote')}
                        className={`flex justify-center ${getFormatButtonClass(
                          'quote'
                        )}`}
                      >
                        <Quote size={16} />
                      </button>
                    </div>
                  </div>
                  <div
                    className={`h-px w-full ${
                      isLight ? 'bg-brand-gray-100' : 'bg-brand-gray-800'
                    }`}
                  ></div>
                  <div>
                    <div className="text-[10px] font-bold uppercase text-brand-gray-500 mb-1">
                      Lists
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleFormat('ul')}
                        className={`flex-1 flex justify-center ${getFormatButtonClass(
                          'ul'
                        )}`}
                      >
                        <List size={16} />
                      </button>
                      <button
                        onClick={() => handleFormat('ol')}
                        className={`flex-1 flex justify-center ${getFormatButtonClass(
                          'ol'
                        )}`}
                      >
                        <ListOrdered size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Chapter AI - Desktop only */}
          <div className="hidden md:flex items-center space-x-1">
            <div className={`w-px h-4 mx-2 ${dividerColor}`}></div>
            <div
              className={`flex items-center rounded-md p-1 space-x-1 border ${
                isLight
                  ? 'bg-brand-gray-100 border-brand-gray-200'
                  : 'bg-brand-gray-800 border-brand-gray-700'
              }`}
            >
              <span className="hidden 2xl:inline text-[10px] text-brand-gray-500 font-bold uppercase px-2">
                Chapter AI
              </span>
              <div
                className={`hidden 2xl:block w-px h-4 ${
                  isLight ? 'bg-brand-gray-300' : 'bg-brand-gray-700'
                }`}
              ></div>
              <Button
                theme={currentTheme}
                size="sm"
                variant="ghost"
                className="text-xs h-6"
                onClick={() => handleAiAction('chapter', 'extend')}
                disabled={isAiActionLoading}
                icon={<Wand2 size={12} />}
                title="Extend Chapter (WRITING model)"
              >
                <span className="hidden xl:inline">Extend</span>
              </Button>
              <Button
                theme={currentTheme}
                size="sm"
                variant="ghost"
                className="text-xs h-6"
                onClick={() => handleAiAction('chapter', 'rewrite')}
                disabled={isAiActionLoading}
                icon={<FileEdit size={12} />}
                title="Rewrite Chapter (WRITING model)"
              >
                <span className="hidden xl:inline">Rewrite</span>
              </Button>
            </div>
          </div>

          {/* Quick Model Selectors */}
          <div
            className={`hidden 2xl:flex items-center space-x-3 ml-2 pl-2 border-l h-8 ${
              isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
            }`}
          >
            <ModelSelector
              label="Editing"
              value={appSettings.activeEditingProviderId}
              onChange={(v) =>
                setAppSettings((prev) => ({
                  ...prev,
                  activeEditingProviderId: v,
                }))
              }
              options={appSettings.providers}
              theme={currentTheme}
              connectionStatus={modelConnectionStatus}
              detectedCapabilities={detectedCapabilities}
              labelColorClass={isLight ? 'text-fuchsia-600' : 'text-fuchsia-400'}
            />
            <ModelSelector
              label="Writing"
              value={appSettings.activeWritingProviderId}
              onChange={(v) =>
                setAppSettings((prev) => ({
                  ...prev,
                  activeWritingProviderId: v,
                }))
              }
              options={appSettings.providers}
              theme={currentTheme}
              connectionStatus={modelConnectionStatus}
              detectedCapabilities={detectedCapabilities}
              labelColorClass={isLight ? 'text-violet-600' : 'text-violet-400'}
            />
            <ModelSelector
              label="Chat"
              value={appSettings.activeChatProviderId}
              onChange={(v) =>
                setAppSettings((prev) => ({
                  ...prev,
                  activeChatProviderId: v,
                }))
              }
              options={appSettings.providers}
              theme={currentTheme}
              connectionStatus={modelConnectionStatus}
              detectedCapabilities={detectedCapabilities}
              labelColorClass={isLight ? 'text-blue-600' : 'text-blue-400'}
            />
          </div>
        </div>

        {/* Right: Settings & Panels */}
        <div className="flex items-center space-x-2 shrink-0">
          <Button
            theme={currentTheme}
            variant="ghost"
            size="sm"
            onClick={() => setIsImagesOpen(true)}
            title="Images"
            className="hidden sm:inline-flex mr-1"
          >
            <ImageIcon size={18} />
          </Button>
          <Button
            theme={currentTheme}
            variant="ghost"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            title="Settings"
            className="mr-1"
          >
            <SettingsIcon size={18} />
          </Button>
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
                    <div
                      className={`flex justify-between items-center text-sm ${textMain}`}
                    >
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
                    <div
                      className={`flex justify-between items-center text-sm ${textMain}`}
                    >
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
                      onChange={(e) =>
                        setEditorSettings({
                          ...editorSettings,
                          brightness: Number(e.target.value) / 100,
                        })
                      }
                      className={sliderClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <div
                      className={`flex justify-between items-center text-sm ${textMain}`}
                    >
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
                      onChange={(e) =>
                        setEditorSettings({
                          ...editorSettings,
                          contrast: Number(e.target.value) / 100,
                        })
                      }
                      className={sliderClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <div
                      className={`flex justify-between items-center text-sm ${textMain}`}
                    >
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
                      onChange={(e) =>
                        setEditorSettings({
                          ...editorSettings,
                          fontSize: Number(e.target.value),
                        })
                      }
                      className={sliderClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <div
                      className={`flex justify-between items-center text-sm ${textMain}`}
                    >
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
                      onChange={(e) =>
                        setEditorSettings({
                          ...editorSettings,
                          maxWidth: Number(e.target.value),
                        })
                      }
                      className={sliderClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <div
                      className={`flex justify-between items-center text-sm ${textMain}`}
                    >
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
                      onChange={(e) =>
                        setEditorSettings({
                          ...editorSettings,
                          sidebarWidth: Number(e.target.value),
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

          <Button
            theme={currentTheme}
            variant="secondary"
            size="sm"
            onClick={() => setIsChatOpen(!isChatOpen)}
            icon={
              isChatOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />
            }
          >
            {isChatOpen ? 'Hide' : 'AI'}
          </Button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-brand-gray-950/60 z-30 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          ></div>
        )}
        <div
          className={`fixed inset-y-0 left-0 top-14 w-[var(--sidebar-width)] flex-col border-r flex-shrink-0 z-40 transition-transform duration-300 ease-in-out lg:relative lg:top-auto lg:translate-x-0 flex h-full ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } ${
            isLight
              ? 'bg-brand-gray-50 border-brand-gray-200'
              : 'bg-brand-gray-900 border-brand-gray-800'
          }`}
        >
          <StoryMetadata
            title={story.title}
            summary={story.summary}
            tags={story.styleTags}
            notes={story.notes}
            private_notes={story.private_notes}
            onUpdate={updateStoryMetadata}
            theme={currentTheme}
          />
          <ChapterList
            chapters={story.chapters}
            books={story.books}
            projectType={story.projectType}
            currentChapterId={currentChapterId}
            onSelect={handleChapterSelect}
            onDelete={deleteChapter}
            onUpdateChapter={updateChapter}
            onUpdateBook={updateBook}
            onCreate={(bookId) => addChapter('New Chapter', '', bookId)}
            onBookCreate={handleBookCreate}
            onBookDelete={handleBookDelete}
            onReorderChapters={handleReorderChapters}
            onReorderBooks={handleReorderBooks}
            onAiAction={handleSidebarAiAction}
            theme={currentTheme}
            onOpenImages={handleOpenImages}
          />
        </div>
        <div
          className={`flex-1 flex flex-col relative overflow-hidden w-full h-full ${bgMain}`}
        >
          <div className="flex-1 overflow-hidden h-full flex flex-col">
            {currentChapter ? (
              <Editor
                ref={editorRef}
                chapter={currentChapter}
                settings={editorSettings}
                viewMode={viewMode}
                onChange={updateChapter}
                continuations={continuations}
                isSuggesting={isSuggesting}
                onTriggerSuggestions={handleTriggerSuggestions}
                onAcceptContinuation={handleAcceptContinuation}
                isSuggestionMode={isSuggestionMode}
                onKeyboardSuggestionAction={handleKeyboardSuggestionAction}
                onAiAction={handleAiAction}
                isAiLoading={isAiActionLoading}
                onContextChange={setActiveFormats}
                showWhitespace={showWhitespace}
                onToggleShowWhitespace={() => setShowWhitespace((s) => !s)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-brand-gray-500">
                <img
                  src="/static/images/logo_2048.png"
                  className="w-64 h-64 mb-8 opacity-20"
                  alt="AugmentedQuill Logo"
                />
                <p className="text-lg font-medium">
                  Select or create a chapter to start writing.
                </p>
              </div>
            )}
          </div>
        </div>
        {isChatOpen && (
          <div className="fixed inset-y-0 right-0 top-14 w-full md:w-[var(--sidebar-width)] flex-shrink-0 flex flex-col z-40 shadow-xl transition duration-300 ease-in-out md:relative md:top-auto md:bottom-auto md:z-20 md:h-full">
            <Chat
              messages={chatMessages}
              isLoading={isChatLoading}
              systemPrompt={systemPrompt}
              onSendMessage={handleSendMessage}
              onStop={handleStopChat}
              onRegenerate={handleRegenerate}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onUpdateSystemPrompt={setSystemPrompt}
              theme={currentTheme}
            />
          </div>
        )}
      </div>

      <DebugLogs
        isOpen={isDebugLogsOpen}
        onClose={() => setIsDebugLogsOpen(false)}
        theme={currentTheme}
      />
    </div>
  );
};

export default App;

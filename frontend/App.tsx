import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStory } from './hooks/useStory';
import { StoryMetadata } from './components/StoryMetadata';
import { ChapterList } from './components/ChapterList';
import { Editor } from './components/Editor';
import { Chat } from './components/Chat';
import { Button } from './components/Button';
import { SettingsDialog } from './components/SettingsDialog';
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
  Type,
  Monitor,
  X,
  Code,
  Eye,
  Bold,
  Italic,
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
  activeStoryProviderId: 'default',
};

const App: React.FC = () => {
  const {
    story,
    currentChapterId,
    selectChapter,
    updateStoryMetadata,
    updateChapter,
    addChapter,
    deleteChapter,
    loadStory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useStory();

  const currentChapter = story.chapters.find((c) => c.id === currentChapterId);
  const editorRef = useRef<any>(null);

  // App State
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('augmentedquill_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!parsed.activeStoryProviderId && parsed.activeProviderId) {
          return {
            ...parsed,
            activeStoryProviderId: parsed.activeProviderId,
            activeChatProviderId: parsed.activeProviderId,
          };
        }
        return parsed.activeStoryProviderId ? parsed : DEFAULT_APP_SETTINGS;
      } catch (e) {
        return DEFAULT_APP_SETTINGS;
      }
    }
    return DEFAULT_APP_SETTINGS;
  });

  const [projects, setProjects] = useState<ProjectMetadata[]>(() => {
    const saved = localStorage.getItem('augmentedquill_projects_meta');
    return saved
      ? JSON.parse(saved)
      : [{ id: story.id, title: story.title, updatedAt: Date.now() }];
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isAiActionLoading, setIsAiActionLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('raw');
  const [showWhitespace, setShowWhitespace] = useState<boolean>(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
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
        if (exists && exists.title === story.title) {
          return prev.map((p) =>
            p.id === story.id ? { ...p, updatedAt: Date.now() } : p
          );
        } else if (exists) {
          return prev.map((p) =>
            p.id === story.id ? { ...p, title: story.title, updatedAt: Date.now() } : p
          );
        } else {
          return [...prev, { id: story.id, title: story.title, updatedAt: Date.now() }];
        }
      });
    }
  }, [story.title, story.chapters, story.summary, story.styleTags]);

  useEffect(() => {
    localStorage.setItem('augmentedquill_projects_meta', JSON.stringify(projects));
  }, [projects]);

  // Project Management Functions
  const handleLoadProject = (id: string) => {
    const saved = localStorage.getItem(`project_${id}`);
    if (saved) {
      const loadedStory = JSON.parse(saved);
      loadStory(loadedStory);
      setChatMessages([]);
    }
  };

  const handleCreateProject = () => {
    const newId = uuidv4();
    const newStory: StoryState = {
      id: newId,
      title: 'New Project',
      summary: '',
      styleTags: [],
      chapters: [],
      currentChapterId: null,
      lastUpdated: Date.now(),
    };
    loadStory(newStory);
    setChatMessages([]);
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
  const activeStoryConfig =
    appSettings.providers.find((p) => p.id === appSettings.activeStoryProviderId) ||
    appSettings.providers[0];

  const getSystemPrompt = () => {
    return `You are a professional creative writing partner and editor.
You are helping the user write a story titled "${story.title}".
Story Summary: ${story.summary}
Style Tags: ${story.styleTags.join(', ')}

Your goal is to assist with writing, editing, brainstorming, and structuring.
You have tools to directly modify the story content if the user explicitly asks.
Always prioritize the user's creative vision.`;
  };

  const [systemPrompt, setSystemPrompt] = useState(getSystemPrompt());

  useEffect(() => {
    setSystemPrompt(getSystemPrompt());
  }, [story.title, story.summary, story.styleTags]);

  const executeChatRequest = async (userText: string, history: ChatMessage[]) => {
    setIsChatLoading(true);
    try {
      const historyForSdk = history.map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.text }],
      }));

      const session = createChatSession(systemPrompt, historyForSdk, activeChatConfig);

      let promptWithContext = userText;
      if (currentChapter) {
        promptWithContext = `[Current Chapter Context: ID=${
          currentChapter.id
        }, Title="${
          currentChapter.title
        }"]\n[Current Content Start]\n${currentChapter.content.slice(
          0,
          5000
        )}\n[Current Content End]\n\nUser Request: ${userText}`;
      }

      const result = await session.sendMessage({ message: promptWithContext });

      const functionCalls = result.functionCalls;
      let responseText = result.text || '';

      if (functionCalls && functionCalls.length > 0) {
        const functionResponses = [];
        for (const call of functionCalls) {
          let toolResult = { result: 'Success' };
          if (call.name === 'update_chapter_content') {
            const args = call.args as any;
            if (currentChapterId && args.content) {
              updateChapter(currentChapterId, { content: args.content });
              toolResult = { result: `Chapter content updated.` };
            } else {
              toolResult = { result: `Error: No chapter selected.` };
            }
          } else if (call.name === 'create_chapter') {
            const args = call.args as any;
            addChapter(args.title, args.summary);
            toolResult = { result: `Created chapter "${args.title}"` };
          } else if (call.name === 'update_chapter_summary') {
            const args = call.args as any;
            if (currentChapterId && args.summary) {
              updateChapter(currentChapterId, { summary: args.summary });
              toolResult = { result: `Summary updated.` };
            }
          }
          functionResponses.push({
            id: call.id,
            name: call.name,
            response: toolResult,
          });
        }
        responseText += '\n\n(Actions executed)';
      }
      const botMessage: ChatMessage = {
        id: uuidv4(),
        role: 'model',
        text: responseText,
      };
      setChatMessages((prev) => [...prev, botMessage]);
    } catch (error) {
      console.error(error);
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'model',
        text: 'Sorry, I encountered an error processing your request. Please check your AI settings.',
        isError: true,
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    const newMessage: ChatMessage = { id: uuidv4(), role: 'user', text };
    const newHistory = [...chatMessages, newMessage];
    setChatMessages(newHistory);
    await executeChatRequest(text, chatMessages);
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
        activeStoryConfig,
        currentChapter.id
      );
      setContinuations(options);
    } catch (e) {
      console.error('Failed to generate suggestions', e);
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

    if (target === 'summary') {
      if (action === 'update') {
        prompt = `Read the chapter content and the current summary. Update the summary to better reflect the content. Keep it concise.\n\nCurrent Summary: ${currentChapter.summary}\n\nChapter Content:\n${currentChapter.content}`;
      } else {
        // rewrite
        prompt = `Read the chapter content and generate a concise summary.\n\nChapter Content:\n${currentChapter.content}`;
      }
    } else {
      // chapter
      if (action === 'extend') {
        prompt = `Continue the story chapter based on the existing content and the summary. Append the new text to the end. Do not repeat existing content.\n\nSummary: ${currentChapter.summary}\n\nExisting Content:\n${currentChapter.content}`;
      } else {
        // rewrite
        prompt = `Rewrite the FULL content for this chapter based strictly on the following summary. The style should be: ${story.styleTags.join(
          ', '
        )}.\n\nSummary: ${currentChapter.summary}`;
      }
    }

    try {
      const result = await generateSimpleContent(
        prompt,
        systemPrompt,
        activeStoryConfig
      );

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
    } catch (e) {
      console.error('AI Action failed', e);
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
        { '--sidebar-width': `${editorSettings.sidebarWidth}px` } as React.CSSProperties
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
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
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
                  : 'bg-brand-gray-800 border border-brand-gray-700 shadow-none'
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
              theme={currentTheme}
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
              theme={currentTheme}
            >
              <Redo size={16} />
            </Button>
          </div>

          <div
            className={`hidden xl:flex items-center animate-in fade-in pl-2 border-l ${
              isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
            }`}
          >
            <Button
              theme={currentTheme}
              variant={isSummaryOpen ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setIsSummaryOpen(!isSummaryOpen)}
              icon={<BookOpen size={14} />}
              className="text-xs h-7"
              theme={currentTheme}
            >
              {isSummaryOpen ? 'Hide' : 'Edit Summary'}
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
              <button
                onClick={() => setShowWhitespace((s) => !s)}
                title="Show whitespace"
                className={`flex items-center px-2 py-1 ml-2 rounded-md text-xs font-medium transition-all ${
                  showWhitespace ? buttonActive : `${iconColor} ${iconHover}`
                }`}
              >
                {showWhitespace ? 'WS On' : 'WS'}
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
                title="Extend"
                theme={currentTheme}
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
                title="Rewrite"
                theme={currentTheme}
              >
                <span className="hidden xl:inline">Rewrite</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Right: Settings & Panels */}
        <div className="flex items-center space-x-2 shrink-0">
          <Button
            theme={currentTheme}
            variant="ghost"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            title="Settings"
            className="mr-1"
            theme={currentTheme}
          >
            <SettingsIcon size={18} />
          </Button>
          <div className="relative">
            <Button
              theme={currentTheme}
              variant={isAppearanceOpen ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setIsAppearanceOpen(!isAppearanceOpen)}
              icon={<Type size={16} />}
              title="Page Appearance"
              className="hidden sm:inline-flex"
              theme={currentTheme}
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
          </div>

          <Button
            theme={currentTheme}
            variant="secondary"
            size="sm"
            onClick={() => setIsChatOpen(!isChatOpen)}
            icon={
              isChatOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />
            }
            theme={currentTheme}
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
          className={`fixed inset-y-0 left-0 top-14 w-[var(--sidebar-width)] flex-col border-r flex-shrink-0 z-40 transition-transform duration-300 ease-in-out lg:relative lg:top-auto lg:translate-x-0 flex ${
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
            onUpdate={updateStoryMetadata}
            theme={currentTheme}
          />
          <ChapterList
            chapters={story.chapters}
            currentChapterId={currentChapterId}
            onSelect={handleChapterSelect}
            onDelete={deleteChapter}
            onCreate={() => addChapter()}
            theme={currentTheme}
          />
        </div>
        <div
          className={`flex-1 flex flex-col relative overflow-hidden w-full ${bgMain}`}
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
                isSummaryOpen={isSummaryOpen}
                onToggleSummary={() => setIsSummaryOpen(!isSummaryOpen)}
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
          <div className="fixed inset-y-0 right-0 top-14 w-full md:w-[var(--sidebar-width)] flex-shrink-0 flex flex-col z-40 shadow-xl transition duration-300 ease-in-out md:relative md:top-auto md:z-20 md:h-full">
            <Chat
              messages={chatMessages}
              isLoading={isChatLoading}
              systemPrompt={systemPrompt}
              onSendMessage={handleSendMessage}
              onRegenerate={handleRegenerate}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onUpdateSystemPrompt={setSystemPrompt}
              theme={currentTheme}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;

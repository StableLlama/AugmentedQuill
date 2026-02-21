// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the editor unit so this responsibility stays isolated, testable, and easy to evolve.

import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  useCallback,
  useState,
} from 'react';
import { Chapter, EditorSettings, ViewMode } from '../../types';
import {
  Sparkles,
  Loader2,
  SplitSquareHorizontal,
  RefreshCw,
  PenLine,
  Wand2,
  FileEdit,
  BookOpen,
  Image as ImageIcon,
  Trash2,
  X,
  Upload,
} from 'lucide-react';
import { api } from '../../services/api';
import { Button } from '../../components/ui/Button';
// @ts-ignore
import { marked } from 'marked';
// @ts-ignore
import TurndownService from 'turndown';

interface EditorProps {
  chapter: Chapter;
  settings: EditorSettings;
  viewMode: ViewMode;
  showWhitespace?: boolean;
  onToggleShowWhitespace?: () => void;
  onChange: (id: string, updates: Partial<Chapter>) => void;
  continuations: string[];
  isSuggesting: boolean;
  onTriggerSuggestions: () => void;
  onAcceptContinuation: (text: string) => void;
  isSuggestionMode: boolean;
  onKeyboardSuggestionAction: (
    action: 'trigger' | 'chooseLeft' | 'chooseRight' | 'regenerate' | 'undo' | 'exit',
    cursor?: number
  ) => void;
  onAiAction: (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => void;
  isAiLoading: boolean;
  onContextChange?: (formats: string[]) => void;
}

interface PlainTextEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  onChange: (value: string) => void;
  showWhitespace?: boolean;
}

interface TurndownServiceLike {
  turndown: (html: string) => string;
}

export interface EditorHandle {
  insertImage: (filename: string, url: string, altText?: string) => void;
  focus: () => void;
  format: (type: string) => void;
  openImageManager?: () => void;
}

// Internal component for auto-growing plain text editing
const PlainTextEditable = React.forwardRef<HTMLDivElement, PlainTextEditableProps>(
  (
    {
      value,
      onChange,
      className,
      onKeyDown,
      onSelect,
      placeholder,
      style,
      showWhitespace = false,
      ...props
    },
    ref
  ) => {
    const elementRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => elementRef.current);

    // Avoid unnecessary DOM rewrites to preserve caret stability while typing.
    useEffect(() => {
      const display = showWhitespace
        ? (value || '')
            .replace(/\t/g, '→\t')
            .replace(/ /g, '·\u200b')
            .replace(/\r?\n/g, '¶\n')
        : value || '';
      if (elementRef.current && elementRef.current.innerText !== display) {
        elementRef.current.innerText = display;
      }
    }, [value, showWhitespace]);

    const onPaste = (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      // insert raw text; onInput handler will convert display when needed
      document.execCommand('insertText', false, text);
    };

    const fromDisplay = (s: string) => {
      return s
        .replace(/·\u200b?/g, ' ')
        .replace(/→\t/g, '\t')
        .replace(/¶\n/g, '\n');
    };

    const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
      const displayed = e.currentTarget.innerText;
      const raw = showWhitespace ? fromDisplay(displayed) : displayed;
      onChange(raw);
    };

    return (
      <div
        ref={elementRef}
        contentEditable
        className={`${className} empty:before:content-[attr(data-placeholder)] empty:before:text-inherit empty:before:opacity-40 outline-none`}
        onInput={handleInput}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        onMouseUp={onSelect}
        onKeyUp={onSelect}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        spellCheck={false}
        style={style}
        {...props}
      />
    );
  }
);

export const Editor = React.forwardRef<EditorHandle, EditorProps>(
  (
    {
      chapter,
      settings,
      viewMode,
      showWhitespace,
      onToggleShowWhitespace,
      onChange,
      continuations,
      isSuggesting,
      onTriggerSuggestions,
      onAcceptContinuation,
      isSuggestionMode,
      onKeyboardSuggestionAction,
      onAiAction,
      isAiLoading,
      onContextChange,
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLDivElement>(null);
    const wysiwygRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isDragging, setIsDragging] = useState(false);

    const handleImageUpload = async (file: File) => {
      try {
        const res = await api.projects.uploadImage(file);
        if (res.ok) {
          insertImageMarkdown(res.filename, res.url);
        }
      } catch (e) {
        console.error(e);
        alert('Failed to upload image');
      }
    };

    const insertImageMarkdown = (filename: string, url: string, altText?: string) => {
      const alt = altText || filename;
      if (viewMode === 'wysiwyg') {
        const html = `<img src="${url}" alt="${alt}" />`;
        if (wysiwygRef.current && wysiwygRef.current.contains(document.activeElement)) {
          document.execCommand('insertHTML', false, html);
          wysiwygRef.current.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          const markdown = `\n![${alt}](${url})`;
          onChange(chapter.id, { content: chapter.content + markdown });
        }
      } else {
        const markdown = `![${alt}](${url})`;
        if (document.activeElement === textareaRef.current) {
          document.execCommand('insertText', false, markdown);
        } else {
          onChange(chapter.id, { content: chapter.content + '\n' + markdown });
        }
      }
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/')) {
          await handleImageUpload(file);
        }
      }
    };

    const turndownService = useRef<TurndownServiceLike | null>(null);
    if (!turndownService.current) {
      turndownService.current = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
      });
    }

    // Keep WYSIWYG DOM synchronized when content changes externally.
    useEffect(() => {
      if (viewMode === 'wysiwyg' && wysiwygRef.current) {
        if (document.activeElement !== wysiwygRef.current) {
          wysiwygRef.current.innerHTML = marked.parse(chapter.content) as string;
        }
      }
    }, [chapter.content, viewMode, chapter.id]);

    const handleWysiwygInput = () => {
      if (wysiwygRef.current) {
        const html = wysiwygRef.current.innerHTML;
        const md = turndownService.current.turndown(html);
        if (md !== chapter.content) {
          onChange(chapter.id, { content: md });
        }
        checkContext();
      }
    };

    // Update active formatting state for toolbar affordances.
    const checkContext = () => {
      if (!onContextChange) return;

      const formats: string[] = [];
      const isWysiwyg = viewMode === 'wysiwyg';
      const el = isWysiwyg ? null : textareaRef.current;

      if (isWysiwyg) {
        if (document.queryCommandState('bold')) formats.push('bold');
        if (document.queryCommandState('italic')) formats.push('italic');
        if (document.queryCommandState('insertUnorderedList')) formats.push('ul');
        if (document.queryCommandState('insertOrderedList')) formats.push('ol');
        const formatBlock = document.queryCommandValue('formatBlock');
        if (formatBlock === 'h1') formats.push('h1');
        if (formatBlock === 'h2') formats.push('h2');
        if (formatBlock === 'h3') formats.push('h3');
        if (formatBlock === 'blockquote') formats.push('quote');
      } else if (el) {
        const selection = window.getSelection();
        if (
          selection &&
          selection.rangeCount > 0 &&
          el.contains(selection.anchorNode)
        ) {
          // Raw-mode context detection is intentionally conservative until
          // selection-to-markdown offset mapping is implemented.
          const text = el.innerText;
        }
      }
      onContextChange(formats);
    };

    const getCaretOffset = (root: HTMLElement | null): number | null => {
      if (!root) return null;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer)) return null;
      const preRange = range.cloneRange();
      preRange.selectNodeContents(root);
      preRange.setEnd(range.startContainer, range.startOffset);
      return preRange.toString().length;
    };

    const getEditorCaretOffset = useCallback((): number | null => {
      if (viewMode === 'raw' || viewMode === 'markdown') {
        return getCaretOffset(textareaRef.current);
      }
      if (viewMode === 'wysiwyg') {
        // DOM-to-markdown offset mapping is ambiguous in WYSIWYG mode;
        // use content-end fallback while still requiring in-editor selection.
        const inside =
          !!wysiwygRef.current &&
          !!window.getSelection()?.anchorNode &&
          wysiwygRef.current.contains(window.getSelection()!.anchorNode);
        return inside ? chapter.content.length : null;
      }
      return null;
    }, [viewMode, chapter.content.length]);

    const maybeHandleSuggestionHotkey = useCallback(
      (e: KeyboardEvent | React.KeyboardEvent) => {
        const key = 'key' in e ? e.key : '';
        const ctrlKey = 'ctrlKey' in e ? e.ctrlKey : false;
        const metaKey = 'metaKey' in e ? e.metaKey : false;

        const suggestionActive =
          isSuggestionMode || continuations.length > 0 || isSuggesting;

        // Trigger: Ctrl+Enter / Cmd+Enter
        if (key === 'Enter' && (ctrlKey || metaKey)) {
          const cursor = getEditorCaretOffset() ?? chapter.content.length;
          e.preventDefault();
          // @ts-ignore - stopPropagation exists on both KeyboardEvent and React synthetic events
          e.stopPropagation?.();
          onKeyboardSuggestionAction('trigger', cursor);
          return true;
        }

        if (!suggestionActive) return false;

        if (key === 'ArrowLeft') {
          e.preventDefault();
          // @ts-ignore
          e.stopPropagation?.();
          onKeyboardSuggestionAction('chooseLeft');
          return true;
        }
        if (key === 'ArrowRight') {
          e.preventDefault();
          // @ts-ignore
          e.stopPropagation?.();
          onKeyboardSuggestionAction('chooseRight');
          return true;
        }
        if (key === 'ArrowDown') {
          e.preventDefault();
          // @ts-ignore
          e.stopPropagation?.();
          onKeyboardSuggestionAction('regenerate');
          return true;
        }
        if (key === 'ArrowUp') {
          e.preventDefault();
          // @ts-ignore
          e.stopPropagation?.();
          onKeyboardSuggestionAction('undo');
          return true;
        }
        if (key === 'Escape') {
          e.preventDefault();
          // @ts-ignore
          e.stopPropagation?.();
          onKeyboardSuggestionAction('exit');
          return true;
        }
        return false;
      },
      [
        isSuggestionMode,
        continuations.length,
        isSuggesting,
        onKeyboardSuggestionAction,
        getEditorCaretOffset,
      ]
    );

    useEffect(() => {
      // Capture shortcuts globally so suggestion controls remain reachable
      // while focus moves across editor-adjacent UI.
      const onKeyDown = (e: KeyboardEvent) => {
        maybeHandleSuggestionHotkey(e);
      };
      window.addEventListener('keydown', onKeyDown, true);
      return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [maybeHandleSuggestionHotkey]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (maybeHandleSuggestionHotkey(e)) return;

      // Basic Enter handling to prevent div insertion, ensuring clean newlines
      if (e.key === 'Enter') {
        // Keep native behavior in raw mode; newline normalization happens
        // during content extraction.
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        setTimeout(checkContext, 0);
      }
    };

    const format = (type: string) => {
      if (viewMode === 'wysiwyg') {
        wysiwygRef.current?.focus();
        switch (type) {
          case 'bold':
            document.execCommand('bold');
            break;
          case 'italic':
            document.execCommand('italic');
            break;
          case 'h1':
            document.execCommand('formatBlock', false, 'H1');
            break;
          case 'h2':
            document.execCommand('formatBlock', false, 'H2');
            break;
          case 'h3':
            document.execCommand('formatBlock', false, 'H3');
            break;
          case 'quote':
            document.execCommand('formatBlock', false, 'BLOCKQUOTE');
            break;
          case 'ul':
            document.execCommand('insertUnorderedList');
            break;
          case 'ol':
            document.execCommand('insertOrderedList');
            break;
          case 'link':
            const url = prompt('Enter URL:');
            if (url) document.execCommand('createLink', false, url);
            break;
          case 'image':
            const src = prompt('Enter Image URL:');
            if (src) document.execCommand('insertImage', false, src);
            break;
        }
        handleWysiwygInput();
      } else {
        // Raw mode formatting insertion
        if (!textareaRef.current) return;
        const el = textareaRef.current;
        el.focus();

        let prefix = '';
        let suffix = '';

        switch (type) {
          case 'bold':
            prefix = '**';
            suffix = '**';
            break;
          case 'italic':
            prefix = '_';
            suffix = '_';
            break;
          case 'h1':
            prefix = '# ';
            break;
          case 'h2':
            prefix = '## ';
            break;
          case 'h3':
            prefix = '### ';
            break;
          case 'quote':
            prefix = '> ';
            break;
          case 'ul':
            prefix = '- ';
            break;
          case 'ol':
            prefix = '1. ';
            break;
          case 'link':
            prefix = '[';
            suffix = '](url)';
            break;
          case 'image':
            prefix = '![';
            suffix = '](url)';
            break;
        }

        document.execCommand('insertText', false, prefix + suffix);

        onChange(chapter.id, { content: el.innerText });
      }
    };

    useImperativeHandle(ref, () => ({
      insertImage: (filename: string, url: string, altText?: string) =>
        insertImageMarkdown(filename, url, altText),
      focus: () => {
        if (viewMode === 'wysiwyg') wysiwygRef.current?.focus();
        else textareaRef.current?.focus();
      },
      format: (type: string) => format(type),
    }));

    // Styles & Theme Logic
    let pageBackgroundColor: string;
    let textColor: string;
    let editorContainerBg: string;

    if (settings.theme === 'dark') {
      const b = settings.brightness * 20; // range 10-20% lightness
      pageBackgroundColor = `hsl(24, 10%, ${b}%)`;
      textColor = `rgba(231, 229, 228, ${settings.contrast})`;
      editorContainerBg = 'bg-brand-gray-950';
    } else {
      pageBackgroundColor = `hsl(38, 25%, ${settings.brightness * 100}%)`;
      textColor = `rgba(20, 15, 10, ${settings.contrast})`;
      editorContainerBg =
        settings.theme === 'light' ? 'bg-brand-gray-100' : 'bg-brand-gray-950';
    }

    const isMonospace = viewMode === 'raw';
    const fontFamily = isMonospace
      ? '"JetBrains Mono", "Fira Code", monospace'
      : 'Merriweather, serif';
    const titleFontFamily = 'Merriweather, serif'; // Always serif for title

    const commonTextStyle: React.CSSProperties = {
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: '1.6',
      padding: '0px',
      margin: '0',
      border: 'none',
      width: '100%',
      boxSizing: 'border-box',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      wordBreak: 'break-word',
    };

    const toolbarBg =
      settings.theme === 'light'
        ? 'bg-brand-gray-50 border-b border-brand-gray-200 shadow-sm'
        : 'bg-brand-gray-900 border-b border-brand-gray-800 shadow-sm';
    const summaryBg =
      settings.theme === 'light'
        ? 'bg-brand-gray-50 border-b border-brand-gray-200'
        : 'bg-brand-gray-900 border-b border-brand-gray-800';
    const inputBg =
      settings.theme === 'light'
        ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-900'
        : 'bg-brand-gray-950 border-brand-gray-800 text-brand-gray-300';
    const textMuted =
      settings.theme === 'light' ? 'text-brand-gray-500' : 'text-brand-gray-500';
    const footerBg =
      settings.theme === 'light'
        ? 'bg-brand-gray-50 border-t border-brand-gray-200'
        : 'bg-brand-gray-900 border-t border-brand-gray-800';

    return (
      <div
        className={`flex flex-col h-full w-full overflow-hidden relative ${editorContainerBg}`}
      >
        <div className={`flex-none z-20 xl:hidden ${toolbarBg}`}>
          <div className="h-14 flex items-center justify-between px-4">
            <div className="flex items-center space-x-3">
              {/* Mobile Toolbar Left Items */}
            </div>
            <div className="flex items-center space-x-2">
              <div
                className={`flex items-center rounded-md p-1 space-x-1 ${
                  settings.theme === 'light' ? 'bg-brand-gray-100' : 'bg-brand-gray-800'
                }`}
              >
                <span className={`text-[10px] font-bold uppercase px-2 ${textMuted}`}>
                  Chapter AI
                </span>
                <div
                  className={`w-px h-4 ${
                    settings.theme === 'light'
                      ? 'bg-brand-gray-300'
                      : 'bg-brand-gray-700'
                  }`}
                ></div>
                <Button
                  theme={settings.theme}
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7"
                  onClick={() => onAiAction('chapter', 'extend')}
                  disabled={isAiLoading}
                  icon={<Wand2 size={12} />}
                  title="Extend Chapter (WRITING model)"
                >
                  Extend
                </Button>
                <Button
                  theme={settings.theme}
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7"
                  onClick={() => onAiAction('chapter', 'rewrite')}
                  disabled={isAiLoading}
                  icon={<FileEdit size={12} />}
                  title="Rewrite Chapter (WRITING model)"
                >
                  Rewrite
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Main Scrollable Content Area */}
        <div
          className="flex-1 overflow-y-auto px-4 py-6 md:py-8 flex flex-col items-center relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 bg-blue-500/10 z-50 flex items-center justify-center border-4 border-blue-500 border-dashed m-4 rounded-xl pointer-events-none">
              <div className="bg-white dark:bg-gray-800 p-4 rounded shadow-lg flex flex-col items-center">
                <Upload className="w-8 h-8 mb-2 text-blue-500" />
                <span className="font-bold text-blue-500">Drop image to upload</span>
              </div>
            </div>
          )}
          {/* The Paper - Grows infinitely */}
          <div
            className="relative w-full shadow-2xl transition duration-300 ease-in-out px-4 py-8 md:px-12 md:py-16 mx-auto flex flex-col flex-none"
            style={{
              maxWidth: `${settings.maxWidth}ch`,
              backgroundColor: pageBackgroundColor,
              color: textColor,
              fontSize: `${settings.fontSize}px`,
              fontFamily: fontFamily,
              // At least fill the available scroll area height, but always grow with content.
              minHeight: '100%',
            }}
          >
            {/* Toolbar - Removed Image Icon here */}
            {/* Title Input */}
            <PlainTextEditable
              value={chapter.title}
              onChange={(val: string) => onChange(chapter.id, { title: val })}
              className="w-full bg-transparent font-serif font-bold mb-8 border-b-2 border-transparent focus:border-brand-gray-400/50 transition-colors block"
              placeholder="Chapter Title"
              style={{
                ...commonTextStyle,
                fontSize: '1.8em',
                lineHeight: '1.3',
                fontFamily: titleFontFamily,
              }}
            />

            {/* Editor Area */}
            <div id="editor-area" className="flex flex-col relative w-full">
              {/* WYSIWYG View */}
              <div
                id="wysiwyg-editor"
                ref={wysiwygRef}
                contentEditable
                onInput={handleWysiwygInput}
                onMouseUp={checkContext}
                onKeyDown={handleKeyDown}
                onKeyUp={(e) => {
                  checkContext();
                }}
                className={`prose-editor outline-none w-full ${
                  viewMode === 'wysiwyg' ? 'block' : 'hidden'
                }`}
                style={{ ...commonTextStyle }}
              />

              {/* Raw / Markdown View */}
              {(viewMode === 'raw' || viewMode === 'markdown') && (
                <div id="raw-markdown-editor" className="relative w-full flex flex-col">
                  <PlainTextEditable
                    ref={textareaRef}
                    value={chapter.content}
                    onChange={(val: string) => {
                      onChange(chapter.id, { content: val });
                      checkContext();
                    }}
                    onSelect={checkContext}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-transparent text-inherit outline-none"
                    placeholder="Start writing your chapter here..."
                    showWhitespace={showWhitespace}
                    style={{
                      ...commonTextStyle,
                      color: showWhitespace ? 'inherit' : 'inherit',
                      caretColor: textColor,
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 h-16 w-full"></div>
        </div>

        {/* Persistent Footer */}
        <div
          className={`flex-shrink-0 z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] ${footerBg}`}
        >
          {continuations.length > 0 ? (
            <div className="p-4 animate-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center space-x-2 text-brand-500">
                  <SplitSquareHorizontal size={18} />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Choose a continuation
                  </span>
                </div>
                <button
                  onClick={() => onAcceptContinuation('')}
                  className={`${textMuted} hover:text-brand-gray-800 text-xs`}
                >
                  Dismiss
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full max-h-[40vh] overflow-y-auto pr-1 custom-scrollbar">
                {continuations.map((option, idx) => (
                  <div
                    key={idx}
                    onClick={() => onAcceptContinuation(option)}
                    className={`group relative p-5 rounded-lg border cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 ${
                      settings.theme === 'light'
                        ? 'bg-brand-gray-50 border-brand-gray-200 hover:bg-brand-gray-50 hover:border-brand-300'
                        : 'bg-brand-gray-800 border-brand-gray-700 hover:bg-brand-gray-750 hover:border-brand-500/50'
                    }`}
                  >
                    <div
                      className={`font-serif text-sm leading-relaxed ${
                        settings.theme === 'light'
                          ? 'text-brand-gray-800'
                          : 'text-brand-gray-300 group-hover:text-brand-gray-200'
                      }`}
                    >
                      {option}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3 flex justify-center items-center space-x-3">
              <button
                onClick={onTriggerSuggestions}
                disabled={isSuggesting || isAiLoading}
                className={`group flex items-center space-x-3 px-6 py-3 rounded-full border transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
                  settings.theme === 'light'
                    ? 'bg-brand-gray-50 border-brand-gray-200 hover:bg-brand-gray-50 text-brand-gray-600'
                    : 'bg-brand-gray-800 border-brand-gray-700 hover:bg-brand-gray-700 hover:border-brand-500/30 text-brand-gray-300'
                }`}
                title="Get AI Suggestions (WRITING model)"
              >
                {isSuggesting || isAiLoading ? (
                  <>
                    <Loader2 className="animate-spin text-violet-500" size={18} />
                    <span className="font-medium text-sm text-violet-600 dark:text-violet-400">
                      Working...
                    </span>
                  </>
                ) : (
                  <>
                    <div className="bg-violet-100 dark:bg-violet-900/30 p-1 rounded-md text-violet-600 dark:text-violet-400">
                      <Sparkles size={16} />
                    </div>
                    <span className="font-medium text-sm">Suggest next paragraph</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="fixed bottom-4 right-4 text-xs opacity-30 pointer-events-none">
          {/* Debug or Status info could go here */}
        </div>
      </div>
    );
  }
);

Editor.displayName = 'Editor';

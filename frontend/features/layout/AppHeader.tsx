// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the app header unit so this responsibility stays isolated, testable, and easy to evolve.

import React, { Dispatch, RefObject, SetStateAction } from 'react';
import { useTheme } from './ThemeContext';
import {
  Bold,
  ChevronDown,
  Code,
  Eye,
  FileEdit,
  FileText,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Pilcrow,
  Quote,
  Redo,
  Settings as SettingsIcon,
  Type,
  Undo,
  Wand2,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { AppSettings, AppTheme, EditorSettings, ViewMode } from '../../types';
import { ModelSelector } from '../chat/ModelSelector';
import { HeaderAppearanceControls } from '../editor/HeaderAppearanceControls';

type AppHeaderProps = {
  storyTitle: string;

  isSidebarOpen: boolean;
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setIsSettingsOpen: Dispatch<SetStateAction<boolean>>;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  viewMode: ViewMode;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  showWhitespace: boolean;
  setShowWhitespace: Dispatch<SetStateAction<boolean>>;
  isViewMenuOpen: boolean;
  setIsViewMenuOpen: Dispatch<SetStateAction<boolean>>;

  handleFormat: (type: string) => void;
  getFormatButtonClass: (type: string) => string;
  isFormatMenuOpen: boolean;
  setIsFormatMenuOpen: Dispatch<SetStateAction<boolean>>;
  isMobileFormatMenuOpen: boolean;
  setIsMobileFormatMenuOpen: Dispatch<SetStateAction<boolean>>;

  handleAiAction: (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => Promise<void>;
  isAiActionLoading: boolean;

  appSettings: AppSettings;
  setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  modelConnectionStatus: React.ComponentProps<typeof ModelSelector>['connectionStatus'];
  detectedCapabilities: React.ComponentProps<
    typeof ModelSelector
  >['detectedCapabilities'];

  setIsImagesOpen: Dispatch<SetStateAction<boolean>>;
  appearanceRef: RefObject<HTMLDivElement | null>;
  isAppearanceOpen: boolean;
  setIsAppearanceOpen: Dispatch<SetStateAction<boolean>>;
  setAppTheme: (theme: AppTheme) => void;
  editorSettings: EditorSettings;
  setEditorSettings: Dispatch<SetStateAction<EditorSettings>>;
  setIsDebugLogsOpen: Dispatch<SetStateAction<boolean>>;

  isChatOpen: boolean;
  setIsChatOpen: Dispatch<SetStateAction<boolean>>;
};

export const AppHeader: React.FC<AppHeaderProps> = ({
  storyTitle,
  isSidebarOpen,
  setIsSidebarOpen,
  setIsSettingsOpen,
  undo,
  redo,
  canUndo,
  canRedo,
  viewMode,
  setViewMode,
  showWhitespace,
  setShowWhitespace,
  isViewMenuOpen,
  setIsViewMenuOpen,
  handleFormat,
  getFormatButtonClass,
  isFormatMenuOpen,
  setIsFormatMenuOpen,
  isMobileFormatMenuOpen,
  setIsMobileFormatMenuOpen,
  handleAiAction,
  isAiActionLoading,
  appSettings,
  setAppSettings,
  modelConnectionStatus,
  detectedCapabilities,
  setIsImagesOpen,
  appearanceRef,
  isAppearanceOpen,
  setIsAppearanceOpen,
  setAppTheme,
  editorSettings,
  setEditorSettings,
  setIsDebugLogsOpen,
  isChatOpen,
  setIsChatOpen,
}) => {
  const {
    headerBg,
    iconColor,
    iconHover,
    dividerColor,
    buttonActive,
    textMain,
    isLight,
    currentTheme,
    sliderClass,
  } = useTheme();

  return (
    <header
      className={`h-14 border-b flex items-center justify-between px-3 md:px-4 shadow-sm z-40 relative shrink-0 ${headerBg}`}
    >
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
              {storyTitle}
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

      <div className="flex-1 flex justify-center items-center min-w-0 px-2 space-x-2 md:space-x-4">
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
              onClick={() => setShowWhitespace((value) => !value)}
              title="Toggle whitespace characters"
              className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                showWhitespace ? buttonActive : `${iconColor} ${iconHover}`
              }`}
            >
              <Pilcrow size={13} />
              <span>WS</span>
            </button>
          </div>

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

        <div className="hidden md:flex items-center space-x-0.5">
          <div className={`w-px h-4 mx-2 ${dividerColor}`}></div>

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

          <div className={`w-px h-4 mx-1 ${dividerColor}`}></div>

          <div className="hidden xl:flex items-center space-x-0.5">
            <button
              onClick={() => handleFormat('h1')}
              className={`${getFormatButtonClass('h1')} font-serif font-bold text-xs w-8`}
              title="Heading 1"
            >
              H1
            </button>
            <button
              onClick={() => handleFormat('h2')}
              className={`${getFormatButtonClass('h2')} font-serif font-bold text-xs w-8`}
              title="Heading 2"
            >
              H2
            </button>
            <button
              onClick={() => handleFormat('h3')}
              className={`${getFormatButtonClass('h3')} font-serif font-bold text-xs w-8`}
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
                    className={`${getFormatButtonClass('h1')} font-serif font-bold text-xs`}
                  >
                    H1
                  </button>
                  <button
                    onClick={() => handleFormat('h2')}
                    className={`${getFormatButtonClass('h2')} font-serif font-bold text-xs`}
                  >
                    H2
                  </button>
                  <button
                    onClick={() => handleFormat('h3')}
                    className={`${getFormatButtonClass('h3')} font-serif font-bold text-xs`}
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
                      className={`flex-1 flex justify-center ${getFormatButtonClass('bold')}`}
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
                      className={`flex-1 flex justify-center ${getFormatButtonClass('link')}`}
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
                      className={`${getFormatButtonClass('h1')} font-serif font-bold text-xs`}
                    >
                      H1
                    </button>
                    <button
                      onClick={() => handleFormat('h2')}
                      className={`${getFormatButtonClass('h2')} font-serif font-bold text-xs`}
                    >
                      H2
                    </button>
                    <button
                      onClick={() => handleFormat('h3')}
                      className={`${getFormatButtonClass('h3')} font-serif font-bold text-xs`}
                    >
                      H3
                    </button>
                    <button
                      onClick={() => handleFormat('quote')}
                      className={`flex justify-center ${getFormatButtonClass('quote')}`}
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
                      className={`flex-1 flex justify-center ${getFormatButtonClass('ul')}`}
                    >
                      <List size={16} />
                    </button>
                    <button
                      onClick={() => handleFormat('ol')}
                      className={`flex-1 flex justify-center ${getFormatButtonClass('ol')}`}
                    >
                      <ListOrdered size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

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

        <div
          className={`hidden 2xl:flex items-center space-x-3 ml-2 pl-2 border-l h-8 ${
            isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
          }`}
        >
          <ModelSelector
            label="Editing"
            value={appSettings.activeEditingProviderId}
            onChange={(value) =>
              setAppSettings((previous) => ({
                ...previous,
                activeEditingProviderId: value,
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
            onChange={(value) =>
              setAppSettings((previous) => ({
                ...previous,
                activeWritingProviderId: value,
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
            onChange={(value) =>
              setAppSettings((previous) => ({
                ...previous,
                activeChatProviderId: value,
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
        <HeaderAppearanceControls
          appearanceRef={appearanceRef}
          isAppearanceOpen={isAppearanceOpen}
          setIsAppearanceOpen={setIsAppearanceOpen}
          isLight={isLight}
          textMain={textMain}
          buttonActive={buttonActive}
          currentTheme={currentTheme}
          setAppTheme={setAppTheme}
          editorSettings={editorSettings}
          setEditorSettings={setEditorSettings}
          sliderClass={sliderClass}
          setIsDebugLogsOpen={setIsDebugLogsOpen}
        />

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
  );
};

// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the app header unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React from 'react';
import { useTheme } from './ThemeContext';
import {
  Image as ImageIcon,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Redo,
  Settings as SettingsIcon,
  Undo,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { HeaderAppearanceControls } from '../editor/HeaderAppearanceControls';
import { HeaderCenterControls } from './header/HeaderCenterControls';
import {
  HeaderAiControls,
  HeaderAppearanceControlsState,
  HeaderChatPanelControls,
  HeaderFormatControls,
  HeaderHistoryControls,
  HeaderModelControls,
  HeaderSettingsControls,
  HeaderSidebarControls,
  HeaderViewControls,
} from './layoutControlTypes';

type AppHeaderProps = {
  storyTitle: string;
  sidebarControls: HeaderSidebarControls;
  settingsControls: HeaderSettingsControls;
  historyControls: HeaderHistoryControls;
  viewControls: HeaderViewControls;
  formatControls: HeaderFormatControls;
  aiControls: HeaderAiControls;
  modelControls: HeaderModelControls;
  appearanceControls: HeaderAppearanceControlsState;
  chatPanelControls: HeaderChatPanelControls;
};

export const AppHeader: React.FC<AppHeaderProps> = ({
  storyTitle,
  sidebarControls,
  settingsControls,
  historyControls,
  viewControls,
  formatControls,
  aiControls,
  modelControls,
  appearanceControls,
  chatPanelControls,
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

  const { isSidebarOpen, setIsSidebarOpen } = sidebarControls;
  const { setIsSettingsOpen, setIsImagesOpen, setIsDebugLogsOpen } = settingsControls;
  const { undo, redo, canUndo, canRedo } = historyControls;
  const {
    appearanceRef,
    isAppearanceOpen,
    setIsAppearanceOpen,
    setAppTheme,
    editorSettings,
    setEditorSettings,
  } = appearanceControls;
  const { isChatOpen, setIsChatOpen } = chatPanelControls;

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

      <HeaderCenterControls
        viewControls={viewControls}
        formatControls={formatControls}
        aiControls={aiControls}
        modelControls={modelControls}
        themeTokens={{
          isLight,
          iconColor,
          iconHover,
          dividerColor,
          buttonActive,
          currentTheme,
        }}
      />

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

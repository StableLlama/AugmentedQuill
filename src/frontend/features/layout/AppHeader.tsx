// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the app header unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from './ThemeContext';
import {
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo,
  Search,
  Settings as SettingsIcon,
  Undo,
} from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { HeaderAppearanceControls } from '../editor/HeaderAppearanceControls';
import { HeaderCenterControls } from './header/HeaderCenterControls';
import { CheckpointsMenu } from '../checkpoints/CheckpointsMenu';
import { useConfirm } from './ConfirmDialogContext';
import { useClickOutside } from '../../utils/hooks';
import {
  HeaderAiControls,
  HeaderAppearanceControlsState,
  HeaderChatPanelControls,
  HeaderHistoryControls,
  HeaderModelControls,
  HeaderSearchControls,
  HeaderSettingsControls,
  HeaderSidebarControls,
} from './layoutControlTypes';
import type { AppTheme } from '../../types/ui';

type AppHeaderProps = {
  storyTitle: string;
  sidebarControls: HeaderSidebarControls;
  settingsControls: HeaderSettingsControls;
  historyControls: HeaderHistoryControls;
  aiControls: HeaderAiControls;
  modelControls: HeaderModelControls;
  appearanceControls: HeaderAppearanceControlsState;
  chatPanelControls: HeaderChatPanelControls;
  searchControls: HeaderSearchControls;
};

interface UndoRedoMenuProps {
  options: Array<{ id: string; label: string; steps: number }>;
  label: string;
  primaryActionLabel: string;
  menuContainerClass: string;
  menuButtonClass: string;
  onPrimaryAction: () => void;
  onStep: (steps: number) => void;
  t: (key: string) => string;
}

const UndoRedoMenu: React.FC<UndoRedoMenuProps> = ({
  options,
  label,
  primaryActionLabel,
  menuContainerClass,
  menuButtonClass,
  onPrimaryAction,
  onStep,
  t,
}: UndoRedoMenuProps) => (
  <div className={menuContainerClass} role="menu" aria-label={`${label} actions`}>
    <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide opacity-70">
      {t(`${label} Actions`)}
    </div>
    <button
      type="button"
      role="menuitem"
      className={`${menuButtonClass} font-medium border-b border-brand-gray-200 dark:border-brand-gray-700`}
      onClick={onPrimaryAction}
      title={primaryActionLabel}
    >
      {primaryActionLabel}
    </button>
    {options.map((option: { id: string; label: string; steps: number }) => (
      <button
        key={option.id}
        type="button"
        role="menuitem"
        className={menuButtonClass}
        onClick={(): void => onStep(option.steps)}
        title={option.label}
      >
        {t(label)} {option.steps}: {option.label}
      </button>
    ))}
  </div>
);

interface HeaderRightControlsProps {
  settingsControls: HeaderSettingsControls;
  appearanceControls: HeaderAppearanceControlsState;
  chatPanelControls: HeaderChatPanelControls;
  currentTheme: AppTheme;
  t: (key: string) => string;
}

const HeaderRightControls: React.FC<HeaderRightControlsProps> = ({
  settingsControls,
  appearanceControls,
  chatPanelControls,
  currentTheme,
  t,
}: HeaderRightControlsProps) => {
  const { setIsSettingsOpen, setIsDebugLogsOpen } = settingsControls;
  const {
    appearanceRef,
    isAppearanceOpen,
    setIsAppearanceOpen,
    setAppTheme,
    editorSettings,
    setEditorSettings,
  } = appearanceControls;
  const { isLight, textMain, buttonActive, sliderClass } = useTheme();
  const { isChatOpen, setIsChatOpen } = chatPanelControls;

  return (
    <div className="order-2 sm:order-3 flex items-center justify-end gap-1 sm:gap-2 min-w-0">
      <Button
        theme={currentTheme}
        variant="ghost"
        size="sm"
        onClick={(): void => setIsSettingsOpen(true)}
        title={t('Settings')}
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
        onClick={(): void => setIsChatOpen(!isChatOpen)}
        aria-label={t('Toggle AI Chat')}
        icon={isChatOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      >
        <span className="hidden xl:inline">{isChatOpen ? t('Hide') : t('AI')}</span>
      </Button>
    </div>
  );
};

interface HeaderLeftControlsProps {
  storyTitle: string;
  sidebarControls: HeaderSidebarControls;
  settingsControls: Pick<HeaderSettingsControls, 'setIsSettingsOpen'>;
  historyControls: HeaderHistoryControls;
  searchControls: HeaderSearchControls;
  iconColor: string;
  iconHover: string;
  dividerColor: string;
  currentTheme: AppTheme;
  t: (key: string) => string;
}

const HeaderLeftControls: React.FC<HeaderLeftControlsProps> = ({
  storyTitle,
  sidebarControls,
  settingsControls,
  historyControls,
  searchControls,
  iconColor: _iconColor,
  iconHover: _iconHover,
  dividerColor,
  currentTheme,
  t,
}: HeaderLeftControlsProps) => {
  const { isLight, textMain } = useTheme();
  const { isSidebarOpen, setIsSidebarOpen } = sidebarControls;
  const { setIsSettingsOpen } = settingsControls;
  const {
    undo,
    redo,
    undoSteps,
    redoSteps,
    undoOptions,
    redoOptions,
    nextUndoLabel,
    nextRedoLabel,
    canUndo,
    canRedo,
  } = historyControls;
  const { onOpenSearch } = searchControls;
  const [isUndoMenuOpen, setIsUndoMenuOpen] = useState(false);
  const [isRedoMenuOpen, setIsRedoMenuOpen] = useState(false);
  const undoMenuRef = useRef<HTMLDivElement | null>(null);
  const redoMenuRef = useRef<HTMLDivElement | null>(null);
  const confirm = useConfirm();

  useClickOutside(undoMenuRef, (): void => setIsUndoMenuOpen(false), isUndoMenuOpen);
  useClickOutside(redoMenuRef, (): void => setIsRedoMenuOpen(false), isRedoMenuOpen);

  const menuContainerClass = isLight
    ? 'absolute left-0 top-full z-[90] mt-1 w-64 rounded-md border border-brand-gray-200 bg-white shadow-lg'
    : 'absolute left-0 top-full z-[90] mt-1 w-64 rounded-md border border-brand-gray-700 bg-brand-gray-900 shadow-lg';
  const menuButtonClass = isLight
    ? 'w-full px-3 py-2 text-left text-xs text-brand-gray-700 hover:bg-brand-gray-100'
    : 'w-full px-3 py-2 text-left text-xs text-brand-gray-300 hover:bg-brand-gray-800';

  return (
    <div className="order-1 flex items-center gap-1 sm:gap-2 md:gap-3 min-w-0">
      <Button
        theme={currentTheme}
        variant="secondary"
        size="sm"
        onClick={(): void => setIsSidebarOpen(!isSidebarOpen)}
        icon={
          isSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />
        }
      >
        <span className="hidden xl:inline">
          {isSidebarOpen ? t('Hide') : t('Menu')}
        </span>
      </Button>

      <button
        type="button"
        onClick={(): void => setIsSettingsOpen(true)}
        className="flex items-center space-x-2"
        aria-label={t('Open settings')}
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
            className={`font-bold tracking-tight leading-none hidden xl:inline ${textMain}`}
          >
            AugmentedQuill
          </span>
          <span className="text-[10px] text-brand-gray-500 font-mono leading-none hidden 2xl:inline">
            {storyTitle}
          </span>
        </div>
      </button>

      <div className={`h-6 w-px hidden lg:block ${dividerColor}`} />

      <div className="flex items-center gap-1 min-w-0">
        <div className="relative inline-flex rounded-md shadow-sm" ref={undoMenuRef}>
          <Button
            theme={currentTheme}
            variant="ghost"
            size="sm"
            onClick={(): void => undo()}
            disabled={!canUndo}
            title={nextUndoLabel ? `${t('Undo')}: ${nextUndoLabel}` : t('Undo')}
            aria-label={nextUndoLabel ? `${t('Undo')}: ${nextUndoLabel}` : t('Undo')}
            className="rounded-r-none border-r-0 px-1.5"
            icon={<Undo size={14} />}
          />
          <Button
            theme={currentTheme}
            variant="ghost"
            size="sm"
            onClick={(): void => setIsUndoMenuOpen((o: boolean): boolean => !o)}
            disabled={!canUndo}
            title={t('Show undo history')}
            aria-label={t('Show undo history')}
            aria-haspopup="menu"
            aria-expanded={isUndoMenuOpen}
            className="rounded-l-none px-1.5 w-7"
            icon={<ChevronDown size={12} />}
          />
          {isUndoMenuOpen && canUndo && (
            <UndoRedoMenu
              options={undoOptions}
              label="Undo"
              primaryActionLabel={
                nextUndoLabel ? `${t('Undo')}: ${nextUndoLabel}` : t('Undo')
              }
              menuContainerClass={menuContainerClass}
              menuButtonClass={menuButtonClass}
              onPrimaryAction={(): void => {
                undo();
                setIsUndoMenuOpen(false);
              }}
              onStep={(steps: number): void => {
                undoSteps(steps);
                setIsUndoMenuOpen(false);
              }}
              t={t}
            />
          )}
        </div>

        <div className="relative inline-flex rounded-md shadow-sm" ref={redoMenuRef}>
          <Button
            theme={currentTheme}
            variant="ghost"
            size="sm"
            onClick={(): void => redo()}
            disabled={!canRedo}
            title={nextRedoLabel ? `${t('Redo')}: ${nextRedoLabel}` : t('Redo')}
            aria-label={nextRedoLabel ? `${t('Redo')}: ${nextRedoLabel}` : t('Redo')}
            className="rounded-r-none border-r-0 px-1.5"
            icon={<Redo size={14} />}
          />
          <Button
            theme={currentTheme}
            variant="ghost"
            size="sm"
            onClick={(): void => setIsRedoMenuOpen((o: boolean): boolean => !o)}
            disabled={!canRedo}
            title={t('Show redo history')}
            aria-label={t('Show redo history')}
            aria-haspopup="menu"
            aria-expanded={isRedoMenuOpen}
            className="rounded-l-none px-1.5 w-7"
            icon={<ChevronDown size={12} />}
          />
          {isRedoMenuOpen && canRedo && (
            <UndoRedoMenu
              options={redoOptions}
              label="Redo"
              primaryActionLabel={
                nextRedoLabel ? `${t('Redo')}: ${nextRedoLabel}` : t('Redo')
              }
              menuContainerClass={menuContainerClass}
              menuButtonClass={menuButtonClass}
              onPrimaryAction={(): void => {
                redo();
                setIsRedoMenuOpen(false);
              }}
              onStep={(steps: number): void => {
                redoSteps(steps);
                setIsRedoMenuOpen(false);
              }}
              t={t}
            />
          )}
        </div>
        <CheckpointsMenu hasUnsavedChanges={canUndo} confirm={confirm} />
        <Button
          theme={currentTheme}
          variant="ghost"
          size="sm"
          onClick={onOpenSearch}
          title={t('Search and Replace (Ctrl+F)')}
          aria-label={t('Search and Replace')}
          className="ml-1"
        >
          <Search size={18} />
        </Button>
      </div>
    </div>
  );
};

export const AppHeader: React.FC<AppHeaderProps> = React.memo(
  ({
    storyTitle,
    sidebarControls,
    settingsControls,
    historyControls,
    aiControls,
    modelControls,
    appearanceControls,
    chatPanelControls,
    searchControls,
  }: AppHeaderProps) => {
    const { t } = useTranslation();
    const {
      headerBg,
      iconColor,
      iconHover,
      dividerColor,
      buttonActive,
      isLight,
      currentTheme,
    } = useTheme();

    return (
      <header
        id="aq-header"
        role="banner"
        className={`min-h-14 py-1.5 border-b flex flex-wrap lg:flex-nowrap items-center justify-between px-3 md:px-4 shadow-sm z-[80] relative shrink-0 ${headerBg}`}
      >
        <HeaderLeftControls
          storyTitle={storyTitle}
          sidebarControls={sidebarControls}
          settingsControls={settingsControls}
          historyControls={historyControls}
          searchControls={searchControls}
          iconColor={iconColor}
          iconHover={iconHover}
          dividerColor={dividerColor}
          currentTheme={currentTheme}
          t={t}
        />

        <HeaderCenterControls
          title={storyTitle}
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

        <HeaderRightControls
          settingsControls={settingsControls}
          appearanceControls={appearanceControls}
          chatPanelControls={chatPanelControls}
          currentTheme={currentTheme}
          t={t}
        />
      </header>
    );
  }
);

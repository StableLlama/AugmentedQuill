// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines center controls in app header to keep top-level header composition concise.
 */

import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bold,
  ChevronDown,
  Code,
  Code2,
  Cpu,
  Eye,
  FileEdit,
  FileText,
  Hash,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Strikethrough,
  Subscript,
  Superscript,
  Type,
  Wand2,
  BookOpen,
  Layers,
  Columns,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore, UIStoreState } from '../../../stores/uiStore';

import { Button } from '../../../components/ui/Button';
import {
  HeaderAiControls,
  HeaderFormatControls,
  HeaderModelControls,
  HeaderThemeTokens,
  HeaderViewControls,
} from '../layoutControlTypes';
import { ModelSelector } from '../../chat/ModelSelector';
import { useClickOutside } from '../../../utils/hooks';
import type { AppTheme } from '../../../types/ui';

type HeaderCenterControlsProps = {
  title: string | null;
  hasUpdates?: boolean;
  aiControls: HeaderAiControls;
  modelControls: HeaderModelControls;
  themeTokens: HeaderThemeTokens;
};

export type FormatButton = {
  key: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  extraClass?: string;
};

export interface ViewModeSelectorProps {
  viewMode: string;
  setViewMode: (mode: 'raw' | 'markdown' | 'wysiwyg') => void;
  showWhitespace: boolean;
  setShowWhitespace: (v: boolean) => void;
  showInlineTabs: boolean;
  isViewMenuOpen: boolean;
  setIsViewMenuOpen: (v: boolean) => void;
  isLight: boolean;
  iconColor: string;
  iconHover: string;
  buttonActive: string;
  t: (key: string) => string;
}

const VIEW_MODES: Array<{
  key: 'raw' | 'markdown' | 'wysiwyg';
  icon: React.ReactNode;
  label: string;
}> = [
  { key: 'raw', icon: <FileText size={14} />, label: 'Raw' },
  { key: 'markdown', icon: <Code size={14} />, label: 'MD' },
  { key: 'wysiwyg', icon: <Eye size={14} />, label: 'Visual' },
];

export const ViewModeSelector: React.FC<ViewModeSelectorProps> = ({
  viewMode,
  setViewMode,
  showWhitespace,
  setShowWhitespace,
  showInlineTabs,
  isViewMenuOpen,
  setIsViewMenuOpen,
  isLight,
  iconColor,
  iconHover,
  buttonActive,
  t,
}: ViewModeSelectorProps) => {
  const activeMode = VIEW_MODES.find((m: { key: string }) => m.key === viewMode);
  const tabBg = isLight
    ? 'bg-brand-gray-100 border-brand-gray-200'
    : 'bg-brand-gray-800 border-brand-gray-700';
  const dropBg = isLight
    ? 'bg-brand-gray-50 border-brand-gray-200'
    : 'bg-brand-gray-800 border-brand-gray-700';
  const dropItem = isLight ? 'hover:bg-brand-gray-100' : 'dark:hover:bg-brand-gray-700';
  return (
    <div className="relative">
      {/* Desktop: inline tab row */}
      <div
        className={`${showInlineTabs ? 'flex' : 'hidden'} items-center p-1 rounded-lg border ${tabBg}`}
      >
        {VIEW_MODES.map((m: (typeof VIEW_MODES)[0]) => (
          <button
            key={m.key}
            onClick={(): void => setViewMode(m.key)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              viewMode === m.key ? buttonActive : `${iconColor} ${iconHover}`
            }`}
          >
            {React.cloneElement(m.icon as React.ReactElement<{ size?: number }>, {
              size: 13,
            })}
            <span>{m.label}</span>
          </button>
        ))}
        <div
          className={`w-px h-4 mx-2 ${isLight ? 'bg-brand-gray-300' : 'bg-brand-gray-700'}`}
        />
        <button
          onClick={(): void => setShowWhitespace(!showWhitespace)}
          title={t('Toggle whitespace characters')}
          className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
            showWhitespace ? buttonActive : `${iconColor} ${iconHover}`
          }`}
        >
          <Pilcrow size={13} />
          <span>WS</span>
        </button>
      </div>

      {/* Mobile/tablet: dropdown */}
      <div className={`${showInlineTabs ? 'hidden' : 'relative'}`}>
        <button
          onClick={(): void => setIsViewMenuOpen(!isViewMenuOpen)}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium border ${
            isLight
              ? 'bg-brand-gray-50 border-brand-gray-200 text-brand-gray-700'
              : 'bg-brand-gray-900 border-brand-gray-700 text-brand-gray-300'
          }`}
        >
          {activeMode &&
            React.cloneElement(
              activeMode.icon as React.ReactElement<{ size?: number }>,
              { size: 14 }
            )}
          <span>{activeMode?.label}</span>
          <ChevronDown size={12} className="opacity-50" />
        </button>
        {isViewMenuOpen && (
          <>
            <button
              className="fixed inset-0 z-10 cursor-default"
              onClick={(): void => setIsViewMenuOpen(false)}
              aria-label={t('Close menu')}
            />
            <div
              role="menu"
              className={`absolute top-full left-0 mt-2 w-36 rounded-lg shadow-lg border p-1 z-20 flex flex-col gap-1 ${dropBg}`}
            >
              {VIEW_MODES.map((m: (typeof VIEW_MODES)[0]) => (
                <button
                  key={m.key}
                  onClick={(): void => {
                    setViewMode(m.key);
                    setIsViewMenuOpen(false);
                  }}
                  className={`flex items-center space-x-2 px-2 py-1.5 rounded text-xs text-left ${
                    viewMode === m.key
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                      : dropItem
                  }`}
                >
                  {m.icon}
                  <span>{m.label}</span>
                </button>
              ))}
              <div
                className={`my-1 h-px ${isLight ? 'bg-brand-gray-200' : 'bg-brand-gray-700'}`}
              />
              <button
                onClick={(): void => {
                  setShowWhitespace(!showWhitespace);
                  setIsViewMenuOpen(false);
                }}
                className={`flex items-center space-x-2 px-2 py-1.5 rounded text-xs text-left ${
                  showWhitespace
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                    : dropItem
                }`}
              >
                <Pilcrow size={14} />
                <span>WS</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export interface FormatToolbarProps {
  allFormatButtons: FormatButton[];
  inlineCount: number;
  getFormatButtonClass: (key: string) => string;
  isFormatMenuOpen: boolean;
  setIsFormatMenuOpen: (v: boolean) => void;
  isMobileFormatMenuOpen: boolean;
  setIsMobileFormatMenuOpen: (v: boolean) => void;
  formatMenuRef: React.RefObject<HTMLDivElement | null>;
  dividerColor: string;
  isLight: boolean;
  buttonActive: string;
  currentTheme: AppTheme;
  t: (key: string) => string;
}

export const FormatToolbar: React.FC<FormatToolbarProps> = ({
  allFormatButtons,
  inlineCount,
  getFormatButtonClass,
  isFormatMenuOpen,
  setIsFormatMenuOpen,
  isMobileFormatMenuOpen,
  setIsMobileFormatMenuOpen,
  formatMenuRef,
  dividerColor,
  isLight,
  buttonActive,
  t,
}: FormatToolbarProps) => {
  const dropBg = isLight
    ? 'bg-brand-gray-50 border-brand-gray-200'
    : 'bg-brand-gray-800 border-brand-gray-700';
  const mobileBg = isLight
    ? 'bg-brand-gray-50 border-brand-gray-200'
    : 'bg-brand-gray-900 border-brand-gray-700';
  return (
    <>
      {/* Desktop inline buttons */}
      {inlineCount > 0 && (
        <div className="hidden lg:flex items-center space-x-0.5">
          <div className={`w-px h-4 mx-2 ${dividerColor}`} />
          {allFormatButtons.slice(0, inlineCount).map((btn: FormatButton) => (
            <button
              key={btn.key}
              onClick={btn.onClick}
              className={getFormatButtonClass(btn.key)}
              title={btn.label}
            >
              {btn.icon}
            </button>
          ))}
          {inlineCount < allFormatButtons.length && (
            <div className="relative" ref={formatMenuRef}>
              <button
                onClick={(): void => setIsFormatMenuOpen(!isFormatMenuOpen)}
                className={`p-1.5 rounded-md transition-colors flex items-center gap-1 ${
                  isFormatMenuOpen
                    ? buttonActive
                    : isLight
                      ? 'text-brand-gray-500 hover:bg-brand-gray-100'
                      : 'text-brand-gray-400 hover:bg-brand-gray-800'
                }`}
                title={t('Formatting')}
              >
                <Type size={16} />
                <ChevronDown size={10} />
              </button>
              {isFormatMenuOpen && (
                <>
                  <button
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={(): void => setIsFormatMenuOpen(false)}
                    aria-label={t('Close formatting menu')}
                  />
                  <div
                    className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 rounded-lg shadow-xl border p-2 z-20 flex gap-1 flex-wrap max-w-48 ${dropBg}`}
                  >
                    {allFormatButtons.slice(inlineCount).map((btn: FormatButton) => (
                      <button
                        key={btn.key}
                        onClick={(): void => {
                          btn.onClick();
                          setIsFormatMenuOpen(false);
                        }}
                        className={getFormatButtonClass(btn.key)}
                        title={btn.label}
                      >
                        {btn.icon}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mobile: all buttons in one menu */}
      <div className="lg:hidden relative">
        <button
          onClick={(): void => setIsMobileFormatMenuOpen(!isMobileFormatMenuOpen)}
          className={`p-2 rounded-md border flex items-center gap-2 text-xs font-medium ${
            isMobileFormatMenuOpen
              ? buttonActive
              : isLight
                ? 'bg-brand-gray-50 border-brand-gray-200 text-brand-gray-700'
                : 'bg-brand-gray-900 border-brand-gray-700 text-brand-gray-300'
          }`}
        >
          <Type size={16} />
          <span>{t('Format')}</span>
        </button>
        {isMobileFormatMenuOpen && (
          <>
            <button
              className="fixed inset-0 z-10 cursor-default"
              onClick={(): void => setIsMobileFormatMenuOpen(false)}
              aria-label={t('Close mobile format menu')}
            />
            <div
              className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 rounded-xl shadow-2xl border p-3 z-50 flex flex-wrap gap-1 ${mobileBg}`}
            >
              {allFormatButtons.map((btn: FormatButton) => (
                <button
                  key={btn.key}
                  onClick={(): void => {
                    btn.onClick();
                    setIsMobileFormatMenuOpen(false);
                  }}
                  className={`flex-1 min-w-[2.5rem] flex justify-center ${getFormatButtonClass(btn.key)}`}
                  title={btn.label}
                >
                  {btn.icon}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
};

interface AiChapterControlsProps {
  handleAiAction: (
    target: 'summary' | 'chapter',
    action: 'update' | 'rewrite' | 'extend'
  ) => Promise<void>;
  isAiActionLoading: boolean;
  isWritingAvailable: boolean;
  isChapterEmpty: boolean | undefined;
  showLabel: boolean;
  isLight: boolean;
  currentTheme: AppTheme;
  t: (key: string) => string;
}

const AiChapterControls: React.FC<AiChapterControlsProps> = ({
  handleAiAction,
  isAiActionLoading,
  isWritingAvailable,
  isChapterEmpty,
  showLabel,
  isLight,
  currentTheme,
  t,
}: AiChapterControlsProps) => {
  const writingUnavailableReason = t(
    'This action is unavailable because no working WRITING model is configured.'
  );
  const chapterExtendDisabled = isAiActionLoading || !isWritingAvailable;
  const chapterRewriteDisabled =
    isAiActionLoading || !isWritingAvailable || !!isChapterEmpty;
  return (
    <div className="hidden lg:flex items-center space-x-1">
      <div
        className={`flex items-center rounded-md p-1 space-x-1 border ${
          isLight
            ? 'bg-brand-gray-100 border-brand-gray-200'
            : 'bg-brand-gray-800 border-brand-gray-700'
        }`}
      >
        {showLabel && (
          <>
            <span className="text-[10px] text-brand-gray-500 font-bold uppercase px-2 whitespace-nowrap">
              {t('Chapter AI')}
            </span>
            <div
              className={`w-px h-4 ${isLight ? 'bg-brand-gray-300' : 'bg-brand-gray-700'}`}
            />
          </>
        )}
        <Button
          theme={currentTheme}
          size="sm"
          variant="ghost"
          className="text-xs h-6"
          onClick={(): Promise<void> => handleAiAction('chapter', 'extend')}
          disabled={chapterExtendDisabled}
          icon={<Wand2 size={12} />}
          title={
            !isWritingAvailable
              ? writingUnavailableReason
              : t('Extend Chapter (WRITING model)')
          }
        >
          <span className="hidden 2xl:inline">{t('Extend')}</span>
        </Button>
        <Button
          theme={currentTheme}
          size="sm"
          variant="ghost"
          className="text-xs h-6"
          onClick={(): Promise<void> => handleAiAction('chapter', 'rewrite')}
          disabled={chapterRewriteDisabled}
          icon={<FileEdit size={12} />}
          title={
            !isWritingAvailable
              ? writingUnavailableReason
              : isChapterEmpty
                ? t('Chapter is empty; cannot rewrite existing text.')
                : t('Rewrite Chapter (WRITING model)')
          }
        >
          <span className="hidden 2xl:inline">{t('Rewrite')}</span>
        </Button>
      </div>
    </div>
  );
};

export const HeaderCenterControls: React.FC<HeaderCenterControlsProps> = ({
  aiControls,
  modelControls,
  themeTokens,
  title,
}: HeaderCenterControlsProps) => {
  const { t } = useTranslation();

  const { workspaceMode, setWorkspaceMode } = useUIStore(
    useShallow((s: UIStoreState) => ({
      workspaceMode: s.workspaceMode,
      setWorkspaceMode: s.setWorkspaceMode,
    }))
  );

  const { handleAiAction, isAiActionLoading, isWritingAvailable, isChapterEmpty } =
    aiControls;
  const {
    appSettings,
    setAppSettings,
    saveSettings,
    modelConnectionStatus,
    detectedCapabilities,
    recheckUnavailableProviderIfStale,
  } = modelControls;
  const { isLight, iconColor, iconHover, dividerColor, buttonActive, currentTheme } =
    themeTokens;

  const updateAppSettings = (nextSettings: typeof appSettings): void => {
    setAppSettings(nextSettings);
    if (saveSettings) {
      void saveSettings(nextSettings).catch((error: unknown): void => {
        console.error('Failed to persist model selection', error);
      });
    }
  };

  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const formatMenuRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const [centerWidth, setCenterWidth] = useState<number>(0);

  useEffect((): (() => void) | void => {
    const element = centerRef.current;
    if (!element) {
      return;
    }

    if (typeof ResizeObserver === 'undefined') {
      const syncFromWindow = (): void => {
        setCenterWidth(window.innerWidth);
      };
      syncFromWindow();
      window.addEventListener('resize', syncFromWindow);
      return (): void => window.removeEventListener('resize', syncFromWindow);
    }

    const syncWidth = (): void => {
      setCenterWidth(element.getBoundingClientRect().width);
    };
    syncWidth();

    const observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === 'number') {
        setCenterWidth(next);
      }
    });
    observer.observe(element);
    return (): void => observer.disconnect();
  }, []);

  useClickOutside(modelMenuRef, (): void => setIsModelMenuOpen(false), isModelMenuOpen);
  const showAiControls = centerWidth >= 860;
  const showAiLabel = centerWidth >= 1180;
  const showModelInline = centerWidth >= 1360;
  const showModelDropdown = centerWidth >= 980 && !showModelInline;

  const modelSelectorProps = {
    options: appSettings.providers,
    theme: currentTheme,
    connectionStatus: modelConnectionStatus,
    detectedCapabilities,
  };

  return (
    <div
      ref={centerRef}
      className="basis-full sm:basis-auto order-3 sm:order-2 flex-1 flex justify-center items-center min-w-0 px-2 space-x-2 xl:space-x-4 py-1 sm:py-0"
    >
      {/* Workspace Mode Toggles */}
      <div
        className={`flex items-center rounded-md p-1 border ${
          isLight
            ? 'bg-brand-gray-100 border-brand-gray-200'
            : 'bg-brand-gray-800 border-brand-gray-700'
        }`}
      >
        <button
          onClick={() => setWorkspaceMode('page')}
          className={`flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
            workspaceMode === 'page'
              ? isLight
                ? 'bg-white shadow-sm text-brand-gray-900 border border-brand-gray-200'
                : 'bg-brand-gray-700 text-brand-gray-100 border border-brand-gray-600'
              : isLight
                ? 'text-brand-gray-500 hover:text-brand-gray-700'
                : 'text-brand-gray-400 hover:text-brand-gray-200 hover:bg-brand-gray-700/50'
          }`}
          title={t('Page Mode')}
        >
          <FileText size={14} />
          <span className="hidden xl:inline">{t('Page')}</span>
        </button>

        <button
          onClick={() => setWorkspaceMode('scenes')}
          className={`flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
            workspaceMode === 'scenes'
              ? isLight
                ? 'bg-white shadow-sm text-brand-gray-900 border border-brand-gray-200'
                : 'bg-brand-gray-700 text-brand-gray-100 border border-brand-gray-600'
              : isLight
                ? 'text-brand-gray-500 hover:text-brand-gray-700'
                : 'text-brand-gray-400 hover:text-brand-gray-200 hover:bg-brand-gray-700/50'
          }`}
          title={t('Scenes Mode')}
        >
          <BookOpen size={14} />
          <span className="hidden xl:inline">{t('Scenes')}</span>
        </button>

        <button
          onClick={() => setWorkspaceMode('split')}
          className={`flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
            workspaceMode === 'split'
              ? isLight
                ? 'bg-white shadow-sm text-brand-gray-900 border border-brand-gray-200'
                : 'bg-brand-gray-700 text-brand-gray-100 border border-brand-gray-600'
              : isLight
                ? 'text-brand-gray-500 hover:text-brand-gray-700'
                : 'text-brand-gray-400 hover:text-brand-gray-200 hover:bg-brand-gray-700/50'
          }`}
          title={t('Split Mode')}
        >
          <Columns size={14} />
          <span className="hidden xl:inline">{t('Split')}</span>
        </button>
      </div>

      {showAiControls && (
        <div className="hidden lg:flex items-center space-x-1">
          <div className={`w-px h-4 mx-2 ${dividerColor}`} />
          <AiChapterControls
            handleAiAction={handleAiAction}
            isAiActionLoading={isAiActionLoading}
            isWritingAvailable={isWritingAvailable}
            isChapterEmpty={isChapterEmpty}
            showLabel={showAiLabel}
            isLight={isLight}
            currentTheme={currentTheme}
            t={t}
          />
        </div>
      )}

      {/* Model selectors */}
      {(showModelDropdown || showModelInline) && (
        <div
          className={`hidden lg:flex items-center ml-2 pl-2 border-l h-8 ${isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'}`}
        >
          {showModelDropdown && (
            <div className="relative" ref={modelMenuRef}>
              <button
                onClick={(): void => setIsModelMenuOpen(!isModelMenuOpen)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                  isLight
                    ? 'bg-brand-gray-50 border-brand-gray-200 text-brand-gray-700 hover:bg-brand-gray-100'
                    : 'bg-brand-gray-800 border-brand-gray-700 text-brand-gray-300 hover:bg-brand-gray-700'
                }`}
                title={t('Model settings')}
              >
                <Cpu size={13} />
                <span>{t('Models')}</span>
                <ChevronDown size={10} className="opacity-60" />
              </button>
              {isModelMenuOpen && (
                <>
                  <button
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={(): void => setIsModelMenuOpen(false)}
                    aria-label={t('Close model menu')}
                  />
                  <div
                    className={`absolute top-full right-0 mt-2 w-72 rounded-lg shadow-xl border p-3 z-20 flex flex-col gap-3 ${isLight ? 'bg-brand-gray-50 border-brand-gray-200' : 'bg-brand-gray-900 border-brand-gray-700'}`}
                  >
                    <ModelSelector
                      {...modelSelectorProps}
                      label="Writing"
                      value={appSettings.activeWritingProviderId}
                      onSelectorClick={(): void => {
                        void recheckUnavailableProviderIfStale(
                          appSettings.activeWritingProviderId
                        );
                      }}
                      onChange={(v: string): void =>
                        updateAppSettings({
                          ...appSettings,
                          activeWritingProviderId: v,
                        })
                      }
                      labelColorClass={isLight ? 'text-violet-600' : 'text-violet-400'}
                    />
                    <ModelSelector
                      {...modelSelectorProps}
                      label="Editing"
                      value={appSettings.activeEditingProviderId}
                      onSelectorClick={(): void => {
                        void recheckUnavailableProviderIfStale(
                          appSettings.activeEditingProviderId
                        );
                      }}
                      onChange={(v: string): void =>
                        updateAppSettings({
                          ...appSettings,
                          activeEditingProviderId: v,
                        })
                      }
                      labelColorClass={
                        isLight ? 'text-fuchsia-600' : 'text-fuchsia-400'
                      }
                    />
                    <ModelSelector
                      {...modelSelectorProps}
                      label="Chat"
                      value={appSettings.activeChatProviderId}
                      onSelectorClick={(): void => {
                        void recheckUnavailableProviderIfStale(
                          appSettings.activeChatProviderId
                        );
                      }}
                      onChange={(v: string): void =>
                        updateAppSettings({ ...appSettings, activeChatProviderId: v })
                      }
                      labelColorClass={isLight ? 'text-blue-600' : 'text-blue-400'}
                    />
                  </div>
                </>
              )}
            </div>
          )}
          {showModelInline && (
            <div className="flex items-center space-x-3">
              <ModelSelector
                {...modelSelectorProps}
                label="Writing"
                value={appSettings.activeWritingProviderId}
                onSelectorClick={(): void => {
                  void recheckUnavailableProviderIfStale(
                    appSettings.activeWritingProviderId
                  );
                }}
                onChange={(v: string): void =>
                  updateAppSettings({ ...appSettings, activeWritingProviderId: v })
                }
                labelColorClass={isLight ? 'text-violet-600' : 'text-violet-400'}
              />
              <ModelSelector
                {...modelSelectorProps}
                label="Editing"
                value={appSettings.activeEditingProviderId}
                onSelectorClick={(): void => {
                  void recheckUnavailableProviderIfStale(
                    appSettings.activeEditingProviderId
                  );
                }}
                onChange={(v: string): void =>
                  updateAppSettings({ ...appSettings, activeEditingProviderId: v })
                }
                labelColorClass={isLight ? 'text-fuchsia-600' : 'text-fuchsia-400'}
              />
              <ModelSelector
                {...modelSelectorProps}
                label="Chat"
                value={appSettings.activeChatProviderId}
                onSelectorClick={(): void => {
                  void recheckUnavailableProviderIfStale(
                    appSettings.activeChatProviderId
                  );
                }}
                onChange={(v: string): void =>
                  updateAppSettings({ ...appSettings, activeChatProviderId: v })
                }
                labelColorClass={isLight ? 'text-blue-600' : 'text-blue-400'}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

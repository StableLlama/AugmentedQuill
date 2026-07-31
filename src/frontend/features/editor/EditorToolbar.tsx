// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the editor toolbar unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../layout/ThemeContext';
import {
  ViewModeSelector,
  FormatToolbar,
  FormatButton,
} from '../layout/header/HeaderCenterControls';
import {
  Bold,
  Italic,
  Image as ImageIcon,
  Quote,
  Strikethrough,
  Subscript,
  Superscript,
  List,
  ListOrdered,
  Code,
  Code2,
} from 'lucide-react';
import { HeaderFormatControls, HeaderViewControls } from '../layout/layoutControlTypes';

export interface EditorToolbarProps {
  viewControls: HeaderViewControls;
  formatControls: HeaderFormatControls;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  viewControls,
  formatControls,
}: EditorToolbarProps): React.ReactElement => {
  const { t } = useTranslation();
  const { isLight, iconColor, iconHover, buttonActive, dividerColor, currentTheme } =
    useTheme();

  const {
    viewMode,
    setViewMode,
    showWhitespace,
    setShowWhitespace,
    isViewMenuOpen,
    setIsViewMenuOpen,
  } = viewControls;

  const {
    handleFormat,
    getFormatButtonClass,
    isFormatMenuOpen,
    setIsFormatMenuOpen,
    isMobileFormatMenuOpen,
    setIsMobileFormatMenuOpen,
    onOpenImages,
  } = formatControls;

  const allFormatButtons: FormatButton[] = [
    {
      key: 'bold',
      icon: <Bold size={16} />,
      label: 'Bold',
      onClick: (): void => handleFormat('bold'),
    },
    {
      key: 'italic',
      icon: <Italic size={16} />,
      label: 'Italic',
      onClick: (): void => handleFormat('italic'),
    },
    {
      key: 'image',
      icon: <ImageIcon size={16} />,
      label: 'Insert Image',
      onClick: onOpenImages,
    },
    {
      key: 'h1',
      icon: <span className="font-serif font-bold text-xs">H1</span>,
      label: 'Heading 1',
      onClick: (): void => handleFormat('h1'),
    },
    {
      key: 'h2',
      icon: <span className="font-serif font-bold text-xs">H2</span>,
      label: 'Heading 2',
      onClick: (): void => handleFormat('h2'),
    },
    {
      key: 'h3',
      icon: <span className="font-serif font-bold text-xs">H3</span>,
      label: 'Heading 3',
      onClick: (): void => handleFormat('h3'),
    },
    {
      key: 'quote',
      icon: <Quote size={16} />,
      label: 'Blockquote',
      onClick: (): void => handleFormat('quote'),
    },
    {
      key: 'ul',
      icon: <List size={16} />,
      label: 'Bullet List',
      onClick: (): void => handleFormat('ul'),
    },
    {
      key: 'ol',
      icon: <ListOrdered size={16} />,
      label: 'Numbered List',
      onClick: (): void => handleFormat('ol'),
    },
    {
      key: 'code_inline',
      icon: <Code size={16} />,
      label: 'Inline Code',
      onClick: (): void => handleFormat('code_inline'),
    },
    {
      key: 'code_block',
      icon: <Code2 size={16} />,
      label: 'Code Block',
      onClick: (): void => handleFormat('code_block'),
    },
    {
      key: 'strikethrough',
      icon: <Strikethrough size={16} />,
      label: 'Strikethrough',
      onClick: (): void => handleFormat('strikethrough'),
    },
    {
      key: 'subscript',
      icon: <Subscript size={16} />,
      label: 'Subscript',
      onClick: (): void => handleFormat('subscript'),
    },
    {
      key: 'superscript',
      icon: <Superscript size={16} />,
      label: 'Superscript',
      onClick: (): void => handleFormat('superscript'),
    },
  ];

  const formatMenuRef = useRef<HTMLDivElement | null>(null);

  const inlineCount = 10;

  return (
    <div className="flex w-full justify-center items-center px-4 py-2 space-x-2 xl:space-x-4 border-b bg-brand-gray-50/50 dark:bg-brand-gray-900/50 dark:border-brand-gray-800">
      <ViewModeSelector
        viewMode={viewMode}
        setViewMode={setViewMode}
        showWhitespace={showWhitespace}
        setShowWhitespace={setShowWhitespace}
        showInlineTabs={true}
        isViewMenuOpen={isViewMenuOpen}
        setIsViewMenuOpen={setIsViewMenuOpen}
        isLight={isLight}
        iconColor={iconColor}
        iconHover={iconHover}
        buttonActive={buttonActive}
        t={t}
      />

      <FormatToolbar
        allFormatButtons={allFormatButtons}
        inlineCount={inlineCount}
        getFormatButtonClass={getFormatButtonClass}
        isFormatMenuOpen={isFormatMenuOpen}
        setIsFormatMenuOpen={setIsFormatMenuOpen}
        isMobileFormatMenuOpen={isMobileFormatMenuOpen}
        setIsMobileFormatMenuOpen={setIsMobileFormatMenuOpen}
        formatMenuRef={formatMenuRef}
        dividerColor={dividerColor}
        isLight={isLight}
        buttonActive={buttonActive}
        currentTheme={currentTheme}
        t={t}
      />
    </div>
  );
};

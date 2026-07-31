// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the sourcebook relation dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Search, ArrowRightLeft } from 'lucide-react';
import { AppTheme, SourcebookRelation } from '../../types';
import { Button } from '../../components/ui/Button';
import { useThemeClasses } from '../layout/ThemeContext';
import { useFocusTrap } from '../layout/useFocusTrap';
import { useSourcebookRelationData } from './useSourcebookRelationData';

interface SourcebookRelationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (relation: SourcebookRelation) => void;
  currentEntryId?: string;
  currentEntryName?: string;
  theme?: AppTheme;
  initialRelation?: SourcebookRelation;
}

interface TargetEntrySectionProps {
  borderClass: string;
  inputBorderClass: string;
  inputBgClass: string;
  textClass: string;
  filter: string;
  targetId: string;
  filteredEntries: Array<{ id: string; name: string; description?: string }>;
  onFilterChange: (value: string) => void;
  onTargetSelect: (id: string) => void;
  t: (key: string, options?: Record<string, string>) => string;
}

const TargetEntrySection: React.FC<TargetEntrySectionProps> = ({
  borderClass,
  inputBorderClass,
  inputBgClass,
  textClass,
  filter,
  targetId,
  filteredEntries,
  onFilterChange,
  onTargetSelect,
  t,
}: TargetEntrySectionProps) => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{t('Target Entry')}</label>
      <div className={`border ${borderClass} rounded-md p-2 space-y-3`}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-gray-400" />
          <input
            type="text"
            placeholder={t('Filter entries...')}
            value={filter}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onFilterChange(e.target.value)}
            className={`w-full pl-9 pr-3 py-2 rounded-md border ${inputBorderClass} ${inputBgClass} ${textClass} focus:outline-none focus:ring-2 focus:ring-brand-500`}
          />
        </div>
        <div className="max-h-40 overflow-y-auto space-y-1 pr-2">
          {filteredEntries.length === 0 ? (
            <p className="text-sm text-center py-4 opacity-50">
              {t('No entries found.')}
            </p>
          ) : (
            filteredEntries.map(
              (entry: { id: string; name: string; description?: string }) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={(): void => onTargetSelect(entry.id)}
                  className={`w-full text-left px-3 py-2 cursor-pointer rounded-md border text-sm transition-colors ${
                    targetId === entry.id
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'border-transparent hover:bg-brand-gray-100 dark:hover:bg-brand-gray-800'
                  }`}
                  aria-label={t('Select target entry {{name}}', {
                    name: entry.name,
                  })}
                >
                  <div className="font-medium">{entry.name}</div>
                  <div className="text-xs opacity-70 truncate">{entry.description}</div>
                </button>
              )
            )
          )}
        </div>
      </div>
    </div>
  );
};

interface RelationLogicSectionProps {
  direction: 'forward' | 'reverse';
  mainName: string;
  targetName: string;
  relationStatement: string;
  inputBorderClass: string;
  inputBgClass: string;
  textClass: string;
  theme: AppTheme;
  onToggleDirection: () => void;
  onRelationStatementChange: (value: string) => void;
  t: (key: string) => string;
}

const RelationLogicSection: React.FC<RelationLogicSectionProps> = ({
  direction,
  mainName,
  targetName,
  relationStatement,
  inputBorderClass,
  inputBgClass,
  textClass,
  theme,
  onToggleDirection,
  onRelationStatementChange,
  t,
}: RelationLogicSectionProps) => {
  return (
    <div className="space-y-3 p-4 border rounded-md bg-opacity-50 bg-brand-gray-500/5 border-brand-500/20">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{t('Relation Logic')}</label>
        <Button
          size="sm"
          variant="secondary"
          onClick={onToggleDirection}
          icon={<ArrowRightLeft className="w-3 h-3" />}
          theme={theme}
        >
          {t('Swap Direction')}
        </Button>
      </div>
      <div className="flex flex-col md:flex-row md:items-center gap-3 w-full">
        <div
          className={`flex-1 p-2 text-center rounded-md ${direction === 'forward' ? 'font-semibold text-brand-500 bg-brand-500/10' : 'opacity-80 bg-brand-gray-500/10'}`}
        >
          {direction === 'forward' ? mainName : targetName}
        </div>
        <input
          type="text"
          placeholder={t("e.g. 'owns', 'is married to'")}
          value={relationStatement}
          onChange={(e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>): void =>
            onRelationStatementChange(e.target.value)
          }
          className={`w-full md:w-1/3 px-3 flex-shrink-0 text-center py-2 rounded-md border ${inputBorderClass} ${inputBgClass} ${textClass} focus:outline-none focus:ring-2 focus:ring-brand-500`}
        />
        <div
          className={`flex-1 p-2 text-center rounded-md ${direction === 'reverse' ? 'font-semibold text-brand-500 bg-brand-500/10' : 'opacity-80 bg-brand-gray-500/10'}`}
        >
          {direction === 'reverse' ? mainName : targetName}
        </div>
      </div>
      <p className="text-xs opacity-70 text-center">
        {t('How does the left entry relate to the right entry?')}
      </p>
    </div>
  );
};

interface ConstraintSectionProps {
  showScenes: boolean;
  showBooks: boolean;
  startScene: string;
  endScene: string;
  startBook: string;
  endBook: string;
  inputBorderClass: string;
  inputBgClass: string;
  textClass: string;
  onStartSceneChange: (value: string) => void;
  onEndSceneChange: (value: string) => void;
  onStartBookChange: (value: string) => void;
  onEndBookChange: (value: string) => void;
  t: (key: string) => string;
}

const ConstraintSection: React.FC<ConstraintSectionProps> = ({
  showScenes,
  showBooks,
  startScene,
  endScene,
  startBook,
  endBook,
  inputBorderClass,
  inputBgClass,
  textClass,
  onStartSceneChange,
  onEndSceneChange,
  onStartBookChange,
  onEndBookChange,
  t,
}: ConstraintSectionProps) => {
  if (!showScenes && !showBooks) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-4 pt-2">
      <div className="space-y-2">
        <label className="text-sm font-medium">{t('Start Constraint')}</label>
        {showScenes && (
          <input
            type="number"
            min="1"
            placeholder={t('e.g. Scene 3')}
            value={startScene}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onStartSceneChange(e.target.value)}
            className={`w-full px-3 py-2 rounded-md border ${inputBorderClass} ${inputBgClass} ${textClass} focus:outline-none focus:ring-2 focus:ring-brand-500 mb-2`}
          />
        )}
        {showBooks && (
          <input
            type="text"
            placeholder={t('e.g. Book 1')}
            value={startBook}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onStartBookChange(e.target.value)}
            className={`w-full px-3 py-2 rounded-md border ${inputBorderClass} ${inputBgClass} ${textClass} focus:outline-none focus:ring-2 focus:ring-brand-500`}
          />
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t('End Constraint')}</label>
        {showScenes && (
          <input
            type="number"
            min="1"
            placeholder={t('e.g. Scene 10')}
            value={endScene}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onEndSceneChange(e.target.value)}
            className={`w-full px-3 py-2 rounded-md border ${inputBorderClass} ${inputBgClass} ${textClass} focus:outline-none focus:ring-2 focus:ring-brand-500 mb-2`}
          />
        )}
        {showBooks && (
          <input
            type="text"
            placeholder={t('e.g. Book 1')}
            value={endBook}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onEndBookChange(e.target.value)}
            className={`w-full px-3 py-2 rounded-md border ${inputBorderClass} ${inputBgClass} ${textClass} focus:outline-none focus:ring-2 focus:ring-brand-500`}
          />
        )}
      </div>
    </div>
  );
};

export const SourcebookRelationDialog: React.FC<SourcebookRelationDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  currentEntryId,
  currentEntryName,
  theme = 'mixed',
  initialRelation,
}: SourcebookRelationDialogProps) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const { entries, projectType } = useSourcebookRelationData({
    isOpen,
    currentEntryId,
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(isOpen, dialogRef, onClose);

  // Form fields
  const [targetId, setTargetId] = useState('');
  const [relationStatement, setRelationStatement] = useState('');
  const [startScene, setStartScene] = useState('');
  const [endScene, setEndScene] = useState('');
  const [startBook, setStartBook] = useState('');
  const [endBook, setEndBook] = useState('');
  const [direction, setDirection] = useState<'forward' | 'reverse'>('forward');

  const {
    bg: bgClass,
    text: textClass,
    border: borderClass,
    input: inputBgClass,
  } = useThemeClasses();
  const inputBorderClass = borderClass;

  useEffect((): void => {
    if (isOpen) {
      if (initialRelation) {
        setTargetId(initialRelation.target_id);
        setRelationStatement(initialRelation.relation);
        const startSceneValue =
          initialRelation.start_scene ?? initialRelation.start_chapter;
        const endSceneValue = initialRelation.end_scene ?? initialRelation.end_chapter;
        setStartScene(
          startSceneValue === undefined || startSceneValue === null
            ? ''
            : String(startSceneValue)
        );
        setEndScene(
          endSceneValue === undefined || endSceneValue === null
            ? ''
            : String(endSceneValue)
        );
        setStartBook(initialRelation.start_book || '');
        setEndBook(initialRelation.end_book || '');
        setDirection(initialRelation.direction || 'forward');
      } else {
        setTargetId('');
        setRelationStatement('');
        setStartScene('');
        setEndScene('');
        setStartBook('');
        setEndBook('');
        setDirection('forward');
      }
      setFilter('');
    }
  }, [isOpen, initialRelation]);

  if (!isOpen) return null;

  const filteredEntries = entries.filter(
    (e: import('../../types').SourcebookEntry): boolean | '' =>
      e.name.toLowerCase().includes(filter.toLowerCase()) ||
      (e.description && e.description.toLowerCase().includes(filter.toLowerCase()))
  );

  const targetName =
    entries.find(
      (e: import('../../types').SourcebookEntry): boolean => e.id === targetId
    )?.name || t('Target Entry');
  const mainName = currentEntryName || t('Current Entry');

  const parseSceneValue = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (!/^\d+$/.test(trimmed)) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : undefined;
  };

  const handleSave = (): void => {
    if (!targetId || !relationStatement.trim()) return;
    const parsedStartScene = parseSceneValue(startScene);
    const parsedEndScene = parseSceneValue(endScene);
    if (startScene.trim() && parsedStartScene === undefined) return;
    if (endScene.trim() && parsedEndScene === undefined) return;
    onSave({
      target_id: targetId,
      relation: relationStatement.trim(),
      start_scene: parsedStartScene,
      end_scene: parsedEndScene,
      start_book: startBook.trim() || undefined,
      end_book: endBook.trim() || undefined,
      direction: direction,
    });
    onClose();
  };

  const showScenes = projectType === 'novel' || projectType === 'series';
  const showBooks = projectType === 'series';

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="none"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="relation-dialog-title"
        tabIndex={-1}
        className={`${bgClass} ${textClass} w-full max-w-2xl rounded-lg shadow-2xl border ${borderClass} flex flex-col max-h-[90vh]`}
      >
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${borderClass}`}
        >
          <h2 id="relation-dialog-title" className="text-xl font-semibold">
            {initialRelation ? t('Edit Relation') : t('Add Relation')}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t('Close relation dialog')}
            title={t('Close')}
            theme={theme}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <TargetEntrySection
            borderClass={borderClass}
            inputBorderClass={inputBorderClass}
            inputBgClass={inputBgClass}
            textClass={textClass}
            filter={filter}
            targetId={targetId}
            filteredEntries={filteredEntries}
            onFilterChange={setFilter}
            onTargetSelect={setTargetId}
            t={t}
          />

          <RelationLogicSection
            direction={direction}
            mainName={mainName}
            targetName={targetName}
            relationStatement={relationStatement}
            inputBorderClass={inputBorderClass}
            inputBgClass={inputBgClass}
            textClass={textClass}
            theme={theme}
            onToggleDirection={(): void =>
              setDirection((d: 'reverse' | 'forward'): 'reverse' | 'forward' =>
                d === 'forward' ? 'reverse' : 'forward'
              )
            }
            onRelationStatementChange={setRelationStatement}
            t={t}
          />

          <ConstraintSection
            showScenes={showScenes}
            showBooks={showBooks}
            startScene={startScene}
            endScene={endScene}
            startBook={startBook}
            endBook={endBook}
            inputBorderClass={inputBorderClass}
            inputBgClass={inputBgClass}
            textClass={textClass}
            onStartSceneChange={setStartScene}
            onEndSceneChange={setEndScene}
            onStartBookChange={setStartBook}
            onEndBookChange={setEndBook}
            t={t}
          />
        </div>

        <div
          className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${borderClass}`}
        >
          <Button variant="secondary" onClick={onClose} theme={theme}>
            {t('Cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!targetId || !relationStatement.trim()}
            theme={theme}
          >
            {t('Save Relation')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

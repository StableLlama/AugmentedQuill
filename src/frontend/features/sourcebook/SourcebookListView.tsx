// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Render sourcebook list presentation so state orchestration remains focused in the controller.
 */

import React from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  HelpCircle,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  Search,
  User,
  Users,
} from 'lucide-react';
import { TFunction } from 'i18next';
import { AppTheme, SourcebookEntry } from '../../types';
import { ProjectImage, SourcebookUpsertPayload } from '../../services/apiTypes';
import { SourcebookEntryDialog } from './SourcebookEntryDialog';
import { SourcebookEntryRow } from './SourcebookEntryRow';
import { SourcebookHoverCard } from './SourcebookHoverCard';

const CATEGORY_DETAILS: Record<string, { icon: React.ElementType }> = {
  Character: { icon: User },
  Location: { icon: MapPin },
  Organization: { icon: Users },
  Item: { icon: Package },
  Event: { icon: Calendar },
  Lore: { icon: BookOpen },
  Other: { icon: HelpCircle },
};

interface SourcebookListHeaderProps {
  t: TFunction;
  subTextClass: string;
  textHeaderClass: string;
  btnHover: string;
  isAutoSelectionRunning: boolean;
  isAutoSelectionEnabled: boolean;
  isLight: boolean;
  onOpenCreate: () => void;
  onToggleAutoSelection?: (enabled: boolean) => void;
}

const SourcebookListHeader: React.FC<SourcebookListHeaderProps> = ({
  t,
  subTextClass,
  textHeaderClass,
  btnHover,
  isAutoSelectionRunning,
  isAutoSelectionEnabled,
  isLight,
  onOpenCreate,
  onToggleAutoSelection,
}: SourcebookListHeaderProps) => {
  return (
    <div className="flex items-center justify-between px-4 py-4 border-b border-transparent gap-3">
      <div className="flex items-center gap-1.5 min-w-0">
        <h3
          className={`text-sm font-semibold uppercase tracking-wider ${textHeaderClass} flex items-center gap-2`}
        >
          {t('SOURCEBOOK')}
        </h3>
        <button
          onClick={onOpenCreate}
          className={`p-1 rounded-full transition-colors ${btnHover}`}
          title={t('Add Entry')}
        >
          <Plus size={18} />
        </button>
      </div>

      <div
        className={`flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide ${subTextClass}`}
        title={t(
          'Enable automatic sourcebook entry selection. While enabled, the AI picks relevant entries and manual entry checkboxes are locked. Disable to stop this AI helper and choose entries manually.'
        )}
      >
        <span className="whitespace-nowrap">{t('AUTO SELECTION')}</span>
        {isAutoSelectionRunning && (
          <LoaderCircle
            size={12}
            className="animate-spin text-brand-500"
            aria-label={t('Automatic sourcebook selection is running')}
          />
        )}
        <button
          type="button"
          onClick={(): void | undefined =>
            onToggleAutoSelection?.(!isAutoSelectionEnabled)
          }
          className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
            isAutoSelectionEnabled
              ? 'bg-brand-500 border-brand-500 text-white'
              : `${isLight ? 'border-brand-gray-300' : 'border-brand-gray-600'} hover:border-brand-500`
          }`}
          title={t('Toggle automatic sourcebook selection')}
          aria-label={t('Toggle automatic sourcebook selection')}
          aria-pressed={isAutoSelectionEnabled}
        >
          {isAutoSelectionEnabled && <Check size={10} strokeWidth={4} />}
        </button>
      </div>
    </div>
  );
};

interface SourcebookEntriesPanelProps {
  entries: SourcebookEntry[];
  checkedIds: string[];
  createdEntryIds: Set<string>;
  modifiedEntryIds: Set<string>;
  externalMutationEntryIds: Set<string>;
  deletedEntries: SourcebookEntry[];
  search: string;
  isLoadingEntry: boolean;
  isAutoSelectionEnabled: boolean;
  isLight: boolean;
  textClass: string;
  subTextClass: string;
  itemHoverClass: string;
  t: TFunction;
  onEntryClick: (entry: SourcebookEntry) => Promise<void>;
  onEntryHover: (
    event: React.MouseEvent<HTMLButtonElement>,
    entry: SourcebookEntry
  ) => void;
  onEntryHoverLeave: () => void;
  onToggleEntry: (id: string, checked: boolean) => void;
}

const DeletedEntryRow: React.FC<{
  entry: SourcebookEntry;
  isLight: boolean;
  t: TFunction;
}> = ({
  entry,
  isLight,
  t,
}: {
  entry: SourcebookEntry;
  isLight: boolean;
  t: TFunction;
}) => {
  const CategoryIcon =
    (entry.category && CATEGORY_DETAILS[entry.category]?.icon) || HelpCircle;
  return (
    <div
      key={`deleted-${entry.id}`}
      className={`group px-3 py-2 rounded-md flex items-center gap-2 select-none border-l-2 border-l-red-500 opacity-60 ${
        isLight ? 'bg-red-50/40' : 'bg-red-900/10'
      }`}
      title={t('Deleted')}
      role="listitem"
      aria-label={t('{{name}} (deleted)', { name: entry.name })}
    >
      <CategoryIcon size={14} className="flex-shrink-0 text-red-400" />
      <div
        className={`text-sm truncate line-through ${
          isLight ? 'text-brand-gray-600' : 'text-brand-gray-400'
        }`}
      >
        {entry.name}
      </div>
    </div>
  );
};

const SourcebookEntriesPanel: React.FC<SourcebookEntriesPanelProps> = ({
  entries,
  checkedIds,
  createdEntryIds,
  modifiedEntryIds,
  externalMutationEntryIds,
  deletedEntries,
  search,
  isLoadingEntry,
  isAutoSelectionEnabled,
  isLight,
  textClass,
  subTextClass,
  itemHoverClass,
  t,
  onEntryClick,
  onEntryHover,
  onEntryHoverLeave,
  onToggleEntry,
}: SourcebookEntriesPanelProps) => {
  const showDeletedOnly =
    entries.length === 0 && !search.trim() && deletedEntries.length > 0;

  return (
    <div className="relative flex-1 overflow-y-auto px-1 pb-2">
      {isLoadingEntry && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/30">
          <div className="flex flex-col items-center gap-2 rounded-lg bg-white/90 px-6 py-4 shadow-lg">
            <LoaderCircle className="animate-spin" size={24} />
            <span className="text-sm font-medium text-brand-gray-900">
              {t('Loading entry...')}
            </span>
          </div>
        </div>
      )}

      {entries.length === 0 && (
        <div className={`text-center py-4 text-xs ${subTextClass}`}>
          {t('No entries yet.')}
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-0.5" role="list">
          {entries.map((entry: SourcebookEntry) => {
            const CategoryIcon =
              (entry.category && CATEGORY_DETAILS[entry.category]?.icon) || HelpCircle;
            const isChecked = checkedIds.includes(entry.id);
            const diffBorderClass = createdEntryIds.has(entry.id)
              ? 'border-l-2 border-l-green-500'
              : modifiedEntryIds.has(entry.id) || externalMutationEntryIds.has(entry.id)
                ? 'border-l-2 border-l-amber-400'
                : '';

            return (
              <SourcebookEntryRow
                key={entry.id}
                entry={entry}
                CategoryIcon={CategoryIcon}
                isChecked={isChecked}
                diffBorderClass={diffBorderClass}
                isAutoSelectionEnabled={isAutoSelectionEnabled}
                isLoadingEntry={isLoadingEntry}
                isLight={isLight}
                textClass={textClass}
                subTextClass={subTextClass}
                itemHoverClass={itemHoverClass}
                onClick={onEntryClick}
                onMouseEnter={onEntryHover}
                onMouseLeave={onEntryHoverLeave}
                onToggle={onToggleEntry}
              />
            );
          })}
          {!search.trim() &&
            deletedEntries.map((entry: SourcebookEntry) => (
              <DeletedEntryRow
                key={`deleted-${entry.id}`}
                entry={entry}
                isLight={isLight}
                t={t}
              />
            ))}
        </div>
      )}

      {showDeletedOnly && (
        <div className="space-y-0.5" role="list">
          {deletedEntries.map((entry: SourcebookEntry) => (
            <DeletedEntryRow
              key={`deleted-${entry.id}`}
              entry={entry}
              isLight={isLight}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface SourcebookListViewProps {
  theme: AppTheme;
  language: string;
  t: TFunction;
  entries: SourcebookEntry[];
  checkedIds: string[];
  search: string;
  selectedEntry: SourcebookEntry | null;
  isDialogOpen: boolean;
  isLoadingEntry: boolean;
  isAutoSelectionEnabled: boolean;
  isAutoSelectionRunning: boolean;
  dialogKey: number;
  dialogOpenedViaTrigger: boolean;
  hoveredEntry: SourcebookEntry | null;
  tooltipPos: { x: number; y: number };
  availableImages: ProjectImage[];
  createdEntryIds: Set<string>;
  modifiedEntryIds: Set<string>;
  externalMutationEntryIds: Set<string>;
  deletedEntries: SourcebookEntry[];
  baselineEntries?: SourcebookEntry[];
  canAppUndo: boolean;
  canAppRedo: boolean;
  onAppUndo?: () => Promise<void>;
  onAppRedo?: () => Promise<void>;
  onToggleAutoSelection?: (enabled: boolean) => void;
  onSearchChange: (value: string) => void;
  onOpenCreate: () => void;
  onDialogClose: () => void;
  onEntryClick: (entry: SourcebookEntry) => Promise<void>;
  onEntryHover: (
    event: React.MouseEvent<HTMLButtonElement>,
    entry: SourcebookEntry
  ) => void;
  onEntryHoverLeave: () => void;
  onToggleEntry: (id: string, checked: boolean) => void;
  onSaveCreate: (entry: SourcebookUpsertPayload) => Promise<void>;
  onSaveUpdate: (entry: SourcebookUpsertPayload) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
  isLight: boolean;
  borderClass: string;
  textClass: string;
  textHeaderClass: string;
  subTextClass: string;
  itemHoverClass: string;
  inputBg: string;
  inputBorder: string;
  inputPlace: string;
  btnHover: string;
}

export const SourcebookListView: React.FC<SourcebookListViewProps> = ({
  theme,
  language,
  t,
  entries,
  checkedIds,
  search,
  selectedEntry,
  isDialogOpen,
  isLoadingEntry,
  isAutoSelectionEnabled,
  isAutoSelectionRunning,
  dialogKey,
  dialogOpenedViaTrigger,
  hoveredEntry,
  tooltipPos,
  availableImages,
  createdEntryIds,
  modifiedEntryIds,
  externalMutationEntryIds,
  deletedEntries,
  baselineEntries,
  canAppUndo,
  canAppRedo,
  onAppUndo,
  onAppRedo,
  onToggleAutoSelection,
  onSearchChange,
  onOpenCreate,
  onDialogClose,
  onEntryClick,
  onEntryHover,
  onEntryHoverLeave,
  onToggleEntry,
  onSaveCreate,
  onSaveUpdate,
  onDeleteEntry,
  isLight,
  borderClass,
  textClass,
  textHeaderClass,
  subTextClass,
  itemHoverClass,
  inputBg,
  inputBorder,
  inputPlace,
  btnHover,
}: SourcebookListViewProps) => {
  return (
    <div
      id="sourcebook-list"
      className="flex flex-col mt-0 flex-1 min-h-0 bg-opacity-50"
    >
      <SourcebookListHeader
        t={t}
        subTextClass={subTextClass}
        textHeaderClass={textHeaderClass}
        btnHover={btnHover}
        isAutoSelectionRunning={isAutoSelectionRunning}
        isAutoSelectionEnabled={isAutoSelectionEnabled}
        isLight={isLight}
        onOpenCreate={onOpenCreate}
        onToggleAutoSelection={onToggleAutoSelection}
      />

      <div className="px-3 mb-2 pt-2">
        <div className="relative">
          <Search size={12} className={`absolute left-2.5 top-2 ${subTextClass}`} />
          <input
            type="text"
            value={search}
            onChange={(
              event: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onSearchChange(event.target.value)}
            placeholder={t('Filter entries...')}
            className={`w-full pl-8 pr-2 py-1.5 text-xs rounded border ${inputBorder} ${inputBg} ${textClass} ${inputPlace} focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors`}
          />
        </div>
      </div>

      <SourcebookEntriesPanel
        entries={entries}
        checkedIds={checkedIds}
        createdEntryIds={createdEntryIds}
        modifiedEntryIds={modifiedEntryIds}
        externalMutationEntryIds={externalMutationEntryIds}
        deletedEntries={deletedEntries}
        search={search}
        isLoadingEntry={isLoadingEntry}
        isAutoSelectionEnabled={isAutoSelectionEnabled}
        isLight={isLight}
        textClass={textClass}
        subTextClass={subTextClass}
        itemHoverClass={itemHoverClass}
        t={t}
        onEntryClick={onEntryClick}
        onEntryHover={onEntryHover}
        onEntryHoverLeave={onEntryHoverLeave}
        onToggleEntry={onToggleEntry}
      />

      <SourcebookEntryDialog
        key={dialogKey}
        isOpen={isDialogOpen}
        onClose={onDialogClose}
        entry={selectedEntry}
        allEntries={entries}
        language={language}
        onSave={selectedEntry ? onSaveUpdate : onSaveCreate}
        onDelete={selectedEntry ? onDeleteEntry : undefined}
        theme={theme}
        baselineEntry={
          baselineEntries?.find(
            (entry: SourcebookEntry): boolean => entry.id === selectedEntry?.id
          ) ?? null
        }
        showDiffForNew={dialogOpenedViaTrigger}
        canAppUndo={canAppUndo}
        canAppRedo={canAppRedo}
        onAppUndo={onAppUndo}
        onAppRedo={onAppRedo}
      />

      {hoveredEntry && (
        <SourcebookHoverCard
          entry={hoveredEntry}
          position={tooltipPos}
          bgClass={isLight ? 'bg-white' : 'bg-brand-gray-900'}
          borderClass={borderClass}
          textClass={textClass}
          subTextClass={subTextClass}
          availableImages={availableImages}
        />
      )}
    </div>
  );
};

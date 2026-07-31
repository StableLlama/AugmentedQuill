// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Extract sourcebook entry dialog presentation sections so the main
 * dialog component can focus on state orchestration and side effects.
 */

import React from 'react';
import {
  Book,
  Calendar,
  X,
  Undo,
  Redo,
  MessageSquareDiff,
  Type,
  User,
  MapPin,
  Users,
  Package,
  BookOpen,
  HelpCircle,
  ChevronDown,
  Image as ImageIcon,
  ImagePlus,
  Plus,
  Link,
  Edit2,
  Trash2,
  Tag,
  LoaderCircle,
  Check,
  Save,
  Zap,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SourcebookEntry, SourcebookRelation, AppTheme } from '../../types';
import { ProjectImage } from '../../services/apiTypes';
import { CodeMirrorEditor } from '../editor/CodeMirrorEditor';
import { SceneDatetimePickerButton } from '../scenes/SceneDatetimePickerButton';
import type { TimelineOption } from '../scenes/timelineOptions';

const CATEGORY_DETAILS: Record<
  string,
  { icon: React.ElementType; description: string }
> = {
  Character: {
    icon: User,
    description: 'People, creatures, or specific individuals important to the story.',
  },
  Location: {
    icon: MapPin,
    description: 'Places, regions, buildings, maps, or distinct environments.',
  },
  Organization: {
    icon: Users,
    description: 'Groups, factions, governments, companies, or societies.',
  },
  Item: {
    icon: Package,
    description: 'Objects, artifacts, weapons, key items, or vehicles.',
  },
  Event: {
    icon: Calendar,
    description: 'Historical events, holidays, plot points, or timeline markers.',
  },
  Lore: {
    icon: BookOpen,
    description: 'History, myths, magic systems, laws, or cultural rules.',
  },
  Other: {
    icon: HelpCircle,
    description: "Anything that doesn't fit strictly into other categories.",
  },
  'Time Travel': {
    icon: Zap,
    description:
      'Time travel events with departure, destination, and timeline branching.',
  },
};

interface HeaderProps {
  entryExists: boolean;
  isLight: boolean;
  borderClass: string;
  historyIndex: number;
  historyLength: number;
  canAppUndo: boolean;
  canAppRedo: boolean;
  showDiff: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleDiff: () => void;
  onClose: () => void;
  t: (key: string) => string;
}

export const SourcebookEntryHeader: React.FC<HeaderProps> = ({
  entryExists,
  isLight,
  borderClass,
  historyIndex,
  historyLength,
  canAppUndo,
  canAppRedo,
  showDiff,
  onUndo,
  onRedo,
  onToggleDiff,
  onClose,
  t,
}: HeaderProps) => (
  <div
    className={`flex items-center justify-between px-6 py-4 border-b ${borderClass}`}
  >
    <div className="flex items-center gap-2">
      <Book size={20} className={isLight ? 'text-brand-700' : 'text-brand-400'} />
      <h2 id="sourcebook-entry-title" className="text-lg font-bold">
        {entryExists ? t('Edit Entry') : t('New Sourcebook Entry')}
      </h2>
    </div>
    <div className="flex items-center gap-2">
      <button
        onClick={onUndo}
        disabled={historyIndex === 0 && !canAppUndo}
        aria-label={t('Undo sourcebook entry changes')}
        title={t('Undo')}
        className={`p-1 rounded-md transition-colors ${
          isLight
            ? 'hover:bg-brand-gray-100 text-brand-gray-500 disabled:opacity-40 disabled:cursor-not-allowed'
            : 'hover:bg-brand-gray-800 text-brand-gray-400 disabled:opacity-40 disabled:cursor-not-allowed'
        }`}
      >
        <Undo size={18} />
      </button>
      <button
        onClick={onRedo}
        disabled={historyIndex >= historyLength - 1 && !canAppRedo}
        aria-label={t('Redo sourcebook entry changes')}
        title={t('Redo')}
        className={`p-1 rounded-md transition-colors ${
          isLight
            ? 'hover:bg-brand-gray-100 text-brand-gray-500 disabled:opacity-40 disabled:cursor-not-allowed'
            : 'hover:bg-brand-gray-800 text-brand-gray-400 disabled:opacity-40 disabled:cursor-not-allowed'
        }`}
      >
        <Redo size={18} />
      </button>
      <button
        onClick={onToggleDiff}
        aria-label={t('Toggle diff view')}
        aria-pressed={showDiff}
        title={showDiff ? t('Hide diff highlights') : t('Show diff highlights')}
        className={`p-1 rounded-md transition-colors ${
          showDiff
            ? isLight
              ? 'text-brand-500 hover:text-brand-600'
              : 'text-brand-400 hover:text-brand-300'
            : isLight
              ? 'text-brand-gray-400 hover:text-brand-gray-600'
              : 'text-brand-gray-600 hover:text-brand-gray-400'
        }`}
      >
        <MessageSquareDiff size={18} />
      </button>
      <button
        onClick={onClose}
        aria-label={t('Close sourcebook entry')}
        className={`p-1 rounded-md transition-colors ${
          isLight
            ? 'hover:bg-brand-gray-100 text-brand-gray-500'
            : 'hover:bg-brand-gray-800 text-brand-gray-400'
        }`}
      >
        <X size={20} />
      </button>
    </div>
  </div>
);

interface BasicSectionProps {
  name: string;
  category: string;
  synonyms: string[];
  newSynonym: string;
  originDate: string | null;
  destinationDatetime: string | null;
  destinationRelative: string;
  createsNewTimeline: boolean;
  timelineId: string;
  timelineOptions: TimelineOption[];
  inputBorderClass: string;
  inputBgClass: string;
  labelClass: string;
  isLight: boolean;
  language: string;
  t: (key: string) => string;
  onNameChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSynonymInputChange: (value: string) => void;
  onAddSynonym: () => void;
  onRemoveSynonym: (idx: number) => void;
  onOriginDateChange: (value: string | null) => void;
  onDestinationDatetimeChange: (value: string | null) => void;
  onDestinationRelativeChange: (value: string) => void;
  onCreatesNewTimelineChange: (value: boolean) => void;
  onTimelineIdChange: (value: string) => void;
}

export const SourcebookEntryBasicsSection: React.FC<BasicSectionProps> = ({
  name,
  category,
  synonyms,
  newSynonym,
  originDate,
  destinationDatetime,
  destinationRelative,
  createsNewTimeline,
  timelineId,
  timelineOptions,
  inputBorderClass,
  inputBgClass,
  labelClass,
  isLight,
  language,
  t,
  onNameChange,
  onCategoryChange,
  onSynonymInputChange,
  onAddSynonym,
  onRemoveSynonym,
  onOriginDateChange,
  onDestinationDatetimeChange,
  onDestinationRelativeChange,
  onCreatesNewTimelineChange,
  onTimelineIdChange,
}: BasicSectionProps) => (
  <>
    <div className="space-y-4">
      <div className="space-y-2">
        <label
          className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
        >
          {t('Name')}
        </label>
        <div className="relative">
          <Type
            size={16}
            className={`absolute left-3 top-3 ${isLight ? 'text-brand-gray-400' : 'text-brand-gray-600'}`}
          />
          <input
            type="text"
            value={name}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onNameChange(e.target.value)}
            lang={language}
            spellCheck={true}
            className={`w-full pl-10 pr-3 py-2 text-sm rounded-md border ${inputBorderClass} ${inputBgClass} focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors`}
            placeholder={t('E.g. Captain Ahab')}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label
          className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
        >
          {t('Category')}
        </label>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {Object.entries(CATEGORY_DETAILS).map(
            ([cat, details]: [
              string,
              { icon: React.ElementType; description: string },
            ]) => {
              const Icon = details.icon;
              const isSelected = category === cat;
              return (
                <button
                  key={cat}
                  onClick={(): void => onCategoryChange(cat)}
                  title={t(details.description)}
                  className={`flex flex-col items-center justify-center p-2 rounded-md border transition-all ${
                    isSelected
                      ? 'bg-brand-500 text-white border-brand-600 ring-2 ring-brand-500/20'
                      : `${inputBgClass} ${inputBorderClass} hover:border-brand-500/50 opacity-70 hover:opacity-100`
                  }`}
                >
                  <Icon size={20} className="mb-1" />
                  <span className="text-[10px] uppercase font-bold tracking-tight">
                    {cat}
                  </span>
                </button>
              );
            }
          )}
        </div>
        <p
          className={`text-xs mt-1 min-h-[1.5em] ${isLight ? 'text-brand-700' : 'text-brand-300'}`}
        >
          {t(CATEGORY_DETAILS[category]?.description || '')}
        </p>
      </div>
    </div>

    <div className="space-y-2">
      <label className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}>
        {t('Synonyms & Nicknames')}
      </label>
      <div
        className={`p-3 rounded-md border ${inputBorderClass} ${inputBgClass} min-h-[60px]`}
      >
        <div className="flex flex-wrap gap-2 mb-2">
          {synonyms.map((syn: string, idx: number) => (
            <span
              key={idx}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border ${
                isLight
                  ? 'bg-brand-gray-100 border-brand-gray-200 text-brand-gray-800'
                  : 'bg-brand-gray-800 border-brand-gray-700 text-brand-gray-200'
              }`}
            >
              {syn}
              <button
                onClick={(): void => onRemoveSynonym(idx)}
                className="hover:text-red-500 transition-colors"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <div className="flex-1 min-w-[120px] flex items-center">
            <input
              type="text"
              value={newSynonym}
              onChange={(
                e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
              ): void => onSynonymInputChange(e.target.value)}
              lang={language}
              spellCheck={true}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>): void => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onAddSynonym();
                }
              }}
              className="bg-transparent text-sm focus:outline-none w-full"
              placeholder={t('Add (+)')}
            />
          </div>
        </div>
      </div>
    </div>

    <div className="space-y-2">
      <label className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}>
        {t('Origin Date')}
      </label>
      <SceneDatetimePickerButton
        value={originDate}
        onChange={onOriginDateChange}
        placeholder={t('Set origin date (birth / creation)')}
      />
    </div>

    {category === 'Time Travel' && (
      <>
        <div className="space-y-2">
          <label
            className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
          >
            {t('Travel Destination')}
          </label>
          <SceneDatetimePickerButton
            value={destinationDatetime}
            onChange={onDestinationDatetimeChange}
            placeholder={t('Set travel destination time')}
          />
        </div>
        <div className="space-y-2">
          <label
            className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
          >
            {t('Relative Description')}
          </label>
          <input
            type="text"
            value={destinationRelative}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onDestinationRelativeChange(e.target.value)}
            lang={language}
            spellCheck={false}
            className={`w-full px-3 py-2 text-sm rounded-md border ${inputBorderClass} ${inputBgClass} focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors`}
            placeholder={t('e.g. 30 years earlier')}
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="creates-new-timeline"
            checked={createsNewTimeline}
            onChange={(
              e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
            ): void => onCreatesNewTimelineChange(e.target.checked)}
            className="w-4 h-4 rounded border accent-brand-500 cursor-pointer"
          />
          <label
            htmlFor="creates-new-timeline"
            className={`text-sm cursor-pointer ${isLight ? 'text-brand-gray-700' : 'text-brand-gray-300'}`}
          >
            {t('Creates new timeline')}
          </label>
        </div>
        <div className="space-y-2">
          <label
            className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
          >
            {t('Timeline')}
          </label>
          <select
            value={timelineId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>): void =>
              onTimelineIdChange(e.target.value)
            }
            className={`w-full px-3 py-2 text-sm rounded-md border ${inputBorderClass} ${inputBgClass} focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors`}
          >
            {timelineOptions.map((option: TimelineOption) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </>
    )}
  </>
);

interface ImagesSectionProps {
  isImagesExpanded: boolean;
  selectedImagesList: ProjectImage[];
  labelClass: string;
  inputBorderClass: string;
  inputBgClass: string;
  theme: AppTheme;
  t: (key: string) => string;
  onToggleExpanded: () => void;
  onOpenPicker: () => void;
  onToggleImage: (filename: string) => void;
}

export const SourcebookEntryImagesSection: React.FC<ImagesSectionProps> = ({
  isImagesExpanded,
  selectedImagesList,
  labelClass,
  inputBorderClass,
  inputBgClass,
  theme,
  t,
  onToggleExpanded,
  onOpenPicker,
  onToggleImage,
}: ImagesSectionProps) => (
  <div className="space-y-2">
    <div className="flex justify-between items-end">
      <button
        type="button"
        onClick={onToggleExpanded}
        className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider focus:outline-none ${labelClass}`}
      >
        <span>{t('Associated Images')}</span>
        {!isImagesExpanded && selectedImagesList.length > 0 && (
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            {selectedImagesList.length}
          </span>
        )}
        <ChevronDown
          size={14}
          className={`transition-transform ${isImagesExpanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      <Button
        onClick={onOpenPicker}
        variant="ghost"
        size="sm"
        theme={theme}
        icon={<ImagePlus size={14} />}
      >
        {t('Manage Images')}
      </Button>
    </div>

    {isImagesExpanded && (
      <div
        className={`p-3 rounded-md border min-h-[100px] ${inputBorderClass} ${inputBgClass}`}
      >
        {selectedImagesList.length === 0 ? (
          <div className="h-20 flex flex-col items-center justify-center text-gray-500 text-xs">
            <ImageIcon size={20} className="mb-1 opacity-50" />
            <span>{t('No images associated')}</span>
          </div>
        ) : (
          <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
            {selectedImagesList.map((img: ProjectImage) => {
              const tooltip = `${img.title || img.filename}\n${img.description || ''}`;
              return (
                <div
                  key={img.filename}
                  className="relative aspect-square rounded overflow-hidden border border-brand-500/20 group bg-gray-100 dark:bg-gray-800"
                  title={tooltip}
                >
                  {img.is_placeholder ? (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <ImageIcon size={24} />
                    </div>
                  ) : (
                    <img
                      src={img.url ?? undefined}
                      alt={img.filename}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <button
                    onClick={(): void => onToggleImage(img.filename)}
                    className="absolute top-0 right-0 p-1 bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    )}
  </div>
);

interface RelationsSectionProps {
  isRelationsExpanded: boolean;
  relations: SourcebookRelation[];
  relationNameMap: Record<string, string>;
  labelClass: string;
  inputBorderClass: string;
  inputBgClass: string;
  theme: AppTheme;
  t: (key: string) => string;
  onToggleExpanded: () => void;
  onOpenAddRelation: () => void;
  onEditRelation: (index: number) => void;
  onDeleteRelation: (index: number) => void;
}

export const SourcebookEntryRelationsSection: React.FC<RelationsSectionProps> = ({
  isRelationsExpanded,
  relations,
  relationNameMap,
  labelClass,
  inputBorderClass,
  inputBgClass,
  theme,
  t,
  onToggleExpanded,
  onOpenAddRelation,
  onEditRelation,
  onDeleteRelation,
}: RelationsSectionProps) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onToggleExpanded}
        className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider focus:outline-none ${labelClass}`}
      >
        <span>{t('Relations')}</span>
        {!isRelationsExpanded && relations.length > 0 && (
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            {relations.length}
          </span>
        )}
        <ChevronDown
          size={14}
          className={`transition-transform ${isRelationsExpanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenAddRelation}
        icon={<Plus size={14} />}
        theme={theme}
      >
        {t('Add Relation')}
      </Button>
    </div>

    {isRelationsExpanded &&
      (relations.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {relations.map((rel: SourcebookRelation, idx: number) => (
            <div
              key={idx}
              className={`flex items-center justify-between p-2 rounded-md border ${inputBorderClass} ${inputBgClass}`}
            >
              <div className="flex flex-col min-w-0 pr-4">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Link size={14} className="text-brand-500 flex-shrink-0" />
                  <span className="truncate">
                    {rel.direction === 'reverse' ? (
                      <>
                        {relationNameMap[rel.target_id] || rel.target_id}{' '}
                        <span className="opacity-70 font-normal">[{rel.relation}]</span>{' '}
                        {t('this')}
                      </>
                    ) : (
                      <>
                        <span className="opacity-70 font-normal">[{rel.relation}]</span>{' '}
                        {relationNameMap[rel.target_id] || rel.target_id}
                      </>
                    )}
                  </span>
                </div>
                {(rel.start_scene ||
                  rel.end_scene ||
                  rel.start_book ||
                  rel.end_book) && (
                  <div className="text-xs opacity-60 mt-1 truncate">
                    {rel.start_scene ? `${t('Start')}: ${rel.start_scene}` : ''}
                    {rel.start_book ? ` (${rel.start_book})` : ''}
                    {(rel.start_scene || rel.start_book) &&
                    (rel.end_scene || rel.end_book)
                      ? ' | '
                      : ''}
                    {rel.end_scene ? `${t('End')}: ${rel.end_scene}` : ''}
                    {rel.end_book ? ` (${rel.end_book})` : ''}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={(): void => onEditRelation(idx)}
                  className="p-1 rounded-md hover:bg-brand-500/10 text-brand-500 transition-colors"
                  title={t('Edit Relation')}
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={(): void => onDeleteRelation(idx)}
                  className="p-1 rounded-md hover:bg-red-500/10 text-red-500 transition-colors"
                  title={t('Delete Relation')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={`text-sm opacity-60 italic p-3 rounded-md border border-dashed ${inputBorderClass}`}
        >
          {t('No relations to other entries yet.')}
        </div>
      ))}
  </div>
);

interface DescriptionSectionProps {
  description: string;
  descriptionBaseline?: string;
  showDiff: boolean;
  showKeywordsPanel: boolean;
  keywords: string[];
  isGeneratingKeywords: boolean;
  keywordsTooltip: string;
  isLight: boolean;
  borderClass: string;
  inputBorderClass: string;
  descriptionSurfaceClass: string;
  descriptionTextClass: string;
  labelClass: string;
  language: string;
  searchHighlightRanges: Array<{ start: number; end: number }>;
  t: (key: string) => string;
  onDescriptionChange: (value: string) => void;
  onToggleKeywordsPanel: () => void;
}

export const SourcebookEntryDescriptionSection: React.FC<DescriptionSectionProps> = ({
  description,
  descriptionBaseline,
  showDiff,
  showKeywordsPanel,
  keywords,
  isGeneratingKeywords,
  keywordsTooltip,
  isLight,
  borderClass,
  inputBorderClass,
  descriptionSurfaceClass,
  descriptionTextClass,
  labelClass,
  language,
  searchHighlightRanges,
  t,
  onDescriptionChange,
  onToggleKeywordsPanel,
}: DescriptionSectionProps) => (
  <div className="space-y-2 flex-1 flex flex-col min-h-[320px]">
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <label
          className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
        >
          {t('Description & Facts')}
        </label>
        <p className={`text-xs leading-relaxed ${labelClass}`}>
          {t(
            'Describe the details the models should remember. CHAT uses this for planning and consistency, while WRITING and EDITING receive relevant entries as read-only context.'
          )}
        </p>
      </div>
      <div className="relative inline-block group">
        <button
          type="button"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold tracking-wide cursor-pointer ${labelClass} ${borderClass}`}
          aria-label={keywordsTooltip}
          onClick={onToggleKeywordsPanel}
          aria-expanded={showKeywordsPanel}
        >
          <Tag size={12} />
          {t('Keywords')}
        </button>

        <div
          className={`absolute right-0 z-10 mt-2 min-w-[calc(100vw-2rem)] sm:min-w-[50vw] max-w-[90vw] rounded-lg border ${borderClass} ${
            isLight
              ? 'bg-white/95 text-brand-gray-900'
              : 'bg-brand-gray-950/95 text-brand-gray-100'
          } shadow-lg p-3 text-xs transition-opacity duration-150 ${
            showKeywordsPanel
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none'
          } group-hover:opacity-100 group-hover:pointer-events-auto`}
        >
          {isGeneratingKeywords ? (
            <div className="italic opacity-70">{t('Generating...')}</div>
          ) : keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {keywords.map((kw: string) => (
                <span
                  key={kw}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                    isLight
                      ? 'bg-brand-gray-100 border-brand-gray-200 text-brand-gray-800'
                      : 'bg-brand-gray-800 border-brand-gray-700 text-brand-gray-200'
                  }`}
                >
                  {kw}
                </span>
              ))}
            </div>
          ) : (
            <div className="italic opacity-60">{t('No keywords yet.')}</div>
          )}
        </div>
      </div>
    </div>

    <div
      className={`rounded-md border ${inputBorderClass} ${descriptionSurfaceClass} ${descriptionTextClass} flex-1 min-h-[220px] overflow-y-auto`}
    >
      <CodeMirrorEditor
        value={description}
        onChange={onDescriptionChange}
        baselineValue={descriptionBaseline}
        showDiff={showDiff}
        searchHighlightRanges={searchHighlightRanges}
        language={language}
        spellCheck={true}
        mode="markdown"
        className={`w-full h-full p-4 text-sm bg-transparent ${descriptionTextClass}`}
        placeholder={t(
          'Detailed description, personality traits, history, rules, and constraints the AI should remember...'
        )}
        style={{ minHeight: '220px' }}
      />
    </div>
  </div>
);

interface FooterProps {
  entry?: SourcebookEntry | null;
  canDelete: boolean;
  isSaving: boolean;
  isLight: boolean;
  borderClass: string;
  theme: AppTheme;
  t: (key: string) => string;
  onDelete: () => Promise<void>;
  onCancel: () => void;
  onSave: () => Promise<void>;
  disableSave: boolean;
}

export const SourcebookEntryFooter: React.FC<FooterProps> = ({
  entry,
  canDelete,
  isSaving,
  isLight,
  borderClass,
  theme,
  t,
  onDelete,
  onCancel,
  onSave,
  disableSave,
}: FooterProps) => (
  <div
    className={`flex justify-between items-center px-6 py-4 border-t ${borderClass} bg-opacity-50 ${
      isLight ? 'bg-brand-gray-50' : 'bg-black/20'
    }`}
  >
    <div>
      {entry && canDelete && (
        <Button
          onClick={onDelete}
          variant="danger"
          size="sm"
          theme={theme}
          icon={<Trash2 size={16} />}
        >
          {t('Delete')}
        </Button>
      )}
    </div>
    <div className="flex gap-3">
      <Button onClick={onCancel} variant="ghost" theme={theme}>
        {t('Cancel')}
      </Button>
      <Button
        onClick={onSave}
        theme={theme}
        disabled={disableSave}
        icon={
          isSaving ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <Save size={16} />
          )
        }
      >
        {isSaving ? t('Saving...') : t('Save Entry')}
      </Button>
    </div>
  </div>
);

interface ImagePickerProps {
  isOpen: boolean;
  availableImages: ProjectImage[];
  selectedImageNames: string[];
  bgClass: string;
  textClass: string;
  borderClass: string;
  theme: AppTheme;
  imagePickerRef: React.RefObject<HTMLDivElement | null>;
  t: (key: string, options?: Record<string, unknown>) => string;
  onClose: () => void;
  onToggleImage: (filename: string) => void;
}

export const SourcebookImagePickerModal: React.FC<ImagePickerProps> = ({
  isOpen,
  availableImages,
  selectedImageNames,
  bgClass,
  textClass,
  borderClass,
  theme,
  imagePickerRef,
  t,
  onClose,
  onToggleImage,
}: ImagePickerProps) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
      role="none"
    >
      <div
        ref={imagePickerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-picker-title"
        tabIndex={-1}
        className={`${bgClass} ${textClass} w-full max-w-4xl rounded-lg shadow-2xl border ${borderClass} flex flex-col max-h-[85vh]`}
      >
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${borderClass}`}
        >
          <div className="flex items-center gap-2">
            <ImagePlus size={20} className="text-brand-500" />
            <h3 id="image-picker-title" className="text-lg font-bold">
              {t('Select Images')}
            </h3>
          </div>
          <button onClick={onClose} aria-label={t('Close image picker')}>
            <X size={20} className="text-gray-500 hover:text-gray-300" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {availableImages.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              {t('No images found in project.')}
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
              {availableImages.map((img: ProjectImage) => {
                const isSelected = selectedImageNames.includes(img.filename);
                const tooltip = `${img.title || img.filename}\n${img.description || ''}`;
                return (
                  <button
                    key={img.filename}
                    type="button"
                    onClick={(): void => onToggleImage(img.filename)}
                    title={tooltip}
                    aria-label={`Toggle ${img.title || img.filename} selection`}
                    aria-pressed={isSelected}
                    className={`group relative aspect-square cursor-pointer rounded-lg overflow-hidden border-2 transition-all bg-gray-100 dark:bg-gray-800 ${
                      isSelected
                        ? 'border-brand-500 ring-2 ring-brand-500/20'
                        : 'border-transparent hover:border-brand-500/30'
                    }`}
                  >
                    {img.is_placeholder ? (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <ImageIcon size={28} />
                      </div>
                    ) : (
                      <img
                        src={img.url ?? undefined}
                        alt={img.filename}
                        className="w-full h-full object-cover"
                      />
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-brand-500/20 flex items-center justify-center animate-in zoom-in-50 duration-200">
                        <div className="bg-brand-500 text-white rounded-full p-1 shadow-md">
                          <Check size={16} />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          className={`px-6 py-4 border-t ${borderClass} flex justify-between items-center`}
        >
          <span className="text-sm opacity-70">
            {t('{{count}} images selected', { count: selectedImageNames.length })}
          </span>
          <Button onClick={onClose} theme={theme} icon={<Check size={16} />}>
            {t('Done')}
          </Button>
        </div>
      </div>
    </div>
  );
};

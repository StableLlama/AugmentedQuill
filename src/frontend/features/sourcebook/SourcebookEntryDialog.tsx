// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the sourcebook entry dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTheme, SourcebookEntry, SourcebookRelation } from '../../types';
import type { Scene, SceneId } from '../../types';
import { SourcebookUpsertPayload } from '../../services/apiTypes';
import { useThemeClasses } from '../layout/ThemeContext';
import { useFocusTrap } from '../layout/useFocusTrap';
import { buildSourcebookTimelineOptions } from '../scenes/timelineOptions';
import { SourcebookEntryDialogView } from './SourcebookEntryDialogView';
import { useSourcebookEntryDialogState } from './useSourcebookEntryDialogState';
import { useScenes } from '../../stores/storyStore';

interface SourcebookEntryDialogProps {
  entry?: SourcebookEntry | null;
  allEntries: SourcebookEntry[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: SourcebookUpsertPayload) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  theme?: AppTheme;
  language?: string;
  baselineEntry?: SourcebookEntry | null;
  /** When true and the dialog is opened for an existing entry that has no
   *  baseline counterpart, treat the entry as newly created by the AI and
   *  display all content as "added" (green).  Default: false (no diff for
   *  entries not in the baseline, e.g. when the user opens a recently
   *  created entry manually). */
  showDiffForNew?: boolean;
  /** App-level undo/redo so the dialog buttons reflect global history. */
  canAppUndo?: boolean;
  canAppRedo?: boolean;
  onAppUndo?: () => Promise<void>;
  onAppRedo?: () => Promise<void>;
}

export const SourcebookEntryDialog: React.FC<SourcebookEntryDialogProps> = ({
  entry,
  allEntries,
  isOpen,
  onClose,
  onSave,
  onDelete,
  theme = 'mixed',
  language = 'en',
  baselineEntry = null,
  showDiffForNew = false,
  canAppUndo = false,
  canAppRedo = false,
  onAppUndo,
  onAppRedo,
}: SourcebookEntryDialogProps) => {
  const { t } = useTranslation();
  const state = useSourcebookEntryDialogState({
    entry,
    allEntries,
    isOpen,
    baselineEntry,
    showDiffForNew,
    onSave,
    onClose,
  });
  const scenes = useScenes();
  const timelineOptions = useMemo(
    () => buildSourcebookTimelineOptions(allEntries, state.timelineId),
    [allEntries, state.timelineId]
  );

  const entryDialogRef = useRef<HTMLDivElement>(null);
  const imagePickerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen, entryDialogRef, onClose);
  useFocusTrap(state.isImagePickerOpen, imagePickerRef, (): void =>
    state.setIsImagePickerOpen(false)
  );

  const {
    isLight,
    bg: bgClass,
    text: textClass,
    border: borderClass,
    input: inputBgClass,
    muted: labelClass,
    surface: descriptionSurfaceClass,
  } = useThemeClasses();
  const inputBorderClass = borderClass;
  const descriptionTextClass = isLight ? 'text-brand-gray-700' : 'text-brand-gray-300';
  const keywordsTooltip = state.isGeneratingKeywords
    ? '...generating...'
    : state.keywords.length > 0
      ? state.keywords.join(', ')
      : 'No keywords yet.';

  const sceneReferences = useMemo((): Array<{
    id: SceneId;
    summary: string;
    roles: string[];
  }> => {
    if (!entry) return [];
    const normalizedName = entry.name.trim().toLowerCase();
    return scenes
      .map(
        (
          sceneItem: Scene
        ): {
          id: SceneId;
          summary: string;
          roles: string[];
        } | null => {
          const roles: string[] = [];
          if (
            sceneItem.active_characters.some(
              (name: string): boolean => name.trim().toLowerCase() === normalizedName
            )
          ) {
            roles.push('active');
          }
          if (
            sceneItem.passive_characters.some(
              (name: string): boolean => name.trim().toLowerCase() === normalizedName
            )
          ) {
            roles.push('passive');
          }
          if (
            (sceneItem.sourcebook_entry_ids ?? []).includes(entry.id) ||
            (sceneItem.location ?? '').trim().toLowerCase() === normalizedName ||
            (sceneItem.time ?? '').trim().toLowerCase() === normalizedName
          ) {
            roles.push('sourcebook');
          }
          if (roles.length === 0) {
            return null;
          }
          return {
            id: sceneItem.id,
            summary: sceneItem.summary,
            roles,
          };
        }
      )
      .filter(
        (
          value: { id: SceneId; summary: string; roles: string[] } | null
        ): value is {
          id: SceneId;
          summary: string;
          roles: string[];
        } => value !== null
      );
  }, [entry, scenes]);

  if (!isOpen) {
    return null;
  }

  const handleUndo = (): void => {
    if (state.historyIndex > 0) {
      state.restoreFromHistory(state.historyIndex - 1);
      return;
    }
    onAppUndo?.();
  };

  const handleRedo = (): void => {
    if (state.historyIndex < state.history.length - 1) {
      state.restoreFromHistory(state.historyIndex + 1);
      return;
    }
    onAppRedo?.();
  };

  const handleDeleteEntry = async (): Promise<void> => {
    if (!entry || !onDelete) {
      return;
    }

    if (await confirm(t('Are you sure you want to delete this entry?'))) {
      await onDelete(entry.id);
      onClose();
    }
  };

  const handleRelationSave = (rel: SourcebookRelation): void => {
    if (state.editingRelationIndex !== null) {
      const nextRelations = [...state.relations];
      nextRelations[state.editingRelationIndex] = rel;
      state.setRelations(nextRelations);
      return;
    }

    state.setRelations([...state.relations, rel]);
  };

  return (
    <SourcebookEntryDialogView
      entry={entry}
      theme={theme}
      language={language}
      entryDialogRef={entryDialogRef}
      imagePickerRef={imagePickerRef}
      bgClass={bgClass}
      textClass={textClass}
      borderClass={borderClass}
      inputBgClass={inputBgClass}
      labelClass={labelClass}
      descriptionSurfaceClass={descriptionSurfaceClass}
      descriptionTextClass={descriptionTextClass}
      inputBorderClass={inputBorderClass}
      isLight={isLight}
      name={state.name}
      category={state.category}
      synonyms={state.synonyms}
      newSynonym={state.newSynonym}
      originDate={state.originDate}
      destinationDatetime={state.destinationDatetime}
      destinationRelative={state.destinationRelative}
      createsNewTimeline={state.createsNewTimeline}
      timelineId={state.timelineId}
      timelineOptions={timelineOptions}
      images={state.images}
      relations={state.relations}
      relationNameMap={state.relationNameMap}
      availableImages={state.availableImages}
      selectedImagesList={state.selectedImagesList}
      description={state.description}
      descriptionBaseline={state.descriptionBaseline}
      showDiff={state.showDiff}
      showKeywordsPanel={state.showKeywordsPanel}
      keywords={state.keywords}
      isGeneratingKeywords={state.isGeneratingKeywords}
      keywordsTooltip={keywordsTooltip}
      searchHighlightRanges={state.descriptionHighlightRanges}
      isImagesExpanded={state.isImagesExpanded}
      isRelationsExpanded={state.isRelationsExpanded}
      isImagePickerOpen={state.isImagePickerOpen}
      isRelationDialogVisible={state.isRelationDialogVisible}
      editingRelationIndex={state.editingRelationIndex}
      historyIndex={state.historyIndex}
      historyLength={state.history.length}
      canAppUndo={canAppUndo}
      canAppRedo={canAppRedo}
      isSaving={state.isSaving}
      canDelete={Boolean(onDelete)}
      t={t}
      onUndo={handleUndo}
      onRedo={handleRedo}
      onToggleDiff={(): void => state.setShowDiff((value: boolean): boolean => !value)}
      onClose={onClose}
      onNameChange={state.setName}
      onCategoryChange={state.setCategory}
      onSynonymInputChange={state.setNewSynonym}
      onAddSynonym={state.addSynonym}
      onRemoveSynonym={state.removeSynonym}
      onOriginDateChange={state.setOriginDate}
      onDestinationDatetimeChange={state.setDestinationDatetime}
      onDestinationRelativeChange={state.setDestinationRelative}
      onCreatesNewTimelineChange={state.setCreatesNewTimeline}
      onTimelineIdChange={state.setTimelineId}
      onToggleImagesExpanded={(): void =>
        state.setIsImagesExpanded((value: boolean): boolean => !value)
      }
      onOpenImagePicker={(): void => state.setIsImagePickerOpen(true)}
      onToggleImage={state.toggleImage}
      onToggleRelationsExpanded={(): void =>
        state.setIsRelationsExpanded((value: boolean): boolean => !value)
      }
      onOpenAddRelation={(): void => (
        state.setEditingRelationIndex(null),
        state.setIsRelationDialogVisible(true)
      )}
      onEditRelation={(index: number): void => (
        state.setEditingRelationIndex(index),
        state.setIsRelationDialogVisible(true)
      )}
      onDeleteRelation={(index: number): void =>
        state.setRelations(
          state.relations.filter(
            (_: SourcebookRelation, relationIndex: number): boolean =>
              relationIndex !== index
          )
        )
      }
      onDescriptionChange={(value: string): void => (
        state.setDescriptionBaseline(value),
        state.setDescription(value)
      )}
      onToggleKeywordsPanel={(): void =>
        state.setShowKeywordsPanel((value: boolean): boolean => !value)
      }
      onDeleteEntry={handleDeleteEntry}
      onSaveEntry={state.handleSave}
      onSaveRelation={handleRelationSave}
      onCloseRelationDialog={(): void => state.setIsRelationDialogVisible(false)}
      onCloseImagePicker={(): void => state.setIsImagePickerOpen(false)}
      sceneReferences={sceneReferences}
    />
  );
};

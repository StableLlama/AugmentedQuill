// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Isolate sourcebook entry dialog state and behavior from the UI shell.
 */

import { useEffect, useMemo, useState, Dispatch, SetStateAction } from 'react';
import { SourcebookEntry, SourcebookRelation } from '../../types';
import { ProjectImage, SourcebookUpsertPayload } from '../../services/apiTypes';
import { useSearchHighlight } from '../search/SearchHighlightContext';
import {
  SourcebookEntryHistoryState,
  useSourcebookEntryHistory,
} from './useSourcebookEntryHistory';
import { useSourcebookEntryData } from './useSourcebookEntryData';

const CATEGORY_KEYS = [
  'Character',
  'Location',
  'Organization',
  'Item',
  'Event',
  'Lore',
  'Other',
  'Time Travel',
] as const;

const DEFAULT_CATEGORY = CATEGORY_KEYS[0];
const EMPTY_ENTRY_STATE: SourcebookEntryHistoryState = {
  name: '',
  description: '',
  category: DEFAULT_CATEGORY,
  synonyms: [],
  images: [],
  relations: [],
  keywords: [],
};

const buildEntryHistoryState = (
  entry?: SourcebookEntry | null
): SourcebookEntryHistoryState => ({
  name: entry?.name || '',
  description: entry?.description || '',
  category: entry?.category || DEFAULT_CATEGORY,
  synonyms: entry?.synonyms || [],
  images: entry?.images || [],
  relations: entry?.relations || [],
  keywords: entry?.keywords || [],
});

const resolveDescriptionBaseline = (
  entry: SourcebookEntry | null | undefined,
  baselineEntry: SourcebookEntry | null | undefined,
  showDiffForNew: boolean
): string | undefined => {
  if (!entry) {
    return undefined;
  }
  if (baselineEntry != null) {
    return baselineEntry.description;
  }
  return showDiffForNew ? '' : undefined;
};

interface UseSourcebookEntryDialogStateParams {
  entry?: SourcebookEntry | null;
  allEntries: SourcebookEntry[];
  isOpen: boolean;
  baselineEntry?: SourcebookEntry | null;
  showDiffForNew: boolean;
  onSave: (entry: SourcebookUpsertPayload) => Promise<void>;
  onClose: () => void;
}

export interface UseSourcebookEntryDialogStateResult {
  name: string;
  description: string;
  descriptionBaseline: string | undefined;
  showDiff: boolean;
  category: string;
  synonyms: string[];
  newSynonym: string;
  originDate: string | null;
  destinationDatetime: string | null;
  destinationRelative: string;
  createsNewTimeline: boolean;
  timelineId: string;
  images: string[];
  relations: SourcebookRelation[];
  isImagesExpanded: boolean;
  isRelationsExpanded: boolean;
  isRelationDialogVisible: boolean;
  editingRelationIndex: number | null;
  isImagePickerOpen: boolean;
  showKeywordsPanel: boolean;
  isSaving: boolean;
  relationNameMap: Record<string, string>;
  descriptionHighlightRanges: import('../search/useSearchReplace').SearchHighlightRange[];
  availableImages: ProjectImage[];
  selectedImagesList: ProjectImage[];
  keywords: string[];
  isGeneratingKeywords: boolean;
  history: import('./useSourcebookEntryHistory').SourcebookEntryHistoryState[];
  historyIndex: number;
  setName: Dispatch<SetStateAction<string>>;
  setDescription: Dispatch<SetStateAction<string>>;
  setDescriptionBaseline: Dispatch<SetStateAction<string | undefined>>;
  setShowDiff: Dispatch<SetStateAction<boolean>>;
  setCategory: Dispatch<SetStateAction<string>>;
  setSynonyms: Dispatch<SetStateAction<string[]>>;
  setNewSynonym: Dispatch<SetStateAction<string>>;
  setOriginDate: Dispatch<SetStateAction<string | null>>;
  setDestinationDatetime: Dispatch<SetStateAction<string | null>>;
  setDestinationRelative: Dispatch<SetStateAction<string>>;
  setCreatesNewTimeline: Dispatch<SetStateAction<boolean>>;
  setTimelineId: Dispatch<SetStateAction<string>>;
  setImages: Dispatch<SetStateAction<string[]>>;
  setRelations: Dispatch<SetStateAction<SourcebookRelation[]>>;
  setIsImagesExpanded: Dispatch<SetStateAction<boolean>>;
  setIsRelationsExpanded: Dispatch<SetStateAction<boolean>>;
  setIsRelationDialogVisible: Dispatch<SetStateAction<boolean>>;
  setEditingRelationIndex: Dispatch<SetStateAction<number | null>>;
  setIsImagePickerOpen: Dispatch<SetStateAction<boolean>>;
  setShowKeywordsPanel: Dispatch<SetStateAction<boolean>>;
  handleSave: () => Promise<void>;
  addSynonym: () => void;
  removeSynonym: (index: number) => void;
  toggleImage: (filename: string) => void;
  restoreFromHistory: (index: number) => void;
}

export const useSourcebookEntryDialogState = ({
  entry,
  allEntries,
  isOpen,
  baselineEntry,
  showDiffForNew,
  onSave,
  onClose,
}: UseSourcebookEntryDialogStateParams): UseSourcebookEntryDialogStateResult => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionBaseline, setDescriptionBaseline] = useState<string | undefined>(
    undefined
  );
  const [showDiff, setShowDiff] = useState(true);
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [synonyms, setSynonyms] = useState<string[]>([]);
  const [newSynonym, setNewSynonym] = useState('');
  const [originDate, setOriginDate] = useState<string | null>(null);
  const [destinationDatetime, setDestinationDatetime] = useState<string | null>(null);
  const [destinationRelative, setDestinationRelative] = useState<string>('');
  const [createsNewTimeline, setCreatesNewTimeline] = useState<boolean>(false);
  const [timelineId, setTimelineId] = useState<string>('main');
  const [images, setImages] = useState<string[]>([]);
  const [relations, setRelations] = useState<SourcebookRelation[]>([]);
  const [isImagesExpanded, setIsImagesExpanded] = useState(true);
  const [isRelationsExpanded, setIsRelationsExpanded] = useState(true);
  const [isRelationDialogVisible, setIsRelationDialogVisible] = useState(false);
  const [editingRelationIndex, setEditingRelationIndex] = useState<number | null>(null);
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const [showKeywordsPanel, setShowKeywordsPanel] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const relationNameMap = useMemo((): Record<string, string> => {
    const map: Record<string, string> = {};
    allEntries.forEach((item: SourcebookEntry): void => {
      map[item.id] = item.name;
    });
    return map;
  }, [allEntries]);

  const { getRanges } = useSearchHighlight();
  const descriptionHighlightRanges = getRanges(
    'sourcebook',
    entry?.id ?? '',
    'description'
  );

  const { availableImages, selectedImagesList, keywords, isGeneratingKeywords } =
    useSourcebookEntryData({
      isOpen,
      isImagePickerOpen,
      images,
      keywordInputs: { name, description, synonyms },
      hasEntry: Boolean(entry),
      entryKeywords: entry?.keywords,
    });

  const [initialHistoryState, setInitialHistoryState] =
    useState<SourcebookEntryHistoryState>(EMPTY_ENTRY_STATE);

  const currentHistoryState = useMemo(
    () => ({ name, description, category, synonyms, images, relations, keywords }),
    [name, description, category, synonyms, images, relations, keywords]
  );

  const { history, historyIndex, restoreSourcebookHistory } = useSourcebookEntryHistory(
    {
      initialState: initialHistoryState,
      currentState: currentHistoryState,
    }
  );

  useEffect((): void => {
    const initialState = buildEntryHistoryState(entry);

    setName(initialState.name);
    setDescription(initialState.description);
    setDescriptionBaseline(
      resolveDescriptionBaseline(entry, baselineEntry, showDiffForNew)
    );
    setCategory(initialState.category);
    setSynonyms(initialState.synonyms);
    setOriginDate(entry?.origin_date ?? null);
    setDestinationDatetime(entry?.destination_datetime ?? null);
    setDestinationRelative(entry?.destination_relative ?? '');
    setCreatesNewTimeline(entry?.creates_new_timeline ?? false);
    setTimelineId(entry?.timeline_id ?? 'main');
    setImages(initialState.images);
    setRelations(initialState.relations);

    setNewSynonym('');
    setShowKeywordsPanel(false);
    setInitialHistoryState(initialState);
    setIsImagesExpanded(initialState.images.length > 0);
    setIsRelationsExpanded(initialState.relations.length > 0);
  }, [entry?.id, isOpen, baselineEntry, showDiffForNew]);

  useEffect((): void => {
    if (relations.length > 0) {
      setIsRelationsExpanded(true);
    }
  }, [relations]);

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await onSave({
        ...entry,
        name,
        description,
        category,
        synonyms,
        images,
        // Cast: domain SourcebookRelation is structurally compatible with the
        // generated type; direction differs only in optional vs. nullable.
        relations: relations as SourcebookUpsertPayload['relations'],
        origin_date: originDate ?? undefined,
        destination_datetime: destinationDatetime ?? undefined,
        destination_relative: destinationRelative || undefined,
        creates_new_timeline: createsNewTimeline,
        timeline_id: timelineId,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const addSynonym = (): void => {
    if (!newSynonym.trim()) {
      return;
    }

    setSynonyms([...synonyms, newSynonym.trim()]);
    setNewSynonym('');
  };

  const removeSynonym = (index: number): void => {
    setSynonyms(
      synonyms.filter(
        (_: string, currentIndex: number): boolean => currentIndex !== index
      )
    );
  };

  const toggleImage = (filename: string): void => {
    if (images.includes(filename)) {
      setImages(images.filter((value: string): boolean => value !== filename));
      return;
    }

    setImages([...images, filename]);
  };

  const restoreFromHistory = (index: number): void => {
    restoreSourcebookHistory(index, (snapshot: SourcebookEntryHistoryState): void => {
      setName(snapshot.name);
      setDescription(snapshot.description);
      setCategory(snapshot.category);
      setSynonyms(snapshot.synonyms);
      setImages(snapshot.images);
      setRelations(snapshot.relations);
    });
  };

  return {
    name,
    description,
    descriptionBaseline,
    showDiff,
    category,
    synonyms,
    newSynonym,
    originDate,
    destinationDatetime,
    destinationRelative,
    createsNewTimeline,
    timelineId,
    images,
    relations,
    isImagesExpanded,
    isRelationsExpanded,
    isRelationDialogVisible,
    editingRelationIndex,
    isImagePickerOpen,
    showKeywordsPanel,
    isSaving,
    relationNameMap,
    descriptionHighlightRanges,
    availableImages,
    selectedImagesList,
    keywords,
    isGeneratingKeywords,
    history,
    historyIndex,
    setName,
    setDescription,
    setDescriptionBaseline,
    setShowDiff,
    setCategory,
    setSynonyms,
    setNewSynonym,
    setOriginDate,
    setDestinationDatetime,
    setDestinationRelative,
    setCreatesNewTimeline,
    setTimelineId,
    setImages,
    setRelations,
    setIsImagesExpanded,
    setIsRelationsExpanded,
    setIsRelationDialogVisible,
    setEditingRelationIndex,
    setIsImagePickerOpen,
    setShowKeywordsPanel,
    handleSave,
    addSynonym,
    removeSynonym,
    toggleImage,
    restoreFromHistory,
  };
};

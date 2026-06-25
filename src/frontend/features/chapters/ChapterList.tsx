// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the chapter list unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Chapter, Book, AppTheme, Scene } from '../../types';
import { MetadataParams } from '../story/metadataSync';
import { useConfirm } from '../layout/ConfirmDialogContext';
import { useThemeClasses } from '../layout/ThemeContext';
import { MetadataEditorDialog } from '../story/MetadataEditorDialog';
import {
  useChapterMetadataDialog,
  useUIStore,
  type UIStoreState,
} from '../../stores/uiStore';
import { useScenes } from '../../stores/storyStore';
import { api } from '../../services/api';
import { diff_match_patch } from 'diff-match-patch';
import { normalizeChapterId } from '../scenes/sceneSortUtils';
import {
  Plus,
  Trash2,
  FileText,
  Folder,
  FolderOpen,
  Book as BookIcon,
  Edit,
  ListTree,
} from 'lucide-react';
import { SceneTreeView } from './SceneTreeView';

interface ChapterListProps {
  chapters: Chapter[];
  books?: Book[];
  projectType?: 'short-story' | 'novel' | 'series';
  currentChapterId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateChapter?: (
    id: string,
    updates: Partial<Chapter>,
    sync?: boolean,
    pushHistory?: boolean
  ) => void;
  onUpdateBook?: (id: string, updates: Partial<Book>) => void;
  onCreate: (bookId?: string) => void;
  onBookDelete?: (id: string) => void;
  onReorderChapters?: (chapterIds: number[], bookId?: string) => void;
  onReorderBooks?: (bookIds: string[]) => void;
  onAiAction?: (
    type: 'chapter' | 'book',
    id: string,
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void,
    currentText?: string,
    onThinking?: (thinking: string) => void
  ) => Promise<string | undefined>;
  isAiAvailable?: boolean;
  theme?: AppTheme;
  onBookCreate?: (title: string) => void;
  onOpenImages?: () => void;
  languages?: string[];
  language?: string;
  baselineChapters?: Chapter[];
  spellCheck?: boolean;
}

/* eslint-disable complexity, max-lines-per-function */
function ChapterListInner({
  chapters,
  books = [],
  projectType = 'novel',
  currentChapterId,
  onSelect,
  onDelete,
  onUpdateChapter,
  onUpdateBook,
  onCreate,
  onBookCreate,
  onBookDelete,
  onReorderChapters,
  onReorderBooks,
  onAiAction,
  isAiAvailable = true,
  theme = 'mixed',
  languages = [],
  language,
  onOpenImages: _onOpenImages,
  baselineChapters = [],
  spellCheck = true,
}: ChapterListProps): React.ReactElement {
  const DRAG_SCENE_MIME = 'application/x-augmentedquill-scene-id';
  const DRAG_SCENES_MIME = 'application/x-augmentedquill-scene-ids';
  const { isLight } = useThemeClasses();
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});
  const [newBookTitle, setNewBookTitle] = useState('');
  const [isCreatingBook, setIsCreatingBook] = useState(false);
  const scenes = useScenes();
  const selectedSceneChapterIds = useUIStore(
    (s: UIStoreState): ReadonlySet<string> => s.sceneSelectionChapterIds
  );
  const [sceneDropChapterId, setSceneDropChapterId] = useState<string | null>(null);

  // Toggle between summary view and compact scene tree view.
  const [scenesMode, setScenesMode] = useState(false);

  // Keep transient drag state local so failed reorder requests do not corrupt source props.
  const [draggedItem, setDraggedItem] = useState<{
    type: 'chapter' | 'book';
    id: string;
    bookId?: string;
    originalIndex: number;
  } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverBookId, setDragOverBookId] = useState<string | null>(null);
  const [optimisticChapters, setOptimisticChapters] = useState<Chapter[] | null>(null);
  const [optimisticBooks, setOptimisticBooks] = useState<Book[] | null>(null);

  // Server-confirmed props always win over optimistic previews.
  useEffect((): void => {
    if (optimisticChapters !== null) {
      setOptimisticChapters(null);
    }
  }, [chapters, optimisticChapters]);

  useEffect((): void => {
    if (optimisticBooks !== null) {
      setOptimisticBooks(null);
    }
  }, [books, optimisticBooks]);

  // Shared array move helper for optimistic drag previews.
  const moveInArray = <T,>(arr: T[], from: number, to: number): T[] => {
    if (from === to || from === -1 || to === -1) return arr;
    const result = [...arr];
    const [removed] = result.splice(from, 1);
    result.splice(to, 0, removed);
    return result;
  };

  let displayChapters = optimisticChapters || chapters;
  let displayBooks = optimisticBooks || books;

  if (draggedItem && dragOverIndex !== null) {
    if (draggedItem.type === 'chapter') {
      if (projectType === 'series') {
        const targetBookId = dragOverBookId || draggedItem.bookId;
        if (targetBookId === draggedItem.bookId) {
          const bookChapters = chapters.filter(
            (c: Chapter): boolean => c.book_id === draggedItem.bookId
          );
          const reordered = moveInArray(
            bookChapters,
            draggedItem.originalIndex,
            dragOverIndex
          );
          displayChapters = chapters.map((c: Chapter): Chapter => {
            if (c.book_id !== draggedItem.bookId) return c;
            const subIdx = bookChapters.findIndex(
              (sc: Chapter): boolean => sc.id === c.id
            );
            return reordered[subIdx];
          });
        } else {
          // Cross-book preview keeps chapter context visible before persistence.
          const sourceChapters = chapters.filter(
            (c: Chapter): boolean => c.book_id === draggedItem.bookId
          );
          const targetChapters = chapters.filter(
            (c: Chapter): boolean => c.book_id === targetBookId
          );

          const movingChapter = sourceChapters[draggedItem.originalIndex];

          if (movingChapter) {
            const newSourceChapters = [...sourceChapters];
            newSourceChapters.splice(draggedItem.originalIndex, 1);

            const newTargetChapters = [...targetChapters];
            newTargetChapters.splice(dragOverIndex, 0, {
              ...movingChapter,
              book_id: targetBookId,
            });

            displayChapters = chapters
              .filter(
                (c: Chapter): boolean =>
                  c.book_id !== draggedItem.bookId && c.book_id !== targetBookId
              )
              .concat(newSourceChapters)
              .concat(newTargetChapters);
          }
        }
      } else {
        displayChapters = moveInArray(
          chapters,
          draggedItem.originalIndex,
          dragOverIndex
        );
      }
    } else if (draggedItem.type === 'book') {
      displayBooks = moveInArray(books, draggedItem.originalIndex, dragOverIndex);
    }
  }

  // Drag handlers coordinate optimistic UI and final persistence callbacks.
  const handleDragStart = (
    e: React.DragEvent,
    type: 'chapter' | 'book',
    id: string,
    index: number,
    bookId?: string
  ): void => {
    setDraggedItem({ type, id, bookId, originalIndex: index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (index: number, bookId?: string): void => {
    if (dragOverIndex !== index || (bookId && dragOverBookId !== bookId)) {
      setDragOverIndex(index);
      if (bookId) setDragOverBookId(bookId);
    }
  };

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const parseDroppedSceneIds = (dataTransfer: DataTransfer): number[] => {
    const rawIds = dataTransfer.getData(DRAG_SCENES_MIME);
    if (rawIds) {
      try {
        const parsed = JSON.parse(rawIds) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (value: unknown): value is number =>
              typeof value === 'number' && Number.isInteger(value)
          );
        }
      } catch {
        // Ignore malformed payloads.
      }
    }

    const single =
      dataTransfer.getData(DRAG_SCENE_MIME) || dataTransfer.getData('text/plain');
    const parsedSingle = Number(single);
    return Number.isInteger(parsedSingle) ? [parsedSingle] : [];
  };

  const handleChapterSceneDragOver = (
    e: React.DragEvent,
    chapterId: string
  ): boolean => {
    const droppedSceneIds = parseDroppedSceneIds(e.dataTransfer);
    if (droppedSceneIds.length > 0) {
      if (draggedItem) {
        // A stale internal chapter/book drag state must not block external
        // scene drops coming from Narrative view.
        setDraggedItem(null);
        setDragOverIndex(null);
        setDragOverBookId(null);
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setSceneDropChapterId(chapterId);
      return true;
    }

    if (draggedItem) return false;
    return false;
  };

  const handleChapterSceneDrop = (e: React.DragEvent, chapterId: string): boolean => {
    const droppedSceneIds = parseDroppedSceneIds(e.dataTransfer);
    if (droppedSceneIds.length > 0) {
      if (draggedItem) {
        setDraggedItem(null);
        setDragOverIndex(null);
        setDragOverBookId(null);
      }
      e.preventDefault();

      const normalizedChapterId = normalizeChapterId(chapterId);
      if (!normalizedChapterId) return true;

      setSceneDropChapterId(null);
      window.dispatchEvent(
        new CustomEvent('aq-scene-drop-chapter', {
          detail: {
            sourceSceneIds: droppedSceneIds,
            chapterId: normalizedChapterId,
          },
        })
      );
      return true;
    }

    if (draggedItem) return false;
    return false;
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const targetIdx = dragOverIndex;
    const dragged = draggedItem;

    if (!dragged || targetIdx === null) {
      setDragOverIndex(null);
      setDraggedItem(null);
      return;
    }

    if (dragged.type === 'chapter') {
      if (projectType === 'series') {
        const targetBookId = dragOverBookId || dragged.bookId;

        // Skip no-op drops to avoid unnecessary reorder writes.
        if (targetBookId === dragged.bookId && targetIdx === dragged.originalIndex) {
          setDragOverIndex(null);
          setDraggedItem(null);
          setDragOverBookId(null);
          return;
        }

        if (targetBookId && onReorderChapters) {
          const bookChaptersFinal = displayChapters.filter(
            (c: Chapter): boolean => c.book_id === targetBookId
          );
          const chapterIds = bookChaptersFinal.map((c: Chapter): number =>
            parseInt(c.id)
          );
          setOptimisticChapters(displayChapters);
          onReorderChapters(chapterIds, targetBookId);
        }
      } else {
        if (onReorderChapters) {
          const chapterIds = displayChapters.map((c: Chapter): number =>
            parseInt(c.id)
          );
          setOptimisticChapters(displayChapters);
          onReorderChapters(chapterIds);
        }
      }
    } else if (dragged.type === 'book') {
      if (onReorderBooks) {
        const bookIds = displayBooks.map((b: Book): string => b.id);
        setOptimisticBooks(displayBooks);
        onReorderBooks(bookIds);
      }
    }

    setDragOverIndex(null);
    setDragOverBookId(null);
    setDraggedItem(null);
    setSceneDropChapterId(null);
  };

  const handleDragEnd = (): void => {
    setDraggedItem(null);
    setDragOverIndex(null);
    setDragOverBookId(null);
    setSceneDropChapterId(null);
  };

  const toggleBook = (id: string): void => {
    setExpandedBooks((prev: Record<string, boolean>): { [x: string]: boolean } => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const bgClass = isLight
    ? 'bg-brand-gray-50 border-brand-gray-200'
    : 'bg-brand-gray-900 border-brand-gray-800';
  const textHeader = isLight ? 'text-brand-gray-500' : 'text-brand-gray-400';
  const btnHover = isLight
    ? 'hover:bg-brand-gray-200 text-brand-gray-500 hover:text-brand-gray-700'
    : 'hover:bg-brand-gray-800 text-brand-gray-500 hover:text-brand-gray-300';

  const itemActive = isLight
    ? 'bg-brand-gray-50 border-brand-400 shadow-sm'
    : 'bg-brand-gray-800/50 border-brand-800 shadow-sm';
  const itemInactive = isLight
    ? 'bg-transparent border-transparent hover:bg-brand-gray-100'
    : 'bg-transparent border-transparent hover:bg-brand-gray-800/50';
  const titleActive = isLight ? 'text-brand-700' : 'text-brand-300';
  const titleInactive = isLight ? 'text-brand-gray-700' : 'text-brand-gray-400';

  const [editingMetadata, setEditingMetadata] = useState<{
    type: 'chapter' | 'book';
    id: string;
  } | null>(null);
  const [pendingMetadataUpdate, setPendingMetadataUpdate] = useState<{
    id: string;
    data: {
      title?: string;
      summary?: string;
      notes?: string;
      private_notes?: string;
      conflicts?: Chapter['conflicts'];
    };
  } | null>(null);

  const activeEditingData = useMemo((): Chapter | Book | null | undefined => {
    if (!editingMetadata) return null;
    if (editingMetadata.type === 'chapter') {
      return displayChapters.find((c: Chapter): boolean => c.id === editingMetadata.id);
    } else {
      return displayBooks.find((b: Book): boolean => b.id === editingMetadata.id);
    }
  }, [editingMetadata, displayChapters, displayBooks]);

  const chapterScenesForEditor = useMemo((): Array<{
    id: string;
    summary: string;
  }> => {
    if (!editingMetadata || editingMetadata.type !== 'chapter') return [];

    const targetChapterId = normalizeChapterId(editingMetadata.id);
    if (!targetChapterId) return [];

    return scenes
      .filter(
        (scene: Scene): boolean =>
          scene.prose_link?.scope_type === 'chapter' &&
          normalizeChapterId(scene.prose_link.chapter_id) === targetChapterId
      )
      .sort((a: Scene, b: Scene): number => {
        const aStart = a.prose_link?.start_offset ?? Number.POSITIVE_INFINITY;
        const bStart = b.prose_link?.start_offset ?? Number.POSITIVE_INFINITY;
        if (aStart !== bStart) return aStart - bStart;

        const aOrder = Number.isFinite(a.order_index)
          ? (a.order_index as number)
          : Number.POSITIVE_INFINITY;
        const bOrder = Number.isFinite(b.order_index)
          ? (b.order_index as number)
          : Number.POSITIVE_INFINITY;
        if (aOrder !== bOrder) return aOrder - bOrder;

        return String(a.id).localeCompare(String(b.id));
      })
      .map((scene: Scene): { id: string; summary: string } => ({
        id: String(scene.id),
        summary: scene.summary?.trim() || t('Untitled Scene'),
      }));
  }, [editingMetadata, scenes, t]);

  const chapterMetadataDialog = useChapterMetadataDialog();
  useEffect((): void => {
    if (!chapterMetadataDialog.isOpen || !chapterMetadataDialog.chapterId) {
      return;
    }
    setEditingMetadata({ type: 'chapter', id: chapterMetadataDialog.chapterId });
  }, [
    chapterMetadataDialog.isOpen,
    chapterMetadataDialog.chapterId,
    chapterMetadataDialog.version,
  ]);

  const handleEditChapterMetadata = (e: React.MouseEvent, chapter: Chapter): void => {
    e.stopPropagation();
    setEditingMetadata({ type: 'chapter', id: chapter.id });
  };

  const handleEditBookMetadata = (e: React.MouseEvent, book: Book): void => {
    e.stopPropagation();
    setEditingMetadata({ type: 'book', id: book.id });
  };

  const saveMetadata = async (data: {
    title?: string;
    summary?: string;
    notes?: string;
    private_notes?: string;
    conflicts?: Chapter['conflicts'];
  }): Promise<void> => {
    if (!editingMetadata || !activeEditingData) return;
    try {
      if (editingMetadata.type === 'chapter') {
        const id = parseInt(editingMetadata.id, 10);
        await api.chapters.updateMetadata(id, {
          summary: data.summary,
          notes: data.notes,
          private_notes: data.private_notes,
          conflicts: data.conflicts,
        });

        if (onUpdateChapter) {
          onUpdateChapter(editingMetadata.id, data, false, false);
          setPendingMetadataUpdate({ id: editingMetadata.id, data });
        } else {
          if (data.title !== activeEditingData.title) {
            await api.chapters.updateTitle(id, data.title || '');
          }
        }
      } else {
        const id = editingMetadata.id;
        await api.books.updateBookMetadata(id, {
          title: data.title,
          summary: data.summary,
          notes: data.notes,
          private_notes: data.private_notes,
        });
        onUpdateBook?.(id, data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const renderChapter = (chapter: Chapter, index: number): React.JSX.Element => {
    const isDragging = draggedItem?.type === 'chapter' && draggedItem.id === chapter.id;
    const isRelatedToSelectedScenes = selectedSceneChapterIds.has(
      normalizeChapterId(chapter.id)
    );
    const chapterStateClass =
      currentChapterId === chapter.id
        ? itemActive
        : isRelatedToSelectedScenes
          ? isLight
            ? 'bg-brand-50 border-transparent hover:bg-brand-100'
            : 'bg-brand-gray-700/45 border-transparent hover:bg-brand-gray-700'
          : itemInactive;

    const baselineChapter = baselineChapters.find(
      (c: Chapter): boolean => String(c.id) === String(chapter.id)
    );
    const baselineSummary = baselineChapter?.summary || '';

    const renderSummary = (): React.ReactNode => {
      const summary = chapter.summary || t('No summary available...');
      if (!baselineSummary || baselineSummary === summary) {
        return <Fragment>{summary}</Fragment>;
      }

      const diffs = new diff_match_patch().diff_main(baselineSummary, summary);
      new diff_match_patch().diff_cleanupSemantic(diffs);

      return diffs.map(([op, text]: import('diff-match-patch').Diff, i: number) => {
        if (op === 0) return <Fragment key={i}>{text}</Fragment>;
        if (op === 1) {
          return (
            <span
              key={i}
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.15)',
                borderBottom: '1px solid rgba(34, 197, 94, 0.4)',
              }}
            >
              {text}
            </span>
          );
        }
        return (
          <span
            key={i}
            style={{
              textDecoration: 'line-through',
              opacity: 0.5,
            }}
          >
            {text}
          </span>
        );
      });
    };

    return (
      <div
        key={chapter.id}
        className={`group relative p-3 rounded-lg transition-all duration-150 border ${chapterStateClass} ${
          isDragging
            ? 'opacity-20 grayscale border-dashed border-brand-gray-500/50'
            : 'opacity-100'
        } ${
          sceneDropChapterId === chapter.id
            ? isLight
              ? 'ring-2 ring-brand-400/70 bg-brand-50/80'
              : 'ring-2 ring-brand-500/70 bg-brand-900/20'
            : ''
        }`}
      >
        <button
          type="button"
          className="flex flex-col w-full text-left cursor-pointer"
          draggable
          onDragStart={(e: React.DragEvent<HTMLButtonElement>): void =>
            handleDragStart(e, 'chapter', chapter.id, index, chapter.book_id)
          }
          onDragEnter={(): void => {
            if (draggedItem?.type === 'chapter' && !isDragging) {
              handleDragEnter(index, chapter.book_id);
            }
          }}
          onDragOver={(e: React.DragEvent<HTMLButtonElement>): void => {
            if (handleChapterSceneDragOver(e, chapter.id)) return;
            handleDragOver(e);
          }}
          onDragLeave={(e: React.DragEvent<HTMLButtonElement>): void => {
            const relatedTarget = e.relatedTarget;
            if (
              relatedTarget instanceof Node &&
              e.currentTarget.contains(relatedTarget)
            ) {
              return;
            }
            setSceneDropChapterId((current: string | null) =>
              current === chapter.id ? null : current
            );
          }}
          onDrop={(e: React.DragEvent<HTMLButtonElement>): void => {
            if (handleChapterSceneDrop(e, chapter.id)) return;
            handleDrop(e);
          }}
          onDragEnd={handleDragEnd}
          onClick={(): void => onSelect(chapter.id)}
          aria-current={currentChapterId === chapter.id ? 'true' : undefined}
        >
          <div className="flex justify-between items-start w-full">
            <div className="flex items-center gap-2">
              <h3
                className={`font-medium text-sm mb-1 ${
                  currentChapterId === chapter.id ? titleActive : titleInactive
                }`}
              >
                {chapter.title || t('Untitled Chapter')}
              </h3>
              {chapter.conflicts && chapter.conflicts.length > 0 && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[10px] font-bold">
                  {chapter.conflicts.length}
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 text-xs text-brand-gray-500 line-clamp-2">
            {renderSummary()}
          </div>
        </button>
        <div className="absolute top-2 right-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>): void =>
              handleEditChapterMetadata(e, chapter)
            }
            className="p-1 text-brand-gray-400 hover:text-blue-500"
            title={t('Edit Metadata')}
          >
            <Edit size={14} />
          </button>
          <button
            onClick={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>): void => {
              e.stopPropagation();
              onDelete(chapter.id);
            }}
            className="p-1 text-brand-gray-400 hover:text-red-500"
            title={t('Delete Chapter')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      id="chapter-list"
      className={`flex flex-col flex-1 min-h-0 border-r relative ${bgClass}`}
    >
      {editingMetadata && activeEditingData && (
        <MetadataEditorDialog
          type={editingMetadata.type}
          language={language}
          spellCheck={spellCheck}
          title={
            editingMetadata.type === 'chapter'
              ? t('Edit Chapter: {{title}}', { title: activeEditingData.title })
              : t('Edit Book: {{title}}', { title: activeEditingData.title })
          }
          initialData={activeEditingData}
          initialTab={
            editingMetadata.type === 'chapter'
              ? chapterMetadataDialog.initialTab
              : undefined
          }
          baseline={
            editingMetadata.type === 'chapter'
              ? baselineChapters.find(
                  (c: Chapter): boolean => String(c.id) === String(editingMetadata.id)
                )
              : undefined
          }
          onSave={saveMetadata as (data: MetadataParams) => Promise<void>}
          onClose={(): void => {
            if (
              pendingMetadataUpdate &&
              pendingMetadataUpdate.id === editingMetadata.id
            ) {
              const currentChapter = displayChapters.find(
                (c: Chapter): boolean => c.id === pendingMetadataUpdate.id
              );
              const isDifferent =
                currentChapter &&
                Object.entries(pendingMetadataUpdate.data).some(
                  ([key, value]: [
                    string,
                    string | import('../../types').Conflict[],
                  ]): boolean => {
                    if (value === undefined) return false;
                    return (
                      JSON.stringify(value) !==
                      JSON.stringify(
                        (currentChapter as unknown as Record<string, unknown>)[key]
                      )
                    );
                  }
                );
              if (isDifferent) {
                onUpdateChapter?.(
                  pendingMetadataUpdate.id,
                  pendingMetadataUpdate.data,
                  false,
                  true
                );
              }
            }
            setPendingMetadataUpdate(null);
            setEditingMetadata(null);
            useUIStore.getState().closeChapterMetadataDialog();
          }}
          theme={theme}
          aiDisabledReason={
            !isAiAvailable
              ? t(
                  'Summary AI is unavailable because no working EDITING model is configured.'
                )
              : undefined
          }
          primarySourceLabel={
            editingMetadata.type === 'chapter' ? t('Chapter') : undefined
          }
          primarySourceAvailable={
            editingMetadata.type === 'chapter' &&
            activeEditingData &&
            'content' in activeEditingData
              ? !!activeEditingData.content?.trim()
              : undefined
          }
          onAiGenerate={
            onAiAction && editingMetadata
              ? (
                  action: 'update' | 'rewrite' | 'write',
                  onProgress: ((text: string) => void) | undefined,
                  currentText: string | undefined,
                  onThinking: ((thinking: string) => void) | undefined
                ): Promise<string | undefined> =>
                  onAiAction(
                    editingMetadata.type,
                    editingMetadata.id,
                    action,
                    onProgress,
                    currentText,
                    onThinking
                  )
              : undefined
          }
          languages={languages}
          chapterScenes={
            editingMetadata.type === 'chapter' ? chapterScenesForEditor : undefined
          }
        />
      )}
      <div
        className={`p-4 border-b flex justify-between items-center sticky top-0 z-10 ${bgClass} ${
          isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
        }`}
      >
        {/* title with inline create button so it hugs the header text */}
        <div className="flex items-center gap-1.5 min-w-0">
          <h2
            className={`text-sm font-semibold uppercase tracking-wider ${textHeader}`}
          >
            {projectType === 'series' ? t('Books & Chapters') : t('Chapters')}
          </h2>
          {projectType === 'novel' && !scenesMode && (
            <button
              onClick={(): void => onCreate()}
              className={`p-1 rounded-full transition-colors ${btnHover}`}
              title={t('New Chapter')}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
        <button
          onClick={(): void => setScenesMode((prev: boolean) => !prev)}
          className={`p-1 rounded transition-colors ${btnHover}`}
          title={scenesMode ? t('Show chapters view') : t('Show scenes view')}
        >
          {scenesMode ? <FileText size={16} /> : <ListTree size={16} />}
        </button>
      </div>

      {scenesMode ? (
        <SceneTreeView
          scenes={scenes}
          chapters={displayChapters}
          books={displayBooks}
          projectType={projectType === 'series' ? 'series' : 'novel'}
          currentChapterId={currentChapterId}
          onSelectChapter={onSelect}
          isLight={isLight}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {projectType === 'series' ? (
            <div className="space-y-4">
              {displayBooks.map((book: Book, bIdx: number) => {
                const bookChapters = displayChapters.filter(
                  (c: Chapter): boolean => c.book_id === book.id
                );
                const isExpanded = expandedBooks[book.id] ?? true;
                const isBookDragging =
                  draggedItem?.type === 'book' && draggedItem.id === book.id;

                return (
                  <div
                    key={`book-${(book.id || '').trim() || String(bIdx + 1)}`}
                    className="space-y-1"
                  >
                    <div
                      className={`flex flex-col p-2 rounded transition-all duration-150 group ${
                        isLight
                          ? 'hover:bg-brand-gray-200/50'
                          : 'hover:bg-brand-gray-800/50'
                      } ${
                        isBookDragging
                          ? 'opacity-20 grayscale border-dashed border-brand-gray-500/50'
                          : 'opacity-100'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full text-left">
                        <button
                          className="flex items-center space-x-2 font-bold text-sm cursor-row-resize"
                          style={{ cursor: 'row-resize' }}
                          draggable
                          onDragStart={(e: React.DragEvent<HTMLButtonElement>): void =>
                            handleDragStart(e, 'book', book.id, bIdx)
                          }
                          onDragEnter={(): void => {
                            if (draggedItem?.type === 'book' && !isBookDragging) {
                              handleDragEnter(bIdx);
                            } else if (draggedItem?.type === 'chapter') {
                              handleDragEnter(0, book.id);
                            }
                          }}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                          onDragEnd={handleDragEnd}
                          onClick={(): void => toggleBook(book.id)}
                          aria-expanded={isExpanded}
                          aria-label={t('Toggle book {{title}}', { title: book.title })}
                        >
                          <div className="flex items-center space-x-2 font-bold text-sm pointer-events-none">
                            {isExpanded ? (
                              <FolderOpen size={16} />
                            ) : (
                              <Folder size={16} />
                            )}
                            <span>{book.title}</span>
                            <span className="text-xs opacity-50 font-normal">
                              ({bookChapters.length})
                            </span>
                          </div>
                        </button>
                        <div className="flex items-center">
                          <div className="flex items-center">
                            <button
                              onClick={(
                                e: React.MouseEvent<HTMLButtonElement, MouseEvent>
                              ): void => handleEditBookMetadata(e, book)}
                              className={`p-1 opacity-0 group-hover:opacity-100 hover:text-blue-500 ${textHeader}`}
                              title={t('Edit Book Metadata')}
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={(
                                e: React.MouseEvent<HTMLButtonElement, MouseEvent>
                              ): void => {
                                e.stopPropagation();
                                onCreate(book.id);
                              }}
                              className={`p-1 opacity-0 group-hover:opacity-100 ${btnHover}`}
                              title={t('Add Chapter to Book')}
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              onClick={async (
                                e: React.MouseEvent<HTMLButtonElement, MouseEvent>
                              ): Promise<void> => {
                                e.stopPropagation();
                                if (
                                  await confirm(t('Delete Book and all its chapters?'))
                                ) {
                                  onBookDelete?.(book.id);
                                }
                              }}
                              className="text-brand-gray-400 hover:text-red-500 p-1"
                              title={t('Delete Book')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="pl-6 mt-1.5 w-full">
                        <p
                          className={`text-xs line-clamp-2 pointer-events-none ${
                            isLight ? 'text-brand-gray-500' : 'text-brand-gray-500'
                          }`}
                        >
                          {book.summary || t('No summary available...')}
                        </p>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pl-3 space-y-2 border-l ml-3 border-brand-gray-700/30">
                        {bookChapters.map(renderChapter)}
                        <button
                          type="button"
                          aria-label={t('Add Chapter')}
                          className={`w-full text-left text-xs p-2 rounded flex items-center space-x-2 opacity-60 hover:opacity-100 ${titleInactive}`}
                          onClick={(): void => {
                            onCreate(book.id);
                          }}
                        >
                          <Plus size={14} /> <span>{t('Add Chapter')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* New Book UI */}
              <div className="mt-4 pt-4 border-t border-dashed border-gray-700/30">
                {isCreatingBook ? (
                  <div className="flex flex-col gap-2 p-2">
                    <input
                      className="bg-transparent border rounded p-1 text-sm outline-none focus:border-brand-500"
                      lang={language || undefined}
                      spellCheck={spellCheck}
                      placeholder={t('Book Title')}
                      value={newBookTitle}
                      onChange={(
                        e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
                      ): void => setNewBookTitle(e.target.value)}
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>): void => {
                        if (e.key === 'Enter') {
                          onBookCreate?.(newBookTitle);
                          setNewBookTitle('');
                          setIsCreatingBook(false);
                        }
                        if (e.key === 'Escape') setIsCreatingBook(false);
                      }}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        aria-label={t('Cancel create book')}
                        onClick={(): void => setIsCreatingBook(false)}
                        className="text-xs opacity-50"
                      >
                        {t('Cancel')}
                      </button>
                      <button
                        type="button"
                        aria-label={t('Create book')}
                        onClick={(): void => {
                          onBookCreate?.(newBookTitle);
                          setNewBookTitle('');
                          setIsCreatingBook(false);
                        }}
                        className="text-xs font-bold text-brand-500"
                      >
                        {t('Create')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={t('Start creating a new book')}
                    onClick={(): void => setIsCreatingBook(true)}
                    className={`w-full flex items-center justify-center gap-2 p-2 rounded border border-dashed text-sm opacity-60 hover:opacity-100 ${
                      isLight ? 'border-brand-gray-300' : 'border-brand-gray-700'
                    }`}
                  >
                    <BookIcon size={16} /> <span>{t('Add Book')}</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            // Non-series projects render as a flat chapter list.
            <>
              {displayChapters.map(renderChapter)}
              {displayChapters.length === 0 && (
                <div className="text-center py-10 text-brand-gray-500">
                  <FileText className="mx-auto mb-2 opacity-30" size={32} />
                  <p className="text-sm">{t('No chapters yet.')}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const ChapterList: React.FC<ChapterListProps> = React.memo(ChapterListInner);
/* eslint-enable complexity, max-lines-per-function */

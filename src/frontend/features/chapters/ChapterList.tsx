// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the chapter list unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Chapter, Book, AppTheme } from '../../types';
import { MetadataEditorDialog } from '../story/MetadataEditorDialog';
import { api } from '../../services/api';
import {
  Plus,
  Trash2,
  FileText,
  Folder,
  FolderOpen,
  Book as BookIcon,
  Edit,
} from 'lucide-react';

interface ChapterListProps {
  chapters: Chapter[];
  books?: Book[];
  projectType?: 'short-story' | 'novel' | 'series';
  currentChapterId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateChapter?: (id: string, updates: Partial<Chapter>) => void;
  onUpdateBook?: (id: string, updates: Partial<Book>) => void;
  onCreate: (bookId?: string) => void;
  onBookCreate?: (title: string) => void;
  onBookDelete?: (id: string) => void;
  onReorderChapters?: (chapterIds: number[], bookId?: string) => void;
  onReorderBooks?: (bookIds: string[]) => void;
  onAiAction?: (
    type: 'chapter' | 'book',
    id: string,
    action: 'write' | 'update' | 'rewrite',
    onProgress?: (text: string) => void
  ) => Promise<string | undefined>;
  theme?: AppTheme;
  onOpenImages?: () => void;
}

export const ChapterList: React.FC<ChapterListProps> = ({
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
  theme = 'mixed',
  onOpenImages,
}) => {
  const isLight = theme === 'light';
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});
  const [newBookTitle, setNewBookTitle] = useState('');
  const [isCreatingBook, setIsCreatingBook] = useState(false);

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
  useEffect(() => {
    setOptimisticChapters(null);
  }, [chapters]);

  useEffect(() => {
    setOptimisticBooks(null);
  }, [books]);

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
          const bookChapters = chapters.filter((c) => c.book_id === draggedItem.bookId);
          const reordered = moveInArray(
            bookChapters,
            draggedItem.originalIndex,
            dragOverIndex
          );
          displayChapters = chapters.map((c) => {
            if (c.book_id !== draggedItem.bookId) return c;
            const subIdx = bookChapters.findIndex((sc) => sc.id === c.id);
            return reordered[subIdx];
          });
        } else {
          // Cross-book preview keeps chapter context visible before persistence.
          const sourceChapters = chapters.filter(
            (c) => c.book_id === draggedItem.bookId
          );
          const targetChapters = chapters.filter((c) => c.book_id === targetBookId);

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
                (c) => c.book_id !== draggedItem.bookId && c.book_id !== targetBookId
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
  ) => {
    setDraggedItem({ type, id, bookId, originalIndex: index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (index: number, bookId?: string) => {
    if (dragOverIndex !== index || (bookId && dragOverBookId !== bookId)) {
      setDragOverIndex(index);
      if (bookId) setDragOverBookId(bookId);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
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
            (c) => c.book_id === targetBookId
          );
          const chapterIds = bookChaptersFinal.map((c) => parseInt(c.id));
          setOptimisticChapters(displayChapters);
          onReorderChapters(chapterIds, targetBookId);
        }
      } else {
        if (onReorderChapters) {
          const chapterIds = displayChapters.map((c) => parseInt(c.id));
          setOptimisticChapters(displayChapters);
          onReorderChapters(chapterIds);
        }
      }
    } else if (dragged.type === 'book') {
      if (onReorderBooks) {
        const bookIds = displayBooks.map((b) => b.id);
        setOptimisticBooks(displayBooks);
        onReorderBooks(bookIds);
      }
    }

    setDragOverIndex(null);
    setDragOverBookId(null);
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverIndex(null);
    setDragOverBookId(null);
  };

  const toggleBook = (id: string) => {
    setExpandedBooks((prev) => ({ ...prev, [id]: !prev[id] }));
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

  const activeEditingData = useMemo(() => {
    if (!editingMetadata) return null;
    if (editingMetadata.type === 'chapter') {
      return displayChapters.find((c) => c.id === editingMetadata.id);
    } else {
      return displayBooks.find((b) => b.id === editingMetadata.id);
    }
  }, [editingMetadata, displayChapters, displayBooks]);

  const handleEditChapterMetadata = (e: React.MouseEvent, chapter: Chapter) => {
    e.stopPropagation();
    setEditingMetadata({ type: 'chapter', id: chapter.id });
  };

  const handleEditBookMetadata = (e: React.MouseEvent, book: Book) => {
    e.stopPropagation();
    setEditingMetadata({ type: 'book', id: book.id });
  };

  const saveMetadata = async (data: {
    title?: string;
    summary?: string;
    notes?: string;
    private_notes?: string;
    conflicts?: Chapter['conflicts'];
  }) => {
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
          onUpdateChapter(editingMetadata.id, data);
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

  const renderChapter = (chapter: Chapter, index: number) => {
    const isDragging = draggedItem?.type === 'chapter' && draggedItem.id === chapter.id;

    return (
      <div
        key={chapter.id}
        draggable
        onDragStart={(e) =>
          handleDragStart(e, 'chapter', chapter.id, index, chapter.book_id)
        }
        onDragEnter={() => {
          if (draggedItem?.type === 'chapter' && !isDragging) {
            handleDragEnter(index, chapter.book_id);
          }
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        className={`group relative p-3 rounded-lg cursor-pointer transition-all duration-150 border ${
          currentChapterId === chapter.id ? itemActive : itemInactive
        } ${
          isDragging
            ? 'opacity-20 grayscale border-dashed border-brand-gray-500/50'
            : 'opacity-100'
        }`}
        onClick={() => onSelect(chapter.id)}
      >
        <div className="flex justify-between items-start pointer-events-none">
          <div className="flex items-center gap-2">
            <h3
              className={`font-medium text-sm mb-1 ${
                currentChapterId === chapter.id ? titleActive : titleInactive
              }`}
            >
              {chapter.title || 'Untitled Chapter'}
            </h3>
            {chapter.conflicts && chapter.conflicts.length > 0 && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[10px] font-bold">
                {chapter.conflicts.length}
              </span>
            )}
          </div>
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
            <button
              onClick={(e) => handleEditChapterMetadata(e, chapter)}
              className="p-1 text-brand-gray-400 hover:text-blue-500"
              title="Edit Metadata"
            >
              <Edit size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(chapter.id);
              }}
              className="p-1 text-brand-gray-400 hover:text-red-500"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <p className="text-xs text-brand-gray-500 line-clamp-2 pointer-events-none">
          {chapter.summary || 'No summary available...'}
        </p>
      </div>
    );
  };

  return (
    <div className={`flex flex-col flex-1 min-h-0 border-r relative ${bgClass}`}>
      {editingMetadata && activeEditingData && (
        <MetadataEditorDialog
          type={editingMetadata.type}
          title={`Edit ${
            editingMetadata.type === 'chapter' ? 'Chapter' : 'Book'
          }: ${activeEditingData.title}`}
          initialData={activeEditingData}
          onSave={saveMetadata}
          onClose={() => setEditingMetadata(null)}
          theme={theme}
          onAiGenerate={
            onAiAction && editingMetadata
              ? (action, onProgress) =>
                  onAiAction(
                    editingMetadata.type,
                    editingMetadata.id,
                    action,
                    onProgress
                  )
              : undefined
          }
        />
      )}
      <div
        className={`p-4 border-b flex justify-between items-center sticky top-0 z-10 ${bgClass} ${
          isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
        }`}
      >
        <h2 className={`text-sm font-semibold uppercase tracking-wider ${textHeader}`}>
          {projectType === 'series' ? 'Books & Chapters' : 'Chapters'}
        </h2>
        {projectType === 'novel' && (
          <button
            onClick={() => onCreate()}
            className={`p-1 rounded-full transition-colors ${btnHover}`}
            title="New Chapter"
          >
            <Plus size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {projectType === 'series' ? (
          <div className="space-y-4">
            {displayBooks.map((book, bIdx) => {
              const bookChapters = displayChapters.filter((c) => c.book_id === book.id);
              const isExpanded = expandedBooks[book.id] ?? true;
              const isBookDragging =
                draggedItem?.type === 'book' && draggedItem.id === book.id;

              return (
                <div key={book.id} className="space-y-1">
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, 'book', book.id, bIdx)}
                    onDragEnter={() => {
                      if (draggedItem?.type === 'book' && !isBookDragging) {
                        handleDragEnter(bIdx);
                      } else if (draggedItem?.type === 'chapter') {
                        handleDragEnter(0, book.id);
                      }
                    }}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    className={`flex flex-col p-2 rounded cursor-pointer transition-all duration-150 group ${
                      isLight
                        ? 'hover:bg-brand-gray-200/50'
                        : 'hover:bg-brand-gray-800/50'
                    } ${
                      isBookDragging
                        ? 'opacity-20 grayscale border-dashed border-brand-gray-500/50'
                        : 'opacity-100'
                    }`}
                    onClick={() => toggleBook(book.id)}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center space-x-2 font-bold text-sm pointer-events-none">
                        {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                        <span>{book.title}</span>
                        <span className="text-xs opacity-50 font-normal">
                          ({bookChapters.length})
                        </span>
                      </div>
                      <div className="flex items-center pointer-events-auto">
                        <button
                          onClick={(e) => handleEditBookMetadata(e, book)}
                          className={`p-1 opacity-0 group-hover:opacity-100 hover:text-blue-500 ${textHeader}`}
                          title="Edit Book Metadata"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onCreate(book.id);
                          }}
                          className={`p-1 opacity-0 hover:opacity-100 ${btnHover}`}
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('Delete Book and all its chapters?')) {
                              onBookDelete?.(book.id);
                            }
                          }}
                          className="text-brand-gray-400 hover:text-red-500 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="pl-6 mt-1.5 w-full">
                      <p
                        className={`text-xs line-clamp-2 pointer-events-none ${
                          isLight ? 'text-brand-gray-500' : 'text-brand-gray-500'
                        }`}
                      >
                        {book.summary || 'No summary available...'}
                      </p>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="pl-3 space-y-2 border-l ml-3 border-brand-gray-700/30">
                      {bookChapters.map(renderChapter)}
                      <button
                        className={`w-full text-left text-xs p-2 rounded flex items-center space-x-2 opacity-60 hover:opacity-100 ${titleInactive}`}
                        onClick={() => {
                          onCreate(book.id);
                        }}
                      >
                        <Plus size={14} /> <span>Add Chapter</span>
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
                    autoFocus
                    className="bg-transparent border rounded p-1 text-sm outline-none focus:border-brand-500"
                    placeholder="Book Title"
                    value={newBookTitle}
                    onChange={(e) => setNewBookTitle(e.target.value)}
                    onKeyDown={(e) => {
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
                      onClick={() => setIsCreatingBook(false)}
                      className="text-xs opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        onBookCreate?.(newBookTitle);
                        setNewBookTitle('');
                        setIsCreatingBook(false);
                      }}
                      className="text-xs font-bold text-brand-500"
                    >
                      Create
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreatingBook(true)}
                  className={`w-full flex items-center justify-center gap-2 p-2 rounded border border-dashed text-sm opacity-60 hover:opacity-100 ${
                    isLight ? 'border-brand-gray-300' : 'border-brand-gray-700'
                  }`}
                >
                  <BookIcon size={16} /> <span>Add Book</span>
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
                <p className="text-sm">No chapters yet.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

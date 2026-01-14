// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import React, { useState } from 'react';
import { Chapter, Book, AppTheme } from '../types';
import {
  Plus,
  Trash2,
  FileText,
  Folder,
  FolderOpen,
  Book as BookIcon,
} from 'lucide-react';

interface ChapterListProps {
  chapters: Chapter[];
  books?: Book[];
  projectType?: 'small' | 'medium' | 'large';
  currentChapterId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: (bookId?: string) => void;
  onBookCreate?: (title: string) => void;
  onBookDelete?: (id: string) => void;
  theme?: AppTheme;
  onOpenImages?: () => void;
}

export const ChapterList: React.FC<ChapterListProps> = ({
  chapters,
  books = [],
  projectType = 'medium',
  currentChapterId,
  onSelect,
  onDelete,
  onCreate,
  onBookCreate,
  onBookDelete,
  theme = 'mixed',
  onOpenImages,
}) => {
  const isLight = theme === 'light';
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});
  const [newBookTitle, setNewBookTitle] = useState('');
  const [isCreatingBook, setIsCreatingBook] = useState(false);

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

  const renderChapter = (chapter: Chapter) => (
    <div
      key={chapter.id}
      className={`group relative p-3 rounded-lg cursor-pointer transition border ${
        currentChapterId === chapter.id ? itemActive : itemInactive
      }`}
      onClick={() => onSelect(chapter.id)}
    >
      <div className="flex justify-between items-start">
        <h3
          className={`font-medium text-sm mb-1 ${
            currentChapterId === chapter.id ? titleActive : titleInactive
          }`}
        >
          {chapter.title || 'Untitled Chapter'}
        </h3>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
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
      <p className="text-xs text-brand-gray-500 line-clamp-2">
        {chapter.summary || 'No summary available...'}
      </p>
    </div>
  );

  return (
    <div className={`flex flex-col flex-1 min-h-0 border-r ${bgClass}`}>
      <div
        className={`p-4 border-b flex justify-between items-center sticky top-0 z-10 ${bgClass} ${
          isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
        }`}
      >
        <h2 className={`text-sm font-semibold uppercase tracking-wider ${textHeader}`}>
          {projectType === 'large' ? 'Books & Chapters' : 'Chapters'}
        </h2>
        {projectType === 'medium' && (
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
        {projectType === 'large' ? (
          <div className="space-y-4">
            {books.map((book) => {
              const bookChapters = chapters.filter((c) => c.book_id === book.id);
              const isExpanded = expandedBooks[book.id] ?? true;

              return (
                <div key={book.id} className="space-y-1">
                  <div
                    className={`flex items-center justify-between p-2 rounded cursor-pointer ${
                      isLight
                        ? 'hover:bg-brand-gray-200/50'
                        : 'hover:bg-brand-gray-800/50'
                    }`}
                    onClick={() => toggleBook(book.id)}
                  >
                    <div className="flex items-center space-x-2 font-bold text-sm">
                      {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                      <span>{book.title}</span>
                      <span className="text-xs opacity-50 font-normal">
                        ({bookChapters.length})
                      </span>
                    </div>
                    <div className="flex items-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // Create chapter in this book specifically?
                          // Backend `create_project` -> `create_new_chapter` supports `book_id`.
                          // We need to pass book_id to onCreate if supported.
                          // Temporarily just onCreate() which defaults to last book.
                          // We should probably expose book specific create.
                          // For now, let's just allow global create or fail gracefully.
                          // Wait, onCreate prop is generic.
                          // User can move chapters later? No UI for that yet.
                          // Ideally we pass book context.
                        }}
                        className={`p-1 opacity-0 hover:opacity-100 ${btnHover}`}
                      >
                        {/* Placeholder for specific add */}
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
          // Medium / Default View
          <>
            {chapters.map(renderChapter)}
            {chapters.length === 0 && (
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

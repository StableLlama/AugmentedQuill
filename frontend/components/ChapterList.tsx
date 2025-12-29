import React from 'react';
import { Chapter, AppTheme } from '../types';
import { Plus, Trash2, FileText } from 'lucide-react';

interface ChapterListProps {
  chapters: Chapter[];
  currentChapterId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  theme?: AppTheme;
}

export const ChapterList: React.FC<ChapterListProps> = ({
  chapters,
  currentChapterId,
  onSelect,
  onDelete,
  onCreate,
  theme = 'mixed',
}) => {
  const isLight = theme === 'light';

  const bgClass = isLight
    ? 'bg-stone-50 border-stone-200'
    : 'bg-stone-900 border-stone-800';
  const textHeader = isLight ? 'text-stone-500' : 'text-stone-400';
  const btnHover = isLight
    ? 'hover:bg-stone-200 text-stone-500 hover:text-stone-700'
    : 'hover:bg-stone-800 text-stone-500 hover:text-stone-300';

  const itemActive = isLight
    ? 'bg-white border-amber-400 shadow-sm'
    : 'bg-stone-800 border-amber-500/50 shadow-sm';
  const itemInactive = isLight
    ? 'bg-transparent border-transparent hover:bg-stone-100'
    : 'bg-transparent border-transparent hover:bg-stone-800';
  const titleActive = isLight ? 'text-amber-700' : 'text-amber-400';
  const titleInactive = isLight ? 'text-stone-700' : 'text-stone-300';

  return (
    <div className={`flex flex-col h-full border-r ${bgClass}`}>
      <div
        className={`p-4 border-b flex justify-between items-center sticky top-0 z-10 ${bgClass} ${
          isLight ? 'border-stone-200' : 'border-stone-800'
        }`}
      >
        <h2 className={`text-sm font-semibold uppercase tracking-wider ${textHeader}`}>
          Chapters
        </h2>
        <button
          onClick={onCreate}
          className={`p-1 rounded-full transition-colors ${btnHover}`}
          title="New Chapter"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {chapters.map((chapter) => (
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(chapter.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-500 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <p className="text-xs text-stone-500 line-clamp-2">
              {chapter.summary || 'No summary available...'}
            </p>
          </div>
        ))}

        {chapters.length === 0 && (
          <div className="text-center py-10 text-stone-500">
            <FileText className="mx-auto mb-2 opacity-30" size={32} />
            <p className="text-sm">No chapters yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

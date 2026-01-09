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

  return (
    <div className={`flex flex-col flex-1 min-h-0 border-r ${bgClass}`}>
      <div
        className={`p-4 border-b flex justify-between items-center sticky top-0 z-10 ${bgClass} ${
          isLight ? 'border-brand-gray-200' : 'border-brand-gray-800'
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
                className="opacity-0 group-hover:opacity-100 p-1 text-brand-gray-400 hover:text-red-500 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <p className="text-xs text-brand-gray-500 line-clamp-2">
              {chapter.summary || 'No summary available...'}
            </p>
          </div>
        ))}

        {chapters.length === 0 && (
          <div className="text-center py-10 text-brand-gray-500">
            <FileText className="mx-auto mb-2 opacity-30" size={32} />
            <p className="text-sm">No chapters yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

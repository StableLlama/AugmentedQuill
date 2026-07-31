// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Hover preview tooltip for sourcebook entries, rendered via a
 * React portal so it escapes overflow-hidden containers.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SourcebookEntry } from '../../types';
import { ProjectImage } from '../../services/apiTypes';

interface SourcebookHoverCardProps {
  entry: SourcebookEntry;
  position: { x: number; y: number };
  topRightMeta?: string | null;
  bgClass: string;
  borderClass: string;
  textClass: string;
  subTextClass: string;
  availableImages: ProjectImage[];
}

export const SourcebookHoverCard: React.FC<SourcebookHoverCardProps> = ({
  entry,
  position,
  topRightMeta = null,
  bgClass,
  borderClass,
  textClass,
  subTextClass,
  availableImages,
}: SourcebookHoverCardProps): React.ReactPortal => {
  const { t } = useTranslation();
  const getEntryImage = (): ProjectImage | null => {
    if (!entry.images || entry.images.length === 0) return null;
    const firstImgName = entry.images[0];
    return (
      availableImages.find(
        (image: ProjectImage): boolean => image.filename === firstImgName
      ) ?? null
    );
  };

  const img = getEntryImage();

  return createPortal(
    <div
      style={{
        top: position.y,
        left: position.x,
        maxWidth: '300px',
      }}
      className={`fixed z-[100] p-3 rounded-lg shadow-xl border ${borderClass} ${bgClass} animate-in fade-in zoom-in-95 duration-100`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className={`font-bold text-sm truncate ${textClass}`}>{entry.name}</h4>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${borderClass} ${subTextClass}`}
          >
            {entry.category}
          </span>
        </div>
        {topRightMeta && (
          <span className={`text-[10px] shrink-0 ${subTextClass}`}>{topRightMeta}</span>
        )}
      </div>

      {img && (
        <div className="mb-2 rounded overflow-hidden border border-brand-500/20 bg-black/5 aspect-video flex items-center justify-center">
          {img.is_placeholder || !img.url ? (
            <div className="text-gray-400 flex flex-col items-center">
              <ImageIcon size={24} />
            </div>
          ) : (
            <img
              src={img.url}
              alt={img.filename}
              className="w-full h-full object-cover"
            />
          )}
        </div>
      )}

      {entry.description ? (
        <p className={`text-xs ${subTextClass} line-clamp-6 leading-relaxed`}>
          {entry.description}
        </p>
      ) : (
        <p className={`text-xs italic ${subTextClass}`}>
          {t('No description provided.')}
        </p>
      )}
    </div>,
    document.body
  );
};

// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Search,
  BookOpen,
  Book,
  User,
  MapPin,
  Users,
  Package,
  Calendar,
  HelpCircle,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from './Button';
import { SourcebookEntryDialog } from './SourcebookEntryDialog';
import { api } from '../services/api';
import { AppTheme } from '../types';

const CATEGORY_DETAILS: Record<string, { icon: React.ElementType }> = {
  Character: { icon: User },
  Location: { icon: MapPin },
  Organization: { icon: Users },
  Item: { icon: Package },
  Event: { icon: Calendar },
  Lore: { icon: BookOpen },
  Other: { icon: HelpCircle },
};

interface SourcebookListProps {
  theme?: AppTheme;
}

export const SourcebookList: React.FC<SourcebookListProps> = ({ theme = 'mixed' }) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Tooltip state
  const [hoveredEntry, setHoveredEntry] = useState<any>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const isLight = theme === 'light';

  const loadEntries = async () => {
    try {
      const data = await api.sourcebook.list();
      setEntries(data);
    } catch (e) {
      console.error('Failed to load sourcebook', e);
    }
  };

  useEffect(() => {
    loadEntries();
    const interval = setInterval(loadEntries, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async (entry: any) => {
    await api.sourcebook.create(entry);
    loadEntries();
  };

  const handleUpdate = async (entry: any) => {
    await api.sourcebook.update(entry.id, entry);
    loadEntries();
  };

  const handleDelete = async (id: string) => {
    await api.sourcebook.delete(id);
    loadEntries();
  };

  const handleMouseEnter = (e: React.MouseEvent, entry: any) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.right + 10;
    // Ensure it doesn't go off bottom
    const y = Math.min(rect.top, window.innerHeight - 200);
    setTooltipPos({ x, y });
    setHoveredEntry(entry);
  };

  const filtered = entries.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.category && e.category.toLowerCase().includes(search.toLowerCase())) ||
      (e.synonyms &&
        e.synonyms.some((s: string) => s.toLowerCase().includes(search.toLowerCase())))
  );

  const borderClass = isLight ? 'border-brand-gray-200' : 'border-brand-gray-800';
  const textHeaderClass = isLight ? 'text-brand-gray-500' : 'text-brand-gray-400';
  const textClass = isLight ? 'text-brand-gray-900' : 'text-brand-gray-200';
  const subTextClass = isLight ? 'text-brand-gray-500' : 'text-brand-gray-400';
  const itemHoverClass = isLight
    ? 'hover:bg-brand-gray-100'
    : 'hover:bg-brand-gray-800';
  const inputBg = isLight ? 'bg-white' : 'bg-brand-gray-950/50';
  const inputBorder = isLight ? 'border-brand-gray-200' : 'border-brand-gray-800';
  const inputPlace = 'placeholder-brand-gray-500';

  // Resolve available images for tooltip
  const [availableImages, setAvailableImages] = useState<any[]>([]);
  useEffect(() => {
    if (hoveredEntry && hoveredEntry.images?.length > 0) {
      api.projects.listImages().then((data) => {
        setAvailableImages(data.images || []);
      });
    }
  }, [hoveredEntry]);

  const getEntryImage = (entry: any) => {
    if (!entry.images || entry.images.length === 0) return null;
    // Get first image
    const firstImgName = entry.images[0];
    const imgData = availableImages.find((i: any) => i.filename === firstImgName);
    return imgData;
  };

  return (
    <div
      className={`flex flex-col border-t ${borderClass} mt-0 flex-1 min-h-[200px] bg-opacity-50`}
    >
      {/* Title Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-transparent">
        {/* MATCHING HEADER STYLE FROM CHAPTER LIST */}
        <h3
          className={`text-sm font-semibold uppercase tracking-wider ${textHeaderClass} flex items-center gap-2`}
        >
          SOURCEBOOK
        </h3>
        <Button
          variant="ghost"
          size="sm"
          theme={theme}
          className="h-6 w-6 p-0"
          onClick={() => {
            setSelectedEntry(null);
            setIsDialogOpen(true);
          }}
          title="Add Entry"
        >
          <Plus size={14} />
        </Button>
      </div>

      {/* Search Bar */}
      <div className="px-3 mb-2 pt-2">
        <div className="relative">
          <Search size={12} className={`absolute left-2.5 top-2 ${subTextClass}`} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter entries..."
            className={`w-full pl-8 pr-2 py-1.5 text-xs rounded border ${inputBorder} ${inputBg} ${textClass} ${inputPlace} focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors`}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {filtered.length === 0 && (
          <div className={`text-center py-4 text-xs ${subTextClass}`}>
            {entries.length === 0 ? 'No entries yet.' : 'No matches.'}
          </div>
        )}

        <div className="space-y-0.5">
          {filtered.map((e) => {
            const CategoryIcon = CATEGORY_DETAILS[e.category]?.icon || HelpCircle;
            return (
              <div
                key={e.id}
                onClick={() => {
                  setSelectedEntry(e);
                  setIsDialogOpen(true);
                }}
                onMouseEnter={(evt) => handleMouseEnter(evt, e)}
                onMouseLeave={() => setHoveredEntry(null)}
                className={`group px-3 py-2 rounded-md cursor-pointer transition-colors ${itemHoverClass} flex items-center gap-2 select-none`}
              >
                <CategoryIcon
                  size={14}
                  className={`flex-shrink-0 ${subTextClass} group-hover:text-brand-500 transition-colors`}
                />
                <div className={`text-sm truncate ${textClass}`}>{e.name}</div>
              </div>
            );
          })}
        </div>
      </div>

      <SourcebookEntryDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        entry={selectedEntry}
        onSave={selectedEntry ? handleUpdate : handleCreate}
        onDelete={selectedEntry ? handleDelete : undefined}
        theme={theme}
      />

      {/* Portal Tooltip */}
      {hoveredEntry &&
        createPortal(
          <div
            style={{
              top: tooltipPos.y,
              left: tooltipPos.x,
              maxWidth: '300px',
            }}
            className={`fixed z-[100] p-3 rounded-lg shadow-xl border ${borderClass} ${isLight ? 'bg-white' : 'bg-brand-gray-900'} animate-in fade-in zoom-in-95 duration-100`}
          >
            <div className="flex items-center gap-2 mb-2">
              <h4 className={`font-bold text-sm ${textClass}`}>{hoveredEntry.name}</h4>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full border ${borderClass} ${subTextClass}`}
              >
                {hoveredEntry.category}
              </span>
            </div>

            {/* Image Preview if exists */}
            {(() => {
              const img = getEntryImage(hoveredEntry);
              if (img) {
                return (
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
                );
              }
              return null;
            })()}

            {hoveredEntry.description ? (
              <p
                className={`text-xs ${isLight ? 'text-brand-gray-700' : 'text-brand-gray-300'} line-clamp-6 leading-relaxed`}
              >
                {hoveredEntry.description}
              </p>
            ) : (
              <p className={`text-xs italic ${subTextClass}`}>
                No description provided.
              </p>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

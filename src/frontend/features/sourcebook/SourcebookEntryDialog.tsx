// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the sourcebook entry dialog unit so this responsibility stays isolated, testable, and easy to evolve.

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Plus,
  Trash2,
  Save,
  Book,
  Tag,
  Type,
  Image as ImageIcon,
  User,
  MapPin,
  Users,
  Package,
  Calendar,
  BookOpen,
  HelpCircle,
  ImagePlus,
  Check,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { api } from '../../services/api';
import { AppTheme, SourcebookEntry } from '../../types';
import { ProjectImage, SourcebookUpsertPayload } from '../../services/apiTypes';

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
};

interface SourcebookEntryDialogProps {
  entry?: SourcebookEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: SourcebookUpsertPayload) => void;
  onDelete?: (id: string) => void;
  theme?: AppTheme;
}

export const SourcebookEntryDialog: React.FC<SourcebookEntryDialogProps> = ({
  entry,
  isOpen,
  onClose,
  onSave,
  onDelete,
  theme = 'mixed',
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(Object.keys(CATEGORY_DETAILS)[0]);
  const [synonyms, setSynonyms] = useState<string[]>([]);
  const [newSynonym, setNewSynonym] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [availableImages, setAvailableImages] = useState<ProjectImage[]>([]);

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);

  const isLight = theme === 'light';

  useEffect(() => {
    if (isOpen) {
      api.projects
        .listImages()
        .then((data) => {
          setAvailableImages(data.images || []);
        })
        .catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (entry) {
      setName(entry.name || '');
      setDescription(entry.description || '');
      setCategory(entry.category || Object.keys(CATEGORY_DETAILS)[0]);
      setSynonyms(entry.synonyms || []);
      setImages(entry.images || []);
    } else {
      setName('');
      setDescription('');
      setCategory(Object.keys(CATEGORY_DETAILS)[0]);
      setSynonyms([]);
      setImages([]);
    }
  }, [entry, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
      ...entry,
      name,
      description,
      category,
      synonyms,
      images,
    });
    onClose();
  };

  const addSynonym = () => {
    if (newSynonym.trim()) {
      setSynonyms([...synonyms, newSynonym.trim()]);
      setNewSynonym('');
    }
  };

  const removeSynonym = (idx: number) => {
    setSynonyms(synonyms.filter((_, i) => i !== idx));
  };

  const toggleImage = (filename: string) => {
    if (images.includes(filename)) {
      setImages(images.filter((i) => i !== filename));
    } else {
      setImages([...images, filename]);
    }
  };

  const bgClass = isLight ? 'bg-white' : 'bg-brand-gray-900';
  const textClass = isLight ? 'text-brand-gray-900' : 'text-brand-gray-100';
  const borderClass = isLight ? 'border-brand-gray-200' : 'border-brand-gray-800';
  const inputBgClass = isLight ? 'bg-white' : 'bg-brand-gray-950/50';
  const inputBorderClass = isLight ? 'border-brand-gray-200' : 'border-brand-gray-800';
  const labelClass = isLight ? 'text-brand-gray-600' : 'text-brand-gray-400';

  // Keep picker rendering derived from canonical selection state.
  const selectedImagesList = availableImages.filter((img) =>
    images.includes(img.filename)
  );

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div
          className={`${bgClass} ${textClass} w-full max-w-2xl rounded-lg shadow-2xl border ${borderClass} flex flex-col max-h-[90vh]`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between px-6 py-4 border-b ${borderClass}`}
          >
            <div className="flex items-center gap-2">
              <Book
                size={20}
                className={isLight ? 'text-brand-700' : 'text-brand-400'}
              />
              <h2 className="text-lg font-bold">
                {entry ? 'Edit Entry' : 'New Sourcebook Entry'}
              </h2>
            </div>
            <button
              onClick={onClose}
              className={`p-1 rounded-md transition-colors ${
                isLight
                  ? 'hover:bg-brand-gray-100 text-brand-gray-500'
                  : 'hover:bg-brand-gray-800 text-brand-gray-400'
              }`}
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Top Row: Name and Category */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
                >
                  Name
                </label>
                <div className="relative">
                  <Type
                    size={16}
                    className={`absolute left-3 top-3 ${isLight ? 'text-brand-gray-400' : 'text-brand-gray-600'}`}
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`w-full pl-10 pr-3 py-2 text-sm rounded-md border ${inputBorderClass} ${inputBgClass} focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors`}
                    placeholder="E.g. Captain Ahab"
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
                >
                  Category
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {Object.entries(CATEGORY_DETAILS).map(([cat, details]) => {
                    const Icon = details.icon;
                    const isSelected = category === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setCategory(cat)}
                        title={details.description}
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
                  })}
                </div>
                <p
                  className={`text-xs mt-1 min-h-[1.5em] ${isLight ? 'text-brand-700' : 'text-brand-300'}`}
                >
                  {CATEGORY_DETAILS[category]?.description}
                </p>
              </div>
            </div>

            {/* Middle Row: Synonyms */}
            <div className="space-y-2">
              <label
                className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
              >
                Synonyms & Nicknames
              </label>
              <div
                className={`p-3 rounded-md border ${inputBorderClass} ${inputBgClass} min-h-[60px]`}
              >
                <div className="flex flex-wrap gap-2 mb-2">
                  {synonyms.map((syn, idx) => (
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
                        onClick={() => removeSynonym(idx)}
                        className={'hover:text-red-500 transition-colors'}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <div className="flex-1 min-w-[120px] flex items-center">
                    <input
                      type="text"
                      value={newSynonym}
                      onChange={(e) => setNewSynonym(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addSynonym()}
                      className="bg-transparent text-sm focus:outline-none w-full"
                      placeholder="Add (+)"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Images Section */}
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <label
                  className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
                >
                  Associated Images
                </label>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setIsImagePickerOpen(true)}
                    variant="ghost"
                    size="sm"
                    theme={theme}
                    icon={<ImagePlus size={14} />}
                  >
                    Manage Images
                  </Button>
                </div>
              </div>

              <div
                className={`p-3 rounded-md border min-h-[100px] ${inputBorderClass} ${inputBgClass}`}
              >
                {selectedImagesList.length === 0 ? (
                  <div className="h-20 flex flex-col items-center justify-center text-gray-500 text-xs">
                    <ImageIcon size={20} className="mb-1 opacity-50" />
                    <span>No images associated</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                    {selectedImagesList.map((img) => {
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
                              src={img.url}
                              alt={img.filename}
                              className="w-full h-full object-cover"
                            />
                          )}
                          <button
                            onClick={() => toggleImage(img.filename)}
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
            </div>

            {/* Description */}
            <div className="space-y-2 flex-1 flex flex-col">
              <label
                className={`text-xs font-semibold uppercase tracking-wider ${labelClass}`}
              >
                Description & Facts
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`w-full flex-1 p-4 text-sm font-mono rounded-md border ${inputBorderClass} ${inputBgClass} focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors min-h-[150px] resize-y`}
                placeholder="Detailed description, personality traits, history..."
              />
            </div>
          </div>

          {/* Footer */}
          <div
            className={`flex justify-between items-center px-6 py-4 border-t ${borderClass} bg-opacity-50 ${isLight ? 'bg-brand-gray-50' : 'bg-black/20'}`}
          >
            <div>
              {entry && onDelete && (
                <Button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this entry?')) {
                      onDelete(entry.id);
                      onClose();
                    }
                  }}
                  variant="danger"
                  size="sm"
                  theme={theme}
                  icon={<Trash2 size={16} />}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button onClick={onClose} variant="ghost" theme={theme}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                theme={theme}
                disabled={!name.trim()}
                icon={<Save size={16} />}
              >
                Save Entry
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Image Picker Modal */}
      {isImagePickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div
            className={`${bgClass} ${textClass} w-full max-w-4xl rounded-lg shadow-2xl border ${borderClass} flex flex-col max-h-[85vh]`}
          >
            <div
              className={`flex items-center justify-between px-6 py-4 border-b ${borderClass}`}
            >
              <div className="flex items-center gap-2">
                <ImagePlus size={20} className="text-brand-500" />
                <h3 className="text-lg font-bold">Select Images</h3>
              </div>
              <button onClick={() => setIsImagePickerOpen(false)}>
                <X size={20} className="text-gray-500 hover:text-gray-300" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {availableImages.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                  No images found in project.
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                  {availableImages.map((img) => {
                    const isSelected = images.includes(img.filename);
                    const tooltip = `${img.title || img.filename}\n${img.description || ''}`;
                    return (
                      <div
                        key={img.filename}
                        onClick={() => toggleImage(img.filename)}
                        title={tooltip}
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
                            src={img.url}
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
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              className={`px-6 py-4 border-t ${borderClass} flex justify-between items-center`}
            >
              <span className="text-sm opacity-70">
                {images.length} images selected
              </span>
              <Button
                onClick={() => setIsImagePickerOpen(false)}
                theme={theme}
                icon={<Check size={16} />}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};

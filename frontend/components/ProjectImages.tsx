// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import React, { useState, useEffect, useRef } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Wand2,
  Save,
  X,
  FileImage,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { api } from '../services/api';
import { generateSimpleContent } from '../services/openaiService';
import { AppTheme, AppSettings } from '../types';
import { Button } from './Button';

interface ImageEntry {
  filename: string;
  url: string | null;
  description: string;
  is_placeholder: boolean;
}

interface ProjectImagesProps {
  isOpen: boolean;
  onClose: () => void;
  theme: AppTheme;
  settings: AppSettings;
  prompts?: {
    system_messages: Record<string, string>;
    user_prompts: Record<string, string>;
  };
}

export const ProjectImages: React.FC<ProjectImagesProps> = ({
  isOpen,
  onClose,
  theme = 'mixed',
  settings,
  prompts,
}) => {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLight = theme === 'light';
  const bgClass = isLight ? 'bg-white' : 'bg-brand-gray-900';
  const textClass = isLight ? 'text-brand-gray-900' : 'text-brand-gray-100';
  const borderClass = isLight ? 'border-brand-gray-200' : 'border-brand-gray-700';
  const cardBg = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-800';

  useEffect(() => {
    if (isOpen) {
      loadImages();
    }
  }, [isOpen]);

  const loadImages = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.projects.listImages();
      setImages(res.images || []);
      setEdits({});
    } catch (err: any) {
      setError(err.message || 'Failed to load images');
    } finally {
      setLoading(false);
    }
  };

  const handleDescriptionChange = (filename: string, val: string) => {
    setEdits((prev) => ({ ...prev, [filename]: val }));
  };

  const handleSaveDescription = async (filename: string) => {
    const newDesc = edits[filename];
    if (newDesc === undefined) return;

    try {
      await api.projects.updateImageDescription(filename, newDesc);
      // Update local state
      setImages((prev) =>
        prev.map((img) =>
          img.filename === filename ? { ...img, description: newDesc } : img
        )
      );
      setEdits((prev) => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
    } catch (err: any) {
      setError('Failed to save description: ' + err.message);
    }
  };

  const handleGenerateDescription = async (img: ImageEntry) => {
    if (generating) return;
    setGenerating(img.filename);
    setError(null);
    try {
      const activeProvider = settings.providers.find(
        (p) => p.id === settings.activeChatProviderId
      );
      if (!activeProvider) throw new Error('No active chat provider configured');

      const promptTemplate = prompts?.user_prompts?.image_describer_prompt || '';
      const system = prompts?.system_messages?.image_describer || '';

      if (!promptTemplate || !system) {
        throw new Error('Prompts not loaded');
      }

      const prompt = promptTemplate.replace(/{filename}/g, img.filename);

      const result = await generateSimpleContent(
        prompt,
        system,
        activeProvider,
        'CHAT'
      );

      if (result) {
        handleDescriptionChange(img.filename, result);
        // Optionally auto-save? Let's just update the edit field so user can review.
      }
    } catch (err: any) {
      setError('Generation failed: ' + err.message);
    } finally {
      setGenerating(null);
    }
  };

  const handleUploadClick = (targetName?: string) => {
    setReplaceTarget(targetName || null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // If replacing, pass targetName.
      // Note: targetName ensures we overwrite the specific file entry.
      await api.projects.uploadImage(file, replaceTarget || undefined);
      await loadImages();
    } catch (err: any) {
      setError('Upload failed: ' + err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className={`w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg shadow-xl ${bgClass} ${textClass} border ${borderClass}`}
      >
        <div
          className={`flex items-center justify-between p-4 border-b ${borderClass}`}
        >
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ImageIcon className="w-5 h-5" />
            Project Images
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-black/10 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-200 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end mb-4">
            <Button
              variant="primary"
              onClick={() => handleUploadClick()}
              icon={<Upload className="w-4 h-4" />}
            >
              Upload New Image
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 animate-spin text-brand-blue-500" />
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-10 opacity-50">
              No images in this project.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {images.map((img) => (
                <div
                  key={img.filename}
                  className={`rounded-lg p-3 border ${borderClass} ${cardBg} flex flex-col gap-3`}
                >
                  <div className="relative aspect-video bg-black/5 rounded overflow-hidden flex items-center justify-center group">
                    {img.is_placeholder || !img.url ? (
                      <div className="text-center p-4">
                        <FileImage className="w-12 h-12 mx-auto mb-2 opacity-30" />
                        <span className="text-xs opacity-50 uppercase tracking-widest">
                          Placeholder
                        </span>
                        <div className="text-sm font-medium mt-1">{img.filename}</div>
                      </div>
                    ) : (
                      <img
                        src={img.url}
                        alt={img.filename}
                        className="w-full h-full object-contain"
                      />
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleUploadClick(img.filename)}
                        icon={<RefreshCw className="w-3 h-3" />}
                      >
                        Replace
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs opacity-70">
                      <span
                        className="font-mono truncate max-w-[200px]"
                        title={img.filename}
                      >
                        {img.filename}
                      </span>
                      {generating === img.filename && (
                        <span className="text-brand-blue-500 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Generating...
                        </span>
                      )}
                    </div>
                    <textarea
                      className={`w-full text-sm p-2 rounded border ${borderClass} bg-transparent resize-y min-h-[80px] focus:ring-1 ring-brand-blue-500 outline-none`}
                      placeholder="Image description..."
                      value={
                        edits[img.filename] !== undefined
                          ? edits[img.filename]
                          : img.description
                      }
                      onChange={(e) =>
                        handleDescriptionChange(img.filename, e.target.value)
                      }
                      disabled={generating === img.filename}
                    />
                    <div className="flex justify-between items-center">
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-brand-purple-500 hover:text-brand-purple-600"
                        onClick={() => handleGenerateDescription(img)}
                        disabled={!!generating}
                        icon={<Wand2 className="w-3 h-3" />}
                      >
                        Generate
                      </Button>

                      {edits[img.filename] !== undefined &&
                        edits[img.filename] !== img.description && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleSaveDescription(img.filename)}
                            icon={<Save className="w-3 h-3" />}
                          >
                            Save
                          </Button>
                        )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/png, image/jpeg, image/gif, image/webp"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
};

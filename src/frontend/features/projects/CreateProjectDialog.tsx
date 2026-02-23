// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the create project dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { AppTheme } from '../../types';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, type: string) => void;
  theme: AppTheme;
}

export const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  isOpen,
  onClose,
  onCreate,
  theme,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('novel');

  if (!isOpen) return null;

  const isLight = theme === 'light';
  const bgClass = isLight
    ? 'bg-white text-gray-900'
    : 'bg-brand-gray-900 text-gray-100 border border-brand-gray-800';
  const inputClass = isLight
    ? 'bg-white border-gray-300'
    : 'bg-brand-gray-800 border-brand-gray-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-md p-6 rounded-lg shadow-xl ${bgClass}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Create New Project</h2>
          <Button variant="ghost" size="sm" onClick={onClose} theme={theme}>
            <X size={20} />
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Project Name</label>
            <input
              type="text"
              className={`w-full p-2 rounded border focus:ring-2 focus:ring-brand-500 outline-none ${inputClass}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Story"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Project Type</label>
            <div
              className={`space-y-3 p-3 rounded border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-brand-gray-800 bg-brand-gray-950/50'}`}
            >
              <label className="flex items-start space-x-3 cursor-pointer p-1">
                <input
                  type="radio"
                  name="ptype"
                  value="short-story"
                  checked={type === 'short-story'}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <span
                    className="block font-bold text-sm"
                    title="Short Story: No chapters"
                  >
                    Short Story
                  </span>
                  <span className="text-xs opacity-70 block">
                    Best for short stories, poems, or notes.
                  </span>
                </div>
              </label>
              <div
                className={`h-px w-full ${isLight ? 'bg-gray-200' : 'bg-brand-gray-800'}`}
              ></div>
              <label className="flex items-start space-x-3 cursor-pointer p-1">
                <input
                  type="radio"
                  name="ptype"
                  value="novel"
                  checked={type === 'novel'}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <span
                    className="block font-bold text-sm"
                    title="Novel: Multiple chapters"
                  >
                    Novel
                  </span>
                  <span className="text-xs opacity-70 block">
                    Standard novel structure with multiple chapters.
                  </span>
                </div>
              </label>
              <div
                className={`h-px w-full ${isLight ? 'bg-gray-200' : 'bg-brand-gray-800'}`}
              ></div>
              <label className="flex items-start space-x-3 cursor-pointer p-1">
                <input
                  type="radio"
                  name="ptype"
                  value="series"
                  checked={type === 'series'}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <span
                    className="block font-bold text-sm"
                    title="Series: Multiple books"
                  >
                    Series
                  </span>
                  <span className="text-xs opacity-70 block">
                    Epic sagas grouped into multiple books.
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-2 mt-6">
            <Button variant="ghost" onClick={onClose} theme={theme}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (name.trim()) onCreate(name, type);
              }}
              disabled={!name.trim()}
              theme={theme}
            >
              Create Project
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

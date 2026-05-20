// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the create project dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../layout/useFocusTrap';
import { Button } from '../../components/ui/Button';
import { AppTheme } from '../../types';
import { useThemeClasses } from '../layout/ThemeContext';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  // third argument is ISO language code (e.g. 'en', 'es')
  onCreate: (name: string, type: string, language: string) => void;
  theme: AppTheme;
  languages: string[];
}

export const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  isOpen,
  onClose,
  onCreate,
  theme,
  languages,
}: CreateProjectDialogProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [type, setType] = useState('novel');
  const [language, setLanguage] = useState((): string =>
    languages && languages.length ? languages[0] : 'en'
  );
  const { isLight } = useThemeClasses();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(isOpen, dialogRef, onClose);

  if (!isOpen) return null;

  const bgClass = isLight
    ? 'bg-white text-gray-900'
    : 'bg-brand-gray-900 text-gray-100 border border-brand-gray-800';
  const inputClass = isLight
    ? 'bg-white border-gray-300'
    : 'bg-brand-gray-800 border-brand-gray-700';

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-project-title"
      tabIndex={-1}
    >
      <div className={`w-full max-w-md p-6 rounded-lg shadow-xl ${bgClass}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 id="create-project-title" className="text-xl font-bold">
            {t('Create New Project')}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            theme={theme}
            aria-label={t('Close create project dialog')}
          >
            <X size={20} />
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('Project Name')}
            </label>
            <input
              data-no-smart-quotes="true"
              type="text"
              className={`w-full p-2 rounded border focus:ring-2 focus:ring-brand-500 outline-none ${inputClass}`}
              value={name}
              onChange={(
                e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
              ): void => setName(e.target.value)}
              placeholder={t('My Story')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('Project Language')}
            </label>
            <select
              className={`w-full p-2 rounded border focus:ring-2 focus:ring-brand-500 outline-none ${inputClass}`}
              value={language}
              onChange={(
                e: React.ChangeEvent<HTMLSelectElement, HTMLSelectElement>
              ): void => setLanguage(e.target.value)}
            >
              {languages.map((lng: string) => (
                <option key={lng} value={lng}>
                  {lng.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              {t('Project Type')}
            </label>
            <div
              className={`space-y-3 p-3 rounded border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-brand-gray-800 bg-brand-gray-950/50'}`}
            >
              <label className="flex items-start space-x-3 cursor-pointer p-1">
                <input
                  type="radio"
                  name="ptype"
                  value="short-story"
                  checked={type === 'short-story'}
                  onChange={(
                    e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
                  ): void => setType(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <span
                    className="block font-bold text-sm"
                    title={t('Short Story: One chapter')}
                  >
                    {t('Short Story')}
                  </span>
                  <span className="text-xs opacity-70 block">
                    {t(
                      'Single-chapter structure for short fiction, poems, or compact prose.'
                    )}
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
                  onChange={(
                    e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
                  ): void => setType(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <span
                    className="block font-bold text-sm"
                    title={t('Novel: Multiple chapters')}
                  >
                    {t('Novel')}
                  </span>
                  <span className="text-xs opacity-70 block">
                    {t('Standard novel structure with multiple chapters.')}
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
                  onChange={(
                    e: React.ChangeEvent<HTMLInputElement, HTMLInputElement>
                  ): void => setType(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <span
                    className="block font-bold text-sm"
                    title={t('Series: Multiple books')}
                  >
                    {t('Series')}
                  </span>
                  <span className="text-xs opacity-70 block">
                    {t('Epic sagas grouped into multiple books.')}
                  </span>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-2 mt-6">
            <Button variant="ghost" onClick={onClose} theme={theme}>
              {t('Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={(): void => {
                const trimmedName = name.trim();
                if (trimmedName) onCreate(trimmedName, type, language);
              }}
              disabled={!name.trim()}
              theme={theme}
            >
              {t('Create Project')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

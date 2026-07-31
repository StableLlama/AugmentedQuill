// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Reusable button-like control that displays a temporal value and opens
 * SceneTemporalDialog to pick or clear a date/time.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { SceneTemporalDialog } from './SceneTemporalDialog';
import { toDisplayString } from '../../utils/temporal';
import { useStoryLanguage } from '../../stores/storyStore';

interface SceneDatetimePickerButtonProps {
  value: string | null;
  previousValue?: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  className?: string;
}

export const SceneDatetimePickerButton: React.FC<SceneDatetimePickerButtonProps> = ({
  value,
  previousValue = null,
  onChange,
  placeholder,
  className = '',
}: SceneDatetimePickerButtonProps) => {
  const { t } = useTranslation();
  const storyLanguage = useStoryLanguage();
  const [isOpen, setIsOpen] = useState(false);

  const displayLocale = storyLanguage || undefined;
  const displayValue = value ? toDisplayString(value, displayLocale) : null;

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-left text-sm hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-blue-500"
      >
        {displayValue ?? (
          <span className="text-gray-400 dark:text-gray-500">{placeholder}</span>
        )}
      </button>
      {value && (
        <button
          type="button"
          aria-label={t('Clear date')}
          onClick={() => onChange(null)}
          className="rounded p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400"
        >
          <X size={14} />
        </button>
      )}
      <SceneTemporalDialog
        isOpen={isOpen}
        value={value}
        previousValue={previousValue}
        onClose={() => setIsOpen(false)}
        onApply={(v: string | null): void => {
          onChange(v);
          setIsOpen(false);
        }}
      />
    </div>
  );
};

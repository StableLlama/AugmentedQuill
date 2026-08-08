// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Compact segmented control for switching a diffed field between its
 * word-level "Diff" view, the previous "Old" content, and the current "New"
 * content.  Rendered top-right of a section when a diff is present so a large
 * rewrite stays readable without taking up extra vertical space.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

export type DiffViewTab = 'diff' | 'old' | 'new';

interface DiffViewTabsProps {
  /** Currently active tab. */
  tab: DiffViewTab;
  /** Called when the user picks a tab. */
  onChange: (tab: DiffViewTab) => void;
}

const TABS: ReadonlyArray<{ key: DiffViewTab; labelKey: string }> = [
  { key: 'diff', labelKey: 'Diff' },
  { key: 'old', labelKey: 'Old' },
  { key: 'new', labelKey: 'New' },
];

export const DiffViewTabs: React.FC<DiffViewTabsProps> = ({
  tab,
  onChange,
}: DiffViewTabsProps) => {
  const { t } = useTranslation();

  return (
    <div
      role="tablist"
      aria-label={t('Diff view')}
      className="inline-flex items-center rounded-md border border-brand-gray-300 dark:border-brand-gray-700 overflow-hidden"
    >
      {TABS.map(({ key, labelKey }: { key: DiffViewTab; labelKey: string }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={(): void => onChange(key)}
          className={`px-2.5 py-1 text-xs transition-colors ${
            tab === key
              ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 font-medium'
              : 'text-brand-gray-600 dark:text-brand-gray-400 hover:bg-brand-gray-100 dark:hover:bg-brand-gray-800'
          }`}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
};

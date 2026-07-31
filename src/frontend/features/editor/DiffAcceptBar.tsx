// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Floating toolbar with accept / reject / accept-all icon buttons
 * for diff-highlighted sections.  Renders next to a section that has been
 * changed by an automatic process (LLM, undo/redo) so the user can review
 * and explicitly accept or reject each individual change.
 */

import React, { useState } from 'react';
import { Check, X, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppTheme } from '../../types';

export interface DiffAcceptBarProps {
  /** Theme context for styling */
  theme: AppTheme;
  /** Called when the user accepts this individual diff */
  onAccept: () => void;
  /** Called when the user rejects this individual diff (revert to baseline) */
  onReject: () => void;
  /** Called when the user accepts all diffs in the parent container */
  onAcceptAll?: () => void;
  /** Whether the accept-all button should be shown */
  showAcceptAll?: boolean;
  /** Optional test id for the wrapper */
  'data-testid'?: string;
}

/**
 * Compact floating toolbar with diff action buttons.
 *
 * Renders as an inline-flex row of icon-only buttons.  Intended to be
 * placed next to a section heading or at the top-right of a diff-highlighted
 * card so the user can accept / reject / accept-all without scrolling.
 */
export const DiffAcceptBar: React.FC<DiffAcceptBarProps> = ({
  theme,
  onAccept,
  onReject,
  onAcceptAll,
  showAcceptAll = false,
  'data-testid': testId,
}: DiffAcceptBarProps) => {
  const { t } = useTranslation();
  const [acceptAllConfirm, setAcceptAllConfirm] = useState(false);

  const isLight = theme === 'light';

  const btnBase =
    'inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors';
  const acceptCls = `${btnBase} ${
    isLight
      ? 'text-green-600 hover:bg-green-100 hover:text-green-700'
      : 'text-green-400 hover:bg-green-900/30 hover:text-green-300'
  }`;
  const rejectCls = `${btnBase} ${
    isLight
      ? 'text-red-600 hover:bg-red-100 hover:text-red-700'
      : 'text-red-400 hover:bg-red-900/30 hover:text-red-300'
  }`;
  const acceptAllCls = `${btnBase} ${
    isLight
      ? 'text-brand-600 hover:bg-brand-100 hover:text-brand-700'
      : 'text-brand-400 hover:bg-brand-900/30 hover:text-brand-300'
  }`;

  const handleAcceptAll = (): void => {
    if (!acceptAllConfirm) {
      setAcceptAllConfirm(true);
      return;
    }
    setAcceptAllConfirm(false);
    onAcceptAll?.();
  };

  return (
    <div
      className="inline-flex items-center gap-1"
      role="toolbar"
      aria-label={t('Diff actions')}
      data-testid={testId}
    >
      <button
        type="button"
        className={acceptCls}
        onClick={onAccept}
        title={t('Accept change')}
        aria-label={t('Accept change')}
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        className={rejectCls}
        onClick={onReject}
        title={t('Reject change')}
        aria-label={t('Reject change')}
      >
        <X size={14} />
      </button>
      {showAcceptAll && onAcceptAll && (
        <button
          type="button"
          className={acceptAllCls}
          onClick={handleAcceptAll}
          onBlur={(): void => setAcceptAllConfirm(false)}
          title={
            acceptAllConfirm
              ? t('Click again to confirm accept all')
              : t('Accept all changes')
          }
          aria-label={
            acceptAllConfirm ? t('Confirm accept all changes') : t('Accept all changes')
          }
        >
          <CheckCheck size={14} />
        </button>
      )}
    </div>
  );
};

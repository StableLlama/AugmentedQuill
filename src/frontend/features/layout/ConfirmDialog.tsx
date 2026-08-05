// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the confirm dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React, { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from './useFocusTrap';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  /** When true only the confirm/OK button is shown — acts as an alert dialog. */
  alertOnly?: boolean;
}

/**
 * Non-blocking confirmation dialog that replaces synchronous window.confirm().
 * Rendered via a portal-style overlay so it works within the React event loop.
 */
import { useTheme } from './ThemeContext';

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  alertOnly = false,
}: ConfirmDialogProps) => {
  const { isLight } = useTheme();
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const idBase = useId();
  useFocusTrap(isOpen, dialogRef, onCancel);

  const resolvedConfirmLabel = confirmLabel ?? t('OK');
  const resolvedCancelLabel = cancelLabel ?? t('Cancel');

  if (!isOpen) return null;

  const isDanger = variant === 'danger';
  const titleId = title ? `${idBase}-confirm-dialog-title` : undefined;
  const messageId = `${idBase}-confirm-dialog-description`;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={messageId}
      tabIndex={-1}
    >
      <div
        className={`${
          isLight
            ? 'bg-white border-brand-gray-200 shadow-lg'
            : 'bg-brand-gray-900 border-brand-gray-700 shadow-xl'
        } border rounded-lg p-6 max-w-md w-full mx-4`}
      >
        {title && (
          <h2
            id={titleId}
            className={`text-lg font-bold mb-2 ${
              isDanger
                ? 'text-red-600 dark:text-red-500'
                : isLight
                  ? 'text-brand-gray-900'
                  : 'text-brand-gray-100'
            }`}
          >
            {title}
          </h2>
        )}
        <p
          id={messageId}
          className={`${
            isLight ? 'text-brand-gray-700' : 'text-brand-gray-200'
          } text-sm whitespace-pre-wrap mb-6`}
        >
          {message}
        </p>
        <div className="flex justify-end gap-3">
          {!alertOnly && (
            <button
              className={`${
                isLight
                  ? 'bg-brand-gray-100 text-brand-gray-700 border-brand-gray-300 hover:bg-brand-gray-200'
                  : 'bg-brand-gray-800 text-brand-gray-300 border-brand-gray-700 hover:bg-brand-gray-700'
              } px-4 py-2 text-sm rounded-md border transition-colors`}
              onClick={onCancel}
            >
              {resolvedCancelLabel}
            </button>
          )}
          <button
            className={`${
              isDanger
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-brand-700 hover:bg-brand-600'
            } px-4 py-2 text-sm rounded-md text-white border-transparent transition-colors`}
            onClick={onConfirm}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the confirm dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React from 'react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Non-blocking confirmation dialog that replaces synchronous window.confirm().
 * Rendered via a portal-style overlay so it works within the React event loop.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-brand-gray-900 border border-brand-gray-700 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <p className="text-brand-gray-200 text-sm whitespace-pre-wrap mb-6">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            className="px-4 py-2 text-sm rounded-md bg-brand-gray-800 text-brand-gray-300 border border-brand-gray-700 hover:bg-brand-gray-700 transition-colors"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className="px-4 py-2 text-sm rounded-md bg-brand-700 text-white border-transparent hover:bg-brand-600 transition-colors"
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

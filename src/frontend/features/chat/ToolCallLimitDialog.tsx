// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the tool call limit dialog unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import React from 'react';
import { RefreshCw } from 'lucide-react';

import { AppTheme } from '../../types';

type ToolCallChoice = 'stop' | 'continue' | 'unlimited';

type ToolCallLimitDialogProps = {
  isOpen: boolean;
  count: number;
  theme: AppTheme;
  onResolve: (choice: ToolCallChoice) => void;
};

export const ToolCallLimitDialog: React.FC<ToolCallLimitDialogProps> = ({
  isOpen,
  count,
  theme,
  onResolve,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div
        className={`p-6 rounded-lg shadow-2xl max-w-sm w-full ${
          theme === 'dark'
            ? 'bg-brand-gray-900 text-white border border-brand-gray-700'
            : 'bg-white text-brand-gray-900 border border-brand-gray-200'
        }`}
      >
        <div className="flex items-center gap-3 mb-4 text-amber-500">
          <RefreshCw className="w-6 h-6 animate-spin-slow" />
          <h3 className="text-xl font-bold">Tool Call Limit</h3>
        </div>
        <p className="mb-6 opacity-90">
          The AI has executed <strong>{count}</strong> tool calls in a row.
          <br />
          <br />
          Frequent automated actions can consume tokens quickly. How would you like to
          proceed?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onResolve('continue')}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors shadow-sm"
          >
            Continue (+10 calls)
          </button>
          <button
            onClick={() => onResolve('unlimited')}
            className="w-full py-2.5 px-4 bg-brand-gray-200 dark:bg-brand-gray-800 hover:bg-brand-gray-300 dark:hover:bg-brand-gray-700 rounded-md font-medium transition-colors"
          >
            Continue without limit
          </button>
          <div className="mt-2 pt-2 border-t border-brand-gray-100 dark:border-brand-gray-800">
            <button
              onClick={() => onResolve('stop')}
              className="w-full py-2.5 px-4 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-md font-medium transition-colors"
            >
              Stop and review
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

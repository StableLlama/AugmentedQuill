// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the use confirm dialog unit so this responsibility stays isolated, testable, and easy to evolve.

import { useState, useCallback, useRef } from 'react';

interface PendingConfirm {
  message: string;
  resolve: (value: boolean) => void;
}

/**
 * Hook that provides a non-blocking, Promise-based confirm() callback backed
 * by a React dialog instead of the synchronous window.confirm().
 *
 * Usage:
 *   const { confirm, confirmDialogState, handleConfirm, handleCancel } = useConfirmDialog();
 *   const story = useStory({ confirm });
 *   <ConfirmDialog isOpen={confirmDialogState.isOpen} message={confirmDialogState.message}
 *     onConfirm={handleConfirm} onCancel={handleCancel} />
 */
export const useConfirmDialog = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback((msg: string): Promise<boolean> => {
    return new Promise((resolve) => {
      pendingRef.current = { message: msg, resolve };
      setMessage(msg);
      setIsOpen(true);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setIsOpen(false);
    pendingRef.current?.resolve(true);
    pendingRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
  }, []);

  return {
    confirm,
    confirmDialogState: { isOpen, message },
    handleConfirm,
    handleCancel,
  };
};

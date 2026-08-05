// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use chat message actions unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { Dispatch, SetStateAction, useCallback } from 'react';

import { ChatMessage } from '../../types';

type UseChatMessageActionsParams = {
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

/** Custom React hook that manages chat message actions. */
export function useChatMessageActions({
  setChatMessages,
}: UseChatMessageActionsParams): {
  handleEditMessage: (id: string, newText: string) => void;
  handleDeleteMessage: (id: string) => void;
} {
  const handleEditMessage = useCallback(
    (id: string, newText: string): void => {
      setChatMessages((previous: ChatMessage[]): ChatMessage[] =>
        previous.map((message: ChatMessage): ChatMessage =>
          message.id === id ? { ...message, text: newText } : message
        )
      );
    },
    [setChatMessages]
  );

  const handleDeleteMessage = useCallback(
    (id: string): void => {
      setChatMessages((previous: ChatMessage[]): ChatMessage[] =>
        previous.filter((message: ChatMessage): boolean => message.id !== id)
      );
    },
    [setChatMessages]
  );

  return {
    handleEditMessage,
    handleDeleteMessage,
  };
}

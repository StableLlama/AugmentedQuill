// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the use chat message actions unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { Dispatch, SetStateAction } from 'react';

import { ChatMessage } from '../../types';

type UseChatMessageActionsParams = {
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
};

export function useChatMessageActions({
  setChatMessages,
}: UseChatMessageActionsParams) {
  const handleEditMessage = (id: string, newText: string) => {
    setChatMessages((previous) =>
      previous.map((message) =>
        message.id === id ? { ...message, text: newText } : message
      )
    );
  };

  const handleDeleteMessage = (id: string) => {
    setChatMessages((previous) => previous.filter((message) => message.id !== id));
  };

  return {
    handleEditMessage,
    handleDeleteMessage,
  };
}

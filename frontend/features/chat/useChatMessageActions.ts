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

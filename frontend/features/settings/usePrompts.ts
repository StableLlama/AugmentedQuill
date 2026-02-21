import { useEffect, useState } from 'react';
import { api } from '../../services/api';

type PromptsState = {
  system_messages: Record<string, string>;
  user_prompts: Record<string, string>;
};

const EMPTY_PROMPTS: PromptsState = {
  system_messages: {},
  user_prompts: {},
};

export function usePrompts(storyId: string) {
  const [prompts, setPrompts] = useState<PromptsState>(EMPTY_PROMPTS);

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const promptsData = await api.settings.getPrompts();
        setPrompts({
          system_messages: promptsData.system_messages || {},
          user_prompts: promptsData.user_prompts || {},
        });
      } catch (error) {
        console.error('Failed to load prompts', error);
        setPrompts(EMPTY_PROMPTS);
      }
    };

    fetchPrompts();
  }, [storyId]);

  return prompts;
}

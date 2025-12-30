import { LLMConfig } from '../types';

export interface UnifiedChat {
  sendMessage(
    message: string | { message: any }
  ): Promise<{ text: string; functionCalls?: any[] }>;
}

export const testConnection = async (config: LLMConfig): Promise<boolean> => {
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 5,
      }),
    });
    return response.ok;
  } catch (e) {
    console.error('Connection test failed', e);
    return false;
  }
};

export const getModels = async (config: LLMConfig): Promise<string[]> => {
  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (!res.ok) return [];
    const data = await res.json();

    // OpenAI returns { data: [{ id: 'gpt-4' }, ...] }
    if (Array.isArray(data?.data)) {
      return data.data.map((m: any) => m.id).filter(Boolean);
    }

    // Some compatible endpoints may return { models: [...] }
    if (Array.isArray(data?.models)) {
      return data.models
        .map((m: any) => (typeof m === 'string' ? m : m.id))
        .filter(Boolean);
    }

    return [];
  } catch (e) {
    console.error('Failed to list models', e);
    return [];
  }
};

async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> {
  let text = '';
  let buffer = '';
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr);
          if (data.content) {
            text += data.content;
          }
        } catch (e) {
          console.error('Failed to parse SSE data', e);
        }
      }
    }
  }
  return text;
}

export const createChatSession = (
  systemInstruction: string,
  history: { role: string; parts: { text: string }[] }[],
  config: LLMConfig
): UnifiedChat => {
  return {
    sendMessage: async (msg) => {
      const userMsgText = typeof msg === 'string' ? msg : (msg as any).message;

      const messages = [
        { role: 'system', content: systemInstruction },
        ...history.map((h) => ({
          role: h.role === 'model' ? 'assistant' : 'user',
          content: h.parts[0].text,
        })),
        { role: 'user', content: userMsgText },
      ];

      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        });

        if (!res.ok) throw new Error('Chat request failed');

        const reader = res.body?.getReader();
        if (!reader) return { text: '' };

        const text = await readSSEStream(reader);
        return { text };
      } catch (e) {
        console.error('Chat failed', e);
        throw e;
      }
    },
  };
};

export const generateSimpleContent = async (
  prompt: string,
  systemInstruction: string,
  config: LLMConfig
) => {
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: prompt },
  ];

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) throw new Error('Generation failed');

    const reader = res.body?.getReader();
    if (!reader) return '';

    return await readSSEStream(reader);
  } catch (e) {
    console.error('Generation failed', e);
    return '';
  }
};

export const generateContinuations = async (
  currentContent: string,
  storyContext: string,
  systemInstruction: string,
  config: LLMConfig,
  chapterId?: string
): Promise<string[]> => {
  if (!chapterId) return [];

  const fetchSuggestion = async () => {
    try {
      const res = await fetch('/api/story/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chap_id: Number(chapterId),
          current_text: currentContent,
        }),
      });

      if (!res.ok) return '';

      const reader = res.body?.getReader();
      let text = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
      }
      return text;
    } catch (e) {
      return '';
    }
  };

  const [opt1, opt2] = await Promise.all([fetchSuggestion(), fetchSuggestion()]);
  return [opt1, opt2].filter((s) => s);
};

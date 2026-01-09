import { LLMConfig } from '../types';

export class ChatError extends Error {
  traceback?: string;
  status?: number;
  data?: any;

  constructor(
    message: string,
    options?: { traceback?: string; status?: number; data?: any }
  ) {
    super(message);
    this.name = 'ChatError';
    this.traceback = options?.traceback;
    this.status = options?.status;
    this.data = options?.data;
  }
}

export interface UnifiedChat {
  sendMessage(
    message: string | { message: any },
    onUpdate?: (update: {
      text?: string;
      thinking?: string;
      traceback?: string;
    }) => void
  ): Promise<{
    text: string;
    thinking?: string;
    functionCalls?: any[];
    traceback?: string;
  }>;
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
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToolCalls?: (toolCalls: any[]) => void,
  onThinking?: (thinking: string) => void,
  onContent?: (content: string) => void
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
          if (data.error) {
            let msg = data.message || data.error;
            throw new ChatError(msg, {
              traceback: data.traceback,
              status: data.status,
              data: data.data,
            });
          }
          if (data.content) {
            text += data.content;
            if (onContent) onContent(data.content);
          }
          if (data.thinking && onThinking) {
            onThinking(data.thinking);
          }
          if (data.tool_calls && onToolCalls) {
            onToolCalls(data.tool_calls);
          }
        } catch (e) {
          if (e instanceof Error) {
            const msg = e.message.toLowerCase();
            if (
              msg.includes('status:') ||
              msg.includes('error') ||
              msg.includes('failed') ||
              msg.includes('traceback')
            ) {
              // Re-throw handled errors from backend
              throw e;
            }
          }
          console.error('Failed to parse SSE data', e);
        }
      }
    }
  }
  return text;
}

export const createChatSession = (
  systemInstruction: string,
  history: any[],
  config: LLMConfig,
  modelType: 'CHAT' | 'WRITING' | 'EDITING' = 'CHAT'
): UnifiedChat => {
  return {
    sendMessage: async (msg, onUpdate) => {
      const userMsgText = typeof msg === 'string' ? msg : (msg as any).message;

      const messages = [
        { role: 'system', content: systemInstruction },
        ...history.map((h) => {
          const m: any = {
            role: h.role === 'model' ? 'assistant' : h.role,
            content: h.text || (h.parts && h.parts[0]?.text) || '',
          };
          if (h.name) m.name = h.name;
          if (h.tool_call_id) m.tool_call_id = h.tool_call_id;
          if (h.tool_calls) {
            m.tool_calls = h.tool_calls.map((tc: any) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args),
              },
            }));
          }
          return m;
        }),
      ];

      if (userMsgText) {
        messages.push({ role: 'user', content: userMsgText });
      }

      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, model_type: modelType }),
        });

        if (!res.ok) throw new Error('Chat request failed');

        const reader = res.body?.getReader();
        if (!reader) return { text: '' };

        const toolCallsAccumulator: any[] = [];
        let thinking = '';
        let fullText = '';
        const text = await readSSEStream(
          reader,
          (calls) => {
            for (const call of calls) {
              const index = call.index ?? 0;
              if (!toolCallsAccumulator[index]) {
                toolCallsAccumulator[index] = { id: '', name: '', args: '' };
              }
              if (call.id) toolCallsAccumulator[index].id = call.id;
              if (call.function) {
                if (call.function.name) {
                  // Only append if it's not exactly the same as what we already have.
                  // This prevents doubling up if the backend sends the full name twice.
                  if (toolCallsAccumulator[index].name !== call.function.name) {
                    toolCallsAccumulator[index].name += call.function.name;
                  }
                }
                if (call.function.arguments)
                  toolCallsAccumulator[index].args += call.function.arguments;
              }
            }
          },
          (t) => {
            thinking += t;
            if (onUpdate) onUpdate({ thinking });
          },
          (chunk) => {
            fullText += chunk;
            if (onUpdate) onUpdate({ text: fullText });
          }
        );

        const functionCalls = toolCallsAccumulator
          .filter((c) => c && (c.name || c.args))
          .map((c) => {
            let parsedArgs = {};
            try {
              parsedArgs = c.args ? JSON.parse(c.args) : {};
            } catch (e) {
              console.error('Failed to parse tool arguments', c.args);
            }
            return {
              id: c.id,
              name: c.name,
              args: parsedArgs,
            };
          });

        return {
          text,
          thinking: thinking || undefined,
          functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
          traceback: undefined, // Or capture if needed
        };
      } catch (e: any) {
        throw e;
      }
    },
  };
};

export const generateSimpleContent = async (
  prompt: string,
  systemInstruction: string,
  config: LLMConfig,
  modelType?: 'CHAT' | 'WRITING' | 'EDITING'
) => {
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: prompt },
  ];

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model_type: modelType }),
    });

    if (!res.ok) throw new Error('Generation failed');

    const reader = res.body?.getReader();
    if (!reader) return '';

    return await readSSEStream(reader);
  } catch (e: any) {
    // Re-throw so the caller can handle it and show it to the user
    throw e;
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

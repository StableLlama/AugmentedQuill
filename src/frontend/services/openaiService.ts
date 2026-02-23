// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the openai service unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { LLMConfig } from '../types';

type ErrorData = string | Record<string, unknown> | unknown[];

type UserMessageInput = string | { message: string };

type ToolCallChunk = {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ParsedFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type HistoryMessage = {
  role: 'user' | 'model' | 'assistant' | 'tool' | 'system';
  text?: string;
  parts?: Array<{ text?: string }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    args: string | Record<string, unknown>;
  }>;
};

type ModelsResponse = {
  data?: Array<{ id?: string }>;
  models?: Array<string | { id?: string }>;
};

export class ChatError extends Error {
  traceback?: string;
  status?: number;
  data?: ErrorData;

  constructor(
    message: string,
    options?: { traceback?: string; status?: number; data?: ErrorData }
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
    message: UserMessageInput,
    onUpdate?: (update: {
      text?: string;
      thinking?: string;
      traceback?: string;
    }) => void
  ): Promise<{
    text: string;
    thinking?: string;
    functionCalls?: ParsedFunctionCall[];
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
    const data = (await res.json()) as ModelsResponse;

    // OpenAI returns { data: [{ id: 'gpt-4' }, ...] }
    if (Array.isArray(data?.data)) {
      return data.data.map((m) => m.id).filter((id): id is string => Boolean(id));
    }

    // Some compatible endpoints may return { models: [...] }
    if (Array.isArray(data?.models)) {
      return data.models
        .map((m) => (typeof m === 'string' ? m : m.id))
        .filter((id): id is string => Boolean(id));
    }

    return [];
  } catch (e) {
    console.error('Failed to list models', e);
    return [];
  }
};

async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToolCalls?: (toolCalls: ToolCallChunk[]) => void,
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
          const data = JSON.parse(dataStr) as {
            error?: string;
            message?: string;
            traceback?: string;
            status?: number;
            data?: ErrorData;
            content?: string;
            thinking?: string;
            tool_calls?: ToolCallChunk[];
          };
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
  history: HistoryMessage[],
  config: LLMConfig,
  modelType: 'CHAT' | 'WRITING' | 'EDITING' = 'CHAT',
  options?: { allowWebSearch?: boolean }
): UnifiedChat => {
  return {
    sendMessage: async (msg, onUpdate) => {
      const userMsgText = typeof msg === 'string' ? msg : msg.message;

      const messages = [
        { role: 'system', content: systemInstruction },
        ...history.map((h) => {
          const m: {
            role: string;
            content: string;
            name?: string;
            tool_call_id?: string;
            tool_calls?: Array<{
              id: string;
              type: 'function';
              function: { name: string; arguments: string };
            }>;
          } = {
            role: h.role === 'model' ? 'assistant' : h.role,
            content: h.text || (h.parts && h.parts[0]?.text) || '',
          };
          if (h.name) m.name = h.name;
          if (h.tool_call_id) m.tool_call_id = h.tool_call_id;
          if (h.tool_calls) {
            m.tool_calls = h.tool_calls.map((tc) => ({
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
        const res = await fetch('/api/v1/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            model_type: modelType,
            model_name: config.id,
            allow_web_search: options?.allowWebSearch,
          }),
        });

        if (!res.ok) throw new Error('Chat request failed');

        const reader = res.body?.getReader();
        if (!reader) return { text: '' };

        const toolCallsAccumulator: Array<{ id: string; name: string; args: string }> =
          [];
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
      } catch (e: unknown) {
        throw e;
      }
    },
  };
};

export const generateSimpleContent = async (
  prompt: string,
  systemInstruction: string,
  config: LLMConfig,
  modelType?: 'CHAT' | 'WRITING' | 'EDITING',
  options?: {
    tool_choice?: string;
    onUpdate?: (partialText: string) => void;
  }
) => {
  const messages = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: prompt },
  ];

  try {
    const res = await fetch('/api/v1/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model_type: modelType,
        model_name: config.id,
        tool_choice: options?.tool_choice,
      }),
    });

    if (!res.ok) throw new Error('Generation failed');

    const reader = res.body?.getReader();
    if (!reader) return '';

    let accumulated = '';
    return await readSSEStream(reader, undefined, undefined, (delta) => {
      accumulated += delta;
      options?.onUpdate?.(accumulated);
    });
  } catch (e: unknown) {
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
      const res = await fetch('/api/v1/story/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chap_id: Number(chapterId),
          model_name: config.id,
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

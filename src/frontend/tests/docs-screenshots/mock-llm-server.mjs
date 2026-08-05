// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Minimal OpenAI-compatible mock LLM server used by the docs-screenshots run.
 *
 * The demo provider in the isolated machine.json points at this server so the
 * app treats the model as "working": buttons stay enabled, suggestions/chat
 * stream canned text, and the backend records real request/response entries
 * that the Debug Logs dialog renders.
 *
 * Run with: node tests/docs-screenshots/mock-llm-server.mjs  (or via the
 * docs-screenshots Playwright config webServer entry).
 */

import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.MOCK_LLM_PORT || 28012);
const MODEL = process.env.MOCK_LLM_MODEL || 'demo-model';
// When MOCK_LLM_TOOLS=1 the mock can emit streaming tool calls for a curated
// set of chat-driven actions (create project/chapter/book/sourcebook/scene,
// update story summary, search/replace) so E2E tests can exercise the real
// tool-execution path end-to-end.  The docs-screenshots pipeline keeps this
// off so captured screenshots only ever show plain streaming text.
const TOOLS_ENABLED = process.env.MOCK_LLM_TOOLS === '1';

const GENERIC_RESPONSE =
  'The lantern light steadied as Maren lowered the wick. Whatever the coast charts claimed about these waters, the sea itself clearly knew a different story — one written in wrecks and kept by the rocks.';

const SUGGEST_RESPONSE =
  'Nora turned the map over and found, on the blank side, a single line of pencil in her father’s hand: "If the survey misses it, it was never there to begin with."\n\nShe folded it carefully along the old creases, tucked it against her ribs, and did not mention it to Elias.';

const CHAT_RESPONSE =
  'I can help with that. Here’s the plan I’d suggest for the next scene: open on the gate with no hinges, have Nora notice the map has no compass rose, and let the innkeeper’s recognition of the paper do the work of confirming the valley is real. Want me to draft the opening paragraph for Chapter Three?';

const SUMMARY_RESPONSE =
  'A young cartographer named Nora discovers a forgotten valley on an old map, defies her pragmatic brother Elias to investigate, and crosses into a self-contained valley where the people have never heard of the wider world.';

function pickResponse(messages) {
  // Prefer the last user message so keyword routing reflects the user's
  // actual request rather than the (long) system prompt or history.
  let lastUser = '';
  for (let i = (messages ?? []).length - 1; i >= 0; i -= 1) {
    if (String(messages[i].role || '').toLowerCase() === 'user') {
      lastUser = String(messages[i].content || '');
      break;
    }
  }
  const text = lastUser.toLowerCase();
  if (/suggest|next paragraph|continuation|continue the story/i.test(text)) {
    return SUGGEST_RESPONSE;
  }
  if (/summar|synopsis|synopses/i.test(text)) {
    return SUMMARY_RESPONSE;
  }
  if (/tip|advice|write|brainstorm|idea|plan|draft|how to/i.test(text)) {
    return CHAT_RESPONSE;
  }
  // Fall back to the whole message set for the docs-screenshot prompts.
  const joined = JSON.stringify(messages ?? []).toLowerCase();
  if (/suggest|next paragraph|continuation|continue the story/i.test(joined)) {
    return SUGGEST_RESPONSE;
  }
  if (/summar|synopsis|synopses/i.test(joined)) {
    return SUMMARY_RESPONSE;
  }
  if (/chat|assistant|writing partner/i.test(joined)) {
    return CHAT_RESPONSE;
  }
  return GENERIC_RESPONSE;
}

// ---------------------------------------------------------------------------
// Tool-call emulation (MOCK_LLM_TOOLS=1)
// ---------------------------------------------------------------------------

/**
 * Return the name of the tool to invoke for the last user message, or null.
 * Only tools advertised in `body.tools` are considered, so the decision is
 * driven by the same schemas the real app sends to the model.
 */
function pickToolCall(body) {
  const messages = body.messages || [];
  // A 'tool' role message with a call id we generated ('call_...') means a
  // previous tool call was executed and the backend is asking for the final
  // answer — never emit another call in that round.  The backend injects its
  // own internal context tools (get_current_chapter_id / refresh_project_context
  // with ids like 'current_context' / 'project-context-refresh-...'), which
  // must NOT be mistaken for a completed tool round.
  const hasRealToolResult = messages.some(
    (m) =>
      String(m.role || '').toLowerCase() === 'tool' &&
      /^call_/.test(String(m.tool_call_id || ''))
  );
  if (process.env.MOCK_LLM_DEBUG) {
    console.log(
      '[mock-tools] hasRealToolResult=',
      hasRealToolResult,
      'tools=',
      (body.tools || []).map((t) => t.function && t.function.name).join(','),
      'lastUser=',
      String(
        (() => {
          for (let i = messages.length - 1; i >= 0; i -= 1) {
            if (String(messages[i].role || '').toLowerCase() === 'user') {
              return messages[i].content || '';
            }
          }
          return '';
        })()
      ).slice(0, 120)
    );
  }
  if (hasRealToolResult) {
    return null;
  }

  const tools = (body.tools || [])
    .map((t) => (t && t.function && t.function.name) || '')
    .filter(Boolean);
  const has = (name) => tools.includes(name);

  let lastUser = '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (String(messages[i].role || '').toLowerCase() === 'user') {
      lastUser = String(messages[i].content || '');
      break;
    }
  }
  const text = lastUser.toLowerCase();
  // Normalize typographic quotes so extraction works with smart-quoted input
  // (the chat composer converts straight quotes to “ ”).
  const normalizedUser = lastUser.replace(/[“”]/g, '"');

  const extractQuoted = (label) => {
    const re = new RegExp(`${label}['"]?\\s*:?\\s*['"]([^'"]+)['"]`, 'i');
    const m = normalizedUser.match(re);
    return m ? m[1].trim() : null;
  };
  const extractName = () => {
    const patterns = [
      /(?:called|named)\s+['"]?([A-Za-z][A-Za-z0-9 _-]{0,40})/i,
      /(?:for|profile for)\s+the\s+([A-Za-z][A-Za-z0-9 _-]{0,40})/i,
      /(?:for|profile for)\s+([A-Za-z][A-Za-z0-9 _-]{0,40})/i,
    ];
    for (const re of patterns) {
      const m = normalizedUser.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };

  if (has('manage_project') && /create (?:a |a new |new )?project/.test(text)) {
    const name =
      extractQuoted('called') || extractName() || `Chat Project ${Date.now()}`;
    return {
      id: `call_manage_project_${Date.now()}`,
      name: 'manage_project',
      arguments: {
        action: 'create',
        create_data: { name, project_type: 'novel' },
      },
    };
  }

  if (has('create_new_book') && /create (?:a |a new |new )?book/.test(text)) {
    return {
      id: `call_create_new_book_${Date.now()}`,
      name: 'create_new_book',
      arguments: { title: extractQuoted('called') || 'New Book' },
    };
  }

  if (has('create_new_chapter') && /create (?:a |a new |new )?chapter/.test(text)) {
    return {
      id: `call_create_new_chapter_${Date.now()}`,
      name: 'create_new_chapter',
      arguments: { title: extractQuoted('called') || 'Chapter' },
    };
  }

  const categoryMap = {
    character: 'Character',
    location: 'Location',
    organization: 'Organization',
    item: 'Item',
    event: 'Event',
    lore: 'Lore',
    'time travel': 'Time Travel',
    concept: 'Lore',
  };
  const catMatch = text.match(
    /create (?:a |a new |new )?(character|location|organization|item|event|lore|concept|time travel)/
  );
  if (has('manage_sourcebook') && catMatch) {
    const category = categoryMap[catMatch[1]] || 'Character';
    return {
      id: `call_manage_sourcebook_${Date.now()}`,
      name: 'manage_sourcebook',
      arguments: {
        action: 'create',
        entry_data: {
          name: extractName() || 'Mock Character',
          description: 'Created by the mock LLM for E2E testing.',
          category,
        },
      },
    };
  }

  if (has('manage_scenes') && /create (?:a |a new |new )?scene/.test(text)) {
    const summaryMatch = lastUser.match(
      /scene\s*(?:where|in which|that)?\s*:?\s*(.*)/i
    );
    const summary = summaryMatch
      ? summaryMatch[1].replace(/[.!?]$/, '').trim()
      : 'A scene created by the mock LLM';
    return {
      id: `call_manage_scenes_${Date.now()}`,
      name: 'manage_scenes',
      arguments: { action: 'create', create_data: { summary } },
    };
  }

  if (has('manage_story_core') && /update (?:the )?story summary/.test(text)) {
    const m = lastUser.match(/(?:to|summary\s+to)\s*:?\s*(.*)/i);
    return {
      id: `call_manage_story_core_${Date.now()}`,
      name: 'manage_story_core',
      arguments: {
        action: 'update_metadata',
        update_data: {
          summary: m ? m[1].replace(/[.!?]$/, '').trim() : 'Updated summary.',
        },
      },
    };
  }

  if (has('search_and_replace') && /rename .* to |replace all/i.test(text)) {
    const m = lastUser.match(/rename\s+([^"']+?)\s+to\s+([^"'.]+)/i);
    if (m) {
      return {
        id: `call_search_and_replace_${Date.now()}`,
        name: 'search_and_replace',
        arguments: {
          action: 'replace',
          query: m[1].trim(),
          replacement: m[2].trim(),
          scope: 'all',
        },
      };
    }
  }

  return null;
}

/**
 * Stream an OpenAI-compatible tool_calls response for `call`.  The backend
 * accumulates `delta.tool_calls` fragments by `index`, so we send the id/name
 * on the first fragment and the arguments in pieces.
 */
function streamToolCall(res, body, call) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`;
  const chunk = (delta, finish) =>
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      model: body.model || MODEL,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  const argsJson = JSON.stringify(call.arguments || {});
  const argPieces = argsJson.match(/.{1,12}/gs) || [];

  res.write(
    chunk(
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            index: 0,
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: '' },
          },
        ],
      },
      null
    )
  );

  argPieces.forEach((piece) => {
    res.write(
      chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }, null)
    );
  });

  res.write(chunk({}, 'tool_calls'));
  res.write('data: [DONE]\n\n');
  res.end();
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Error-injection hook for the E2E error-path tests.  When the request
 * content contains the marker 'MOCK_ERROR', respond with an upstream 500 so
 * the app's failure handling (chat error messages, provider failures, ...)
 * can be exercised end-to-end.  Only active when tools emulation is enabled.
 */
function shouldInjectError(body) {
  if (!TOOLS_ENABLED) return false;
  const content = JSON.stringify(body || {}).toLowerCase();
  return /mock_error/.test(content);
}

function sendUpstreamError(res) {
  sendJson(res, 500, {
    error: {
      message: 'mock: injected upstream failure (MOCK_ERROR)',
      type: 'mock_error',
    },
  });
}

function streamChat(res, body) {
  const text = pickResponse(body.messages || []);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`;
  const chunk = (content, finish) =>
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      model: body.model || MODEL,
      choices: [
        {
          index: 0,
          delta: content === '' ? {} : { content },
          finish_reason: finish,
        },
      ],
    })}\n\n`;

  // Error-injection marker: MOCK_STOP makes the mock stream a long, slow
  // response so the E2E test can interrupt it mid-stream with the Stop button.
  const messagesText = JSON.stringify(body.messages || []).toLowerCase();
  const isSlowStream = TOOLS_ENABLED && /mock_stop/.test(messagesText);

  res.write(chunk('', null));
  // Split the text into word-sized chunks so the UI shows a natural stream.
  const words = (
    isSlowStream ? Array.from({ length: 150 }, () => 'lingering prose').join(' ') : text
  ).split(/(\s+)/);
  const intervalMs = isSlowStream ? 30 : 8;
  let i = 0;
  const timer = setInterval(() => {
    if (i >= words.length) {
      clearInterval(timer);
      res.write(chunk('', 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.write(chunk(words[i], null));
    i += 1;
  }, intervalMs);
}

/**
 * Legacy OpenAI /v1/completions streaming (used by the story/suggest flow,
 * which reads `choices[0].text` instead of `delta.content`).
 */
function streamCompletions(res, body) {
  // The legacy completions endpoint is used by the story/suggest flow, so it
  // always streams continuation prose (the request carries a `prompt` string).
  const text = SUGGEST_RESPONSE;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = `cmpl-${Math.random().toString(36).slice(2, 10)}`;
  const chunk = (part, finish) =>
    `data: ${JSON.stringify({
      id,
      object: 'text_completion',
      model: body.model || MODEL,
      choices: [{ index: 0, text: part, finish_reason: finish }],
    })}\n\n`;

  const words = text.split(/(\s+)/);
  let i = 0;
  const timer = setInterval(() => {
    if (i >= words.length) {
      clearInterval(timer);
      res.write(chunk('', 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.write(chunk(words[i], null));
    i += 1;
  }, 8);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    sendJson(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model' }] });
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/models/')) {
    sendJson(res, 200, { object: 'model', id: MODEL });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/completions') {
    let raw = '';
    req.on('data', (d) => {
      raw += d;
    });
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }
      if (shouldInjectError(body)) {
        sendUpstreamError(res);
        return;
      }
      if (body.stream) {
        streamCompletions(res, body);
      } else {
        const text = SUGGEST_RESPONSE;
        sendJson(res, 200, {
          id: `cmpl-${Math.random().toString(36).slice(2, 10)}`,
          object: 'text_completion',
          model: body.model || MODEL,
          choices: [{ index: 0, text, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (d) => {
      raw += d;
    });
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }
      if (shouldInjectError(body)) {
        sendUpstreamError(res);
        return;
      }
      if (process.env.MOCK_LLM_DUMP_BODY) {
        try {
          fs.writeFileSync(
            '/tmp/mock-llm-last-body.json',
            JSON.stringify({ url: url.pathname, body }, null, 2)
          );
        } catch {
          // ignore
        }
      }
      if (body.stream) {
        const toolCall = TOOLS_ENABLED ? pickToolCall(body) : null;
        if (toolCall) {
          streamToolCall(res, body, toolCall);
        } else {
          streamChat(res, body);
        }
      } else {
        const toolCall = TOOLS_ENABLED ? pickToolCall(body) : null;
        if (toolCall) {
          sendJson(res, 200, {
            id: `chatcmpl-${Math.random().toString(36).slice(2, 10)}`,
            object: 'chat.completion',
            model: body.model || MODEL,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: toolCall.id,
                      type: 'function',
                      function: {
                        name: toolCall.name,
                        arguments: JSON.stringify(toolCall.arguments),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          });
        } else {
          const text = pickResponse(body.messages || []);
          sendJson(res, 200, {
            id: `chatcmpl-${Math.random().toString(36).slice(2, 10)}`,
            object: 'chat.completion',
            model: body.model || MODEL,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: text },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          });
        }
      }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/images/generations') {
    sendJson(res, 200, {
      created: Math.floor(Date.now() / 1000),
      data: [
        {
          b64_json:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        },
      ],
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/embeddings') {
    sendJson(res, 200, {
      object: 'list',
      data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
    });
    return;
  }

  sendJson(res, 404, {
    error: { message: `mock: no route for ${req.method} ${url.pathname}` },
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] listening on http://127.0.0.1:${PORT} (model=${MODEL})`);
});

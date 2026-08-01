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

const PORT = Number(process.env.MOCK_LLM_PORT || 28012);
const MODEL = process.env.MOCK_LLM_MODEL || 'demo-model';

const GENERIC_RESPONSE =
  'The lantern light steadied as Maren lowered the wick. Whatever the coast charts claimed about these waters, the sea itself clearly knew a different story — one written in wrecks and kept by the rocks.';

const SUGGEST_RESPONSE =
  'Nora turned the map over and found, on the blank side, a single line of pencil in her father’s hand: "If the survey misses it, it was never there to begin with."\n\nShe folded it carefully along the old creases, tucked it against her ribs, and did not mention it to Elias.';

const CHAT_RESPONSE =
  'I can help with that. Here’s the plan I’d suggest for the next scene: open on the gate with no hinges, have Nora notice the map has no compass rose, and let the innkeeper’s recognition of the paper do the work of confirming the valley is real. Want me to draft the opening paragraph for Chapter Three?';

const SUMMARY_RESPONSE =
  'A young cartographer named Nora discovers a forgotten valley on an old map, defies her pragmatic brother Elias to investigate, and crosses into a self-contained valley where the people have never heard of the wider world.';

function pickResponse(messages) {
  const joined = JSON.stringify(messages ?? []).toLowerCase();
  if (/suggest|next paragraph|continuation|continue the story/i.test(joined)) {
    return SUGGEST_RESPONSE;
  }
  if (/summary|summariz/i.test(joined)) {
    return SUMMARY_RESPONSE;
  }
  if (/chat|assistant|writing partner/i.test(joined)) {
    return CHAT_RESPONSE;
  }
  return GENERIC_RESPONSE;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
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

  res.write(chunk('', null));
  // Split the text into word-sized chunks so the UI shows a natural stream.
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
      if (body.stream) {
        streamChat(res, body);
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

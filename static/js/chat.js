import { fetchJSON, getJSONOrEmpty } from './utils.js';
import { Component } from './component.js';

export class ChatView extends Component {
  constructor(element) {
    const initial = {
      models: [],
      selectedName: '',
      messages: [],
      inputRole: 'user',
      sending: false,
    };
    super(element, initial);
  }

  init() {
    if (!this.el) return;
    this._scanRefs();
    this._bindEvents();
    this.loadModels();
    this.render();
  }

  destroy() {
    super.destroy();
  }

  async loadModels() {
    const machine = await getJSONOrEmpty('/api/machine');
    const openai = (machine && machine.openai) || {};
    const models = Array.isArray(openai.models) ? openai.models : [];
    this.models = models;
    this.selectedName = openai.selected || (models[0]?.name || '');
    this.renderModelSelect();
  }

  _bindEvents() {
    const sel = this.$refs.modelSelect;
    if (sel) {
      sel.addEventListener('change', (e) => {
        this.selectedName = e.target.value;
      });
    }

    const roleBtn = this.$refs.roleButton;
    const roleMenu = this.$refs.roleMenu;
    if (roleBtn && roleMenu) {
      roleBtn.addEventListener('click', () => {
        const open = roleMenu.hasAttribute('hidden') ? false : true;
        if (open) roleMenu.setAttribute('hidden', ''); else roleMenu.removeAttribute('hidden');
        roleBtn.setAttribute('aria-expanded', (!open).toString());
      });
      roleMenu.querySelectorAll('button[data-role]').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = btn.getAttribute('data-role');
          if (r) {
            this.inputRole = r;
            roleBtn.textContent = r + ' ▾';
          }
          roleMenu.setAttribute('hidden', '');
          roleBtn.setAttribute('aria-expanded', 'false');
        });
      });
      document.addEventListener('click', (ev) => {
        if (!this.el.contains(ev.target)) return;
        if (!roleMenu.contains(ev.target) && ev.target !== roleBtn) {
          roleMenu.setAttribute('hidden', '');
          roleBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    const sendBtn = this.$refs.send;
    if (sendBtn) sendBtn.addEventListener('click', () => this.send());
    const regenBtn = this.$refs.regenerate;
    if (regenBtn) regenBtn.addEventListener('click', () => this.regenerate());
    const delBtn = this.$refs.deleteLast;
    if (delBtn) delBtn.addEventListener('click', () => this.deleteLast());

    // Enter to send (Shift+Enter for newline)
    const ta = this.$refs.input;
    if (ta) {
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.send();
        }
      });
    }
  }

  renderModelSelect() {
    const sel = this.$refs.modelSelect;
    if (!sel) return;
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = this.models.length ? '-- choose --' : '(no models configured)';
    sel.appendChild(placeholder);
    this.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name + (m.remote_model ? ` → ${m.remote_model}` : (m.model ? ` → ${m.model}` : ''));
      if (m.name === this.selectedName) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  render() {
    this.renderMessages();
  }

  renderMessages() {
    const list = this.$refs.chatList;
    if (!list) return;
    list.innerHTML = '';
    // Filter out tool messages from rendering to keep UI clean
    const renderable = this.messages.filter(m => m.role !== 'tool');
    if (!renderable.length) {
      const empty = document.createElement('div');
      empty.className = 'aq-empty';
      empty.textContent = 'No messages';
      list.appendChild(empty);
      return;
    }
    renderable.forEach((m, idx) => {
      const wrap = document.createElement('div');
      wrap.className = `aq-bubble ${m.role}` + (idx === this.messages.length - 1 ? ' last' : '');
      const header = document.createElement('div');
      header.className = 'aq-bubble-head';
      header.textContent = m.role;
      const content = document.createElement('div');
      content.className = 'aq-bubble-body';
      // Render assistant messages as basic markdown, others as plain text
      if (m.role === 'assistant') {
        content.innerHTML = this._mdToHtml(m.content || '');
      } else {
        content.contentEditable = 'true';
        content.spellcheck = true;
        content.innerText = m.content || '';
        content.addEventListener('input', () => {
          m.content = content.innerText;
        });
      }

      const actions = document.createElement('div');
      actions.className = 'aq-bubble-actions';
      if (idx === this.messages.length - 1) {
        const del = document.createElement('button');
        del.className = 'aq-btn aq-btn-sm';
        del.textContent = 'Delete';
        del.addEventListener('click', () => this.deleteLast());
        actions.appendChild(del);
        if (m.role === 'assistant') {
          const regen = document.createElement('button');
          regen.className = 'aq-btn aq-btn-sm';
          regen.textContent = 'Regenerate';
          regen.addEventListener('click', () => this.regenerate());
          actions.appendChild(regen);
        }
      }

      wrap.appendChild(header);
      wrap.appendChild(content);
      if (actions.childElementCount) wrap.appendChild(actions);
      list.appendChild(wrap);
    });
    list.scrollTop = list.scrollHeight;
  }

  _escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // very small markdown subset: code blocks, inline code, bold, italic, links, lists, headings, blockquotes
  _mdToHtml(src) {
    let html = this._escapeHtml(src);
    // code blocks ```
    html = html.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${code}</code></pre>`);
    // inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // bold and italic (order matters)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // links [text](url)
    html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // blockquotes
    html = html.replace(/(^|\n)>\s?(.*)(?=\n|$)/g, '$1<blockquote>$2</blockquote>');
    // simple headings # .. ######
    html = html.replace(/(^|\n)######\s?([^\n]+)/g, '$1<h6>$2</h6>')
               .replace(/(^|\n)#####\s?([^\n]+)/g, '$1<h5>$2</h5>')
               .replace(/(^|\n)####\s?([^\n]+)/g, '$1<h4>$2</h4>')
               .replace(/(^|\n)###\s?([^\n]+)/g, '$1<h3>$2</h3>')
               .replace(/(^|\n)##\s?([^\n]+)/g, '$1<h2>$2</h2>')
               .replace(/(^|\n)#\s?([^\n]+)/g, '$1<h1>$2</h1>');
    // unordered lists
    html = html.replace(/(?:^|\n)(-\s.+(?:\n-\s.+)*)/g, (m) => {
      const items = m.trim().split(/\n/).map(li => li.replace(/^-\s+/, '')).map(t => `<li>${t}</li>`).join('');
      return `\n<ul>${items}</ul>`;
    });
    // paragraphs: convert double newlines to <p>
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = `<p>${html}</p>`;
    // tidy multiple paragraphs
    html = html.replace(/<p><\/p>/g, '');
    return html;
  }

  async send() {
    if (this.sending) return;
    const ta = this.$refs.input;
    const content = (ta?.value || '').trim();
    if (!content) return;
    const role = this.inputRole || 'user';
    this.messages = [...this.messages, { role, content }];
    if (ta) ta.value = '';
    this.renderMessages();
    await this._queryAssistant();
  }

  deleteLast() {
    if (!this.messages.length) return;
    this.messages = this.messages.slice(0, -1);
    this.renderMessages();
  }

  async regenerate() {
    // Regenerate last assistant bubble by removing it and re-querying
    if (!this.messages.length) return;
    const last = this.messages[this.messages.length - 1];
    if (last.role !== 'assistant') return;
    this.messages = this.messages.slice(0, -1);
    this.renderMessages();
    await this._queryAssistant();
  }

  async _queryAssistant() {
    if (this.sending) return;
    this.sending = true;
    try {
      // Define OpenAI-style tool schemas
      const tools = [
        {
          type: 'function',
          function: {
            name: 'get_project_overview',
            description: 'Get the project title and a list of chapters with id, filename, title, and summary.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
          }
        },
        {
          type: 'function',
          function: {
            name: 'get_chapter_content',
            description: 'Get a slice of chapter content by id with start and max_chars bounds.',
            parameters: {
              type: 'object',
              properties: {
                chap_id: { type: 'integer', description: 'Chapter numeric id (defaults to active chapter if omitted).' },
                start: { type: 'integer', default: 0 },
                max_chars: { type: 'integer', default: 2000 }
              },
              additionalProperties: false
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'write_summary',
            description: 'Generate or update the summary for a chapter.',
            parameters: {
              type: 'object',
              properties: {
                chap_id: { type: 'integer' },
                mode: { type: 'string', enum: ['update', 'discard'], description: 'Discard existing and write new, or update.' }
              },
              required: ['chap_id'],
              additionalProperties: false
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'write_chapter',
            description: 'Write the full chapter content from its summary for the given chap_id.',
            parameters: { type: 'object', properties: { chap_id: { type: 'integer' } }, required: ['chap_id'], additionalProperties: false }
          }
        },
        {
          type: 'function',
          function: {
            name: 'continue_chapter',
            description: 'Continue the chapter content from its current text, guided by the summary.',
            parameters: { type: 'object', properties: { chap_id: { type: 'integer' } }, required: ['chap_id'], additionalProperties: false }
          }
        }
      ];

      // Helper to call /api/chat
      const callChat = async () => {
        const sysPreamble = {
          role: 'system',
          content: 'You can use tools to access the project context. Use get_project_overview to list chapters and their summaries. Use get_chapter_content to fetch chapter text by id. When the user asks about chapters or content, call these tools and then answer based on the returned data.'
        };
        const hasSystem = this.messages.some(m => m.role === 'system');
        const chatMessages = (hasSystem ? [] : [sysPreamble]).concat(
          this.messages.map(m => ({ role: m.role, content: m.content, tool_call_id: m.tool_call_id, name: m.name, tool_calls: m.tool_calls }))
        );
        const body = {
          model_name: this.selectedName || null,
          messages: chatMessages,
          tools,
          tool_choice: 'auto',
          // Provide the active chapter id so server-side tools can default to it
          active_chapter_id: (window.app?.shellView?.activeId ?? null)
        };
        return await fetchJSON('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      };

      // Helper to execute tools server-side
      const runTools = async (assistantMsg) => {
        const toolCalls = Array.isArray(assistantMsg?.tool_calls) ? assistantMsg.tool_calls : [];
        if (!toolCalls.length) return { appended_messages: [], mutations: {} };
        const body = {
          model_name: this.selectedName || null,
          messages: this.messages.map(m => ({ role: m.role, content: m.content, tool_call_id: m.tool_call_id, name: m.name })).concat([{ role: 'assistant', content: assistantMsg.content || '', tool_calls: toolCalls }]),
          active_chapter_id: (window.app?.shellView?.activeId ?? null)
        };
        const result = await fetchJSON('/api/chat/tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        // If story changed, proactively refresh the editor UI
        try {
          const muts = result?.mutations || {};
          if (muts.story_changed) {
            // Derive changed chapter ids from tool calls and tool results
            const changed = new Set();
            // From tool calls (arguments)
            for (const tc of toolCalls) {
              const fn = tc?.function || {};
              const name = fn?.name || '';
              if (!name) continue;
              if (name === 'write_summary' || name === 'write_chapter' || name === 'continue_chapter') {
                try {
                  const args = fn.arguments ? (typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : (fn.arguments || {})) : {};
                  if (typeof args.chap_id === 'number') changed.add(args.chap_id);
                } catch (_) {}
              }
            }
            // From tool results (appended_messages)
            const appended = result?.appended_messages || [];
            for (const tm of appended) {
              if (!tm || tm.role !== 'tool') continue;
              if (tm.name === 'write_summary' || tm.name === 'write_chapter') {
                try {
                  const payload = tm.content ? JSON.parse(tm.content) : {};
                  const cid = payload?.chapter?.id;
                  if (typeof cid === 'number') changed.add(cid);
                } catch (_) {}
              }
            }
            // Notify editor and refresh
            const ids = Array.from(changed);
            if (window.app?.shellView) {
              try {
                // Refresh chapter list; reopen active if affected
                await window.app.shellView.refreshChapters();
                if (ids.includes(window.app.shellView.activeId)) {
                  await window.app.shellView.openChapter(window.app.shellView.activeId);
                }
              } catch (_) {}
            }
            // Broadcast a global event so any component can react
            try { document.dispatchEvent(new CustomEvent('aq:story-updated', { detail: { changedChapters: ids } })); } catch (_) {}
          }
        } catch (_) {}
        return result;
      };

      // First LLM call
      let resp = await callChat();
      if (resp && resp.ok && resp.message) {
        const assistantMsg = resp.message;
        // Append assistant message (even if content empty, as it may contain tool_calls)
        this.messages = [...this.messages, { role: assistantMsg.role || 'assistant', content: assistantMsg.content || '', tool_calls: assistantMsg.tool_calls }];

        // If server executed tools internally, it will return mutations. Apply them now.
        try {
          const muts = resp.mutations || {};
          if (muts && muts.story_changed) {
            if (window.app?.shellView) {
              try {
                await window.app.shellView.refreshChapters();
                if (window.app.shellView.activeId != null) {
                  await window.app.shellView.openChapter(window.app.shellView.activeId);
                }
              } catch (_) {}
            }
            try { document.dispatchEvent(new CustomEvent('aq:story-updated', { detail: { changedChapters: [] } })); } catch (_) {}
          }
        } catch (_) {}

        // If there are tools to run, execute them and iterate one more time
        if (Array.isArray(assistantMsg.tool_calls)) {
          if (assistantMsg.tool_calls.length) {
            const toolResult = await runTools(assistantMsg);
            const appended = toolResult?.appended_messages || [];
            if (appended.length) {
              // Append tool messages to transcript (not rendered visually)
              appended.forEach(tm => {
                this.messages = [...this.messages, { role: 'tool', content: tm.content || '', name: tm.name || '', tool_call_id: tm.tool_call_id }];
              });
              // Second LLM call with tool outputs
              resp = await callChat();
              if (resp && resp.ok && resp.message) {
                const msg2 = resp.message;
                this.messages = [...this.messages, { role: msg2.role || 'assistant', content: msg2.content || '' }];
                // Apply any server-side mutations from the second call as well
                try {
                  const muts2 = resp.mutations || {};
                  if (muts2 && muts2.story_changed) {
                    if (window.app?.shellView) {
                      try {
                        await window.app.shellView.refreshChapters();
                        if (window.app.shellView.activeId != null) {
                          await window.app.shellView.openChapter(window.app.shellView.activeId);
                        }
                      } catch (_) {}
                    }
                    try { document.dispatchEvent(new CustomEvent('aq:story-updated', { detail: { changedChapters: [] } })); } catch (_) {}
                  }
                } catch (_) {}
              }
            }
          }
        }
        this.renderMessages();
      }
    } catch (e) {
      alert(`Chat error: ${e.message || e}`);
    } finally {
      this.sending = false;
    }
  }
}

// factory used by app.js registry if needed in future
export function chatView() { return new ChatView(document.querySelector('[data-component="chat-view"]')); }

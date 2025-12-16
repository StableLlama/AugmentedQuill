import { fetchJSON, getJSONOrEmpty, API } from './utils/utils.js';
import { Component } from './components/component.js';
import { ROLES, EVENTS, UI_STRINGS } from './constants/constants.js';
import { MarkdownRenderer } from './markdown.js';
import { TOOLS } from './tools.js';
import { ModelSelector } from './renderers/modelSelector.js';
import { MessageRenderer } from './renderers/messageRenderer.js';
import { RoleSelector } from './renderers/roleSelector.js';
import { toast } from './utils/editorUtils.js';

/**
 * ChatView component for handling chat interactions, model selection, and message rendering.
 * Manages the conversational AI interface, integrating with backend APIs for LLM calls,
 * tool execution, and state synchronization across the application.
 * @extends Component
 */
export class ChatView extends Component {
  /**
   * @param {HTMLElement} element - The root element for the chat view.
   */
  constructor(element) {
    const initial = {
      models: [],
      selectedName: '',
      messages: [],
      inputRole: ROLES.USER,
      sending: false,
      systemPrompt: '',
    };
    super(element, initial);
    this.modelSelector = new ModelSelector(this);
    this.messageRenderer = new MessageRenderer(this);
    this.roleSelector = new RoleSelector(this);
  }

  // Start editing a message inline
  startMessageEdit(id) {
    // mark the message object with an _editing flag and store original
    const idx = this.messages.findIndex((m) => String(m.id || '') === String(id) || String(m._localId || '') === String(id));
    if (idx === -1) return;
    const msg = this.messages[idx];
    msg._editing = true;
    msg._editBuffer = msg.content;
    this.messageRenderer.render();
  }

  saveMessageEdit(id) {
    const idx = this.messages.findIndex((m) => String(m.id || '') === String(id) || String(m._localId || '') === String(id));
    if (idx === -1) return;
    const msg = this.messages[idx];
    msg._editing = false;
    msg.content = msg._editBuffer || msg.content;
    delete msg._editBuffer;
    // Optionally persist edits to backend — not implemented, just keep locally
    this.messageRenderer.render();
  }

  cancelMessageEdit(id) {
    const idx = this.messages.findIndex((m) => String(m.id || '') === String(id) || String(m._localId || '') === String(id));
    if (idx === -1) return;
    const msg = this.messages[idx];
    msg._editing = false;
    delete msg._editBuffer;
    this.messageRenderer.render();
  }

  deleteMessage(id) {
    const idx = this.messages.findIndex((m) => String(m.id || '') === String(id) || String(m._localId || '') === String(id));
    if (idx === -1) return;
    this.messages.splice(idx, 1);
    this.messageRenderer.render();
  }

  /**
   * Initializes the chat view by scanning refs, binding events, and loading data.
   */
  init() {
    if (!this.el) return;
    this._scanRefs();
    this._bindEvents();
    this.watch('sending', () => this.render());
    // Load models first (machine configuration), then load chat state (messages, current model)
    this.loadModels();
    this.loadState();
    this.render();
  }

  /**
   * Destroys the chat view.
   */
  destroy() {
    super.destroy();
  }

  /**
   * Loads available models from the machine configuration.
   */
  async loadModels() {
    const machine = await getJSONOrEmpty('/api/machine');
    const openai = (machine && machine.openai) || {};
    const models = Array.isArray(openai.models) ? openai.models : [];
    this.models = models;
    this.selectedName = openai.selected || (models[0]?.name || '');
    this.modelSelector.render();
    // Notify other parts of the app that machine configuration has changed,
    // allowing components like the editor to reload story models accordingly.
    try { document.dispatchEvent(new CustomEvent(EVENTS.MACHINE_UPDATED, { detail: {} })); } catch (e) { console.warn('Failed to dispatch machine updated event:', e); }
  }

  /**
   * Loads the chat state (messages and models) from the API.
   */
  async loadState() {
    try {
      const data = await API.loadChat();
      // Normalize data
      this.messages = Array.isArray(data.messages) ? data.messages.slice() : (this.messages || []);
      // If models present, prefer them; otherwise preserve models loaded from machine
      if (Array.isArray(data.models) && data.models.length) {
        this.models = data.models;
      }
      if (data.current_model) {
        this.selectedName = data.current_model;
      }
      this.modelSelector.render();
      this.messageRenderer.render();
      // Notify that chat has been loaded, enabling other components to react to the initial state.
      try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_LOADED, { detail: { messages: this.messages.slice() } })); } catch (e) { console.warn('Failed to dispatch chat loaded event:', e); }
    } catch (e) {
      console.error('Failed to load chat state:', e);
      // keep existing state
    }
  }

  /**
   * Binds event listeners for the chat view.
   */
  _bindEvents() {
    // Model selector change
    const sel = this.$refs.modelSelect;
    if (sel) {
      sel.addEventListener('change', (e) => {
        this.selectedName = e.target.value;
      });
    }

    // System prompt toggle and controls
    const toggleBtn = this.el.querySelector('[data-action="toggle-system-prompt"]');
    const systemPanel = this.$refs.systemPanel;
    const systemTextarea = this.$refs.systemPrompt;
    const saveSystem = this.el.querySelector('[data-action="save-system"]');
    const cancelSystem = this.el.querySelector('[data-action="cancel-system"]');
    if (toggleBtn && systemPanel) {
      toggleBtn.addEventListener('click', () => {
        const show = systemPanel.classList.toggle('hidden');
        // if showing, populate textarea
        if (!show && systemTextarea) systemTextarea.value = this.systemPrompt || '';
      });
    }
    if (saveSystem && systemTextarea) {
      saveSystem.addEventListener('click', () => {
        this.systemPrompt = systemTextarea.value || '';
        systemPanel.classList.add('hidden');
        // Persisting system prompt isn't implemented server-side; keep local and include when sending
      });
    }
    if (cancelSystem && systemPanel) {
      cancelSystem.addEventListener('click', () => {
        systemPanel.classList.add('hidden');
      });
    }

    // Role selector events
    this.roleSelector.bindEvents();

    // Send button
    const sendBtn = this.$refs.send;
    if (sendBtn) sendBtn.addEventListener('click', (e) => { e.preventDefault(); try { this.send(); } catch (err) { console.error('Chat send failed:', err); } });

    // Regenerate button: delegated handler will handle clicks; we avoid adding a direct listener here
    const regenBtn = this.$refs.regenerate;
    if (regenBtn && !regenBtn.__aq_bound) {
      // do not attach here to avoid duplicate handling; render() will bind once if needed
    }

    // Delete last button
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

    // Delegate per-message edit/delete actions
    this.el.addEventListener('click', (ev) => {
      const editBtn = ev.target.closest('[data-action="edit-message"]');
      if (editBtn) {
        const id = editBtn.getAttribute('data-msg-id');
        if (id) this.startMessageEdit(id);
        return;
      }
      const delBtn = ev.target.closest('[data-action="delete-message"]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-msg-id');
        if (id) this.deleteMessage(id);
        return;
      }
      const saveBtn = ev.target.closest('[data-action="save-edit"]');
      if (saveBtn) {
        const id = saveBtn.getAttribute('data-msg-id');
        if (id) this.saveMessageEdit(id);
        return;
      }
      const cancelBtn = ev.target.closest('[data-action="cancel-edit"]');
      if (cancelBtn) {
        const id = cancelBtn.getAttribute('data-msg-id');
        if (id) this.cancelMessageEdit(id);
        return;
      }
    });
  }

  /**
   * Renders the chat view.
   */
  render() {
    this.messageRenderer.render();
    // Update send button and input based on sending state
    const sendBtn = this.$refs.send;
    const spinner = this.$refs.sendSpinner;
    const input = this.$refs.input;
    if (sendBtn) {
      sendBtn.disabled = this.sending;
    }
    if (spinner) {
      spinner.style.display = this.sending ? 'inline-block' : 'none';
    }
    if (input) {
      input.disabled = this.sending;
    }

    // Show regenerate area if last message is assistant
    const regenArea = this.$refs.regenerateArea;
    if (regenArea) {
      // Show regenerate area if there is at least one assistant-like message
      const msgs = this.messages || [];
      const hasAssistant = msgs.some(m => m && (m.role === ROLES.ASSISTANT || String(m.role) === 'model'));
      if (hasAssistant && !this.sending) {
        regenArea.style.display = '';
      } else {
        regenArea.style.display = 'none';
      }
      // Ensure regenerate button has handler (in case refs were patched later)
      const regenBtn = this.$refs.regenerate;
      if (regenBtn && !regenBtn.__aq_bound) {
        regenBtn.addEventListener('click', () => this.regenerate());
        regenBtn.__aq_bound = true;
      }
    }
    const empty = this.$refs.chatEmpty;
    if (empty) {
      const has = Array.isArray(this.messages) && this.messages.some(m => m.role !== ROLES.TOOL);
      empty.style.display = has ? 'none' : '';
    }
  }

  /**
   * Sends a new message to the chat.
   */
  async send() {
    if (this.sending) return;
    const ta = this.$refs.input;
    const content = (ta?.value || '').trim();
    if (!content) return;
    const role = this.inputRole || ROLES.USER;
    const localId = `m_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    this.messages = [...(this.messages || []), { role, content, _localId: localId }];
    if (ta) ta.value = '';
    this.messageRenderer.render();
    // Emit chat-updated so others can react immediately (optional)
    try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_UPDATED, { detail: { messages: this.messages.slice() } })); } catch (e) { console.warn('Failed to dispatch chat updated event:', e); }

    await this._queryAssistant();

    // After assistant round finished, broadcast updated messages
    try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_UPDATED, { detail: { messages: this.messages.slice() } })); } catch (e) { console.warn('Failed to dispatch chat updated event after response:', e); }
  }

  /**
   * Deletes the last message.
   */
  deleteLast() {
    if (!this.messages || !this.messages.length) return;
    this.messages = this.messages.slice(0, -1);
    this.messageRenderer.render();
    try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_UPDATED, { detail: { messages: this.messages.slice() } })); } catch (e) { console.warn('Failed to dispatch chat updated event on delete:', e); }
  }

  /**
   * Regenerates the last assistant message.
   */
  async regenerate() {
    // Regenerate: find the last assistant-like message (accept 'assistant' or 'model'),
    // remove it and any messages after it (including tool outputs), then re-query.
    if (!this.messages || !this.messages.length) return;
    // find last index of assistant-like message
    let idx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const r = this.messages[i] && this.messages[i].role;
      if (r === ROLES.ASSISTANT || String(r) === 'model') { idx = i; break; }
    }
    if (idx === -1) return;
    // Trim messages up to the assistant message (remove assistant and anything after)
    this.messages = this.messages.slice(0, idx);
    this.messageRenderer.render();
    await this._queryAssistant();
    try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_UPDATED, { detail: { messages: this.messages.slice() } })); } catch (e) { console.warn('Failed to dispatch chat updated event on regenerate:', e); }
  }

  /**
   * Returns the available tools for the assistant.
   * @returns {Array} Array of tool definitions.
   */
  getTools() {
    return TOOLS;
  }

  /**
   * Calls the streaming chat API with the given messages and tools.
   * @param {Array} messages - The messages to send.
   * @param {Array} tools - The tools to include.
   * @param {Function} onChunk - Callback for each streaming chunk.
   * @returns {Promise<Object>} The final API response.
   */
  async callChatStreaming(messages, tools, onChunk) {
    const hasSystem = messages.some(m => m.role === ROLES.SYSTEM);
    const chatMessages = (hasSystem ? [] : []).concat(
      messages.map(m => ({ role: m.role, content: m.content, tool_call_id: m.tool_call_id, name: m.name, tool_calls: m.tool_calls }))
    );
    const body = {
      model_name: this.selectedName || null,
      messages: chatMessages,
      tools,
      tool_choice: 'auto',
      // Provide the active chapter id so server-side tools can default to it
      active_chapter_id: (window.app?.shellView?.activeId ?? null)
    };

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let toolCalls = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const chunk = JSON.parse(data);
              if (chunk.error) {
                throw new Error(chunk.error);
              }
              if (chunk.done) {
                return { ok: true, message: { role: ROLES.ASSISTANT, content: fullContent, tool_calls: toolCalls } };
              }
              
              // Handle direct content format (from backend when not using OpenAI streaming)
              if (chunk.content) {
                fullContent += chunk.content;
                if (onChunk) {
                  onChunk(fullContent);
                }
              }
              
              // Handle tool calls from backend
              if (chunk.tool_calls) {
                for (const toolCall of chunk.tool_calls) {
                  const index = toolCall.index;
                  if (!toolCalls[index]) {
                    toolCalls[index] = { id: '', function: { name: '', arguments: '' }, type: 'function' };
                  }
                  if (toolCall.id) toolCalls[index].id += toolCall.id;
                  if (toolCall.function) {
                    if (toolCall.function.name) toolCalls[index].function.name += toolCall.function.name;
                    if (toolCall.function.arguments) toolCalls[index].function.arguments += toolCall.function.arguments;
                  }
                }
              }
              
              // Handle OpenAI streaming format
              if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
                const delta = chunk.choices[0].delta;
                if (delta.content) {
                  fullContent += delta.content;
                  if (onChunk) {
                    onChunk(fullContent);
                  }
                }
                if (delta.tool_calls) {
                  // Accumulate tool calls from streaming chunks
                  for (const toolCall of delta.tool_calls) {
                    const index = toolCall.index;
                    if (!toolCalls[index]) {
                      toolCalls[index] = { id: '', function: { name: '', arguments: '' }, type: 'function' };
                    }
                    if (toolCall.id) toolCalls[index].id += toolCall.id;
                    if (toolCall.function) {
                      if (toolCall.function.name) toolCalls[index].function.name += toolCall.function.name;
                      if (toolCall.function.arguments) toolCalls[index].function.arguments += toolCall.function.arguments;
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('Failed to parse streaming chunk:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { ok: true, message: { role: ROLES.ASSISTANT, content: fullContent, tool_calls: toolCalls } };
  }

  /**
   * Non-streaming compatibility wrapper used in some call sites.
   * For now we reuse the streaming implementation and return its final result.
   */
  async callChat(messages, tools) {
    const resp = await this.callChatStreaming(messages, tools, null);
    return resp;
  }

  /**
   * Runs tools based on the assistant's tool calls.
   * @param {Object} assistantMsg - The assistant message with tool calls.
   * @returns {Promise<Object>} The tool execution result.
   */
  async runTools(assistantMsg) {
    const toolCalls = Array.isArray(assistantMsg?.tool_calls) ? assistantMsg.tool_calls : [];
    if (!toolCalls.length) return { appended_messages: [], mutations: {} };
    const body = {
      model_name: this.selectedName || null,
      messages: this.messages.map(m => ({ role: m.role, content: m.content, tool_call_id: m.tool_call_id, name: m.name })).concat([{ role: ROLES.ASSISTANT, content: assistantMsg.content || '', tool_calls: assistantMsg.tool_calls }]),
      active_chapter_id: (window.app?.shellView?.activeId ?? null)
    };
    const result = await fetchJSON('/api/chat/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    // If story changed, proactively refresh the editor UI
    this.handleStoryMutations(result, toolCalls);
    return result;
  }

  /**
   * Handles story mutations from tool results.
   * @param {Object} result - The tool result.
   * @param {Array} toolCalls - The tool calls.
   */
  handleStoryMutations(result, toolCalls) {
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
          if (name === 'sync_summary' || name === 'write_chapter' || name === 'continue_chapter') {
            try {
              const args = fn.arguments ? (typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : (fn.arguments || {})) : {};
              if (typeof args.chap_id === 'number') changed.add(args.chap_id);
            } catch (e) { console.warn('Failed to parse tool call arguments:', e); }
          }
        }
        // From tool results (appended_messages)
        const appended = result?.appended_messages || [];
        for (const tm of appended) {
          if (!tm || tm.role !== ROLES.TOOL) continue;
          if (tm.name === 'sync_summary' || tm.name === 'write_chapter') {
            try {
              const payload = tm.content ? JSON.parse(tm.content) : {};
              const cid = payload?.chapter?.id;
              if (typeof cid === 'number') changed.add(cid);
            } catch (e) { console.warn('Failed to parse tool result content:', e); }
          }
        }
        // Notify editor and refresh
        const ids = Array.from(changed);
        if (window.app?.shellView) {
          try {
            // Refresh chapter list; reopen active if affected
            window.app.shellView.refreshChapters();
            if (ids.includes(window.app.shellView.activeId)) {
              window.app.shellView.openChapter(window.app.shellView.activeId);
            }
          } catch (e) { console.warn('Failed to refresh editor after story mutation:', e); }
        }
        // Broadcast a global event so any component can react
        try { document.dispatchEvent(new CustomEvent(EVENTS.STORY_UPDATED, { detail: { changedChapters: ids } })); } catch (e) { console.warn('Failed to dispatch story updated event:', e); }
      }
    } catch (e) { console.warn('Failed to handle story mutations:', e); }
  }

  /**
   * Handles the response from the chat API.
   * @param {Object} resp - The API response.
   */
  async handleResponse(resp) {
    if (resp && resp.ok && resp.message) {
      const assistantMsg = resp.message;
      // Append assistant message (even if content empty, as it may contain tool_calls)
      this.messages = [...(this.messages || []), { role: assistantMsg.role || ROLES.ASSISTANT, content: assistantMsg.content || '', tool_calls: assistantMsg.tool_calls }];

      // If server executed tools internally, apply mutations now.
      this.handleServerMutations(resp);

      // If there are tools to run, execute them and iterate one more time
      if (Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length) {
        const toolResult = await this.runTools(assistantMsg);
        const appended = toolResult?.appended_messages || [];
        if (appended.length) {
          // Append tool messages to transcript (not rendered visually)
          appended.forEach(tm => {
            this.messages = [...(this.messages || []), { role: ROLES.TOOL, content: tm.content || '', name: tm.name || '', tool_call_id: tm.tool_call_id }];
          });
          // Second LLM call with tool outputs
          resp = await this.callChat(this.messages, this.getTools());
          if (resp && resp.ok && resp.message) {
            const msg2 = resp.message;
            this.messages = [...(this.messages || []), { role: msg2.role || ROLES.ASSISTANT, content: msg2.content || '' }];
            // Apply any server-side mutations from the second call as well
            this.handleServerMutations(resp);
          }
        }
      }
      this.messageRenderer.render();
      try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_UPDATED, { detail: { messages: this.messages.slice() } })); } catch (e) { console.warn('Failed to dispatch chat updated event after response:', e); }
    }
  }

  /**
   * Handles server-side mutations from the response.
   * @param {Object} resp - The API response.
   */
  handleServerMutations(resp) {
    try {
      const muts = resp.mutations || {};
      if (muts && muts.story_changed) {
        if (window.app?.shellView) {
          try {
            window.app.shellView.refreshChapters();
            if (window.app.shellView.activeId != null) {
              window.app.shellView.openChapter(window.app.shellView.activeId);
            }
          } catch (e) { console.warn('Failed to refresh editor after server mutation:', e); }
        }
        try { document.dispatchEvent(new CustomEvent(EVENTS.STORY_UPDATED, { detail: { changedChapters: [] } })); } catch (e) { console.warn('Failed to dispatch story updated event from server:', e); }
      }
    } catch (e) { console.warn('Failed to handle server mutations:', e); }
  }

  /**
   * Queries the assistant with the current messages.
   */
  async _queryAssistant() {
    if (this.sending) return;
    this.sending = true;
    
    try {
      const tools = this.getTools();
      // Add a placeholder assistant message
      const assistantMessage = { role: ROLES.ASSISTANT, content: '' };
      assistantMessage._localId = `m_${Date.now()}_${Math.floor(Math.random()*1000)}`;
      this.messages = [...(this.messages || []), assistantMessage];
      
      this.messageRenderer.render();

      let currentMessages = this.messages.slice(0, -1); // Messages up to the user input
      if (this.systemPrompt && this.systemPrompt.trim()) {
        currentMessages = [{ role: ROLES.SYSTEM, content: this.systemPrompt.trim() }, ...currentMessages];
      }
      let hasToolCalls = true;
      let finalResponse = null;

      // Continue the conversation until no more tool calls
      while (hasToolCalls) {
        // Use streaming chat
        
        const resp = await this.callChatStreaming(currentMessages, tools, (content) => {
          assistantMessage.content = content;
          this.messageRenderer.render();
        });

        
        // Update the assistant message content
        assistantMessage.content = resp.message.content;
        this.messageRenderer.render();

        finalResponse = resp;
        hasToolCalls = resp.message.tool_calls && resp.message.tool_calls.length > 0;

        if (hasToolCalls) {
          // Run the tools
          
          const toolResult = await this.runTools(resp.message);
          const appended = toolResult?.appended_messages || [];
          if (appended.length) {
            // Add tool messages to the conversation
            appended.forEach(tm => {
                const toolMessage = { role: ROLES.TOOL, content: tm.content || '', name: tm.name || '', tool_call_id: tm.tool_call_id };
                toolMessage._localId = `m_${Date.now()}_${Math.floor(Math.random()*1000)}`;
                this.messages = [...(this.messages || []), toolMessage];
                
                currentMessages = [...currentMessages, assistantMessage, ...appended]; // Include assistant message and tool results for next call
              });
            this.messageRenderer.render();
          } else {
            // No tool results, break the loop
            hasToolCalls = false;
          }
        }
      }

      // If the final streaming response produced no assistant content but tools appended
      // created tool messages, request a final assistant turn to synthesize outputs.
      try {
        if (finalResponse && (!finalResponse.message || !String(finalResponse.message.content || '').trim())) {
          const hasToolMsgs = Array.isArray(this.messages) && this.messages.some(m => m.role === ROLES.TOOL);
          if (hasToolMsgs) {
            
            const follow = await this.callChat(this.messages, this.getTools());
            
            if (follow && follow.ok && follow.message) {
              // Update the placeholder assistant message (it should be the last assistant placeholder)
              const placeholderIndex = this.messages.findIndex(m => m._localId && String(m._localId).startsWith('m_') && m.role === ROLES.ASSISTANT && (!m.content || m.content === ''));
              if (placeholderIndex !== -1) {
                this.messages[placeholderIndex].content = follow.message.content || '';
              } else {
                this.messages = [...(this.messages || []), { role: follow.message.role || ROLES.ASSISTANT, content: follow.message.content || '' }];
              }
              finalResponse = follow;
            }
          }
        }
      } catch (e) {
        console.warn('queryAssistant: follow-up assistant call failed', e);
      }
      this.handleServerMutations(finalResponse);
      
      this.messageRenderer.render();
      try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_UPDATED, { detail: { messages: this.messages.slice() } })); } catch (e) { console.warn('Failed to dispatch chat updated event after response:', e); }
    } catch (e) {
      toast(`Chat error: ${e.message || e}`, 'error');
      // Remove the failed assistant message
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === ROLES.ASSISTANT && !this.messages[this.messages.length - 1].content) {
        this.messages = this.messages.slice(0, -1);
        this.messageRenderer.render();
      }
    } finally {
      this.sending = false;
      try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_SENDING, { detail: { sending: this.sending } })); } catch (e) { console.warn('Failed to dispatch chat sending event:', e); }
    }
  }
}

// factory used by app.js registry if needed in future
export function chatView() { return new ChatView(document.querySelector('[data-component="chat-view"]')); }

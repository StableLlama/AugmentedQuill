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
    };
    super(element, initial);
    this.modelSelector = new ModelSelector(this);
    this.messageRenderer = new MessageRenderer(this);
    this.roleSelector = new RoleSelector(this);
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

    // Role selector events
    this.roleSelector.bindEvents();

    // Send button
    const sendBtn = this.$refs.send;
    if (sendBtn) sendBtn.addEventListener('click', () => this.send());

    // Regenerate button
    const regenBtn = this.$refs.regenerate;
    if (regenBtn) regenBtn.addEventListener('click', () => this.regenerate());

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
    this.messages = [...(this.messages || []), { role, content }];
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
    // Regenerate last assistant bubble by removing it and re-querying
    if (!this.messages || !this.messages.length) return;
    const last = this.messages[this.messages.length - 1];
    if (last.role !== ROLES.ASSISTANT) return;
    this.messages = this.messages.slice(0, -1);
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
   * Calls the chat API with the given messages and tools.
   * @param {Array} messages - The messages to send.
   * @param {Array} tools - The tools to include.
   * @returns {Promise<Object>} The API response.
   */
  async callChat(messages, tools) {
    const sysPreamble = {
      role: ROLES.SYSTEM,
      content: 'You can use tools to access the project context. Use get_project_overview to list chapters and their summaries. Use get_chapter_content to fetch chapter text by id. You can also create new chapters, write or continue chapters, and delete chapters using the available tools.'
    };
    const hasSystem = messages.some(m => m.role === ROLES.SYSTEM);
    const chatMessages = (hasSystem ? [] : [sysPreamble]).concat(
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
    return await fetchJSON('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
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
      // First LLM call
      let resp = await this.callChat(this.messages, tools);
      await this.handleResponse(resp);
    } catch (e) {
      toast(`Chat error: ${e.message || e}`, 'error');
    } finally {
      this.sending = false;
      try { document.dispatchEvent(new CustomEvent(EVENTS.CHAT_SENDING, { detail: { sending: this.sending } })); } catch (e) { console.warn('Failed to dispatch chat sending event:', e); }
    }
  }
}

// factory used by app.js registry if needed in future
export function chatView() { return new ChatView(document.querySelector('[data-component="chat-view"]')); }

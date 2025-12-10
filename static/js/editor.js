import { fetchJSON, API } from './utils.js';
import { Component } from './component.js';

/**
 * Chapter Editor Component
 */
export class ShellView extends Component {
  constructor(element) {
    const initialState = {
      chapters: [],
      activeId: null,
      content: '',
      renderMode: 'raw',
      contentWidth: 33, // em units
      fontSize: 1, // rem units
      dirty: false,
      _originalContent: '',
      _originalSummaryContent: '', // Added for summary dirty tracking
      editingId: null,
      editingTitle: '',
      _suspendInput: false,
      chatMessages: [],
      chatModels: [],
      chatCurrentModel: '',
      chatSending: false,
      // Story model (separate from chat model)
      storyModels: [],
      storyCurrentModel: '',
      // Streaming state for story actions
      storyBusy: false,
      storyAction: '', // 'summary' | 'write' | 'continue'
    };

    super(element, initialState);

    // Non-reactive properties
    this._tui = null;
    this._tuiEl = null;
    this._debouncedSaveSummary = this._debounce(this._saveSummary.bind(this), 1000); // Debounce by 1 second
    this._debouncedSaveTitle = this._debounce(this._saveTitle.bind(this), 500);
    this._storyAbortController = null;
  }

  /**
   * Initialize the shell view component
   */
  init() {
    super.init();

    // Watch for state changes to update DOM
    this.watch('chapters', () => this.renderChapterList());
    this.watch('activeId', () => {
      this.renderChapterList();
      this.renderMainView();
    });
    this.watch('editingId', () => this.renderChapterList());
    this.watch('dirty', () => this.renderDirtyState());
    this.watch('content', () => this.renderContent());
    this.watch('renderMode', () => {
      try { localStorage.setItem('aq:renderMode', this.renderMode); } catch (_) {}
      this.renderModeButtons();
      this.renderRawEditorToolbar();
    });
    this.watch('contentWidth', () => this.renderContentWidth());
    this.watch('fontSize', () => this.renderFontSize());
    this.watch('chatMessages', () => this.renderChatMessages());
    this.watch('chatSending', () => this.renderChatSending());
    this.watch('chatModels', () => this.renderChatModels());
    this.watch('storyModels', () => this.renderStoryModels());
    this.watch('storyBusy', () => this.renderStoryBusy());


    // Listen for project changes from settings page
    this._onProjectSelected = () => { this.refreshChapters(); };
    document.addEventListener('aq:project-selected', this._onProjectSelected);

    // Global updates when story or machine settings change (from chat tools or settings modal)
    this._onStoryUpdated = (e) => {
      // Refresh chapters and reopen active if it was changed
      const detail = (e && e.detail) || {};
      const changed = Array.isArray(detail.changedChapters) ? detail.changedChapters : [];
      const reopen = this.activeId != null && changed.includes(this.activeId);
      Promise.resolve(this.refreshChapters()).then(() => {
        if (reopen && this.activeId != null) {
          this.openChapter(this.activeId);
        }
      });
    };
    document.addEventListener('aq:story-updated', this._onStoryUpdated);

    this._onMachineUpdated = () => {
      // Reload chat/story models and chapters to reflect new configuration
      Promise.resolve(this.loadChat());
      Promise.resolve(this.refreshChapters());
    };
    document.addEventListener('aq:machine-updated', this._onMachineUpdated);

    // Keyboard shortcut: Ctrl/Cmd+S to save
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (this.dirty) {
          this.saveContent();
        }
      }
    });

    // Warn user before navigating away with unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Setup event listeners for UI elements
    this._setupEventListeners();

    // Load saved render mode preference first
    try {
      const savedMode = localStorage.getItem('aq:renderMode');
      if (savedMode === 'raw' || savedMode === 'markdown' || savedMode === 'wysiwyg') {
        this.renderMode = savedMode;
      }
    } catch (_) {}

    this.load();
    this.renderMainView();
    this.renderRawEditorToolbar();
    this.renderContentWidth();
    this.renderFontSize();
  }

  destroy() {
    try {
      if (this._onProjectSelected) document.removeEventListener('aq:project-selected', this._onProjectSelected);
      if (this._onStoryUpdated) document.removeEventListener('aq:story-updated', this._onStoryUpdated);
      if (this._onMachineUpdated) document.removeEventListener('aq:machine-updated', this._onMachineUpdated);
    } catch (_) {}
    super.destroy();
  }

  /**
   * Setup event listeners for UI interactions
   */
  _setupEventListeners() {
    if (!this.el) return;

    // Delegate chapter list clicks
    const chapterList = this.el.querySelector('[data-chapter-list]');
    if (chapterList) {
      chapterList.addEventListener('click', async (e) => {
        // Handle actions within an editing item first
        if (this.editingId !== null) {
          const saveBtn = e.target.closest('[data-action="save-title"]');
          if (saveBtn) {
            this.saveEdit();
            return;
          }

          const cancelBtn = e.target.closest('[data-action="cancel-edit"]');
          if (cancelBtn) {
            this.cancelEdit();
            return;
          }
        }
        const toggleSummaryBtn = e.target.closest('[data-action="toggle-summary"]');
        if (toggleSummaryBtn) {
            const chapterItem = toggleSummaryBtn.closest('[data-chapter-id]');
            if (chapterItem) {
                const id = parseInt(chapterItem.getAttribute('data-chapter-id'), 10);
                if (!isNaN(id)) {
                    this.toggleSummary(id);
                }
            }
            return;
        }

        const chapterItem = e.target.closest('[data-chapter-id]');
        // Open chapter when clicking item; allow clicks on the title input to also switch chapters
        const clickedTitleInput = e.target.matches('[data-ref="titleInput"]');
        const clickedSummaryInput = e.target.matches('[data-ref="summaryInput"]');
        const clickedToggle = e.target.closest('[data-action="toggle-summary"]');
        if (chapterItem) {
          const id = parseInt(chapterItem.getAttribute('data-chapter-id'), 10);
          if (!isNaN(id)) {
            if (clickedToggle || clickedSummaryInput) {
              // Do nothing; handled elsewhere
              return;
            }
            // If clicking the title input on a non-active chapter, open it and then restore focus
            if (clickedTitleInput) {
              if (this.activeId !== id) {
                const caretPos = e.target.selectionStart ?? null;
                await this.openChapter(id);
                // After render, re-focus the title input of the now-active item and restore caret to end
                queueMicrotask(() => {
                  const input = this.el.querySelector(`[data-chapter-id="${id}"] [data-ref="titleInput"]`);
                  if (input) {
                    input.focus();
                    try {
                      const len = input.value.length;
                      const pos = caretPos == null ? len : Math.min(caretPos, len);
                      input.setSelectionRange(pos, pos);
                    } catch (_) {}
                  }
                });
              }
              return;
            }
            // Clicked elsewhere in the item: open normally
            this.openChapter(id);
          }
        }
      });

      // No-op: editing is always inline now; double-click not needed

      chapterList.addEventListener('keydown', (e) => {
        if (!e.target.matches('[data-ref="titleInput"]')) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.target.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          // Revert to last known title
          const item = e.target.closest('[data-chapter-id]');
          if (item) {
            const id = parseInt(item.getAttribute('data-chapter-id'), 10);
            const chap = this.chapters.find(c => c.id === id);
            if (chap) {
              e.target.value = chap.title || '';
            }
          }
          e.target.blur();
        }
      });

      chapterList.addEventListener('input', (e) => {
        if (e.target.matches('[data-ref="titleInput"]')) {
          this._debouncedSaveTitle(e);
        } else if (e.target.matches('[data-ref="summaryInput"]')) {
          this._debouncedSaveSummary(e);
        }
      });

      chapterList.addEventListener('blur', (e) => {
        if (e.target.matches('[data-ref="titleInput"]')) {
          // Ensure save on blur (debounce already queued)
          this._saveTitle(e);
        }
      }, true);
    }

    // Save button (global header)
    const saveBtn = document.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveContent());
    }

    // Create chapter button
    const createBtn = this.el.querySelector('[data-action="create-chapter"]');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.createChapter());
    }

    // Render mode buttons (scoped to editor toolbar in main pane)
    ['raw','markdown','wysiwyg'].forEach(mode => {
      const btn = this.el.querySelector(`[data-mode="${mode}"]`);
      if (btn) btn.addEventListener('click', () => this.switchRender(mode));
    });

    // Width mode buttons (scoped)
    const widthButtons = this.el.querySelectorAll('[data-action="change-width"]');
    widthButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const direction = btn.dataset.direction;
        const step = 4; // em
        const minWidth = 25; // em
        const maxWidth = 80; // em

        if (direction === 'increase') {
          this.contentWidth = Math.min(maxWidth, this.contentWidth + step);
        } else if (direction === 'decrease') {
          this.contentWidth = Math.max(minWidth, this.contentWidth - step);
        }
      });
    });

    // Font size buttons (scoped)
    const fontSizeButtons = this.el.querySelectorAll('[data-action="change-font-size"]');
    fontSizeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const direction = btn.dataset.direction;
        const step = 0.1; // rem
        const minSize = 0.7; // rem
        const maxSize = 2.0; // rem

        if (direction === 'increase') {
          this.fontSize = Math.min(maxSize, this.fontSize + step);
        } else if (direction === 'decrease') {
          this.fontSize = Math.max(minSize, this.fontSize - step);
        }
      });
    });

    // Raw editor toolbar
    const rawToolbar = this.el.querySelector('[data-raw-toolbar]');
    if (rawToolbar) {
      rawToolbar.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        switch (action) {
          case 'wrap-selection':
            this.wrapSelection(button.dataset.before || '', button.dataset.after || '');
            break;
          case 'insert-heading':
            this.insertHeading();
            break;
          case 'insert-link':
            this.insertLink();
            break;
          case 'toggle-list':
            this.toggleList(button.dataset.prefix);
            break;
          case 'toggle-prefix':
            this.togglePrefix(button.dataset.prefix);
            break;
        }
      });
    }

    // Content textarea
    const textarea = this.el.querySelector('[data-ref="rawEditor"]');
    if (textarea) {
      this._refs.rawEditor = textarea;
      textarea.addEventListener('input', (e) => {
        if (!this._suspendInput) {
          this.content = e.target.value;
          this.onChanged();
        }
      });
    }

    // Chat listeners
    const sendBtn = this.el.querySelector('[data-ref="send"]');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendChatMessage());
    }
    const chatInput = this.el.querySelector('[data-ref="input"]');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendChatMessage();
        }
      });
    }
    const deleteLastBtn = this.el.querySelector('[data-ref="deleteLast"]');
    if (deleteLastBtn) {
      deleteLastBtn.addEventListener('click', () => this.deleteLastChatMessage());
    }
    const regenerateBtn = this.el.querySelector('[data-ref="regenerate"]');
    if (regenerateBtn) {
      regenerateBtn.addEventListener('click', () => this.regenerateLastChatMessage());
    }

    // Story model & actions
    const storyModelSelect = this.$refs.storyModelSelect || this.el.querySelector('[data-ref="storyModelSelect"]');
    if (storyModelSelect) {
      storyModelSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        this.storyCurrentModel = val;
        try { localStorage.setItem('aq.storyModel', val); } catch (_) {}
      });
    }

    const writeSummaryBtn = this.el.querySelector('[data-action="story-write-summary"]');
    if (writeSummaryBtn) {
      writeSummaryBtn.addEventListener('click', () => this.handleWriteSummary());
    }
    const writeChapterBtn = this.el.querySelector('[data-action="story-write-chapter"]');
    if (writeChapterBtn) {
      writeChapterBtn.addEventListener('click', () => this.handleWriteChapter());
    }
    const continueChapterBtn = this.el.querySelector('[data-action="story-continue-chapter"]');
    if (continueChapterBtn) {
      continueChapterBtn.addEventListener('click', () => this.handleContinueChapter());
    }

    const cancelStoryBtn = this.el.querySelector('[data-action="story-cancel"]');
    if (cancelStoryBtn) {
      cancelStoryBtn.addEventListener('click', () => this.cancelStoryAction());
    }
  }

  /**
   * Render chapter list in DOM
   */
  renderChapterList() {
    const list = this.el?.querySelector('[data-chapter-list]');
    if (!list) return;

    list.innerHTML = this.chapters.map(chapter => `
      <li class="chapter-item ${chapter.id === this.activeId ? 'active' : ''} ${chapter.expanded ? 'expanded' : ''}"
          data-chapter-id="${chapter.id}">
        <div class="chapter-header">
            <button class="aq-btn aq-btn-sm aq-btn-icon" data-action="toggle-summary" title="Toggle Summary">
                ${chapter.expanded ? '▼' : '▶'}
            </button>
            <div class="chapter-edit-container" style="flex:1;">
              <input type="text"
                     value="${this.escapeHtml(chapter.title || '')}"
                     placeholder="Untitled"
                     data-ref="titleInput"
                     class="chapter-title-input">
            </div>
        </div>
        ${chapter.expanded ? `
            <div class="chapter-summary-section">
                <div class="summary-edit-container">
                    <textarea data-chapter-id="${chapter.id}"
                              data-ref="summaryInput"
                              class="chapter-summary-input"
                              rows="3"
                              placeholder="Enter summary...">${this.escapeHtml(chapter.summary || '')}</textarea>
                </div>
            </div>
        ` : ''}
      </li>
    `).join('');
    // Refresh refs
    this._scanRefs();
  }

  /**
   * Render save button state
   */
  renderSaveButton() {
    const saveBtn = document.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.disabled = !this.dirty;
      saveBtn.textContent = this.dirty ? 'Save *' : 'Save';
    }
  }

  /**
   * Render content in textarea
   */
  renderContent() {
    const textarea = this.$refs.rawEditor;
    if (textarea && textarea.value !== this.content && !this._suspendInput) {
      this._suspendInput = true;
      textarea.value = this.content;
      this._suspendInput = false;
    }
  }

  /**
   * Render mode button states
   */
  renderModeButtons() {
    ['raw', 'markdown', 'wysiwyg'].forEach(mode => {
      const btn = this.el.querySelector(`[data-mode="${mode}"]`);
      if (btn) {
        const active = this.renderMode === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      }
    });
  }

  /**
   * Render content width (narrow/wide)
   */
  renderContentWidth() {
    this.el.style.gridTemplateColumns = `1fr ${this.contentWidth + 2}em 1fr`;
  }

  /**
   * Render editor font size
   */
  renderFontSize() {
    const cardEl = this.el.querySelector('.aq-card');
    if (cardEl) {
      cardEl.style.fontSize = `${this.fontSize}rem`;
    }
  }

  /**
   * Escape HTML for safe rendering
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Load initial state: rendering preference and chapters
   */
  async load() {
    try {
      // Load story settings to determine render mode preference
      await this._loadRenderMode();

      // Initialize Toast UI if starting in Markdown or WYSIWYG
      if (this.renderMode !== 'raw') {
        const mode = this.renderMode;
        queueMicrotask(() => this._initTUI(mode));
      }

      // Load chapter list
      await this.refreshChapters();
      await this.loadChat();

      // Auto-select first project if none selected
      if (!this.chapters.length) {
        await this.ensureProjectSelected();
      }
    } catch (e) {
      console.error('Failed to load initial state:', e);
    }
  }

  /**
   * Load rendering mode preference from story settings
   */
  async _loadRenderMode() {
    try {
      const story = await API.loadStory();
      if (story && story.format) {
        const format = String(story.format).toLowerCase() || 'markdown';
        if (format === 'raw') {
          this.renderMode = 'raw';
        } else if (format === 'wysiwyg') {
          this.renderMode = 'wysiwyg';
        } else {
          this.renderMode = 'markdown';
        }
      }
    } catch (e) {
      console.error('Failed to load render mode:', e);
    }
  }

  /**
   * Auto-select first available project if none is selected
   */
  async ensureProjectSelected() {
    try {
      const projects = await API.loadProjects();
      const current = projects.current || '';
      const available = Array.isArray(projects.available) ? projects.available : [];

      // Select first project if no current project
      if (!current.trim() && available.length > 0) {
        const firstProject = available[0];
        if (firstProject?.name) {
          const selectResponse = await fetch('/api/projects/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: firstProject.name })
          });

          if (selectResponse.ok) {
            await this.refreshChapters();
          }
        }
      }
    } catch (e) {
      console.error('Failed to auto-select project:', e);
    }
  }

  /**
   * Reload chapter list from API
   */
  async refreshChapters() {
    try {
      const response = await fetch('/api/chapters');
      const data = await response.json();
      this.chapters = Array.isArray(data.chapters) ? data.chapters.map(c => ({...c, expanded: false})) : [];

      // Maintain selection if chapter still exists, otherwise select first
      const hasActiveChapter = this.chapters.some(c => c.id === this.activeId);

      if (!hasActiveChapter && this.chapters.length) {
        await this.openChapter(this.chapters[0].id);
      } else if (!this.chapters.length) {
        this.activeId = null;
        this.content = '';
      }
    } catch (e) {
      console.error('Failed to refresh chapter list:', e);
      this.chapters = [];
    }
  }

  // ========================================
  // Chat
  // ========================================
  async loadChat() {
    try {
      const data = await API.loadChat();
      this.chatModels = data.models || [];
      this.chatCurrentModel = data.current_model || '';
      this.chatMessages = data.messages || [];

      // Initialize story model list from same source for now (separate selection)
      this.storyModels = Array.isArray(data.models) ? data.models.slice() : [];
      const persisted = (() => { try { return localStorage.getItem('aq.storyModel') || ''; } catch (_) { return ''; } })();
      let chosen = '';
      if (persisted && this.storyModels.includes(persisted)) {
        chosen = persisted;
      } else if (this.storyModels.includes(data.current_model)) {
        chosen = data.current_model;
      } else if (this.storyModels.length > 0) {
        chosen = this.storyModels[0];
      } else {
        chosen = '';
      }
      this.storyCurrentModel = chosen;
      if (chosen) {
        try { localStorage.setItem('aq.storyModel', chosen); } catch (_) {}
      }
    } catch (e) {
      console.error('Failed to load chat state', e);
      this.chatMessages = [{ role: 'assistant', content: `Failed to load chat state: ${e.message}` }];
    }
  }

  renderChatModels() {
    const select = this.$refs.modelSelect;
    if (!select) return;
    select.innerHTML = (this.chatModels || []).map(m =>
      `<option value="${m}" ${m === this.chatCurrentModel ? 'selected' : ''}>${m}</option>`
    ).join('');
  }

  // ========================================
  // Story LLM controls
  // ========================================
  renderStoryModels() {
    const select = this.$refs.storyModelSelect || this.el.querySelector('[data-ref="storyModelSelect"]');
    if (!select) return;
    const models = Array.isArray(this.storyModels) ? this.storyModels : [];
    const current = this.storyCurrentModel || '';
    select.innerHTML = models.map(m => `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`).join('');
  }

  async handleWriteSummary() {
    if (this.activeId == null) return;
    const chapter = (this.chapters || []).find(c => c.id === this.activeId) || {};
    const hasExisting = !!(chapter.summary && chapter.summary.trim());
    let mode = 'discard';
    if (hasExisting) {
      const answer = confirm('Summary already exists. OK = discard and write new; Cancel = update existing.');
      mode = answer ? 'discard' : 'update';
    }
    try {
      const data = await fetchJSON('/api/story/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chap_id: this.activeId, mode, model_name: this.storyCurrentModel })
      });
      const updated = (this.chapters || []).map(c => c.id === this.activeId ? { ...c, summary: data.summary || '' } : c);
      this.chapters = updated;
      // Also update inline expanded textarea if visible
      const textarea = this.el.querySelector(`[data-chapter-id="${this.activeId}"][data-ref="summaryInput"]`);
      if (textarea) textarea.value = data.summary || '';
    } catch (e) {
      console.error('Failed to write summary:', e);
      alert(`Failed to write summary: ${e.message || e}`);
    }
  }

  async handleWriteChapter() {
    if (this.activeId == null) return;
    try {
      const data = await fetchJSON('/api/story/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chap_id: this.activeId, model_name: this.storyCurrentModel })
      });
      // Overwrite editor content
      this.content = data.content || '';
      this._originalContent = this.content;
      this.dirty = false;
      this.renderSaveButton();
    } catch (e) {
      console.error('Failed to write chapter:', e);
      alert(`Failed to write chapter: ${e.message || e}`);
    }
  }

  async handleContinueChapter() {
    if (this.activeId == null) return;
    try {
      const data = await fetchJSON('/api/story/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chap_id: this.activeId, model_name: this.storyCurrentModel })
      });
      // Append to editor content
      const appended = data.appended || '';
      this.content = (this.content || '') + ((this.content && !this.content.endsWith('\n')) ? '\n' : '') + appended;
      this._originalContent = this.content;
      this.dirty = false;
      this.renderSaveButton();
    } catch (e) {
      console.error('Failed to continue chapter:', e);
      alert(`Failed to continue chapter: ${e.message || e}`);
    }
  }

  renderChatMessages() {
    const list = this.$refs.chatList;
    if (!list) return;

    if (!this.chatMessages || this.chatMessages.length === 0) {
      list.innerHTML = '<div class="aq-empty">No messages</div>';
      return;
    }

    list.innerHTML = this.chatMessages.map(msg => `
      <div class="aq-bubble ${msg.role}">
        <div class="aq-bubble-head">${this.escapeHtml(msg.role)}</div>
        <div class="aq-bubble-body" contenteditable="true">${this.escapeHtml(msg.content)}</div>
      </div>
    `).join('');
    list.scrollTop = list.scrollHeight;
  }

  renderChatSending() {
    if (this.$refs.send) {
      this.$refs.send.disabled = this.chatSending;
    }
    if (this.$refs.regenerate) {
      this.$refs.regenerate.disabled = this.chatSending;
    }
    if (this.$refs.deleteLast) {
      this.$refs.deleteLast.disabled = this.chatSending;
    }
  }

  deleteLastChatMessage() {
    if (this.chatSending || !this.chatMessages.length) return;
    this.chatMessages = this.chatMessages.slice(0, -1);
  }

  async regenerateLastChatMessage() {
    if (this.chatSending || !this.chatMessages.length) return;
    const lastMessage = this.chatMessages[this.chatMessages.length - 1];
    if (lastMessage.role !== 'assistant') return; // Only regenerate assistant messages

    this.chatMessages = this.chatMessages.slice(0, -1); // Remove the last assistant message
    this.renderChatMessages(); // Re-render to reflect removal

    await this.sendChatMessage(true); // Re-send the last user message or continue the conversation
  }

  async sendChatMessage(isRegenerate = false) {
    if (this.chatSending && !isRegenerate) return; // Prevent sending new messages if already sending
    if (this.chatSending && isRegenerate) { // If regenerating, bypass input checks
        // Continue with the existing chat history
    }

    const input = this.$refs.input;
    const roleSelect = this.$refs.roleSelect;

    let content = '';
    let role = 'user';

    if (!isRegenerate) {
        if (!input || !roleSelect) return;
        content = input.value.trim();
        if (!content) return;
        role = roleSelect.value;
    } else {
        // When regenerating, we assume the previous context is sufficient.
        // If there's a user message preceding the removed assistant message,
        // it serves as the prompt for regeneration.
        // We don't need to read from the input field.
    }


    if (!isRegenerate) {
        const newMessage = { role, content };
        this.chatMessages = [...this.chatMessages, newMessage];
        input.value = '';
        input.focus();
    }


    if (role === 'user' || isRegenerate) { // Always query if it's a user message or regeneration
      this.chatSending = true;
      try {
        const messagesToSend = this.chatMessages.map(m => ({ role: m.role, content: m.content }));
        const response = await fetchJSON('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: messagesToSend,
            model: this.$refs.modelSelect.value
          })
        });

        if (response.message) {
          this.chatMessages = [...this.chatMessages, response.message];
        }
      } catch (e) {
        let errorMessage = 'An unknown error occurred';
        if (e) {
          if (typeof e.message === 'string') {
            errorMessage = e.message;
          } else if (typeof e.message === 'object' && e.message !== null) {
            try {
              errorMessage = JSON.stringify(e.message);
            } catch (jsonError) {
              errorMessage = String(e.message);
            }
          } else if (typeof e === 'object' && e !== null) {
            try {
              errorMessage = JSON.stringify(e);
            } catch (jsonError) {
              errorMessage = String(e);
            }
          } else {
            errorMessage = String(e);
          }
        }
        this.chatMessages = [...this.chatMessages, { role: 'assistant', content: `Error: ${errorMessage}` }];
      } finally {
        this.chatSending = false;
      }
    }
  }


  // Integrated editor helpers
  getRawEl() {
    return this.$refs?.rawEditor || this.el?.querySelector('[data-ref="rawEditor"]') || null;
  }

  getEditorEl() {
    if (this.renderMode !== 'raw' && this._tui && this._tuiEl) {
      return this._tuiEl;
    }
    return this.getRawEl();
  }

  /**
   * Render markdown content into the WYSIWYG editor
   */
  async setEditorHtmlFromContent() {
    if (this._tui) {
      this._suspendInput = true;
      try {
        const contentValue = await Promise.resolve(this.content || '');
        this._tui.setMarkdown(String(contentValue));
      } finally {
        this._suspendInput = false;
      }
      return;
    }
    const textarea = this.getRawEl();
    if (!textarea) return;
    // Raw textarea already reflects content binding
  }

  /**
   * Capture the current Y position of the caret/editor for scroll adjustment
   */
  _captureAnchorY() {
    const editor = this.getEditorEl();
    if (!editor) return window.scrollY;

    // In markdown mode, use selection position if available
    if (this.renderMode === 'markdown') {
      try {
        const selection = window.getSelection();
        if (selection?.rangeCount) {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          if (rect && rect.height >= 0) {
            return rect.top;
          }
        }
      } catch (_) {
        // Fall through to editor position
      }
    }

    return editor.getBoundingClientRect().top;
  }

  /**
   * Adjust scroll position to maintain visual anchor after mode switch
   */
  _scrollAdjust(oldY) {
    try {
      const newY = this._captureAnchorY();
      const delta = newY - oldY;

      if (delta !== 0) {
        window.scrollBy(0, delta);
      }
    } catch (_) {
      // Scroll adjustment is non-critical
    }
  }

  /**
   * Switch between raw textarea, Toast Markdown, and Toast WYSIWYG
   * Preserves caret/scroll position where possible
   */
  switchRender(mode) {
    const m = String(mode || '').toLowerCase();
    const normalized = (m === 'raw' || m === 'markdown' || m === 'wysiwyg') ? m : 'raw';
    if (this.renderMode === normalized) return;

    const oldScrollY = this._captureAnchorY();

    if (normalized === 'raw') {
      this._destroyTUI();
    } else {
      this._destroyTUI();
      this._initTUI(normalized, this.content);
    }

    this.renderMode = normalized;
    this._scrollAdjust(oldScrollY);
  }

  /**
   * Initialize Toast UI Editor on top of the textarea
   */
  _initTUI(mode = 'wysiwyg', initialContent = null) {
    try {
      const textarea = this.getRawEl();
      if (!textarea) return false;
      if (!(window.toastui && window.toastui.Editor)) {
        console.warn('Toast UI Editor not loaded; staying in raw mode');
        return false;
      }

      textarea.style.display = 'none';

      if (this._tui) {
        this._tui.changeMode(mode);
        this.setEditorHtmlFromContent();
        return true;
      }

      const container = document.createElement('div');
      container.className = 'aq-tui-wrap';
      textarea.parentNode.insertBefore(container, textarea);
      this._tuiEl = container;

      const content = initialContent !== null ? initialContent : (this.content || '');

      this._tui = new window.toastui.Editor({
        el: container,
        initialEditType: mode === 'wysiwyg' ? 'wysiwyg' : 'markdown',
        previewStyle: 'tab',
        height: '100%',
        usageStatistics: false,
        toolbarItems: [
          ['heading', 'bold', 'italic', 'strike'],
          ['hr', 'quote'],
          ['ul', 'ol', 'task', 'indent', 'outdent'],
          ['table', 'link'],
          ['code', 'codeblock']
        ],
        hideModeSwitch: true,
        initialValue: content
      });

      this._tui.on('change', () => {
        if (this._suspendInput) return;
        try {
          this.content = this._tui.getMarkdown();
          this.onChanged();
        } catch (_) { /* no-op */ }
      });

      return true;
    } catch (e) {
      console.error('Failed to init Toast UI Editor:', e);
      return false;
    }
  }

  /**
   * Destroy Toast UI instance and restore textarea
   */
  _destroyTUI() {
    if (!this._tui) return;
    try {
      const textarea = this.getRawEl();
      this._suspendInput = true;
      try {
        this.content = this._tui.getMarkdown();
      } finally {
        this._suspendInput = false;
      }
      this._tui.destroy();
      this._tui = null;
      if (this._tuiEl && this._tuiEl.parentNode) {
        this._tuiEl.parentNode.removeChild(this._tuiEl);
      }
      this._tuiEl = null;
      if (textarea) textarea.style.display = '';
    } catch (e) {
      console.error('Failed to destroy Toast UI Editor:', e);
      this._tui = null;
      this._tuiEl = null;
    }
  }

  /**
   * Mark content as changed (dirty tracking)
   */
  onChanged() {
    this.dirty = this.content !== this._originalContent;
  }

  /**
   * Confirm with user before discarding unsaved changes
   */
  _confirmDiscardIfDirty() {
    if (!this.dirty) return true;
    return confirm('You have unsaved changes. Discard them?');
  }

  // ========================================
  // Toolbar Commands (Raw Mode)
  // ========================================

  _replaceSelection(before, after) {
    const textarea = this.getRawEl();
    if (!textarea) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const selected = this.content.slice(start, end);

    this.content =
      this.content.slice(0, start) +
      before + selected + after +
      this.content.slice(end);

    queueMicrotask(() => {
      textarea.focus();
      const newPosition = start + before.length + selected.length + after.length;
      textarea.setSelectionRange(newPosition, newPosition);
    });

    this.onChanged();
  }

  wrapSelection(before, after) {
    this._replaceSelection(before, after);
  }

  insertHeading() {
    const textarea = this.getRawEl();
    if (!textarea) return;

    const caretPos = textarea.selectionStart || 0;
    const lineStart = this.content.lastIndexOf('\n', caretPos - 1) + 1;

    this.content =
      this.content.slice(0, lineStart) +
      '# ' +
      this.content.slice(lineStart);

    this.onChanged();
  }

  insertLink() {
    const textarea = this.getRawEl();
    if (!textarea) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const selected = this.content.slice(start, end) || 'text';

    const url = prompt('Enter URL', 'https://');
    if (url === null) return; // User cancelled

    const linkMarkdown = `[${selected}](${url || ''})`;
    this.content =
      this.content.slice(0, start) +
      linkMarkdown +
      this.content.slice(end);

    this.onChanged();
  }

  togglePrefix(prefix) {
    const textarea = this.getRawEl();
    if (!textarea) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const lines = this.content.split(/\r?\n/);

    const startLineIdx = this._findLineIndex(lines, start);
    const endLineIdx = this._findLineIndex(lines, end);

    for (let i = startLineIdx; i <= endLineIdx; i++) {
      if (lines[i].startsWith(prefix)) {
        lines[i] = lines[i].slice(prefix.length);
      } else {
        lines[i] = prefix + lines[i];
      }
    }

    this.content = lines.join('\n');
    this.onChanged();
  }

  _findLineIndex(lines, offset) {
    let position = 0;
    for (let i = 0; i < lines.length; i++) {
      if (position + lines[i].length >= offset) {
        return i;
      }
      position += lines[i].length + 1; // +1 for newline
    }
    return lines.length - 1;
  }

  toggleList(prefix = '- ') {
    this.togglePrefix(prefix);
  }

  // ========================================
  // Content Management
  // ========================================

  async saveContent() {
    if (this.activeId == null) return;

    try {
      const cleanContent = this.content || '';

      await fetchJSON(`/api/chapters/${this.activeId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: cleanContent })
      });

      this.content = cleanContent;
      this._originalContent = this.content;
      this.dirty = false;
      this._toast('Saved', 'success');
    } catch (e) {
      this._toast(`Failed to save: ${e.message || e}`, 'error');
    }
  }

  async openChapter(id) {
    if (id == null) return;

    if (this.activeId !== null && id !== this.activeId) {
      if (!this._confirmDiscardIfDirty()) return;
    }

    this.editingId = null;
    this.editingTitle = '';

    try {
      const data = await fetchJSON(`/api/chapters/${id}`);

      this.activeId = data.id;
      this.content = data.content || '';
      this._originalContent = this.content;
      this.chapters = this.chapters.map(c => c.id === id ? { ...c, summary: data.summary || '', expanded: false } : c); // Update chapter in list with summary
      this._originalSummaryContent = data.summary || ''; // Store original summary for dirty tracking
      this.dirty = false;

      queueMicrotask(() => {
        if (this.renderMode !== 'raw') {
          this._initTUI(this.renderMode, this.content);
        }
      });
    } catch (e) {
      this.content = `Error loading chapter: ${e.message || e}`;
      this._originalContent = this.content;
      this.dirty = false;
    }
  }

  startEdit(chapter) {
    this.activeId = chapter.id;
    this.editingId = chapter.id;
    this.editingTitle = chapter.title || '';
  }

  async saveEdit() {
    if (this.editingId == null) return;

    const id = this.editingId;
    const title = this.editingTitle?.trim() || '';

    try {
      const data = await fetchJSON(`/api/chapters/${id}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });

      this.chapters = this.chapters.map(c =>
        c.id === id ? { ...c, title: data.chapter.title } : c
      );
    } catch (e) {
      alert(`Failed to save title: ${e.message || e}`);
    } finally {
      this.editingId = null;
      this.editingTitle = '';
    }
  }

  cancelEdit() {
    this.editingId = null;
    this.editingTitle = '';
  }

  toggleSummary(id) {
    this.chapters = this.chapters.map(c =>
      c.id === id ? { ...c, expanded: !c.expanded } : c
    );
  }

  /**
   * Debounce utility function
   */
  _debounce(func, delay) {
    let timeout;
    return function(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), delay);
    };
  }

  async _saveSummary(event) {
    const textarea = event.target;
    if (!textarea || !textarea.matches('[data-ref="summaryInput"]')) return;

    const id = parseInt(textarea.getAttribute('data-chapter-id'), 10);
    const summary = textarea.value.trim();

    if (isNaN(id) || id === null) return;

    try {
      const data = await fetchJSON(`/api/chapters/${id}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary })
      });

      this.chapters = this.chapters.map(c =>
        c.id === id ? { ...c, summary: data.chapter.summary } : c
      );
      this._originalSummaryContent = summary; // Update original content after save
    } catch (e) {
      console.error(`Failed to save summary for chapter ${id}: ${e.message || e}`);
      alert(`Failed to save summary: ${e.message || e}`);
      // Optionally, revert the textarea to _originalSummaryContent or show an error state
    }
  }

  async _saveTitle(event) {
    const input = event?.target;
    if (!input || !input.matches('[data-ref="titleInput"]')) return;
    const item = input.closest('[data-chapter-id]');
    if (!item) return;
    const id = parseInt(item.getAttribute('data-chapter-id'), 10);
    if (isNaN(id)) return;
    const title = String(input.value || '').trim();
    try {
      const data = await fetchJSON(`/api/chapters/${id}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      // Avoid re-rendering the whole list to preserve focus; mutate in place
      const idx = this.chapters.findIndex(c => c.id === id);
      if (idx !== -1) {
        this.chapters[idx].title = data.chapter.title;
      }
    } catch (e) {
      console.error(`Failed to save title for chapter ${id}:`, e);
    }
  }

  async createChapter() {
    try {
      const data = await fetchJSON('/api/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', content: '' })
      });

      await this.refreshChapters();

      const newId = data.chapter?.id;
      if (newId != null) {
        const chapter = this.chapters.find(c => c.id === newId) || data.chapter;
        this.activeId = newId;
        this.startEdit(chapter);
      }
    } catch (e) {
      alert(`Failed to create chapter: ${e.message || e}`);
    }
  }

  // ========================================
  // View Rendering
  // ========================================

  renderMainView() {
    const emptyView = this.el.querySelector('[data-view="empty"]');
    const chapterView = this.el.querySelector('[data-view="chapter"]');
    if (!emptyView || !chapterView) return;

    const isChapterOpen = this.activeId !== null;
    emptyView.style.display = isChapterOpen ? 'none' : 'block';
    chapterView.style.display = isChapterOpen ? 'flex' : 'none';

    if (isChapterOpen) {
      const activeIdEl = this.el.querySelector('[data-active-id]');
      if (activeIdEl) activeIdEl.textContent = this.activeId;
    }
  }

  renderDirtyState() {
    const dirtyIndicator = document.querySelector('[data-dirty-indicator]');
    if (dirtyIndicator) {
      dirtyIndicator.style.display = this.dirty ? 'inline' : 'none';
    }
    try {
      document.body?.setAttribute('data-dirty', this.dirty ? 'true' : 'false');
    } catch (_) {}
    this.renderSaveButton();
  }

  renderRawEditorToolbar() {
    const toolbar = this.el.querySelector('[data-raw-toolbar]');
    const textarea = this.el.querySelector('[data-ref="rawEditor"]');
    if (!toolbar || !textarea) return;

    const show = this.renderMode === 'raw';
    toolbar.style.display = show ? 'flex' : 'none';
    textarea.style.display = show ? 'block' : 'none';
  }

  // =============================
  // Story streaming UX
  // =============================
  renderStoryBusy() {
    const summaryBtn = this.el.querySelector('[data-action="story-write-summary"]');
    const writeBtn = this.el.querySelector('[data-action="story-write-chapter"]');
    const continueBtn = this.el.querySelector('[data-action="story-continue-chapter"]');
    const cancelBtn = this.el.querySelector('[data-action="story-cancel"]');
    const busy = !!this.storyBusy;
    [summaryBtn, writeBtn, continueBtn].forEach(btn => { if (btn) btn.disabled = busy; });
    if (cancelBtn) {
      cancelBtn.style.display = busy ? 'inline-block' : 'none';
    }
  }

  // =============================
  // Toasts
  // =============================
  _ensureToastHost() {
    let host = document.querySelector('.aq-toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'aq-toasts';
      document.body.appendChild(host);
    }
    return host;
  }

  _toast(message, variant = 'info', timeoutMs = 2500) {
    const host = this._ensureToastHost();
    const el = document.createElement('div');
    el.className = `aq-toast ${variant}`;
    el.textContent = message;
    host.appendChild(el);
    window.setTimeout(() => {
      try { el.remove(); } catch (_) {}
      if (!host.childElementCount) host.remove();
    }, timeoutMs);
  }

  cancelStoryAction() {
    if (this._storyAbortController) {
      try { this._storyAbortController.abort(); } catch (_) {}
    }
  }

  async _streamFetch(url, body, onChunk) {
    const controller = new AbortController();
    this._storyAbortController = controller;
    this.storyBusy = true;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (resp.status === 404) {
        throw Object.assign(new Error('Streaming not supported (404)'), { code: 404 });
      }
      if (!resp.ok || !resp.body) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) onChunk(chunk);
      }
    } finally {
      this.storyBusy = false;
      this._storyAbortController = null;
    }
  }

  async handleWriteSummary() {
    if (this.activeId == null) return;
    const chapter = (this.chapters || []).find(c => c.id === this.activeId) || {};
    const hasExisting = !!(chapter.summary && chapter.summary.trim());
    let mode = 'discard';
    if (hasExisting) {
      const answer = confirm('Summary already exists. OK = discard and write new; Cancel = update existing.');
      mode = answer ? 'discard' : 'update';
    }
    // Try streaming endpoint first
    try {
      const textarea = this.el.querySelector(`[data-chapter-id="${this.activeId}"][data-ref="summaryInput"]`);
      let accum = '';
      await this._streamFetch('/api/story/summary/stream', { chap_id: this.activeId, mode, model_name: this.storyCurrentModel }, (chunk) => {
        accum += chunk;
        if (textarea) textarea.value = accum;
      });
      // On completion, update chapters state but do not persist here (server didn’t persist). Caller can save manually or rely on debounce.
      this.chapters = this.chapters.map(c => c.id === this.activeId ? { ...c, summary: (textarea ? textarea.value : accum) } : c);
    } catch (err) {
      if (err && err.code === 404) {
        // Fallback to non-streaming
        try {
          const data = await fetchJSON('/api/story/summary', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chap_id: this.activeId, mode, model_name: this.storyCurrentModel })
          });
          const updated = (this.chapters || []).map(c => c.id === this.activeId ? { ...c, summary: data.summary || '' } : c);
          this.chapters = updated;
          const textarea = this.el.querySelector(`[data-chapter-id="${this.activeId}"][data-ref="summaryInput"]`);
          if (textarea) textarea.value = data.summary || '';
        } catch (e) {
          alert(`Failed to write summary: ${e.message || e}`);
        }
      } else if (!(err && err.name === 'AbortError')) {
        alert(`Summary request failed: ${err.message || err}`);
      }
    }
  }

  async handleWriteChapter() {
    if (this.activeId == null) return;
    try {
      let accum = '';
      await this._streamFetch('/api/story/write/stream', { chap_id: this.activeId, model_name: this.storyCurrentModel }, (chunk) => {
        accum += chunk;
        this.content = accum;
      });
      // On completion, leave content in editor; user can Save.
      this._originalContent = this.content;
      this.dirty = false;
      this.renderSaveButton();
    } catch (err) {
      if (err && err.code === 404) {
        // Fallback to non-streaming
        try {
          const data = await fetchJSON('/api/story/write', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chap_id: this.activeId, model_name: this.storyCurrentModel })
          });
          this.content = data.content || '';
          this._originalContent = this.content;
          this.dirty = false;
          this.renderSaveButton();
        } catch (e) {
          alert(`Failed to write chapter: ${e.message || e}`);
        }
      } else if (!(err && err.name === 'AbortError')) {
        alert(`Write request failed: ${err.message || err}`);
      }
    }
  }

  async handleContinueChapter() {
    if (this.activeId == null) return;
    try {
      let accum = '';
      const base = this.content || '';
      await this._streamFetch('/api/story/continue/stream', { chap_id: this.activeId, model_name: this.storyCurrentModel }, (chunk) => {
        accum += chunk;
        const sep = base && !base.endsWith('\n') ? '\n' : '';
        this.content = base + sep + accum;
      });
      this._originalContent = this.content;
      this.dirty = false;
      this.renderSaveButton();
    } catch (err) {
      if (err && err.code === 404) {
        try {
          const data = await fetchJSON('/api/story/continue', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chap_id: this.activeId, model_name: this.storyCurrentModel })
          });
          this.content = data.content || '';
          this._originalContent = this.content;
          this.dirty = false;
          this.renderSaveButton();
        } catch (e) {
          alert(`Failed to continue chapter: ${e.message || e}`);
        }
      } else if (!(err && err.name === 'AbortError')) {
        alert(`Continue request failed: ${err.message || err}`);
      }
    }
  }
}

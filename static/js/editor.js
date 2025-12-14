import { fetchJSON, API } from './utils.js';
import { Component } from './component.js';
import { RENDER_MODES, EVENTS, DEFAULTS, UI_STRINGS } from './editorConstants.js';
import { ChapterRenderer } from './chapterRenderer.js';
import { ContentEditor } from './contentEditor.js';
import { StoryActions } from './storyActions.js';
import { FlowMode } from './flowMode.js';
import { debounce, toast } from './editorUtils.js';

/**
 * Chapter Editor Component
 * Provides a comprehensive interface for editing story chapters with multiple rendering modes,
 * AI-assisted writing features, and real-time collaboration capabilities.
 * Integrates with backend APIs for persistence and AI services for content generation.
 */
export class ShellView extends Component {
  /**
   * @param {HTMLElement} element - The root element for the shell view.
   */
  constructor(element) {
    const initialState = {
      chapters: [],
      activeId: null,
      content: '',
      renderMode: RENDER_MODES.RAW,
      contentWidth: DEFAULTS.CONTENT_WIDTH, // em units
      fontSize: DEFAULTS.FONT_SIZE, // rem units
      dirty: false,
      _originalContent: '',
      _originalSummaryContent: '', // Added for summary dirty tracking
      editingId: null,
      editingTitle: '',
      _suspendInput: false,
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
    this._debouncedSaveSummary = debounce(this._saveSummary.bind(this), DEFAULTS.DEBOUNCE_SUMMARY); // Debounce by 1 second
    this._debouncedSaveTitle = debounce(this._saveTitle.bind(this), DEFAULTS.DEBOUNCE_TITLE);
    this._storyAbortController = null;

    // Flow mode state (two-choice sentence suggestions)
    this._defineReactive('flowActive', false);
    this._defineReactive('flowBusy', false);
    this._defineReactive('flowLeft', '');
    this._defineReactive('flowRight', '');
    this._flowLastContent = undefined; // For undo functionality

    // Sub-components
    this.chapterRenderer = new ChapterRenderer(this);
    this.contentEditor = new ContentEditor(this);
    this.storyActions = new StoryActions(this);
    this.flowMode = new FlowMode(this);
  }

  /**
   * Initialize the shell view component
   */
  init() {
    super.init();

    // Watch for state changes to update DOM
    this.watch('chapters', () => this.chapterRenderer.renderChapterList());
    this.watch('activeId', () => {
      // Reset Flow mode when switching chapters to avoid mixing contexts
      if (this.flowActive) this.flowMode.handleFlowStop();
      this.chapterRenderer.renderChapterList();
      this.chapterRenderer.renderMainView();
    });
    this.watch('editingId', () => this.chapterRenderer.renderChapterList());
    this.watch('dirty', () => this.chapterRenderer.renderDirtyState());
    this.watch('content', () => this.contentEditor.renderContent());
    this.watch('renderMode', () => {
      try { localStorage.setItem('aq:renderMode', this.renderMode); } catch (e) { console.warn('Failed to save render mode to localStorage:', e); }
      this.contentEditor.renderModeButtons();
      this.contentEditor.renderRawEditorToolbar();
    });
    this.watch('contentWidth', () => this.contentEditor.renderContentWidth());
    this.watch('fontSize', () => this.contentEditor.renderFontSize());
    this.watch('storyModels', () => this.storyActions.renderStoryModels());
    this.watch('storyBusy', () => this.storyActions.renderStoryBusy());

    // Flow mode watchers
    this.watch('flowActive', () => this.flowMode.renderFlowUI());
    this.watch('flowBusy', () => this.flowMode.renderFlowUI());
    this.watch('flowLeft', () => this.flowMode.renderFlowUI());
    this.watch('flowRight', () => this.flowMode.renderFlowUI());


    // Listen for project changes from settings page
    this._onProjectSelected = () => { this.refreshChapters(); };
    document.addEventListener(EVENTS.PROJECT_SELECTED, this._onProjectSelected);

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
    document.addEventListener(EVENTS.STORY_UPDATED, this._onStoryUpdated);

    this._onMachineUpdated = () => {
      // Reload story models and chapters to reflect new configuration
      Promise.resolve(this.loadChat()); // loadChat now only loads story models if needed
      Promise.resolve(this.refreshChapters());
    };
    document.addEventListener(EVENTS.MACHINE_UPDATED, this._onMachineUpdated);

    // Keyboard shortcut: Ctrl/Cmd+S to save
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (this.dirty) {
          this.saveContent();
        }
      }
    });

    // Global keyboard for Flow mode: ← / → to pick, ↓ to discard
    window.addEventListener('keydown', (e) => {
      if (!this.flowActive) return;
      if (['INPUT', 'TEXTAREA'].includes((document.activeElement && document.activeElement.tagName) || '')) {
        // still allow when in editor, but we'll handle explicitly
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.flowMode._flowPick('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.flowMode._flowPick('right');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.flowMode._flowDiscard();
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
      if (savedMode === RENDER_MODES.RAW || savedMode === RENDER_MODES.MARKDOWN || savedMode === RENDER_MODES.WYSIWYG) {
        this.renderMode = savedMode;
      }
    } catch (_) {}

    this.load();
    this.chapterRenderer.renderMainView();
    this.contentEditor.renderRawEditorToolbar();
    this.contentEditor.renderContentWidth();
    this.contentEditor.renderFontSize();
  }

  destroy() {
    try {
      if (this._onProjectSelected) document.removeEventListener(EVENTS.PROJECT_SELECTED, this._onProjectSelected);
      if (this._onStoryUpdated) document.removeEventListener(EVENTS.STORY_UPDATED, this._onStoryUpdated);
      if (this._onMachineUpdated) document.removeEventListener(EVENTS.MACHINE_UPDATED, this._onMachineUpdated);
    } catch (e) { console.warn('Failed to remove event listeners in destroy:', e); }
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
            if (clickedToggle) {
              // Do nothing; handled elsewhere
              return;
            }
            // If clicking the title input on a non-active chapter, open it and then restore focus
            if (clickedTitleInput || clickedSummaryInput) {
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
    [RENDER_MODES.RAW, RENDER_MODES.MARKDOWN, RENDER_MODES.WYSIWYG].forEach(mode => {
      const btn = this.el.querySelector(`[data-mode="${mode}"]`);
      if (btn) btn.addEventListener('click', () => this.contentEditor.switchRender(mode));
    });

    // Width mode buttons (scoped)
    const widthButtons = document.querySelectorAll('[data-action="change-width"]');
    widthButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const direction = btn.dataset.direction;
        const step = DEFAULTS.WIDTH_STEP; // em
        const minWidth = DEFAULTS.MIN_WIDTH; // em
        const maxWidth = DEFAULTS.MAX_WIDTH; // em

        if (direction === 'increase') {
          this.contentWidth = Math.min(maxWidth, this.contentWidth + step);
        } else if (direction === 'decrease') {
          this.contentWidth = Math.max(minWidth, this.contentWidth - step);
        }
      });
    });

    // Font size buttons (scoped)
    const fontSizeButtons = document.querySelectorAll('[data-action="change-font-size"]');
    fontSizeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const direction = btn.dataset.direction;
        const step = DEFAULTS.FONT_STEP; // rem
        const minSize = DEFAULTS.MIN_FONT; // rem
        const maxSize = DEFAULTS.MAX_FONT; // rem

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

    // Story model & actions
    const storyModelSelect = this.$refs.storyModelSelect || document.querySelector('[data-ref="storyModelSelect"]');
    if (storyModelSelect) {
      storyModelSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        this.storyCurrentModel = val;
        try { localStorage.setItem('aq.storyModel', val); } catch (e) { console.warn('Failed to save story model to localStorage:', e); }
      });
    }

    const writeSummaryBtn = document.querySelector('[data-action="story-write-summary"]');
    if (writeSummaryBtn) {
      writeSummaryBtn.addEventListener('click', () => this.storyActions.handleWriteSummary());
    }
    const writeChapterBtn = document.querySelector('[data-action="story-write-chapter"]');
    if (writeChapterBtn) {
      writeChapterBtn.addEventListener('click', () => this.storyActions.handleWriteChapter());
    }
    const continueChapterBtn = document.querySelector('[data-action="story-continue-chapter"]');
    if (continueChapterBtn) {
      continueChapterBtn.addEventListener('click', () => this.storyActions.handleContinueChapter());
    }

    const cancelStoryBtn = document.querySelector('[data-action="story-cancel"]');
    if (cancelStoryBtn) {
      cancelStoryBtn.addEventListener('click', () => this.storyActions.cancelStoryAction());
    }

    // Flow mode buttons
    const flowStartBtn = this.el.querySelector('[data-action="flow-start"]');
    if (flowStartBtn) {
      flowStartBtn.addEventListener('click', () => this.flowMode.handleFlowStart());
    }
    const flowStopBtn = this.el.querySelector('[data-action="flow-stop"]');
    if (flowStopBtn) {
      flowStopBtn.addEventListener('click', () => this.flowMode.handleFlowStop());
    }
    const flowPickLeft = this.el.querySelector('[data-action="flow-pick-left"]');
    if (flowPickLeft) {
      flowPickLeft.addEventListener('click', () => this.flowMode._flowPick('left'));
    }
    const flowPickRight = this.el.querySelector('[data-action="flow-pick-right"]');
    if (flowPickRight) {
      flowPickRight.addEventListener('click', () => this.flowMode._flowPick('right'));
    }
    const flowDiscard = this.el.querySelector('[data-action="flow-discard"]');
    if (flowDiscard) {
      flowDiscard.addEventListener('click', () => this.flowMode._flowDiscard());
    }
    const flowRedo = this.el.querySelector('[data-action="flow-redo"]');
    if (flowRedo) {
      flowRedo.addEventListener('click', () => this.flowMode.handleFlowRedo());
    }

    // Flow mode keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.flowActive) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.flowMode.handleFlowRedo();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.flowMode.handleFlowStop();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.flowMode._flowDiscard();
      }
    });
  }

  /**
   * Confirm with user before discarding unsaved changes
   */
  _confirmDiscardIfDirty() {
    if (!this.dirty) return true;
    return confirm('You have unsaved changes. Discard them?');
  }

  /**
   * Load initial state: rendering preference and chapters
   */
  async load() {
    try {
      // Load story settings to determine render mode preference
      await this._loadRenderMode();

      // Load story models
      await this.loadChat();

      // Initialize Toast UI if starting in Markdown or WYSIWYG
      if (this.renderMode !== RENDER_MODES.RAW) {
        const mode = this.renderMode;
        queueMicrotask(() => this.contentEditor._initTUI(mode));
      }

      // Load chapter list
      await this.refreshChapters();
      // Chat is now handled by ChatView component; don't duplicate here

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
          this.renderMode = RENDER_MODES.RAW;
        } else if (format === 'wysiwyg') {
          this.renderMode = RENDER_MODES.WYSIWYG;
        } else {
          this.renderMode = RENDER_MODES.MARKDOWN;
        }
      }
    } catch (e) {
      console.error('Failed to load render mode:', e);
    }
  }

  /**
   * Load story models from machine configuration
   */
  async loadChat() {
    try {
      const machine = await fetchJSON('/api/machine');
      const openai = (machine && machine.openai) || {};
      const modelsList = Array.isArray(openai.models) ? openai.models : [];
      const modelNames = modelsList.map(m => m.name).filter(Boolean);
      
      // If no named models, check for legacy single model
      if (!modelNames.length) {
        const legacyModel = openai.model;
        if (legacyModel) {
          modelNames.push('default');
        }
      }
      
      this.storyModels = modelNames;
      const selected = openai.selected || '';
      if (selected && modelNames.includes(selected)) {
        this.storyCurrentModel = selected;
      } else if (!this.storyCurrentModel && modelNames.length) {
        this.storyCurrentModel = modelNames[0];
      }
    } catch (e) {
      console.error('Failed to load story models:', e);
      this.storyModels = [];
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
  // Story LLM actions (streaming-enabled)
  // ========================================

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
          toast(`Failed to write summary: ${e.message || e}`, 'error');
        }
      } else if (!(err && err.name === 'AbortError')) {
        toast(`Summary request failed: ${err.message || err}`, 'error');
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
      this.chapterRenderer.renderSaveButton();
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
          this.chapterRenderer.renderSaveButton();
        } catch (e) {
          toast(`Failed to write chapter: ${e.message || e}`, 'error');
        }
      } else if (!(err && err.name === 'AbortError')) {
        toast(`Write request failed: ${err.message || err}`, 'error');
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
      this.chapterRenderer.renderSaveButton();
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
          this.chapterRenderer.renderSaveButton();
        } catch (e) {
          toast(`Failed to continue chapter: ${e.message || e}`, 'error');
        }
      } else if (!(err && err.name === 'AbortError')) {
        toast(`Continue request failed: ${err.message || err}`, 'error');
      }
    }
  }

  // =============================
  // Toasts (Moved up where used)
  // =============================

  // =============================
  // Remaining Editor helpers (wrapping, selection, saving, etc.)
  // =============================

  // Toolbar Commands (Raw Mode)
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
      toast(UI_STRINGS.SAVED, 'success');
    } catch (e) {
      toast(UI_STRINGS.FAILED_SAVE + (e.message || e), 'error');
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
      this.chapters = this.chapters.map(c => c.id === id ? { ...c, summary: data.summary || '' } : c); // Update chapter in list with summary
      this._originalSummaryContent = data.summary || ''; // Store original summary for dirty tracking
      this.dirty = false;

      queueMicrotask(() => {
        if (this.renderMode !== RENDER_MODES.RAW) {
          this.contentEditor._initTUI(this.renderMode, this.content);
        }
      });
    } catch (e) {
      this.content = UI_STRINGS.ERROR_LOADING + (e.message || e);
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
      toast(`Failed to save title: ${e.message || e}`, 'error');
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
      toast(`Failed to save summary: ${e.message || e}`, 'error');
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
      toast(`Failed to create chapter: ${e.message || e}`, 'error');
    }
  }

  // ========================================
  // Remaining editor helpers
  // ========================================

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
}

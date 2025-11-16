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
      editingId: null,
      editingTitle: '',
      _suspendInput: false,
    };

    super(element, initialState);

    // Non-reactive properties
    this._tui = null;
    this._tuiEl = null;
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
      this.renderModeButtons();
      this.renderRawEditorToolbar();
    });
    this.watch('contentWidth', () => this.renderContentWidth());
    this.watch('fontSize', () => this.renderFontSize());

    // Listen for project changes from settings page
    document.addEventListener('aq:project-selected', () => {
      this.refreshChapters();
    });

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

    this.load();
    this.renderMainView();
    this.renderRawEditorToolbar();
    this.renderContentWidth();
    this.renderFontSize();
  }

  /**
   * Setup event listeners for UI interactions
   */
  _setupEventListeners() {
    if (!this.el) return;

    // Delegate chapter list clicks
    const chapterList = this.el.querySelector('[data-chapter-list]');
    if (chapterList) {
      chapterList.addEventListener('click', (e) => {
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

        const chapterItem = e.target.closest('[data-chapter-id]');
        // Do not trigger openChapter if we are clicking inside an editing area
        if (chapterItem && !chapterItem.querySelector('.chapter-edit-container')) {
          const id = parseInt(chapterItem.getAttribute('data-chapter-id'), 10);
          if (!isNaN(id)) {
            this.openChapter(id);
          }
        }
      });

      chapterList.addEventListener('dblclick', (e) => {
        const titleSpan = e.target.closest('[data-action="edit-title"]');
        if (titleSpan) {
          const chapterItem = titleSpan.closest('[data-chapter-id]');
          if (chapterItem) {
            const id = parseInt(chapterItem.getAttribute('data-chapter-id'), 10);
            const chapter = this.chapters.find(c => c.id === id);
            if (chapter) {
              this.startEdit(chapter);
            }
          }
        }
      });

      chapterList.addEventListener('keydown', (e) => {
        if (this.editingId === null || !e.target.matches('[data-ref="titleInput"]')) return;

        if (e.key === 'Enter') {
          e.preventDefault();
          this.saveEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.cancelEdit();
        }
      });

      chapterList.addEventListener('input', (e) => {
        if (this.editingId === null || !e.target.matches('[data-ref="titleInput"]')) return;
        this.editingTitle = e.target.value;
      });
    }

    // Save button
    const saveBtn = document.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveContent());
    }

    // Create chapter button
    const createBtn = this.el.querySelector('[data-action="create-chapter"]');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.createChapter());
    }

    // Render mode buttons
    const rawBtn = document.querySelector('[data-mode="raw"]');
    const markdownBtn = document.querySelector('[data-mode="markdown"]');
    const wysiwygBtn = document.querySelector('[data-mode="wysiwyg"]');

    if (rawBtn) rawBtn.addEventListener('click', () => this.switchRender('raw'));
    if (markdownBtn) markdownBtn.addEventListener('click', () => this.switchRender('markdown'));
    if (wysiwygBtn) wysiwygBtn.addEventListener('click', () => this.switchRender('wysiwyg'));

    // Width mode buttons
    const widthButtons = document.querySelectorAll('[data-action="change-width"]');
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

    // Font size buttons
    const fontSizeButtons = document.querySelectorAll('[data-action="change-font-size"]');
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
  }

  /**
   * Render chapter list in DOM
   */
  renderChapterList() {
    const list = this.el?.querySelector('[data-chapter-list]');
    if (!list) return;

    list.innerHTML = this.chapters.map(chapter => `
      <li class="chapter-item ${chapter.id === this.activeId ? 'active' : ''}"
          data-chapter-id="${chapter.id}">
        ${chapter.id === this.editingId
      ? `
          <div class="chapter-edit-container">
            <input type="text"
                   value="${this.escapeHtml(this.editingTitle)}"
                   data-ref="titleInput"
                   class="chapter-title-input">
            <div class="chapter-edit-buttons">
              <button data-action="save-title" class="aq-btn aq-btn-sm aq-btn-primary">Save</button>
              <button data-action="cancel-edit" class="aq-btn aq-btn-sm">Cancel</button>
            </div>
          </div>
        `
      : `
          <span class="chapter-title" data-action="edit-title">${this.escapeHtml(chapter.title || 'Untitled')}</span>
        `}
      </li>
    `).join('');

    // Update refs if editing
    if (this.editingId !== null) {
      this._scanRefs();
      const input = this.$refs.titleInput;
      if (input) {
        input.focus();
        input.select();
      }
    }
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
      const btn = document.querySelector(`[data-mode="${mode}"]`);
      if (btn) {
        btn.classList.toggle('active', this.renderMode === mode);
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
      this.chapters = Array.isArray(data.chapters) ? data.chapters : [];

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
    } catch (e) {
      alert(`Failed to save: ${e.message || e}`);
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
}

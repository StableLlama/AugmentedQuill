import { fetchJSON, API } from './utils.js';

/**
 * Index Page Data Factory (Chapter Editor)
 */
export function shellView() {
  return {
    // Chapter list state
    chapters: [], // [{id, title, filename}]
    activeId: null,

    // Editor content state
    content: '',
    renderMode: 'raw', // 'raw' | 'markdown' | 'wysiwyg'
    dirty: false,
    _originalContent: '',

    // Inline title editing state
    editingId: null,
    editingTitle: '',

    // Input suspension flag (prevents recursive updates during mode switches)
    _suspendInput: false,

    /**
     * Initialize the shell view component
     */
    init() {
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

      this.load();
    },
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
    },

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
    },

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
    },

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
    },
    // Integrated editor helpers
    getRawEl() { return (this.$refs && this.$refs.rawEditor) ? this.$refs.rawEditor : null; },
    // WYSIWYG editor instance (Toast UI) when in markdown mode
    _tui: null,
    _tuiEl: null,
    getEditorEl() {
      if (this.renderMode !== 'raw' && this._tui && this._tuiEl) {
        return this._tuiEl;
      }
      return this.getRawEl();
    },
    /**
     * Render markdown content into the WYSIWYG editor
     */
    // Update WYSIWYG editor from content when active
    async setEditorHtmlFromContent() {
      if (this._tui) {
        this._suspendInput = true;
        try {
          // Resolve content if it's a Promise
          const contentValue = await Promise.resolve(this.content || '');
          this._tui.setMarkdown(String(contentValue));
        } finally {
          this._suspendInput = false;
        }
        return;
      }
      const textarea = this.getRawEl();
      if (!textarea) return;
      // Raw textarea already reflects x-model content
    },

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
    },

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
    },
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
        // Recreate the editor to ensure proper UI update when switching modes
        this._destroyTUI();
        this._initTUI(normalized, this.content);
      }

      this.renderMode = normalized;
      this._scrollAdjust(oldScrollY);
    },

    /**
     * Initialize Toast UI Editor on top of the textarea
     * @param {'markdown'|'wysiwyg'} mode
     * @param {string} initialContent - Optional content to initialize with
     */
    _initTUI(mode = 'wysiwyg', initialContent = null) {
      try {
        const textarea = this.getRawEl();
        if (!textarea) return false;
        if (!(window.toastui && window.toastui.Editor)) {
          console.warn('Toast UI Editor not loaded; staying in raw mode');
          return false;
        }

        // Hide textarea while Toast UI active
        textarea.style.display = 'none';

        if (this._tui) {
          this._tui.changeMode(mode);
          this.setEditorHtmlFromContent();
          return true;
        }

        // Create container right before the textarea and hide the textarea
        const container = document.createElement('div');
        container.className = 'aq-tui-wrap';
        textarea.parentNode.insertBefore(container, textarea);
        this._tuiEl = container;

        // Use provided content or fall back to this.content
        const content = initialContent !== null ? initialContent : (this.content || '');

        this._tui = new window.toastui.Editor({
          el: container,
          initialEditType: mode === 'wysiwyg' ? 'wysiwyg' : 'markdown',
          previewStyle: 'tab',
          height: '300px',
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

        // Sync changes back to this.content
        this._tui.on('change', () => {
          if (this._suspendInput) return;
          //try {
            this.content = this._tui.getMarkdown();
            this.onChanged();
          //} catch (_) { /* no-op */ }
        });

        return true;
      } catch (e) {
        console.error('Failed to init Toast UI Editor:', e);
        return false;
      }
    },

    /**
     * Destroy Toast UI instance and restore textarea
     */
    _destroyTUI() {
      if (!this._tui) return;
      try {
        const textarea = this.getRawEl();
        // Capture latest value
        this._suspendInput = true;
        try {
          this.content = this._tui.getMarkdown();
        } finally {
          this._suspendInput = false;
        }
        // Destroy editor and remove container
        this._tui.destroy();
        this._tui = null;
        if (this._tuiEl && this._tuiEl.parentNode) {
          this._tuiEl.parentNode.removeChild(this._tuiEl);
        }
        this._tuiEl = null;
        // Show textarea again
        if (textarea) textarea.style.display = '';
      } catch (e) {
        console.error('Failed to destroy Toast UI Editor:', e);
        this._tui = null;
        this._tuiEl = null;
      }
    },


    /**
     * Mark content as changed (dirty tracking)
     */
    onChanged() {
      this.dirty = this.content !== this._originalContent;
    },

    /**
     * Confirm with user before discarding unsaved changes
     * @returns {boolean} true if safe to proceed (clean or user confirmed)
     */
    _confirmDiscardIfDirty() {
      if (!this.dirty) return true;
      return confirm('You have unsaved changes. Discard them?');
    },

    // ========================================
    // Toolbar Commands (Raw Mode)
    // ========================================
    /**
     * Wrap selected text with before/after strings (e.g., bold, italic)
     */
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

      // Move cursor after inserted text
      queueMicrotask(() => {
        textarea.focus();
        const newPosition = start + before.length + selected.length + after.length;
        textarea.setSelectionRange(newPosition, newPosition);
      });

      this.onChanged();
    },

    /**
     * Wrap selection with markdown syntax (used by toolbar)
     */
    wrapSelection(before, after) {
      this._replaceSelection(before, after);
    },

    /**
     * Insert heading marker at start of current line
     */
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
    },

    /**
     * Insert markdown link with selected text
     */
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
    },

    /**
     * Toggle line prefix for selected lines (e.g., list markers)
     */
    togglePrefix(prefix) {
      const textarea = this.getRawEl();
      if (!textarea) return;

      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const lines = this.content.split(/\r?\n/);

      // Find affected line indices
      const startLineIdx = this._findLineIndex(lines, start);
      const endLineIdx = this._findLineIndex(lines, end);

      // Toggle prefix on each line
      for (let i = startLineIdx; i <= endLineIdx; i++) {
        if (lines[i].startsWith(prefix)) {
          lines[i] = lines[i].slice(prefix.length);
        } else {
          lines[i] = prefix + lines[i];
        }
      }

      this.content = lines.join('\n');
      this.onChanged();
    },

    /**
     * Find line index for given character offset
     */
    _findLineIndex(lines, offset) {
      let position = 0;
      for (let i = 0; i < lines.length; i++) {
        if (position + lines[i].length >= offset) {
          return i;
        }
        position += lines[i].length + 1; // +1 for newline
      }
      return lines.length - 1;
    },

    /**
     * Toggle bullet list on selected lines
     */
    toggleList(prefix = '- ') {
      this.togglePrefix(prefix);
    },

    // ========================================
    // Content Management
    // ========================================

    /**
     * Save current chapter content to backend
     */
    async saveContent() {
      if (this.activeId == null) return;

      try {
        const cleanContent = this.content || '';

        await fetchJSON(`/api/chapters/${this.activeId}/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: cleanContent })
        });

        // Update tracking state
        this.content = cleanContent;
        this._originalContent = this.content;
        this.dirty = false;
      } catch (e) {
        alert(`Failed to save: ${e.message || e}`);
      }
    },

    /**
     * Load and display a chapter
     */
    async openChapter(id) {
      if (id == null) return;

      // Check for unsaved changes when switching chapters
      if (this.activeId !== null && id !== this.activeId) {
        if (!this._confirmDiscardIfDirty()) return;
      }

      // Exit title edit mode
      this.editingId = null;
      this.editingTitle = '';

      try {
        const data = await fetchJSON(`/api/chapters/${id}`);

        this.activeId = data.id;
        this.content = data.content || '';
        this._originalContent = this.content;
        this.dirty = false;

        // Ensure editor is initialized and content rendered (Toast UI when applicable)
        queueMicrotask(() => {
          if (this.renderMode !== 'raw') {
            // Initialize Toast UI after the textarea is present in the DOM
            this._initTUI(this.renderMode, this.content);
          }
        });
      } catch (e) {
        // Show error in editor
        this.content = `Error loading chapter: ${e.message || e}`;
        this._originalContent = this.content;
        this.dirty = false;
      }
    },

    /**
     * Start editing chapter title inline
     */
    startEdit(chapter) {
      this.activeId = chapter.id;
      this.editingId = chapter.id;
      this.editingTitle = chapter.title || '';

      // Focus title input
      queueMicrotask(() => {
        try {
          this.$refs?.titleInput?.focus();
        } catch (_) {
          // Focus is non-critical
        }
      });
    },

    /**
     * Save edited chapter title
     */
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

        // Update local chapter list
        this.chapters = this.chapters.map(c =>
          c.id === id ? { ...c, title: data.chapter.title } : c
        );
      } catch (e) {
        alert(`Failed to save title: ${e.message || e}`);
      } finally {
        this.editingId = null;
        this.editingTitle = '';
      }
    },

    /**
     * Cancel title editing
     */
    cancelEdit() {
      this.editingId = null;
      this.editingTitle = '';
    },

    /**
     * Create a new chapter
     */
    async createChapter() {
      try {
        const data = await fetchJSON('/api/chapters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '', content: '' })
        });

        await this.refreshChapters();

        // Select and start editing the new chapter
        const newId = data.chapter?.id;
        if (newId != null) {
          const chapter = this.chapters.find(c => c.id === newId) || data.chapter;
          this.activeId = newId;
          this.startEdit(chapter);
        }
      } catch (e) {
        alert(`Failed to create chapter: ${e.message || e}`);
      }
    },
  };
}

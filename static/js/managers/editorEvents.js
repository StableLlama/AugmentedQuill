import { EVENTS, DEFAULTS } from '../constants/editorConstants.js';

/**
 * Editor Events Manager
 * Handles all event listeners and keyboard shortcuts for the editor.
 */
export class EditorEvents {
  /**
   * @param {ShellView} shellView - The parent ShellView instance
   */
  constructor(shellView) {
    this.shellView = shellView;
    this._onProjectSelected = null;
    this._onStoryUpdated = null;
    this._onMachineUpdated = null;
  }

  /**
   * Initialize event listeners
   */
  init() {
    this._setupGlobalEventListeners();
    this._setupKeyboardShortcuts();
    this._setupEventListeners();
  }

  /**
   * Setup global event listeners for project/story/machine updates
   */
  _setupGlobalEventListeners() {
    // Listen for project changes from settings page
    this._onProjectSelected = () => { this.shellView.chapterManager.refreshChapters(); };
    document.addEventListener(EVENTS.PROJECT_SELECTED, this._onProjectSelected);

    // Global updates when story or machine settings change (from chat tools or settings modal)
    this._onStoryUpdated = (e) => {
      // Refresh chapters and reopen active if it was changed
      const detail = (e && e.detail) || {};
      const changed = Array.isArray(detail.changedChapters) ? detail.changedChapters : [];
      const reopen = this.shellView.activeId != null && changed.includes(this.shellView.activeId);
      Promise.resolve(this.shellView.chapterManager.refreshChapters()).then(() => {
        if (reopen && this.shellView.activeId != null) {
          this.shellView.chapterManager.openChapter(this.shellView.activeId);
        }
      });
    };
    document.addEventListener(EVENTS.STORY_UPDATED, this._onStoryUpdated);

    this._onMachineUpdated = () => {
      // Reload story models and chapters to reflect new configuration
      Promise.resolve(this.shellView.chapterManager.loadChat()); // loadChat now only loads story models if needed
      Promise.resolve(this.shellView.chapterManager.refreshChapters());
    };
    document.addEventListener(EVENTS.MACHINE_UPDATED, this._onMachineUpdated);
  }

  /**
   * Setup keyboard shortcuts
   */
  _setupKeyboardShortcuts() {
    // Keyboard shortcut: Ctrl/Cmd+S to save
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (this.shellView.dirty) {
          this.shellView.chapterManager.saveContent();
        }
      }
    });

    // Global keyboard for Flow mode: ← / → to pick, ↓ to discard
    window.addEventListener('keydown', (e) => {
      if (!this.shellView.flowActive) return;
      if (['INPUT', 'TEXTAREA'].includes((document.activeElement && document.activeElement.tagName) || '')) {
        // still allow when in editor, but we'll handle explicitly
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.shellView.flowMode._flowPick('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.shellView.flowMode._flowPick('right');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.shellView.flowMode._flowDiscard();
      }
    });

    // Warn user before navigating away with unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (this.shellView.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /**
   * Setup event listeners for UI interactions
   */
  _setupEventListeners() {
    if (!this.shellView.el) return;

    // Delegate chapter list clicks
    const chapterList = this.shellView.el.querySelector('[data-chapter-list]');
    if (chapterList) {
      chapterList.addEventListener('click', async (e) => {
        // Handle actions within an editing item first
        if (this.shellView.editingId !== null) {
          const saveBtn = e.target.closest('[data-action="save-title"]');
          if (saveBtn) {
            this.shellView.chapterManager.saveEdit();
            return;
          }

          const cancelBtn = e.target.closest('[data-action="cancel-edit"]');
          if (cancelBtn) {
            this.shellView.chapterManager.cancelEdit();
            return;
          }
        }
        const toggleSummaryBtn = e.target.closest('[data-action="toggle-summary"]');
        if (toggleSummaryBtn) {
          const chapterItem = toggleSummaryBtn.closest('[data-chapter-id]');
          if (chapterItem) {
            const id = parseInt(chapterItem.getAttribute('data-chapter-id'), 10);
            if (!isNaN(id)) {
              this.shellView.chapterManager.toggleSummary(id);
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
              if (this.shellView.activeId !== id) {
                const caretPos = e.target.selectionStart ?? null;
                await this.shellView.chapterManager.openChapter(id);
                // After render, re-focus the title input of the now-active item and restore caret to end
                setTimeout(() => {
                  const input = this.shellView.el.querySelector(`[data-chapter-id="${id}"] [data-ref="titleInput"]`);
                  if (input) {
                    input.focus();
                    try {
                      const len = input.value.length;
                      const pos = caretPos == null ? len : Math.min(caretPos, len);
                      input.setSelectionRange(pos, pos);
                    } catch (_) {}
                  }
                }, 0);
              }
              return;
            }
            // Clicked elsewhere in the item: open normally
            this.shellView.chapterManager.openChapter(id);
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
            const chap = this.shellView.chapters.find(c => c.id === id);
            if (chap) {
              e.target.value = chap.title || '';
            }
          }
          e.target.blur();
        }
      });

      chapterList.addEventListener('input', (e) => {
        if (e.target.matches('[data-ref="titleInput"]')) {
          this.shellView._debouncedSaveTitle(e);
        } else if (e.target.matches('[data-ref="summaryInput"]')) {
          this.shellView._debouncedSaveSummary(e);
        }
      });

      chapterList.addEventListener('blur', (e) => {
        if (e.target.matches('[data-ref="titleInput"]')) {
          // Ensure save on blur (debounce already queued)
          this.shellView.chapterManager._saveTitle(e);
        }
      }, true);
    }

    // Story summary toggle
    const toggleStorySummaryBtn = this.shellView.el.querySelector('[data-action="toggle-story-summary"]');
    if (toggleStorySummaryBtn) {
      toggleStorySummaryBtn.addEventListener('click', () => {
        this.shellView.storySummaryExpanded = !this.shellView.storySummaryExpanded;
      });
    }

    // Story summary and tags inputs
    const storySummaryInput = this.shellView.el.querySelector('[data-ref="storySummaryInput"]');
    if (storySummaryInput) {
      storySummaryInput.addEventListener('focus', () => {
        this.shellView.lastFocusedField = 'storySummary';
      });
      storySummaryInput.addEventListener('input', (e) => {
        this.shellView._debouncedSaveStorySummary(e);
      });
      storySummaryInput.addEventListener('blur', (e) => {
        this.shellView.chapterManager._saveStorySummary(e);
      }, true);
    }

    const storyTagsInput = this.shellView.el.querySelector('[data-ref="storyTagsInput"]');
    if (storyTagsInput) {
      storyTagsInput.addEventListener('focus', () => {
        this.shellView.lastFocusedField = 'storyTags';
      });
      storyTagsInput.addEventListener('input', (e) => {
        this.shellView._debouncedSaveStoryTags(e);
      });
      storyTagsInput.addEventListener('blur', (e) => {
        this.shellView.chapterManager._saveStoryTags(e);
      }, true);
    }

    // Save button (global header)
    const saveBtn = document.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.shellView.chapterManager.saveContent());
    }

    // Create chapter button
    const createBtn = this.shellView.el.querySelector('[data-action="create-chapter"]');
    if (createBtn) {
      createBtn.addEventListener('click', () => this.shellView.chapterManager.createChapter());
    }

    // Render mode buttons (scoped to editor toolbar in main pane)
    ['raw', 'markdown', 'wysiwyg'].forEach(mode => {
      const btn = this.shellView.el.querySelector(`[data-mode="${mode}"]`);
      if (btn) btn.addEventListener('click', () => this.shellView.contentEditor.switchRender(mode));
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
          this.shellView.contentWidth = Math.min(maxWidth, this.shellView.contentWidth + step);
        } else if (direction === 'decrease') {
          this.shellView.contentWidth = Math.max(minWidth, this.shellView.contentWidth - step);
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
          this.shellView.fontSize = Math.min(maxSize, this.shellView.fontSize + step);
        } else if (direction === 'decrease') {
          this.shellView.fontSize = Math.max(minSize, this.shellView.fontSize - step);
        }
      });
    });

    // Raw editor toolbar
    const rawToolbar = this.shellView.el.querySelector('[data-raw-toolbar]');
    if (rawToolbar) {
      rawToolbar.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        const textarea = this.shellView.getRawEl();
        if (!textarea) return;

        switch (action) {
          case 'bold':
            this.shellView.wrapSelection('**', '**');
            break;
          case 'italic':
            this.shellView.wrapSelection('*', '*');
            break;
          case 'strikethrough':
            this.shellView.wrapSelection('~~', '~~');
            break;
          case 'code':
            this.shellView.wrapSelection('`', '`');
            break;
          case 'heading':
            this.shellView.insertHeading();
            break;
          case 'link':
            this.shellView.insertLink();
            break;
          case 'list':
            this.shellView.toggleList();
            break;
          case 'quote':
            this.shellView.togglePrefix('> ');
            break;
        }
      });
    }
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    try {
      if (this._onProjectSelected) document.removeEventListener(EVENTS.PROJECT_SELECTED, this._onProjectSelected);
      if (this._onStoryUpdated) document.removeEventListener(EVENTS.STORY_UPDATED, this._onStoryUpdated);
      if (this._onMachineUpdated) document.removeEventListener(EVENTS.MACHINE_UPDATED, this._onMachineUpdated);
    } catch (e) {
      console.warn('Failed to remove event listeners in destroy:', e);
    }
  }
}
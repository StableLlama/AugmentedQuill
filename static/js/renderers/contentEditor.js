import { RENDER_MODES, UI_STRINGS } from '../constants/editorConstants.js';

export class ContentEditor {
  /**
   * Manages content editing functionality for the ShellView.
   * Handles switching between raw text, Markdown preview, and WYSIWYG editing modes
   * to provide flexible editing experiences while maintaining content integrity.
   * @param {ShellView} shellView - The parent ShellView instance.
   */
  constructor(shellView) {
    this.shellView = shellView;
  }

  /**
   * Renders the content in the textarea.
   */
  renderContent() {
    const textarea = this.shellView.$refs.rawEditor;
    if (textarea && textarea.value !== this.shellView.content && !this.shellView._suspendInput) {
      this.shellView._suspendInput = true;
      textarea.value = this.shellView.content;
      this.shellView._suspendInput = false;
    }
  }

  /**
   * Renders the mode buttons.
   */
  renderModeButtons() {
    [RENDER_MODES.RAW, RENDER_MODES.MARKDOWN, RENDER_MODES.WYSIWYG].forEach(mode => {
      const btn = this.shellView.el.querySelector(`[data-mode="${mode}"]`);
      if (btn) {
        const active = this.shellView.renderMode === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      }
    });
  }

  /**
   * Renders the content width.
   */
  renderContentWidth() {
    this.shellView.el.style.gridTemplateColumns = `1fr ${this.shellView.contentWidth + 2}em 1fr`;
  }

  /**
   * Renders the font size.
   */
  renderFontSize() {
    const cardEl = this.shellView.el.querySelector('.aq-card');
    if (cardEl) {
      cardEl.style.fontSize = `${this.shellView.fontSize}rem`;
    }
  }

  /**
   * Renders the raw editor toolbar visibility.
   */
  renderRawEditorToolbar() {
    const toolbar = this.shellView.el.querySelector('[data-raw-toolbar]');
    const textarea = this.shellView.el.querySelector('[data-ref="rawEditor"]');
    if (!toolbar || !textarea) return;

    const show = this.shellView.renderMode === RENDER_MODES.RAW;
    toolbar.style.display = show ? 'flex' : 'none';
    textarea.style.display = show ? 'block' : 'none';
  }

  /**
   * Gets the raw editor element.
   * @returns {HTMLElement|null} The raw editor element.
   */
  getRawEl() {
    return this.shellView.$refs?.rawEditor || this.shellView.el?.querySelector('[data-ref="rawEditor"]') || null;
  }

  /**
   * Gets the current editor element (raw or TUI).
   * @returns {HTMLElement|null} The editor element.
   */
  getEditorEl() {
    if (this.shellView.renderMode !== RENDER_MODES.RAW && this.shellView._tui && this.shellView._tuiEl) {
      return this.shellView._tuiEl;
    }
    return this.getRawEl();
  }

  /**
   * Captures the current Y position for scroll adjustment.
   * @returns {number} The Y position.
   */
  _captureAnchorY() {
    const editor = this.getEditorEl();
    if (!editor) return window.scrollY;

    // In markdown mode, use selection position if available
    if (this.shellView.renderMode === RENDER_MODES.MARKDOWN) {
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
   * Adjusts scroll position after mode switch.
   * @param {number} oldY - The old Y position.
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
   * Switches the render mode.
   * @param {string} mode - The new mode.
   */
  switchRender(mode) {
    const m = String(mode || '').toLowerCase();
    const normalized = (m === RENDER_MODES.RAW || m === RENDER_MODES.MARKDOWN || m === RENDER_MODES.WYSIWYG) ? m : RENDER_MODES.RAW;
    if (this.shellView.renderMode === normalized) return;

    const oldScrollY = this._captureAnchorY();

    if (normalized === RENDER_MODES.RAW) {
      this._destroyTUI();
    } else {
      this._destroyTUI();
      this._initTUI(normalized, this.shellView.content);
    }

    this.shellView.renderMode = normalized;
    this._scrollAdjust(oldScrollY);
  }

  /**
   * Initializes Toast UI Editor.
   * @param {string} mode - The mode.
   * @param {string} initialContent - Initial content.
   * @returns {boolean} Success.
   */
  _initTUI(mode = RENDER_MODES.WYSIWYG, initialContent = null) {
    try {
      const textarea = this.getRawEl();
      if (!textarea) return false;
      if (!(window.toastui && window.toastui.Editor)) {
        console.warn('Toast UI Editor not loaded; staying in raw mode');
        return false;
      }

      textarea.style.display = 'none';

      if (this.shellView._tui) {
        this.shellView._tui.changeMode(mode);
        this.setEditorHtmlFromContent();
        return true;
      }

      const container = document.createElement('div');
      container.className = 'aq-tui-wrap';
      textarea.parentNode.insertBefore(container, textarea);
      this.shellView._tuiEl = container;

      const content = initialContent !== null ? initialContent : (this.shellView.content || '');

      this.shellView._tui = new window.toastui.Editor({
        el: container,
        initialEditType: mode === RENDER_MODES.WYSIWYG ? 'wysiwyg' : 'markdown',
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

      this.shellView._tui.on('change', () => {
        if (this.shellView._suspendInput) return;
        try {
          this.shellView.content = this.shellView._tui.getMarkdown();
          this.shellView.onChanged();
        } catch (e) { console.warn('Failed to update content from TUI change:', e); }
      });

      return true;
    } catch (e) {
      console.error('Failed to init Toast UI Editor:', e);
      return false;
    }
  }

  /**
   * Destroys Toast UI instance.
   */
  _destroyTUI() {
    if (!this.shellView._tui) return;
    try {
      const textarea = this.getRawEl();
      this.shellView._suspendInput = true;
      try {
        this.shellView.content = this.shellView._tui.getMarkdown();
      } finally {
        this.shellView._suspendInput = false;
      }
      this.shellView._tui.destroy();
      this.shellView._tui = null;
      if (this.shellView._tuiEl && this.shellView._tuiEl.parentNode) {
        this.shellView._tuiEl.parentNode.removeChild(this.shellView._tuiEl);
      }
      this.shellView._tuiEl = null;
      if (textarea) textarea.style.display = '';
    } catch (e) {
      console.error('Failed to destroy Toast UI Editor:', e);
      this.shellView._tui = null;
      this.shellView._tuiEl = null;
    }
  }

  /**
   * Sets editor HTML from content.
   */
  async setEditorHtmlFromContent() {
    if (this.shellView._tui) {
      this.shellView._suspendInput = true;
      try {
        const contentValue = await Promise.resolve(this.shellView.content || '');
        this.shellView._tui.setMarkdown(String(contentValue));
      } finally {
        this.shellView._suspendInput = false;
      }
      return;
    }
    const textarea = this.getRawEl();
    if (!textarea) return;
    // Raw textarea already reflects content binding
  }

  /**
   * Scrolls the editor to the bottom.
   */
  scrollToBottom() {
    const editor = this.getEditorEl();
    if (editor) {
      if (this.shellView.renderMode === RENDER_MODES.RAW) {
        editor.scrollTop = editor.scrollHeight;
      } else if (this.shellView._tuiEl) {
        this.shellView._tuiEl.scrollTop = this.shellView._tuiEl.scrollHeight;
      }
    }
  }
}
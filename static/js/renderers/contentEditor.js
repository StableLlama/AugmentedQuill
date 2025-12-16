import { RENDER_MODES } from '../constants/editorConstants.js';

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
    // Remove active from all
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.remove('bg-indigo-600', 'text-white');
      btn.classList.add('text-stone-400', 'hover:text-stone-200');
    });
    // Add active to current
    const activeBtn = document.querySelector(`[data-mode="${this.shellView.renderMode}"]`);
    if (activeBtn) {
      activeBtn.classList.remove('text-stone-400', 'hover:text-stone-200');
      activeBtn.classList.add('bg-indigo-600', 'text-white');
    }
  }

  /**
   * Renders the content width.
   */
  renderContentWidth() {
    const textarea = this.shellView.$refs.rawEditor;
    if (textarea) {
      textarea.style.maxWidth = `${this.shellView.contentWidth}ch`;
      textarea.style.marginLeft = 'auto';
      textarea.style.marginRight = 'auto';
      textarea.parentNode && (textarea.parentNode.style.display = 'block');
    }

    // Apply width to Toast UI editor container if present
    const tuiEl = this.shellView._tuiEl || (this.shellView.el && this.shellView.el.querySelector ? this.shellView.el.querySelector('[data-ref="tuiEditor"]') : null);
    if (tuiEl) {
      tuiEl.style.maxWidth = `${this.shellView.contentWidth}ch`;
      tuiEl.style.marginLeft = 'auto';
      tuiEl.style.marginRight = 'auto';
      // Ensure inner editor uses full width
      tuiEl.querySelector && tuiEl.querySelector('.toastui-editor-defaultUI') && (tuiEl.querySelector('.toastui-editor-defaultUI').style.width = '100%');
    }
  }

  /**
   * Renders the font size.
   */
  renderFontSize() {
    const textarea = this.shellView.$refs.rawEditor;
    if (textarea) {
      textarea.style.fontSize = `${this.shellView.fontSize}px`;
    }
    // Also apply font size to TUI containers if present
    const tuiEl = this.shellView._tuiEl || (this.shellView.el && this.shellView.el.querySelector ? this.shellView.el.querySelector('[data-ref="tuiEditor"]') : null);
    if (tuiEl) {
      try {
        const fontPx = (this.shellView.fontSize && Number(this.shellView.fontSize)) ? `${this.shellView.fontSize}px` : null;
        const selectors = [
          '.toastui-editor-defaultUI',
          '.toastui-editor-md-preview',
          '.toastui-editor-ww-container',
          '.toastui-editor-contents',
          '.tui-editor-contents',
          '.ProseMirror'
        ];
        selectors.forEach(sel => {
          tuiEl.querySelectorAll(sel).forEach(n => {
            if (!n) return;
            if (fontPx) n.style.fontSize = fontPx;
            // Ensure width uses parent max-width
            n.style.maxWidth = '100%';
            n.style.boxSizing = 'border-box';
          });
        });
      } catch (e) { /* non-critical */ }
    }
  }

  /**
   * Renders the raw editor toolbar visibility.
   */
  renderRawEditorToolbar() {
    const textarea = this.shellView.el.querySelector('[data-ref="rawEditor"]');
    const localToolbars = Array.from(this.shellView.el.querySelectorAll('[data-raw-toolbar]'));
    const globalToolbars = Array.from(document.querySelectorAll('header [data-raw-toolbar], [data-raw-toolbar].aq-global'));
    if (!textarea) return;

    // Show the unified header toolbar for all modes so the format buttons remain available
    // regardless of Raw/Markdown/WYSIWYG mode. Individual actions will be handled by
    // ContentOperations or TUI API depending on active mode.
    localToolbars.forEach(toolbar => { toolbar.style.display = 'flex'; });
    globalToolbars.forEach(toolbar => { toolbar.style.display = 'flex'; });

    // Only toggle the raw textarea visibility according to mode
    const showTextarea = this.shellView.renderMode === RENDER_MODES.RAW;
    textarea.style.display = showTextarea ? 'block' : 'none';
  }

  /**
   * Gets the raw editor element.
   * @returns {HTMLElement|null} The raw editor element.
   */
  getRawEl() {
    return this.shellView.renderingManager.getRawEl();
  }

  /**
   * Gets the current editor element (raw or TUI).
   * @returns {HTMLElement|null} The editor element.
   */
  getEditorEl() {
    return this.shellView.renderingManager.getEditorEl();
  }

  /**
   * Switches the render mode.
   * @param {string} mode - The new mode.
   */
  switchRender(mode) {
    this.shellView.renderingManager.switchRender(mode);
  }

  /**
   * Sets editor HTML from content.
   */
  async setEditorHtmlFromContent() {
    return this.shellView.renderingManager.setEditorHtmlFromContent();
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
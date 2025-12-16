/**
 * Rendering Manager
 * Handles UI rendering operations and editor switching.
 */
export class RenderingManager {
  /**
   * @param {ShellView} shellView - The parent ShellView instance
   */
  constructor(shellView) {
    this.shellView = shellView;
  }

  /**
   * Get the raw textarea element
   */
  getRawEl() {
    return this.shellView.$refs?.rawEditor || this.shellView.el?.querySelector('[data-ref="rawEditor"]') || null;
  }

  /**
   * Get the current editor element (raw or TUI)
   */
  getEditorEl() {
    if (this.shellView.renderMode !== 'raw' && this.shellView._tui && this.shellView._tuiEl) {
      return this.shellView._tuiEl;
    }
    return this.getRawEl();
  }

  /**
   * Render markdown content into the WYSIWYG editor
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
   * Capture the current Y position of the caret/editor for scroll adjustment
   */
  _captureAnchorY() {
    const editor = this.getEditorEl();
    if (!editor) return window.scrollY;

    // In markdown mode, use selection position if available
    if (this.shellView.renderMode === 'markdown') {
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
    if (!['raw', 'markdown', 'wysiwyg'].includes(m)) return;

    const oldY = this._captureAnchorY();
    const wasRaw = this.shellView.renderMode === 'raw';

    // Update mode
    this.shellView.renderMode = m;

    // Handle transitions
    if (m === 'raw') {
      // Switching TO raw
      this._destroyTUI();
      setTimeout(() => this._scrollAdjust(oldY), 0);
    } else {
      // Switching TO markdown/wysiwyg
      if (wasRaw) {
        // From raw: preserve content, init TUI
        setTimeout(() => {
          this._initTUI(m);
          this.setEditorHtmlFromContent();
          this._scrollAdjust(oldY);
        }, 0);
      } else {
        // Between markdown/wysiwyg: just change mode
        if (this.shellView._tui) {
          this.shellView._tui.changeMode(m);
          setTimeout(() => this._scrollAdjust(oldY), 0);
        }
      }
    }
  }

  /**
   * Initialize Toast UI Editor
   */
  _initTUI(mode = 'wysiwyg', initialContent = null) {
    if (this.shellView._tui) return;

    const textarea = this.getRawEl();
    if (!textarea) return;

    // Use globally available Toast UI Editor
    if (!(window.toastui && window.toastui.Editor)) {
      console.warn('Toast UI Editor not loaded; staying in raw mode');
      return;
    }

    // Create container for Toast UI Editor if it doesn't exist
    let el = this.shellView.el?.querySelector('[data-ref="tuiEditor"]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-ref', 'tuiEditor');
      el.className = 'aq-tui-wrap';
      textarea.parentNode.insertBefore(el, textarea);
    }

    // Show the container
    el.style.display = 'flex';

    // Apply current content width so TUI matches raw editor width
    try {
      const widthCh = this.shellView.contentWidth || 80;
      el.style.maxWidth = `${widthCh}ch`;
      el.style.marginLeft = 'auto';
      el.style.marginRight = 'auto';
    } catch (_) {}

    this.shellView._tuiEl = el;
    this.shellView._tui = new window.toastui.Editor({
      el,
      initialEditType: mode === 'wysiwyg' ? 'wysiwyg' : 'markdown',
      previewStyle: 'tab',
      height: 'auto',
      initialValue: initialContent || this.shellView.content || '',
      toolbarItems: [
        ['heading', 'bold', 'italic', 'strike'],
        ['hr', 'quote'],
        ['ul', 'ol', 'task', 'indent', 'outdent'],
        ['table', 'link'],
        ['code', 'codeblock']
      ],
      hideModeSwitch: true,
      events: {
        change: () => {
          if (!this.shellView._suspendInput) {
            this.shellView.content = this.shellView._tui.getMarkdown();
            this.shellView.onChanged();
          }
        }
      }
    });

    // Hide the original textarea
    textarea.style.display = 'none';

    // After TUI has rendered its DOM, apply appearance (width/font/brightness)
    setTimeout(() => {
      try {
        const el = this.shellView._tuiEl;
        if (!el) return;
        const applyAppearanceToTui = () => {
          const widthCh = this.shellView.contentWidth || 80;
          el.style.maxWidth = `${widthCh}ch`;
          el.style.marginLeft = 'auto';
          el.style.marginRight = 'auto';

          const fontPx = (this.shellView.fontSize && Number(this.shellView.fontSize)) ? `${this.shellView.fontSize}px` : null;
          const brightness = null; // brightness handled via filter on outer container if needed

          // Common Toast UI containers
          const defaultUI = el.querySelector('.toastui-editor-defaultUI');
          const mdPreview = el.querySelector('.toastui-editor-md-preview');
          const wwContainer = el.querySelector('.toastui-editor-ww-container');
          const editorContents = el.querySelector('.toastui-editor-contents');

          [defaultUI, mdPreview, wwContainer, editorContents].forEach(node => {
            if (!node) return;
            if (fontPx) node.style.fontSize = fontPx;
            node.style.maxWidth = '100%';
            node.style.boxSizing = 'border-box';
          });
          // Move TUI's internal toolbar into the page-level top-row toolbar if present
          try {
            const defaultContainer = el.querySelector('.toastui-editor-defaultUI') || el;
            let toolbar = defaultContainer.querySelector('[role="toolbar"]') || defaultContainer.querySelector('.toastui-editor-toolbar') || defaultContainer.querySelector('.tui-toolbar') || null;
            if (!toolbar) {
              const firstBtn = defaultContainer.querySelector('button');
              if (firstBtn) {
                let p = firstBtn.parentNode;
                for (let i = 0; i < 5 && p; i++) {
                  if (p.querySelectorAll && p.querySelectorAll('button').length > 2) { toolbar = p; break; }
                  p = p.parentNode;
                }
              }
            }
            if (toolbar) {
              // Do NOT move TUI's internal toolbar; hide it to use our own header toolbar instead
              try { toolbar.style.display = 'none'; } catch (_) { /* ignore */ }
            }
          } catch (_) {}
        };
        applyAppearanceToTui();
      } catch (e) { console.warn('Failed to apply TUI appearance:', e); }
    }, 50);
  }

  /**
   * Destroy Toast UI Editor
   */
  _destroyTUI() {
    if (this.shellView._tui) {
      try {
        this.shellView._tui.destroy();
      } catch (e) {
        console.warn('Error destroying TUI editor:', e);
      }
      this.shellView._tui = null;
      this.shellView._tuiEl = null;
    }

    // Hide the TUI container and show the raw textarea again
    const container = this.shellView.el?.querySelector('[data-ref="tuiEditor"]');
    if (container) container.style.display = 'none';
    
    const textarea = this.getRawEl();
    if (textarea) textarea.style.display = '';
  }
}
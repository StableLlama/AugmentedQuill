import { fetchJSON } from '../utils/utils.js';
import { UI_STRINGS } from '../constants/editorConstants.js';

export class FlowMode {
  /**
   * Manages Flow mode for AI-assisted writing.
   * Provides interactive sentence suggestions to help writers overcome creative blocks
   * by offering two-choice continuations, making the writing process more engaging and efficient.
   * @param {ShellView} shellView - The parent ShellView instance.
   */
  constructor(shellView) {
    this.shellView = shellView;
    this.touchStartX = 0;
  }

  /**
   * Renders the Flow mode UI.
   */
  renderFlowUI() {
    const area = this.shellView.$refs.flowArea || this.shellView.el.querySelector('[data-ref="flowArea"]');
    const startBtn = this.shellView.el.querySelector('[data-action="flow-start"]');
    const stopBtn = this.shellView.el.querySelector('[data-action="flow-stop"]');
    const leftBox = this.shellView.$refs.flowLeft || this.shellView.el.querySelector('[data-ref="flowLeft"]');
    const rightBox = this.shellView.$refs.flowRight || this.shellView.el.querySelector('[data-ref="flowRight"]');
    const hint = this.shellView.$refs.flowHint || this.shellView.el.querySelector('[data-ref="flowHint"]');

    if (area) {
      area.style.display = this.shellView.flowActive ? '' : 'none';
    }
    if (startBtn) startBtn.style.display = this.shellView.flowActive ? 'none' : '';
    if (stopBtn) stopBtn.style.display = this.shellView.flowActive ? '' : 'none';

    const loadingText = this.shellView.flowBusy ? '<div class="aq-spinner"></div>' : '';
    if (leftBox) {
      leftBox.innerHTML = this.shellView.flowLeft || loadingText;
      leftBox.onclick = () => this._flowPick('left');
    }
    if (rightBox) {
      rightBox.innerHTML = this.shellView.flowRight || loadingText;
      rightBox.onclick = () => this._flowPick('right');
    }
    const disabled = this.shellView.flowBusy || !this.shellView.flowActive;
    ['flow-discard', 'flow-redo'].forEach(sel => {
      const btn = this.shellView.el.querySelector(`[data-action="${sel}"]`);
      if (btn) btn.disabled = disabled;
    });

    // Add touch swipe for choices
    if (leftBox && !disabled) {
      leftBox.addEventListener('touchstart', (e) => this._handleTouchStart(e));
      leftBox.addEventListener('touchend', (e) => this._handleTouchEnd(e, 'left'));
    }
    if (rightBox && !disabled) {
      rightBox.addEventListener('touchstart', (e) => this._handleTouchStart(e));
      rightBox.addEventListener('touchend', (e) => this._handleTouchEnd(e, 'right'));
    }
    if (hint) hint.style.opacity = this.shellView.flowBusy ? '0.6' : '1';
  }

  /**
   * Starts Flow mode.
   */
  async handleFlowStart() {
    if (this.shellView.activeId == null) return;
    this.shellView.flowActive = true;
    this.shellView.contentEditor.scrollToBottom();
    await this._flowFetchPair();
  }

  /**
   * Stops Flow mode.
   */
  handleFlowStop() {
    this.shellView.flowActive = false;
    this.shellView.flowLeft = '';
    this.shellView.flowRight = '';
  }

  /**
   * Handles redo (undo last insertion).
   */
  async handleFlowRedo() {
    if (!this.shellView.flowActive) return;
    this._flowUndo();
    // Restart generation from the undone state
    await this._flowFetchPair();
  }

  /**
   * Fetches a pair of sentences for Flow mode.
   */
  async _flowFetchPair() {
    if (!this.shellView.flowActive || this.shellView.activeId == null) return;
    this.shellView.flowBusy = true;
    try {
      const payload = { chap_id: this.shellView.activeId, model_name: this.shellView.storyCurrentModel, current_text: this.shellView.content || '' };
      const [left, right] = await Promise.all([
        this._fetchSuggestion(payload),
        this._fetchSuggestion(payload)
      ]);
      this.shellView.flowLeft = left;
      this.shellView.flowRight = right;
    } catch (e) {
      this.shellView.flowLeft = '(error)';
      this.shellView.flowRight = '(error)';
    } finally {
      this.shellView.flowBusy = false;
    }
  }

  /**
   * Fetches a single suggestion from the backend.
   * @param {object} payload - The payload to send.
   * @returns {string} The suggestion text.
   */
  async _fetchSuggestion(payload) {
    try {
      const response = await fetch('/api/story/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      return buffer; //.trim();
    } catch (e) {
      return '(error)';
    }
  }

  /**
   * Handles touch start for swipe detection.
   * @param {TouchEvent} e - The touch event.
   */
  _handleTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
  }

  /**
   * Handles touch end for swipe detection.
   * @param {TouchEvent} e - The touch event.
   * @param {string} side - 'left' or 'right'.
   */
  _handleTouchEnd(e, side) {
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - this.touchStartX;
    const threshold = 50; // Minimum swipe distance
    if (Math.abs(deltaX) > threshold) {
      if (side === 'left' && deltaX < 0) {
        // Swipe left on left box: pick left
        this._flowPick('left');
      } else if (side === 'right' && deltaX > 0) {
        // Swipe right on right box: pick right
        this._flowPick('right');
      }
    }
  }

  /**
   * Picks a sentence from Flow mode.
   * @param {string} side - 'left' or 'right'.
   */
  async _flowPick(side) {
    if (!this.shellView.flowActive || this.shellView.flowBusy) return;
    const sentence = side === 'left' ? this.shellView.flowLeft : this.shellView.flowRight;
    this._flowAppendSentence(sentence);
    // Immediately fetch next pair to keep flow
    await this._flowFetchPair();
  }

  /**
   * Discards the current pair in Flow mode.
   */
  async _flowDiscard() {
    if (!this.shellView.flowActive || this.shellView.flowBusy) return;
    this.shellView.flowLeft = '';
    this.shellView.flowRight = '';
    await this._flowFetchPair();
  }

  /**
   * Appends a sentence to the content.
   * @param {string} sentence - The sentence to append.
   */
  _flowAppendSentence(sentence) {
    const base = this.shellView.content || '';
    //const sep = base && !base.endsWith('\n') ? ' ' : '';
    const sep = base && sentence.startsWith('\n') ? '\n' : '';
    this.shellView._flowLastContent = base; // Store for undo
    this.shellView.content = base + sep + sentence;
    this.shellView.contentEditor.scrollToBottom();
  }

  /**
   * Undoes the last sentence insertion.
   */
  _flowUndo() {
    if (this.shellView._flowLastContent !== undefined) {
      this.shellView.content = this.shellView._flowLastContent;
      this.shellView._flowLastContent = undefined;
      this.shellView.contentEditor.scrollToBottom();
    }
  }
}
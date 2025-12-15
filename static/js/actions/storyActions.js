import { fetchJSON } from '../utils/utils.js';
import { UI_STRINGS } from '../constants/editorConstants.js';
import { toast } from '../utils/editorUtils.js';

export class StoryActions {
  /**
   * Manages AI-powered story writing actions.
   * Provides streaming interfaces for generating summaries and content,
   * allowing real-time feedback during AI-assisted writing to improve user experience.
   * @param {ShellView} shellView - The parent ShellView instance.
   */
  constructor(shellView) {
    this.shellView = shellView;
  }

  /**
   * Renders story models select.
   */
  renderStoryModels() {
    const select = this.shellView.$refs.storyModelSelect || document.querySelector('[data-ref="storyModelSelect"]');
    if (!select) return;
    const models = Array.isArray(this.shellView.storyModels) ? this.shellView.storyModels : [];
    const current = this.shellView.storyCurrentModel || '';
    select.innerHTML = models.map(m => `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`).join('');
  }

  /**
   * Renders story busy state.
   */
  renderStoryBusy() {
    const summaryBtn = document.querySelector('[data-action="story-write-summary"]');
    const writeBtn = document.querySelector('[data-action="story-write-chapter"]');
    const continueBtn = document.querySelector('[data-action="story-continue-chapter"]');
    const cancelBtn = document.querySelector('[data-action="story-cancel"]');
    const busy = !!this.shellView.storyBusy;
    [summaryBtn, writeBtn, continueBtn].forEach(btn => { if (btn) btn.disabled = busy; });
    if (cancelBtn) {
      cancelBtn.style.display = busy ? 'inline-block' : 'none';
    }
  }

  /**
   * Cancels the current story action.
   */
  cancelStoryAction() {
    if (this.shellView._storyAbortController) {
      try { this.shellView._storyAbortController.abort(); } catch (_) {
        // Ignore abort errors
      }
    }
  }





  /**
   * Handles writing story summary.
   */
  async handleWriteStorySummary() {
    const story = await fetchJSON('/api/story') || {};
    const hasExisting = !!(story.story_summary && story.story_summary.trim());
    let mode = 'discard';
    if (hasExisting) {
      const answer = confirm('A story summary already exists. Do you want to replace it?');
      mode = answer ? 'discard' : 'update';
    }

    // Try streaming endpoint first
    try {
      const textarea = this.shellView.el.querySelector('[data-ref="storySummaryInput"]');
      let accum = '';
      await this._streamFetch('/api/story/story-summary/stream', { mode, model_name: this.shellView.storyCurrentModel }, (chunk) => {
        accum += chunk;
        if (textarea) textarea.value = accum;
      });
      // On completion, update state
      this.shellView.storySummary = accum;
    } catch (err) {
      if (err && err.code === 404) {
        // Fallback to non-streaming
        try {
          const data = await fetchJSON('/api/story/story-summary', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, model_name: this.shellView.storyCurrentModel })
          });
          this.shellView.storySummary = data.summary || '';
          const textarea = this.shellView.el.querySelector('[data-ref="storySummaryInput"]');
          if (textarea) textarea.value = data.summary || '';
        } catch (e) {
          toast('Failed to generate story summary: ' + (e.message || e), 'error');
        }
      } else if (!(err && err.name === 'AbortError')) {
        toast(`Story summary request failed: ${err.message || err}`, 'error');
      }
    }
  }

  /**
   * Handles writing summary.
   */
  async handleWriteSummary() {
    // Check if story summary was the last focused field
    if (this.shellView.lastFocusedField === 'storySummary') {
      // Generate story summary
      await this.handleWriteStorySummary();
      return;
    }

    // Otherwise, generate chapter summary
    if (this.shellView.activeId == null) return;
    const chapter = (this.shellView.chapters || []).find(c => c.id === this.shellView.activeId) || {};
    const hasExisting = !!(chapter.summary && chapter.summary.trim());
    let mode = 'discard';
    if (hasExisting) {
      const answer = confirm(UI_STRINGS.SUMMARY_EXISTS);
      mode = answer ? 'discard' : 'update';
    }
    // Try streaming endpoint first
    try {
      const textarea = this.shellView.el.querySelector(`[data-chapter-id="${this.shellView.activeId}"][data-ref="summaryInput"]`);
      let accum = '';
      await this._streamFetch('/api/story/summary/stream', { chap_id: this.shellView.activeId, mode, model_name: this.shellView.storyCurrentModel }, (chunk) => {
        accum += chunk;
        if (textarea) textarea.value = accum;
      });
      // On completion, update chapters state but do not persist here (server didn't persist). Caller can save manually or rely on debounce.
      this.shellView.chapters = this.shellView.chapters.map(c => c.id === this.shellView.activeId ? { ...c, summary: (textarea ? textarea.value : accum) } : c);
    } catch (err) {
      if (err && err.code === 404) {
        // Fallback to non-streaming
        try {
          const data = await fetchJSON('/api/story/summary', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chap_id: this.shellView.activeId, mode, model_name: this.shellView.storyCurrentModel })
          });
          const updated = (this.shellView.chapters || []).map(c => c.id === this.shellView.activeId ? { ...c, summary: data.summary || '' } : c);
          this.shellView.chapters = updated;
          const textarea = this.shellView.el.querySelector(`[data-chapter-id="${this.shellView.activeId}"][data-ref="summaryInput"]`);
          if (textarea) textarea.value = data.summary || '';
        } catch (e) {
          toast(UI_STRINGS.FAILED_SUMMARY + (e.message || e), 'error');
        }
      } else if (!(err && err.name === 'AbortError')) {
        toast(`Summary request failed: ${err.message || err}`, 'error');
      }
    }
  }

  /**
   * Handles writing chapter.
   */
  async handleWriteChapter() {
    if (this.shellView.activeId == null) return;
    try {
      let accum = '';
      await this._streamFetch('/api/story/write/stream', { chap_id: this.shellView.activeId, model_name: this.shellView.storyCurrentModel }, (chunk) => {
        accum += chunk;
        this.shellView.content = accum;
        this.shellView.contentEditor.scrollToBottom();
      });
      // On completion, leave content in editor; user can Save.
      this.shellView._originalContent = this.shellView.content;
      this.shellView.dirty = false;
      this.shellView.chapterRenderer.renderSaveButton();
      this.shellView.contentEditor.scrollToBottom();
    } catch (err) {
      if (err && err.code === 404) {
        // Fallback to non-streaming
        try {
          const data = await fetchJSON('/api/story/write', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chap_id: this.shellView.activeId, model_name: this.shellView.storyCurrentModel })
          });
          this.shellView.content = data.content || '';
          this.shellView._originalContent = this.shellView.content;
          this.shellView.dirty = false;
          this.shellView.chapterRenderer.renderSaveButton();
        } catch (e) {
          alert(UI_STRINGS.FAILED_CONTINUE + (e.message || e));
        }
      } else if (!(err && err.name === 'AbortError')) {
        alert(`Continue request failed: ${err.message || err}`);
      }
    }
  }

  /**
   * Handles continuing chapter.
   */
  async handleContinueChapter() {
    if (this.shellView.activeId == null) return;
    try {
      let accum = '';
      const base = this.shellView.content || '';
      await this._streamFetch('/api/story/continue/stream', { chap_id: this.shellView.activeId, model_name: this.shellView.storyCurrentModel }, (chunk) => {
        accum += chunk;
        const sep = base && !base.endsWith('\n') ? '\n' : '';
        this.shellView.content = base + sep + accum;
        this.shellView.contentEditor.scrollToBottom();
      });
      this.shellView._originalContent = this.shellView.content;
      this.shellView.dirty = false;
      this.shellView.chapterRenderer.renderSaveButton();
      this.shellView.contentEditor.scrollToBottom();
    } catch (err) {
      if (err && err.code === 404) {
        try {
          const data = await fetchJSON('/api/story/continue', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chap_id: this.shellView.activeId, model_name: this.shellView.storyCurrentModel })
          });
          this.shellView.content = data.content || '';
          this.shellView._originalContent = this.shellView.content;
          this.shellView.dirty = false;
          this.shellView.chapterRenderer.renderSaveButton();
        } catch (e) {
          alert(UI_STRINGS.FAILED_CONTINUE + (e.message || e));
        }
      } else if (!(err && err.name === 'AbortError')) {
        alert(`Continue request failed: ${err.message || err}`);
      }
    }
  }

  /**
   * Streams fetch for story actions.
   * @param {string} url - The URL.
   * @param {Object} body - The body.
   * @param {Function} onChunk - Chunk callback.
   */
  async _streamFetch(url, body, onChunk) {
    const controller = new AbortController();
    this.shellView._storyAbortController = controller;
    this.shellView.storyBusy = true;
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
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) onChunk(chunk);
      }
    } finally {
      this.shellView.storyBusy = false;
      this.shellView._storyAbortController = null;
    }
  }
}
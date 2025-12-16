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
   * Handles suggesting one or more paragraph continuations.
   * Fetches two suggestions in parallel and displays them for user selection.
   */
  async handleSuggestParagraphs() {
    if (this.shellView.activeId == null) return;
    const container = this.shellView.shellView?.el?.querySelector('[data-ref="continuationsContainer"]') || this.shellView.el.querySelector('[data-ref="continuationsContainer"]');
    const list = this.shellView.shellView?.el?.querySelector('[data-ref="continuationsList"]') || this.shellView.el.querySelector('[data-ref="continuationsList"]');
    const btn = document.querySelector('[data-action="story-suggest"]');
    const buttonRow = this.shellView.el.querySelector('[data-ref="suggestButtonRow"]');
    if (btn) btn.disabled = true;

    let prevBtnHtml = null;
    try {
      if (btn) {
        prevBtnHtml = btn.innerHTML;
        btn.innerHTML = `
          <i data-lucide="loader-circle" class="animate-spin" style="width:18px;height:18px"></i>
          <span class="font-medium text-sm">Crafting suggestions...</span>
        `;
        try {
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        } catch (_) {}
      }
    } catch (_) {}
    try {
      const payload = { chap_id: this.shellView.activeId, model_name: this.shellView.storyCurrentModel, current_text: this.shellView.content || '' };
      const [a, b] = await Promise.all([
        this._fetchPlainSuggestion(payload),
        this._fetchPlainSuggestion(payload)
      ]);
      if (!list) throw new Error('No continuations list available');
      list.innerHTML = '';
      [a, b].forEach((text) => {
        const card = document.createElement('div');
        card.className = 'group relative p-5 rounded-lg border border-stone-700 bg-stone-800 hover:bg-stone-750 hover:border-indigo-500/50 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5';
        card.innerHTML = `
          <div class="font-serif text-lg leading-relaxed text-stone-300 group-hover:text-stone-100">${this._escapeHtml(text).replace(/\n/g, '<br/>')}</div>
          <div class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0 hidden md:block">
            <div class="bg-indigo-600 text-white p-1.5 rounded-full shadow-md">
              <i data-lucide="arrow-right" style="width:16px;height:16px"></i>
            </div>
          </div>
        `;
        card.addEventListener('click', () => this._acceptContinuation(text));
        list.appendChild(card);
      });
      if (container) container.classList.remove('hidden');
      if (buttonRow) buttonRow.classList.add('hidden');
      try {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
          window.lucide.createIcons();
        }
      } catch (_) {}
    } catch (e) {
      toast('Failed to fetch suggestions: ' + (e.message || e), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        if (prevBtnHtml != null) btn.innerHTML = prevBtnHtml;
        try {
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
          }
        } catch (_) {}
      }
    }
  }

  dismissContinuations() {
    const container = this.shellView.el.querySelector('[data-ref="continuationsContainer"]');
    const list = this.shellView.el.querySelector('[data-ref="continuationsList"]');
    const buttonRow = this.shellView.el.querySelector('[data-ref="suggestButtonRow"]');
    if (list) list.innerHTML = '';
    if (container) container.classList.add('hidden');
    if (buttonRow) buttonRow.classList.remove('hidden');
  }

  async _fetchPlainSuggestion(payload) {
    try {
      const resp = await fetch('/api/story/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (resp.status === 404) {
        throw new Error('Suggest endpoint not found (404). Is the backend running?');
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // prefer streaming reader if available
      if (resp.body && typeof resp.body.getReader === 'function') {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
        }
        return buf;
      }
      return await resp.text();
    } catch (e) {
      return '(error)';
    }
  }

  _acceptContinuation(text) {
    try {
      const base = this.shellView.content || '';
      if (text && text.trim()) {
        const sep = base && !base.endsWith('\n') ? '\n\n' : '\n\n';
        this.shellView.content = base + sep + text;
      }
      this.dismissContinuations();
      // scroll editor into view if possible
      try { this.shellView.contentEditor.scrollToBottom(); } catch (_) {}
    } catch (e) {
      console.error('Failed to accept continuation:', e);
    }
  }

  _escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  /**
   * Renders story models select.
   */
  renderStoryModels() {
    const select = this.shellView.$refs.storyModelSelect || document.querySelector('[data-ref="storyModelSelect"]');
    if (!select) return;
    const models = Array.isArray(this.shellView.storyModels) ? this.shellView.storyModels : [];
    const current = this.shellView.storyCurrentModel || '';
    // Build options without using innerHTML to avoid HTML injection and simplify testing
    select.innerHTML = '';
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      if (m === current) opt.selected = true;
      opt.textContent = m;
      select.appendChild(opt);
    });
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

  /**
   * Update chapter summary using AI
   */
  async updateChapterSummary(chap_id) {
    try {
      this.shellView.storyBusy = true;
      await this._streamFetch('/api/story/summary/stream', { chap_id, mode: 'update', model_name: this.shellView.storyCurrentModel }, (chunk) => {
        const chapter = this.shellView.chapters.find(c => c.id === chap_id);
        if (chapter) {
          chapter.summary = chunk;
          this.shellView.chapterRenderer.renderChapterList();
        }
      });
    } catch (e) {
      console.error('Failed to update summary:', e);
    } finally {
      this.shellView.storyBusy = false;
    }
  }

  /**
   * Continue chapter using AI
   */
  async continueChapter(chap_id) {
    try {
      this.shellView.storyBusy = true;
      let accum = '';
      const base = this.shellView.content || '';
      await this._streamFetch('/api/story/continue/stream', { chap_id, model_name: this.shellView.storyCurrentModel }, (chunk) => {
        accum += chunk;
        const sep = base && !base.endsWith('\n') ? '\n' : '';
        this.shellView.content = base + sep + accum;
        this.shellView.onChanged();
      });
    } catch (e) {
      console.error('Failed to continue chapter:', e);
    } finally {
      this.shellView.storyBusy = false;
    }
  }
}
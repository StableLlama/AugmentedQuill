import { UI_STRINGS } from '../constants/editorConstants.js';

export class ChapterRenderer {
  /**
   * Handles rendering of the chapter list and main view.
   * Manages UI updates for chapter navigation and content display,
   * ensuring the interface reflects the current state of the story project.
   * @param {ShellView} shellView - The parent ShellView instance.
   */
  constructor(shellView) {
    this.shellView = shellView;
  }

  /**
   * Renders the story title.
   */
  renderStoryTitle() {
    const titleInput = this.shellView.el?.querySelector('[data-ref="storyTitleInput"]');
    if (titleInput) {
      titleInput.value = this.shellView.storyTitle || '';
    }
    const titleDisplay = this.shellView.el?.querySelector('[data-ref="storyTitleDisplay"]');
    if (titleDisplay) {
      titleDisplay.textContent = this.shellView.storyTitle || 'Untitled Story';
    }
  }

  /**
   * Renders the story summary section.
   */
  renderStorySummary() {
    const summaryInput = this.shellView.el?.querySelector('[data-ref="storySummaryInput"]');
    if (summaryInput) {
      summaryInput.value = this.shellView.storySummary || '';
    }
    const content = this.shellView.el?.querySelector('.aq-story-summary-content');
    if (content) {
      content.style.display = this.shellView.storySummaryExpanded ? 'block' : 'none';
    }
    const tagsSection = this.shellView.el?.querySelector('.aq-story-tags-section');
    if (tagsSection) {
      tagsSection.style.display = this.shellView.storySummaryExpanded ? 'block' : 'none';
    }
    const toggleBtn = this.shellView.el?.querySelector('[data-action="toggle-story-summary"]');
    if (toggleBtn) {
      toggleBtn.textContent = this.shellView.storySummaryExpanded ? '▼' : '▶';
    }
    const summaryDisplay = this.shellView.el?.querySelector('[data-ref="storySummaryDisplay"]');
    if (summaryDisplay) {
      summaryDisplay.textContent = this.shellView.storySummary || '';
    }
  }

  /**
   * Renders the story tags section.
   */
  renderStoryTags() {
    const tagsInput = this.shellView.el?.querySelector('[data-ref="storyTagsInput"]');
    if (tagsInput) {
      tagsInput.value = this.shellView.storyTags || '';
    }
    const chips = this.shellView.el?.querySelector('[data-ref="tagChips"]');
    if (chips) {
      chips.innerHTML = '';
      const tags = (this.shellView.storyTags || '').split(',').map(t => t.trim()).filter(Boolean);
      if (!tags.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'aq-empty';
        placeholder.textContent = 'No tags';
        chips.appendChild(placeholder);
      } else {
        tags.forEach(t => {
          const el = document.createElement('span');
          el.className = 'tag-chip';
          el.textContent = t;
          chips.appendChild(el);
        });
      }
    }
  }

  /**
   * Renders the chapter list.
   */
  renderChapterList() {
    const list = this.shellView.el?.querySelector('[data-chapter-list]');
    if (!list) return;
    if (this.shellView.chapters.length === 0) {
      list.innerHTML = `
        <div class="text-center py-10 text-stone-600">
          <i data-lucide="file-text" class="mx-auto mb-2 opacity-50" style="width:32px;height:32px"></i>
          <p class="text-sm">No chapters yet.</p>
        </div>
      `;
      try { if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch (_) {}
      return;
    }

    list.innerHTML = this.shellView.chapters.map(chapter => {
      const active = chapter.id === this.shellView.activeId;
      return `
      <div class="group relative p-3 rounded-lg cursor-pointer transition-all border ${active ? 'bg-stone-800 border-indigo-500/50 shadow-sm' : 'bg-transparent border-transparent hover:bg-stone-800'}" data-chapter-id="${chapter.id}" data-action="select-chapter">
        <div class="flex justify-between items-start">
          <h3 class="font-medium text-sm mb-1 ${active ? 'text-indigo-400' : 'text-stone-300'}">${this.escapeHtml(chapter.title || 'Untitled Chapter')}</h3>
          <button class="opacity-0 group-hover:opacity-100 p-1 text-stone-500 hover:text-red-400 transition-opacity" data-action="delete-chapter" data-chapter-id="${chapter.id}" title="Delete Chapter">
            <i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:middle"></i>
          </button>
        </div>
        <p class="text-xs text-stone-500 line-clamp-2">${this.escapeHtml(chapter.summary || 'No summary available...')}</p>
      </div>
      `;
    }).join('');
    // Refresh refs
    this.shellView._scanRefs();
  }

  /**
   * Renders the main view (empty or chapter).
   */
  renderMainView() {
    const emptyView = this.shellView.el.querySelector('[data-view="empty"]');
    const chapterView = this.shellView.el.querySelector('[data-view="chapter"]');
    if (!emptyView || !chapterView) return;

    const isChapterOpen = this.shellView.activeId !== null;
    emptyView.classList.toggle('hidden', isChapterOpen);
    chapterView.classList.toggle('hidden', !isChapterOpen);

    if (isChapterOpen) {
      const activeIdEl = this.shellView.el.querySelector('[data-active-id]');
      if (activeIdEl) activeIdEl.textContent = this.shellView.activeId;
    }
  }

  /**
   * Renders the dirty state indicator.
   */
  renderDirtyState() {
    const dirtyIndicator = document.querySelector('[data-dirty-indicator]');
    if (dirtyIndicator) {
      dirtyIndicator.style.display = this.shellView.dirty ? 'inline' : 'none';
    }
    try {
      document.body?.setAttribute('data-dirty', this.shellView.dirty ? 'true' : 'false');
    } catch (_) {
      // Ignore DOM errors
    }
    this.renderSaveButton();
  }

  /**
   * Renders the save button state.
   */
  renderSaveButton() {
    const saveBtn = document.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.disabled = !this.shellView.dirty;
      saveBtn.textContent = this.shellView.dirty ? UI_STRINGS.SAVE_DIRTY : UI_STRINGS.SAVE;
    }
  }

  /**
   * Escapes HTML for safe rendering.
   * @param {string} text - The text to escape.
   * @returns {string} The escaped HTML.
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
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
  }

  /**
   * Renders the story tags section.
   */
  renderStoryTags() {
    const tagsInput = this.shellView.el?.querySelector('[data-ref="storyTagsInput"]');
    if (tagsInput) {
      tagsInput.value = this.shellView.storyTags || '';
    }
  }

  /**
   * Renders the chapter list.
   */
  renderChapterList() {
    const list = this.shellView.el?.querySelector('[data-chapter-list]');
    if (!list) return;

    list.innerHTML = this.shellView.chapters.map(chapter => `
      <li class="chapter-item ${chapter.id === this.shellView.activeId ? 'active' : ''} ${chapter.expanded ? 'expanded' : ''}"
          data-chapter-id="${chapter.id}">
        <div class="chapter-header">
            <button class="aq-btn aq-btn-sm aq-btn-icon" data-action="toggle-summary" title="Toggle Summary">
                ${chapter.expanded ? '▼' : '▶'}
            </button>
            <div class="chapter-edit-container" style="flex:1;">
              <input type="text"
                     value="${this.escapeHtml(chapter.title || '')}"
                     placeholder="${UI_STRINGS.UNTITLED}"
                     data-ref="titleInput"
                     class="chapter-title-input">
            </div>
        </div>
        ${chapter.expanded ? `
            <div class="chapter-summary-section">
                <div class="summary-edit-container">
                    <textarea data-chapter-id="${chapter.id}"
                              data-ref="summaryInput"
                              class="chapter-summary-input"
                              rows="3"
                              placeholder="${UI_STRINGS.ENTER_SUMMARY}">${this.escapeHtml(chapter.summary || '')}</textarea>
                </div>
            </div>
        ` : ''}
      </li>
    `).join('');
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
    emptyView.style.display = isChapterOpen ? 'none' : 'block';
    chapterView.style.display = isChapterOpen ? 'flex' : 'none';

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
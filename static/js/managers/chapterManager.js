import { fetchJSON } from '../utils/utils.js';
import { UI_STRINGS } from '../constants/editorConstants.js';
import { toast } from '../utils/editorUtils.js';

/**
 * Chapter Manager
 * Handles chapter-related operations like loading, saving, creating, and managing chapters.
 */
export class ChapterManager {
  /**
   * @param {ShellView} shellView - The parent ShellView instance
   */
  constructor(shellView) {
    this.shellView = shellView;
  }

  /**
   * Load initial state: rendering preference and chapters
   */
  async load() {
    try {
      // Load story settings to determine render mode preference
      await this._loadRenderMode();

      // Load story models
      await this.loadChat();

      // Initialize Toast UI if starting in Markdown or WYSIWYG
      if (this.shellView.renderMode !== 'raw') {
        const mode = this.shellView.renderMode;
        setTimeout(() => this.shellView.renderingManager._initTUI(mode), 0);
      }

      // Load chapter list
      await this.refreshChapters();
      // Chat is now handled by ChatView component; don't duplicate here

      // Auto-select first project if none selected
      if (!this.shellView.chapters.length) {
        await this.ensureProjectSelected();
      }
    } catch (e) {
      console.error('Failed to load initial state:', e);
    }
  }

  /**
   * Load rendering mode preference from story settings
   */
  async _loadRenderMode() {
    try {
      const story = await fetchJSON('/api/story');
      if (story && story.format) {
        const format = String(story.format).toLowerCase() || 'markdown';
        if (format === 'raw') {
          this.shellView.renderMode = 'raw';
        } else if (format === 'wysiwyg') {
          this.shellView.renderMode = 'wysiwyg';
        } else {
          this.shellView.renderMode = 'markdown';
        }
      }
    } catch (e) {
      console.error('Failed to load render mode:', e);
    }
  }

  /**
   * Load story models from machine configuration
   */
  async loadChat() {
    try {
      const machine = await fetchJSON('/api/machine');
      const openai = (machine && machine.openai) || {};
      const modelsList = Array.isArray(openai.models) ? openai.models : [];
      const modelNames = modelsList.map(m => m.name).filter(Boolean);

      // If no named models, check for legacy single model
      if (!modelNames.length) {
        const legacyModel = openai.model;
        if (legacyModel) {
          modelNames.push('default');
        }
      }

      this.shellView.storyModels = modelNames;
      const selected = openai.selected || '';
      if (selected && modelNames.includes(selected)) {
        this.shellView.storyCurrentModel = selected;
      } else if (!this.shellView.storyCurrentModel && modelNames.length) {
        this.shellView.storyCurrentModel = modelNames[0];
      }
    } catch (e) {
      console.error('Failed to load story models:', e);
      this.shellView.storyModels = [];
    }
  }

  /**
   * Auto-select first available project if none is selected
   */
  async ensureProjectSelected() {
    try {
      const projects = await fetchJSON('/api/projects');
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
  }

  /**
   * Reload chapter list from API
   */
  async refreshChapters() {
    try {
      const response = await fetch('/api/chapters');
      const data = await response.json();
      this.shellView.chapters = Array.isArray(data.chapters) ? data.chapters.map(c => ({...c, expanded: false})) : [];

      // Load story config
      const storyResponse = await fetch('/api/story');
      const storyData = await storyResponse.json();
      this.shellView.storySummary = storyData.story_summary || '';
      this.shellView.storyTags = storyData.tags || '';

      // Maintain selection if chapter still exists, otherwise select first
      const hasActiveChapter = this.shellView.chapters.some(c => c.id === this.shellView.activeId);

      if (!hasActiveChapter && this.shellView.chapters.length) {
        await this.openChapter(this.shellView.chapters[0].id);
      } else if (!this.shellView.chapters.length) {
        this.shellView.activeId = null;
        this.shellView.content = '';
      }
    } catch (e) {
      console.error('Failed to refresh chapter list:', e);
      this.shellView.chapters = [];
    }
  }

  /**
   * Saves the current chapter content to the server
   */
  async saveContent() {
    if (this.shellView.activeId == null) return;

    try {
      const cleanContent = this.shellView.content || '';

      await fetchJSON(`/api/chapters/${this.shellView.activeId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: cleanContent })
      });

      this.shellView.content = cleanContent;
      this.shellView._originalContent = this.shellView.content;
      this.shellView.dirty = false;
      toast(UI_STRINGS.SAVED, 'success');
    } catch (e) {
      toast(UI_STRINGS.FAILED_SAVE + (e.message || e), 'error');
    }
  }

  /**
   * Opens a chapter for editing, loading its content and updating the UI
   * @param {number} id - The chapter ID to open
   */
  async openChapter(id) {
    if (id == null) return;

    if (this.shellView.activeId !== null && id !== this.shellView.activeId) {
      if (!this._confirmDiscardIfDirty()) return;
    }

    this.shellView.editingId = null;
    this.shellView.editingTitle = '';

    try {
      const data = await fetchJSON(`/api/chapters/${id}`);

      this.shellView.activeId = data.id;
      this.shellView.content = data.content || '';
      this.shellView._originalContent = this.shellView.content;
      this.shellView.chapters = this.shellView.chapters.map(c => c.id === id ? { ...c, summary: data.summary || '' } : c); // Update chapter in list with summary
      this.shellView._originalSummaryContent = data.summary || ''; // Store original summary for dirty tracking
      this.shellView.dirty = false;

      setTimeout(() => {
        if (this.shellView.renderMode !== 'raw') {
          this.shellView.renderingManager._initTUI(this.shellView.renderMode, this.shellView.content);
        }
      }, 0);
    } catch (e) {
      this.shellView.content = UI_STRINGS.ERROR_LOADING + (e.message || e);
      this.shellView._originalContent = this.shellView.content;
      this.shellView.dirty = false;
    }
  }

  /**
   * Confirm with user before discarding unsaved changes
   */
  _confirmDiscardIfDirty() {
    if (!this.shellView.dirty) return true;
    return confirm('You have unsaved changes. Discard them?');
  }

  /**
   * Creates a new chapter and opens it for editing
   */
  async createChapter() {
    try {
      const data = await fetchJSON('/api/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', content: '' })
      });

      await this.refreshChapters();

      const newId = data.chapter?.id;
      if (newId != null) {
        const chapter = this.shellView.chapters.find(c => c.id === newId) || data.chapter;
        this.shellView.activeId = newId;
        this.startEdit(chapter);
      }
    } catch (e) {
      toast(`Failed to create chapter: ${e.message || e}`, 'error');
    }
  }

  /**
   * Start editing a chapter title
   */
  startEdit(chapter) {
    this.shellView.activeId = chapter.id;
    this.shellView.editingId = chapter.id;
    this.shellView.editingTitle = chapter.title || '';
  }

  /**
   * Cancel editing a chapter title
   */
  cancelEdit() {
    this.shellView.editingId = null;
    this.shellView.editingTitle = '';
  }

  /**
   * Toggle summary expansion for a chapter
   */
  toggleSummary(id) {
    this.shellView.chapters = this.shellView.chapters.map(c =>
      c.id === id ? { ...c, expanded: !c.expanded } : c
    );
  }

  /**
   * Save edited chapter title
   */
  async _saveTitle(event) {
    const input = event?.target;
    if (!input || !input.matches('[data-ref="titleInput"]')) return;
    const item = input.closest('[data-chapter-id]');
    if (!item) return;
    const id = parseInt(item.getAttribute('data-chapter-id'), 10);
    if (isNaN(id)) return;
    const title = String(input.value || '').trim();
    try {
      const data = await fetchJSON(`/api/chapters/${id}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      // Avoid re-rendering the whole list to preserve focus; mutate in place
      const idx = this.shellView.chapters.findIndex(c => c.id === id);
      if (idx !== -1) {
        this.shellView.chapters[idx].title = data.chapter.title;
      }
    } catch (e) {
      console.error(`Failed to save title for chapter ${id}:`, e);
    }
  }

  /**
   * Save chapter summary
   */
  async _saveSummary(event) {
    const textarea = event.target;
    if (!textarea || !textarea.matches('[data-ref="summaryInput"]')) return;

    const id = parseInt(textarea.getAttribute('data-chapter-id'), 10);
    const summary = textarea.value.trim();

    if (isNaN(id) || id === null) return;

    try {
      const data = await fetchJSON(`/api/chapters/${id}/summary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary })
      });

      this.shellView.chapters = this.shellView.chapters.map(c =>
        c.id === id ? { ...c, summary: data.chapter.summary } : c
      );
      this.shellView._originalSummaryContent = summary; // Update original content after save
    } catch (e) {
      console.error(`Failed to save summary for chapter ${id}: ${e.message || e}`);
      toast(`Failed to save summary: ${e.message || e}`, 'error');
      // Optionally, revert the textarea to _originalSummaryContent or show an error state
    }
  }

  /**
   * Save story summary
   */
  async _saveStorySummary(event) {
    const textarea = event.target;
    if (!textarea || !textarea.matches('[data-ref="storySummaryInput"]')) return;

    const summary = textarea.value.trim();

    try {
      const data = await fetchJSON('/api/story/summary', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary })
      });
      this.shellView.storySummary = data.story_summary;
    } catch (e) {
      console.error(`Failed to save story summary: ${e.message || e}`);
      toast(`Failed to save story summary: ${e.message || e}`, 'error');
    }
  }

  /**
   * Save story tags
   */
  async _saveStoryTags(event) {
    const input = event.target;
    if (!input || !input.matches('[data-ref="storyTagsInput"]')) return;

    const tags = input.value.trim();

    try {
      const data = await fetchJSON('/api/story/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
      });
      this.shellView.storyTags = data.tags;
    } catch (e) {
      console.error(`Failed to save story tags: ${e.message || e}`);
      toast(`Failed to save story tags: ${e.message || e}`, 'error');
    }
  }
}
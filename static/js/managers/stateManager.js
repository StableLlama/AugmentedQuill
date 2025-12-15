/**
 * State Manager
 * Handles state management and data persistence operations.
 */
export class StateManager {
  /**
   * @param {ShellView} shellView - The parent ShellView instance
   */
  constructor(shellView) {
    this.shellView = shellView;
  }

  /**
   * Load state from localStorage
   */
  loadState() {
    try {
      const stored = localStorage.getItem('editorState');
      if (stored) {
        const state = JSON.parse(stored);
        Object.assign(this.shellView, state);
      }
    } catch (e) {
      console.warn('Failed to load editor state:', e);
    }
  }

  /**
   * Save state to localStorage
   */
  saveState() {
    try {
      const state = {
        renderMode: this.shellView.renderMode,
        flowMode: this.shellView.flowMode,
        currentChapter: this.shellView.currentChapter,
        projectId: this.shellView.projectId,
        storyId: this.shellView.storyId
      };
      localStorage.setItem('editorState', JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save editor state:', e);
    }
  }

  /**
   * Clear all state
   */
  clearState() {
    try {
      localStorage.removeItem('editorState');
    } catch (e) {
      console.warn('Failed to clear editor state:', e);
    }
  }

  /**
   * Get the current content value
   */
  getContent() {
    return this.shellView.content || '';
  }

  /**
   * Set the content value
   */
  setContent(value) {
    this.shellView.content = String(value || '');
    this.shellView.onChanged();
  }

  /**
   * Check if content has unsaved changes
   */
  hasUnsavedChanges() {
    return this.shellView._hasUnsavedChanges;
  }

  /**
   * Mark content as having unsaved changes
   */
  markUnsavedChanges(hasChanges = true) {
    this.shellView._hasUnsavedChanges = hasChanges;
  }

  /**
   * Get the current project ID
   */
  getProjectId() {
    return this.shellView.projectId;
  }

  /**
   * Set the current project ID
   */
  setProjectId(id) {
    this.shellView.projectId = id;
    this.saveState();
  }

  /**
   * Get the current story ID
   */
  getStoryId() {
    return this.shellView.storyId;
  }

  /**
   * Set the current story ID
   */
  setStoryId(id) {
    this.shellView.storyId = id;
    this.saveState();
  }

  /**
   * Get the current chapter number
   */
  getCurrentChapter() {
    return this.shellView.currentChapter;
  }

  /**
   * Set the current chapter number
   */
  setCurrentChapter(chapter) {
    this.shellView.currentChapter = chapter;
    this.saveState();
  }

  /**
   * Get the current render mode
   */
  getRenderMode() {
    return this.shellView.renderMode;
  }

  /**
   * Set the render mode
   */
  setRenderMode(mode) {
    this.shellView.renderMode = mode;
    this.saveState();
  }

  /**
   * Get the current flow mode
   */
  getFlowMode() {
    return this.shellView.flowMode;
  }

  /**
   * Set the flow mode
   */
  setFlowMode(mode) {
    this.shellView.flowMode = mode;
    this.saveState();
  }
}
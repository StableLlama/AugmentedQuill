// AugmentedQuill frontend script bundle
// - Keeps HTML clean by moving non-trivial JS here
// - Provides Alpine data factories and global event hooks

(function(){
  // ========================================
  // Shared Utilities
  // ========================================

  /**
   * Fetch helper with consistent error handling
   */
  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.detail || data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  /**
   * Safe JSON GET helper: returns {} on error
   */
  async function getJSONOrEmpty(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return {};
      return await resp.json();
    } catch (_) {
      return {};
    }
  }

  // Lightweight API wrappers used across components
  const API = {
    loadStory: () => getJSONOrEmpty('/api/story'),
    loadProjects: () => getJSONOrEmpty('/api/projects')
  };

  // ========================================
  // DOM Event Listeners
  // ========================================

  // Footer year updater
  document.addEventListener('DOMContentLoaded', function(){
    const yearElement = document.getElementById('aq-year');
    if (yearElement) {
      yearElement.textContent = new Date().getFullYear();
    }
  });

  // Re-initialize Alpine.js on HTMX content swaps so x-data components work after partial loads
  document.addEventListener('htmx:afterSwap', function (e) {
    try {
      const target = e.detail?.target || e.target;
      if (window.Alpine && target) {
        window.Alpine.initTree(target);
      }
    } catch (_) { /* no-op */ }
  });

  // ========================================
  // Settings Page Data Factory
  // ========================================

  function modelsEditor() {
    return {
      models: [],
      selected_name: '',
      project_title: '',
      format: 'markdown',
      chapters_text: '',
      llm_temperature: 0.7,
      llm_max_tokens: 2048,
      saved_msg: '',
      error_msg: '',
      new_project_name: '',
      current_project: '',
      available_projects: [],
      _baseline: '',
      async init() {
        try {
          // Load all configuration data in parallel
          const [story, machine, projects] = await this._loadAllConfigs();

          // Initialize state from loaded configs
          this._initializeProjectState(projects);
          this._initializeStoryState(story);
          this._initializeModelState(machine);

          // Establish baseline for dirty tracking
          this._setBaseline();

          // Load remote models asynchronously after initialization
          queueMicrotask(() => {
            this.models.forEach((_, idx) => this.loadRemoteModels(idx));
          });
        } catch (e) {
          this.error_msg = `Failed to load settings: ${e.message || e}`;
        }
      },

      /**
       * Load story, machine, and project configurations from API
       */
      async _loadAllConfigs() {
        const [story, machineResp, projects] = await Promise.all([
          API.loadStory(),
          fetch('/api/machine'),
          API.loadProjects(),
        ]);

        return [
          story || {},
          machineResp.ok ? await machineResp.json() : {},
          projects && (projects.current || projects.available) ? projects : { current: '', available: [] }
        ];
      },

      /**
       * Initialize project-related state
       */
      _initializeProjectState(projects) {
        const currentPath = projects.current || '';
        this.current_project = currentPath ? currentPath.split('/').pop() : '';
        this.available_projects = Array.isArray(projects.available) ? projects.available : [];
      },

      /**
       * Initialize story configuration state
       */
      _initializeStoryState(story) {
        this.project_title = story.project_title || '';
        this.format = story.format || 'markdown';
        this.chapters_text = Array.isArray(story.chapters) ? story.chapters.join('\n') : '';

        const prefs = story.llm_prefs || {};
        this.llm_temperature = typeof prefs.temperature === 'number'
          ? prefs.temperature
          : parseFloat(prefs.temperature) || 0.7;
        this.llm_max_tokens = typeof prefs.max_tokens === 'number'
          ? prefs.max_tokens
          : parseInt(prefs.max_tokens, 10) || 2048;
      },

      /**
       * Initialize model configuration state
       */
      _initializeModelState(machine) {
        const openai = machine?.openai || {};
        const models = Array.isArray(openai.models) ? openai.models : [];

        if (models.length) {
          this.models = models.map(m => ({
            ...m,
            endpoint_ok: undefined,
            remote_models: m.remote_models || [],
            remote_model: m.model || m.remote_model || ''
          }));
          this.selected_name = openai.selected || this.models[0]?.name || '';
        } else {
          // Create default model configuration
          this.models = [{
            name: 'default',
            base_url: openai.base_url || 'https://api.openai.com/v1',
            api_key: openai.api_key || '',
            timeout_s: openai.timeout_s || 60,
            remote_model: openai.model || '',
            remote_models: [],
            endpoint_ok: undefined
          }];
          this.selected_name = 'default';
        }
      },
      /**
       * Add a new model configuration
       */
      add() {
        this.models.push({
          name: `model-${this.models.length + 1}`,
          base_url: 'https://api.openai.com/v1',
          api_key: '',
          timeout_s: 60,
          remote_model: '',
          remote_models: [],
          endpoint_ok: undefined
        });
      },

      /**
       * Remove a model configuration by index
       */
      remove(idx) {
        const removed = this.models.splice(idx, 1);
        // If removed model was selected, switch to first available
        if (removed.length && this.selected_name === removed[0].name) {
          this.selected_name = this.models[0]?.name || '';
        }
      },

      /**
       * Load available models from remote endpoint.
       * Tries direct connection first, falls back to proxy if CORS blocks it.
       */
      async loadRemoteModels(idx) {
        const model = this.models[idx];
        const currentSelection = model.remote_model;

        model.endpoint_ok = undefined;

        try {
          // Try direct connection first (may fail due to CORS)
          let data;
          try {
            data = await this._fetchModelsDirect(model);
          } catch (_) {
            // Fallback to backend proxy
            data = await this._fetchModelsViaProxy(model);
          }

          // Extract and sort model names
          const list = Array.isArray(data.data) ? data.data : [];
          model.remote_models = list
            .map(x => typeof x === 'string' ? x : (x.id || x.name || ''))
            .filter(Boolean)
            .sort();

          // Preserve current selection to avoid UI reset
          model.remote_model = currentSelection;
          model.endpoint_ok = true;
        } catch (_) {
          model.remote_model = currentSelection;
          model.endpoint_ok = false;
        }
      },

      /**
       * Fetch models directly from OpenAI-compatible endpoint
       */
      async _fetchModelsDirect(model) {
        const url = model.base_url.replace(/\/$/, '') + '/models';
        const headers = {};
        if (model.api_key) {
          headers['Authorization'] = `Bearer ${model.api_key}`;
        }

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      },

      /**
       * Fetch models via backend proxy (for CORS issues)
       */
      async _fetchModelsViaProxy(model) {
        const response = await fetch('/api/openai/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base_url: model.base_url,
            api_key: model.api_key,
            timeout_s: model.timeout_s || 60
          })
        });
        if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
        return await response.json();
      },
      /**
       * Count model name occurrences for validation
       */
      _countModelNames() {
        return this.models.reduce((acc, m) => {
          const name = (m.name || '').trim();
          if (name) {
            acc[name] = (acc[name] || 0) + 1;
          }
          return acc;
        }, {});
      },

      /**
       * Check if any model names are duplicated
       */
      hasDuplicateNames() {
        const counts = this._countModelNames();
        return Object.values(counts).some(count => count > 1);
      },

      /**
       * Get list of duplicate model names for error messages
       */
      duplicateNamesList() {
        const counts = this._countModelNames();
        return Object.entries(counts)
          .filter(([_, count]) => count > 1)
          .map(([name]) => name);
      },

      /**
       * Check if any models have empty names
       */
      hasEmptyName() {
        return this.models.some(m => !m.name?.trim());
      },

      /**
       * Check if there are any name validation issues
       */
      hasNameIssues() {
        return this.hasDuplicateNames() || this.hasEmptyName();
      },

      /**
       * Serialize models for API submission
       */
      serializeModelsPayload() {
        const payload = this.models.map(m => ({
          name: m.name,
          base_url: m.base_url,
          api_key: m.api_key,
          timeout_s: m.timeout_s,
          model: m.remote_model || ''
        }));
        return { models: payload, selected: this.selected_name };
      },
      /**
       * Create a snapshot of current state for dirty tracking
       */
      _snapshot() {
        const story = this._buildStoryPayload();
        const machine = { openai: this.serializeModelsPayload() };

        try {
          return JSON.stringify({ story, machine });
        } catch (_) {
          return '';
        }
      },

      /**
       * Set baseline for dirty tracking (after load or save)
       */
      _setBaseline() {
        this._baseline = this._snapshot();
      },

      /**
       * Check if current state differs from baseline
       */
      isDirty() {
        return this._snapshot() !== this._baseline;
      },
      /**
       * Build story payload from current editor fields
       */
      _buildStoryPayload() {
        return {
          project_title: this.project_title || 'Untitled Project',
          format: this.format || 'markdown',
          chapters: this.chapters_text.split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean),
          llm_prefs: {
            temperature: Number(this.llm_temperature),
            max_tokens: Number(this.llm_max_tokens)
          }
        };
      },
      /**
       * Switch to a different project (creates if doesn't exist)
       */
      async selectByName(name) {
        this.error_msg = '';

        const targetName = (name || '').trim();
        const isSameProject = this.current_project === targetName;

        // Warn about unsaved changes when switching projects
        if (!isSameProject && this.isDirty()) {
          const proceed = confirm(
            'You have unsaved changes in the current project. ' +
            'Switching projects will discard them. Continue without saving?'
          );
          if (!proceed) return;
        }

        try {
          const data = await fetchJSON('/api/projects/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name || '' })
          });

          // Update current project
          const registry = data.registry || {};
          const currentPath = registry.current || '';
          this.current_project = currentPath ? currentPath.split('/').pop() : '';

          // Load story settings from response
          this._initializeStoryState(data.story || {});
          this._setBaseline();

          this.saved_msg = data.message || 'Project selected.';

          // Notify other components (like chapter list) to reload
          document.dispatchEvent(new CustomEvent('aq:project-selected', {
            detail: { name: targetName }
          }));

          // Refresh available projects list
          await this._refreshAvailableProjects();
        } catch (e) {
          this.error_msg = `Failed to select project: ${e.message || e}`;
        }
      },

      /**
       * Refresh the list of available projects
       */
      async _refreshAvailableProjects() {
        try {
          const data = await API.loadProjects();
          if (Array.isArray(data.available)) {
            this.available_projects = data.available;
          }
        } catch (_) {
          // Keep existing list on error
        }
      },
      /**
       * Create a new project with the entered name
       */
      async createProject() {
        const name = this.new_project_name?.trim();
        if (!name) {
          this.error_msg = 'Enter a project name.';
          return;
        }
        // Create by selecting (backend creates if doesn't exist)
        return this.selectByName(name);
      },

      /**
       * Delete a project after confirmation
       */
      async deleteProject(name) {
        if (!name) return;

        const isDeletingCurrent = this.current_project === name;

        // Warn about unsaved changes if deleting current project
        if (isDeletingCurrent && this.isDirty()) {
          const proceed = confirm(
            'You have unsaved changes in the current project. ' +
            'Deleting it will discard them. Continue without saving?'
          );
          if (!proceed) return;
        }

        // Final confirmation
        if (!confirm(`Delete project "${name}"? This cannot be undone.`)) {
          return;
        }

        this.saved_msg = '';
        this.error_msg = '';

        try {
          const data = await fetchJSON('/api/projects/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          });

          // Update available projects list
          this.available_projects = Array.isArray(data.available)
            ? data.available
            : this.available_projects;

          // Update current project (backend may have switched to default)
          const registry = data.registry || {};
          const currentPath = registry.current || '';
          this.current_project = currentPath ? currentPath.split('/').pop() : '';

          // Reload story settings if current project was deleted
          if (isDeletingCurrent) {
            await this._reloadStoryFromAPI();
          }

          this.saved_msg = data.message || 'Project deleted.';
        } catch (e) {
          this.error_msg = `Failed to delete project: ${e.message || e}`;
        }
      },

      /**
       * Reload story settings from API
       */
      async _reloadStoryFromAPI() {
        try {
          const story = await API.loadStory();
          if (story && Object.keys(story).length) {
            this._initializeStoryState(story);
            this._setBaseline();
          }
        } catch (_) {
          // Silent failure - user will see default values
        }
      },
      /**
       * Save all settings to backend
       */
      async save() {
        this.saved_msg = '';
        this.error_msg = '';

        // Validate before saving
        if (this.hasNameIssues()) {
          this.error_msg = 'Resolve model name issues before saving.';
          return;
        }

        // Prepare payload
        const story = this._buildStoryPayload();

        const modelsPayload = this.serializeModelsPayload();
        const machine = {
          openai: {
            models: modelsPayload.models,
            selected: modelsPayload.selected
          }
        };

        try {
          await fetchJSON('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ story, machine })
          });

          this.saved_msg = 'Settings saved successfully.';
          this._setBaseline();
        } catch (e) {
          this.error_msg = `Failed to save: ${e.message || e}`;
        }
      },

      /**
       * Get visual indicator for endpoint connection status
       * Returns checkmark or X emoji based on endpoint_ok state
       */
      endpointStatus(model) {
        if (model.endpoint_ok === undefined) return '';
        return model.endpoint_ok ? '✓' : '✗';
      }
    }
  }

  // ========================================
  // Index Page Data Factory (Chapter Editor)
  // ========================================

  function shellView() {
    return {
      // Chapter list state
      chapters: [], // [{id, title, filename}]
      activeId: null,

      // Editor content state
      content: '',
      renderMode: 'markdown', // 'raw' or 'markdown'
      dirty: false,
      _originalContent: '',

      // Inline title editing state
      editingId: null,
      editingTitle: '',

      // Input suspension flag (prevents recursive updates during mode switches)
      _suspendInput: false,

      /**
       * Initialize the shell view component
       */
      init() {
        // Listen for project changes from settings page
        document.addEventListener('aq:project-selected', () => {
          this.refreshChapters();
        });

        // Keyboard shortcut: Ctrl/Cmd+S to save
        window.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            if (this.dirty) {
              this.saveContent();
            }
          }
        });

        // Warn user before navigating away with unsaved changes
        window.addEventListener('beforeunload', (e) => {
          if (this.dirty) {
            e.preventDefault();
            e.returnValue = '';
          }
        });

        this.load();
      },
      /**
       * Load initial state: rendering preference and chapters
       */
      async load() {
        try {
          // Load story settings to determine render mode preference
          await this._loadRenderMode();

          // Initialize editor if starting in markdown mode
          if (this.renderMode === 'markdown') {
            queueMicrotask(() => this._initTUI());
          }

          // Load chapter list
          await this.refreshChapters();

          // Auto-select first project if none selected
          if (!this.chapters.length) {
            await this.ensureProjectSelected();
          }
        } catch (_) {
          // Silent failure - component will show empty state
        }
      },

      /**
       * Load rendering mode preference from story settings
       */
      async _loadRenderMode() {
        try {
          const story = await API.loadStory();
          if (story && story.format) {
            const format = String(story.format).toLowerCase() || 'markdown';
            this.renderMode = format === 'markdown' ? 'markdown' : 'raw';
          }
        } catch (_) {
          // Keep default render mode
        }
      },

      /**
       * Auto-select first available project if none is selected
       */
      async ensureProjectSelected() {
        try {
          const projects = await API.loadProjects();
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
        } catch (_) {
          // Silent failure
        }
      },

      /**
       * Reload chapter list from API
       */
      async refreshChapters() {
        try {
          const response = await fetch('/api/chapters');
          const data = await response.json();
          this.chapters = Array.isArray(data.chapters) ? data.chapters : [];

          // Maintain selection if chapter still exists, otherwise select first
          const hasActiveChapter = this.chapters.some(c => c.id === this.activeId);

          if (!hasActiveChapter && this.chapters.length) {
            await this.openChapter(this.chapters[0].id);
          } else if (!this.chapters.length) {
            this.activeId = null;
            this.content = '';
          }
        } catch (_) {
          this.chapters = [];
        }
      },
      // Integrated editor helpers
      getRawEl() { return (this.$refs && this.$refs.rawEditor) ? this.$refs.rawEditor : null; },
      // WYSIWYG editor instance (Toast UI) when in markdown mode
      _tui: null,
      _tuiEl: null,
      getEditorEl() {
        if (this.renderMode === 'markdown' && this._tui && this._tuiEl) {
          return this._tuiEl;
        }
        return this.getRawEl();
      },
      /**
       * Render markdown content into the WYSIWYG editor
       */
      // Update WYSIWYG editor from content when active
      setEditorHtmlFromContent() {
        if (this._tui) {
          this._suspendInput = true;
          try {
            this._tui.setMarkdown(this.content || '');
          } finally {
            this._suspendInput = false;
          }
          return;
        }
        const textarea = this.getRawEl();
        if (!textarea) return;
        // Raw textarea already reflects x-model content
      },

      /**
       * Handle input in the WYSIWYG editor (convert HTML back to Markdown)
       */
      // Legacy no-op: EasyMDE directly syncs markdown via change events
      onEditorInput() {
        return;
      },
      /**
       * Capture the current Y position of the caret/editor for scroll adjustment
       */
      _captureAnchorY() {
        const editor = this.getEditorEl();
        if (!editor) return window.scrollY;

        // In markdown mode, use selection position if available
        if (this.renderMode === 'markdown') {
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
      },

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
      },
      /**
       * Switch between raw markdown and WYSIWYG rendering modes
       * Preserves caret position using temporary invisible markers
       */
      switchRender(mode) {
        mode = mode === 'raw' ? 'raw' : 'markdown';
        if (this.renderMode === mode) return;

        const oldScrollY = this._captureAnchorY();

        if (mode === 'markdown') {
          this._initTUI();
        } else {
          this._destroyTUI();
        }

        this.renderMode = mode;
        this._scrollAdjust(oldScrollY);
      },

      /**
       * Initialize Toast UI Editor (true WYSIWYG) on top of the textarea
       */
      _initTUI() {
        try {
          const textarea = this.getRawEl();
          if (!textarea) return;
          if (!(window.toastui && window.toastui.Editor)) {
            console.warn('Toast UI Editor not loaded; staying in raw mode');
            return;
          }
          if (this._tui) return;

          // Create container right before the textarea and hide the textarea
          const container = document.createElement('div');
          container.className = 'aq-tui-wrap';
          textarea.parentNode.insertBefore(container, textarea);
          this._tuiEl = container;

          // Hide textarea while WYSIWYG active
          textarea.style.display = 'none';

          this._tui = new window.toastui.Editor({
            el: container,
            initialEditType: 'wysiwyg',
            previewStyle: 'vertical',
            height: '300px',
            usageStatistics: false,
            toolbarItems: [
              ['heading', 'bold', 'italic', 'strike'],
              ['hr', 'quote'],
              ['ul', 'ol', 'task', 'indent', 'outdent'],
              ['table', 'link'],
              ['code', 'codeblock']
            ],
            hideModeSwitch: true,
            initialValue: this.content || ''
          });

          // Sync changes back to this.content
          this._tui.on('change', () => {
            if (this._suspendInput) return;
            try {
              this.content = this._tui.getMarkdown();
              this.onChanged();
            } catch (_) { /* no-op */ }
          });
        } catch (e) {
          console.error('Failed to init Toast UI Editor:', e);
        }
      },

      /**
       * Destroy Toast UI instance and restore textarea
       */
      _destroyTUI() {
        if (!this._tui) return;
        try {
          const textarea = this.getRawEl();
          // Capture latest value
          this._suspendInput = true;
          try {
            this.content = this._tui.getMarkdown();
          } finally {
            this._suspendInput = false;
          }
          // Destroy editor and remove container
          this._tui.destroy();
          this._tui = null;
          if (this._tuiEl && this._tuiEl.parentNode) {
            this._tuiEl.parentNode.removeChild(this._tuiEl);
          }
          this._tuiEl = null;
          // Show textarea again
          if (textarea) textarea.style.display = '';
        } catch (e) {
          console.error('Failed to destroy Toast UI Editor:', e);
          this._tui = null;
          this._tuiEl = null;
        }
      },


      /**
       * Mark content as changed (dirty tracking)
       */
      onChanged() {
        this.dirty = this.content !== this._originalContent;
      },

      /**
       * Confirm with user before discarding unsaved changes
       * @returns {boolean} true if safe to proceed (clean or user confirmed)
       */
      _confirmDiscardIfDirty() {
        if (!this.dirty) return true;
        return confirm('You have unsaved changes. Discard them?');
      },

      // ========================================
      // Toolbar Commands (Raw Mode)
      // ========================================
      /**
       * Wrap selected text with before/after strings (e.g., bold, italic)
       */
      _replaceSelection(before, after) {
        const textarea = this.getRawEl();
        if (!textarea) return;

        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const selected = this.content.slice(start, end);

        this.content =
          this.content.slice(0, start) +
          before + selected + after +
          this.content.slice(end);

        // Move cursor after inserted text
        queueMicrotask(() => {
          textarea.focus();
          const newPosition = start + before.length + selected.length + after.length;
          textarea.setSelectionRange(newPosition, newPosition);
        });

        this.onChanged();
      },

      /**
       * Wrap selection with markdown syntax (used by toolbar)
       */
      wrapSelection(before, after) {
        this._replaceSelection(before, after);
      },

      /**
       * Insert heading marker at start of current line
       */
      insertHeading() {
        const textarea = this.getRawEl();
        if (!textarea) return;

        const caretPos = textarea.selectionStart || 0;
        const lineStart = this.content.lastIndexOf('\n', caretPos - 1) + 1;

        this.content =
          this.content.slice(0, lineStart) +
          '# ' +
          this.content.slice(lineStart);

        this.onChanged();
      },

      /**
       * Insert markdown link with selected text
       */
      insertLink() {
        const textarea = this.getRawEl();
        if (!textarea) return;

        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const selected = this.content.slice(start, end) || 'text';

        const url = prompt('Enter URL', 'https://');
        if (url === null) return; // User cancelled

        const linkMarkdown = `[${selected}](${url || ''})`;
        this.content =
          this.content.slice(0, start) +
          linkMarkdown +
          this.content.slice(end);

        this.onChanged();
      },

      /**
       * Toggle line prefix for selected lines (e.g., list markers)
       */
      togglePrefix(prefix) {
        const textarea = this.getRawEl();
        if (!textarea) return;

        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const lines = this.content.split(/\r?\n/);

        // Find affected line indices
        const startLineIdx = this._findLineIndex(lines, start);
        const endLineIdx = this._findLineIndex(lines, end);

        // Toggle prefix on each line
        for (let i = startLineIdx; i <= endLineIdx; i++) {
          if (lines[i].startsWith(prefix)) {
            lines[i] = lines[i].slice(prefix.length);
          } else {
            lines[i] = prefix + lines[i];
          }
        }

        this.content = lines.join('\n');
        this.onChanged();
      },

      /**
       * Find line index for given character offset
       */
      _findLineIndex(lines, offset) {
        let position = 0;
        for (let i = 0; i < lines.length; i++) {
          if (position + lines[i].length >= offset) {
            return i;
          }
          position += lines[i].length + 1; // +1 for newline
        }
        return lines.length - 1;
      },

      /**
       * Toggle bullet list on selected lines
       */
      toggleList(prefix = '- ') {
        this.togglePrefix(prefix);
      },

      // ========================================
      // Content Management
      // ========================================

      /**
       * Save current chapter content to backend
       */
      async saveContent() {
        if (this.activeId == null) return;

        try {
          const cleanContent = this.content || '';

          await fetchJSON(`/api/chapters/${this.activeId}/content`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: cleanContent })
          });

          // Update tracking state
          this.content = cleanContent;
          this._originalContent = this.content;
          this.dirty = false;
        } catch (e) {
          alert(`Failed to save: ${e.message || e}`);
        }
      },

      /**
       * Load and display a chapter
       */
      async openChapter(id) {
        if (id == null) return;

        // Check for unsaved changes when switching chapters
        if (this.activeId !== null && id !== this.activeId) {
          if (!this._confirmDiscardIfDirty()) return;
        }

        // Exit title edit mode
        this.editingId = null;
        this.editingTitle = '';

        try {
          const data = await fetchJSON(`/api/chapters/${id}`);

          this.activeId = data.id;
          this.content = data.content || '';
          this._originalContent = this.content;
          this.dirty = false;

          // Render in WYSIWYG editor if in markdown mode
          queueMicrotask(() => {
            try {
              this.setEditorHtmlFromContent();
            } catch (_) {
              // Render failure is non-critical
            }
          });
        } catch (e) {
          // Show error in editor
          this.content = `Error loading chapter: ${e.message || e}`;
          this._originalContent = this.content;
          this.dirty = false;
        }
      },

      /**
       * Start editing chapter title inline
       */
      startEdit(chapter) {
        this.activeId = chapter.id;
        this.editingId = chapter.id;
        this.editingTitle = chapter.title || '';

        // Focus title input
        queueMicrotask(() => {
          try {
            this.$refs?.titleInput?.focus();
          } catch (_) {
            // Focus is non-critical
          }
        });
      },

      /**
       * Save edited chapter title
       */
      async saveEdit() {
        if (this.editingId == null) return;

        const id = this.editingId;
        const title = this.editingTitle?.trim() || '';

        try {
          const data = await fetchJSON(`/api/chapters/${id}/title`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
          });

          // Update local chapter list
          this.chapters = this.chapters.map(c =>
            c.id === id ? { ...c, title: data.chapter.title } : c
          );
        } catch (e) {
          alert(`Failed to save title: ${e.message || e}`);
        } finally {
          this.editingId = null;
          this.editingTitle = '';
        }
      },

      /**
       * Cancel title editing
       */
      cancelEdit() {
        this.editingId = null;
        this.editingTitle = '';
      },

      /**
       * Create a new chapter
       */
      async createChapter() {
        try {
          const data = await fetchJSON('/api/chapters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '', content: '' })
          });

          await this.refreshChapters();

          // Select and start editing the new chapter
          const newId = data.chapter?.id;
          if (newId != null) {
            const chapter = this.chapters.find(c => c.id === newId) || data.chapter;
            this.activeId = newId;
            this.startEdit(chapter);
          }
        } catch (e) {
          alert(`Failed to create chapter: ${e.message || e}`);
        }
      },
    };
  } // End of shellView

  // ========================================
  // Global Exports for Alpine.js
  // ========================================

  window.modelsEditor = modelsEditor;
  window.shellView = shellView;

})(); // End of IIFE

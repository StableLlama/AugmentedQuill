import { fetchJSON, API } from './utils.js';

/**
 * Settings Page Data Factory
 */
export function modelsEditor() {
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

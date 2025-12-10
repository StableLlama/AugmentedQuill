import { fetchJSON, API } from './utils.js';
import { Component } from './component.js';

/**
 * Settings Page Component
 */
export class ModelsEditor extends Component {
  constructor(element) {
    const initialState = {
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
      _baseline: ''
    };

    super(element, initialState);
  }

  init() {
    super.init();

    // Watch for state changes
    this.watch('saved_msg', () => this.renderMessages());
    this.watch('error_msg', () => this.renderMessages());
    this.watch('models', () => this.renderModels());
    this.watch('current_project', () => this.renderProjectInfo());
    this.watch('available_projects', () => this.renderProjectList());

    // Setup event listeners
    this._setupEventListeners();

    // Load initial data
    this._loadInitialData();
  }

  /**
   * Setup event listeners for settings UI
   */
  _setupEventListeners() {
    if (!this.el) return;

    // Save button
    const saveBtn = this.el.querySelector('[data-action="save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.save());
    }

    // Add model button
    const addBtn = this.el.querySelector('[data-action="add-model"]');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.add();
      });
    }

    // Create project button
    const createProjectBtn = this.el.querySelector('[data-action="create-project"]');
    if (createProjectBtn) {
      createProjectBtn.addEventListener('click', () => this.createProject());
    }

    // Form inputs
    this._bindFormInputs();

    // Models list event delegation
    const modelsList = this.el.querySelector('[data-models-list]');
    if (modelsList) {
        let debounceTimeout;

        modelsList.addEventListener('input', (e) => {
            const target = e.target;
            const modelCard = target.closest('[data-model-index]');
            if (!modelCard) return;

            const idx = parseInt(modelCard.dataset.modelIndex, 10);
            const model = this.models[idx];
            const field = target.dataset.modelField;

            if (field && model) {
                model[field] = target.value;
                if (field === 'name') {
                    const radio = modelCard.querySelector('input[type="radio"][name="openai_selected_name"]');
                    if (radio) {
                        if (radio.checked) {
                            this.selected_name = target.value;
                        }
                        radio.value = target.value;
                    }
                    this.renderNameIssues();
                    this.renderSaveButton();
                }

                if (field === 'base_url' || field === 'api_key') {
                    model.endpoint_ok = undefined;
                    this.renderModels();
                    clearTimeout(debounceTimeout);
                    debounceTimeout = setTimeout(() => {
                        this.loadRemoteModels(idx).then(() => this.renderModels());
                    }, 500);
                }
            }
        });

        modelsList.addEventListener('change', e => {
            const target = e.target;
            const modelCard = target.closest('[data-model-index]');
            if (!modelCard) return;

            const idx = parseInt(modelCard.dataset.modelIndex, 10);
            const model = this.models[idx];
            const field = target.dataset.modelField;

            if (field === 'remote_model' && model) {
                model.remote_model = target.value;
                this.renderModels();
            }
        });

        modelsList.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const modelCard = target.closest('[data-model-index]');
            if (!modelCard) return;

            const idx = parseInt(modelCard.dataset.modelIndex, 10);
            const action = target.dataset.action;

            if (action === 'remove-model') {
                this.remove(idx);
            } else if (action === 'load-remote-models') {
                this.models[idx].endpoint_ok = undefined;
                this.renderModels();
                this.loadRemoteModels(idx).then(() => this.renderModels());
            }
        });
    }

    this.el.addEventListener('change', e => {
      if (e.target.name === 'openai_selected_name') {
        this.selected_name = e.target.value;
      }
    });
  }

  /**
   * Bind form inputs to state
   */
  _bindFormInputs() {
    const inputs = {
      'project_title': (e) => this.project_title = e.target.value,
      'format': (e) => this.format = e.target.value,
      'chapters_text': (e) => this.chapters_text = e.target.value,
      'llm_temperature': (e) => this.llm_temperature = parseFloat(e.target.value) || 0.7,
      'llm_max_tokens': (e) => this.llm_max_tokens = parseInt(e.target.value, 10) || 2048,
      'new_project_name': (e) => this.new_project_name = e.target.value
    };

    Object.entries(inputs).forEach(([name, handler]) => {
      const input = this.el?.querySelector(`[name="${name}"]`);
      if (input) {
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      }
    });
  }

  /**
   * Load initial data
   */
  async _loadInitialData() {
    try {
      // Load all configuration data in parallel
      const [story, machine, projects] = await this._loadAllConfigs();

      // Initialize state from loaded configs
      this._initializeProjectState(projects);
      this._initializeStoryState(story);
      this._initializeModelState(machine);

      // Establish baseline for dirty tracking
      this._setBaseline();
      this.renderModels();

      // Load remote models asynchronously after initialization
      queueMicrotask(() => {
        const promises = this.models.map((_, idx) => this.loadRemoteModels(idx));
        Promise.all(promises).then(() => this.renderModels());
      });
    } catch (e) {
      this.error_msg = `Failed to load settings: ${e.message || e}`;
    }
  }

  /**
   * Render messages (saved/error)
   */
  renderMessages() {
    const savedEl = this.el?.querySelector('[data-message="saved"]');
    const errorEl = this.el?.querySelector('[data-message="error"]');

    if (savedEl) {
      savedEl.textContent = this.saved_msg;
      savedEl.style.display = this.saved_msg ? 'block' : 'none';
    }

    if (errorEl) {
      errorEl.textContent = this.error_msg;
      errorEl.style.display = this.error_msg ? 'block' : 'none';
    }
  }

  /**
   * Render models list
   */
  renderModels() {
    const container = this.el?.querySelector('[data-models-list]');
    if (!container) return;

    container.innerHTML = this.models.map((m, idx) => `
      <div class="aq-card" style="margin:0 0 0.5rem 0; padding:0.75rem;" data-model-index="${idx}">
        <div class="aq-field-group">
          <label class="aq-field">
            <span>Name</span>
            <input type="text" data-model-field="name" value="${this.escapeHtml(m.name)}" placeholder="prod-openai" />
          </label>
          <label class="aq-field">
            <span>Base URL</span>
            <input type="text" data-model-field="base_url" value="${this.escapeHtml(m.base_url)}" placeholder="https://api.openai.com/v1" />
          </label>
        </div>
        <div class="aq-field-group">
          <label class="aq-field">
            <span>API key</span>
            <input type="text" data-model-field="api_key" value="${this.escapeHtml(m.api_key)}" placeholder="OPENAI_API_KEY" />
          </label>
          <label class="aq-field">
            <span>Timeout (s)</span>
            <input type="text" data-model-field="timeout_s" value="${m.timeout_s}" placeholder="60" />
          </label>
        </div>
        <div class="aq-field">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <button type="button" class="aq-btn" data-action="load-remote-models">Load models</button>
            <span data-endpoint-status>
              ${m.endpoint_ok === true ? '✅ Endpoint OK' : ''}
              ${m.endpoint_ok === false ? '❌ Endpoint error' : ''}
            </span>
          </div>
        </div>
        <div class="aq-field">
          <label class="aq-field">
            <span>Select remote model</span>
            <select data-model-field="remote_model">
              <option value="">-- choose --</option>
              ${m.remote_model && !(m.remote_models?.includes(m.remote_model)) ? `<option value="${this.escapeHtml(m.remote_model)}" selected>${this.escapeHtml(m.remote_model)} (current)</option>` : ''}
              ${(m.remote_models || []).map(rm => `<option value="${this.escapeHtml(rm)}" ${rm === m.remote_model ? 'selected' : ''}>${this.escapeHtml(rm)}</option>`).join('')}
            </select>
          </label>
          <div>
            <span data-model-status>
              ${m.remote_model && m.remote_models && m.remote_models.includes(m.remote_model) ? '✅ Model available' : ''}
              ${m.remote_model && m.remote_models && !m.remote_models.includes(m.remote_model) ? '⚠️ Model not offered' : ''}
            </span>
          </div>
        </div>
        <div class="aq-toolbar" style="justify-content: space-between;">
          <label style="display:flex; align-items:center; gap:0.4rem;">
            <input type="radio" name="openai_selected_name" value="${this.escapeHtml(m.name)}" ${this.selected_name === m.name ? 'checked' : ''} />
            <span>Use this model</span>
          </label>
          <button type="button" class="aq-btn" data-action="remove-model">Remove</button>
        </div>
      </div>
    `).join('');

    this.renderNameIssues();
    this.renderSaveButton();
  }

  /**
   * Render project information
   */
  renderProjectInfo() {
    const projectEl = this.el?.querySelector('[data-current-project]');
    if (projectEl) {
      projectEl.textContent = this.current_project || 'No project';
    }
  }

  /**
   * Render project list
   */
  renderProjectList() {
    const listEl = this.el?.querySelector('[data-project-list]');
    if (!listEl) return;

    if (!this.available_projects || this.available_projects.length === 0) {
        listEl.innerHTML = `<div class="aq-tip">No projects found under the built-in projects folder.</div>`;
        return;
    }

    listEl.innerHTML = this.available_projects.map(ap => `
      <div style="display:flex; gap:0.5rem; align-items:center; justify-content:flex-end;">
        <button type="button" class="aq-btn" style="padding:0.25rem 0.5rem;" onclick="window.app.modelsEditor.selectByName('${this.escapeHtml(ap.name).replace(/'/g, "\\'")}')">
          <span>${this.escapeHtml(ap.name)}</span>
          ${!ap.is_valid ? `<span style="color:#fbbf24;"> (init)</span>` : ''}
        </button>
        <button type="button" class="aq-btn" style="padding:0.25rem 0.5rem; background:#3b82f6;" onclick="window.app.modelsEditor.deleteProject('${this.escapeHtml(ap.name).replace(/'/g, "\\'")}')">Delete</button>
      </div>
    `).join('');
  }

  /**
   * Escape HTML for safe rendering
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

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
  }

  /**
   * Initialize project-related state
   */
  _initializeProjectState(projects) {
    const currentPath = projects.current || '';
    this.current_project = currentPath ? currentPath.split('/').pop() : '';
    this.available_projects = Array.isArray(projects.available) ? projects.available : [];
  }

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
  }

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
  }

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
  }

  /**
   * Remove a model configuration by index
   */
  remove(idx) {
    const removed = this.models.splice(idx, 1);
    // If removed model was selected, switch to first available
    if (removed.length && this.selected_name === removed[0].name) {
      this.selected_name = this.models[0]?.name || '';
    }
  }

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
  }

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
  }

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
  }

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
  }

  /**
   * Check if any model names are duplicated
   */
  hasDuplicateNames() {
    const counts = this._countModelNames();
    return Object.values(counts).some(count => count > 1);
  }

  /**
   * Get list of duplicate model names for error messages
   */
  duplicateNamesList() {
    const counts = this._countModelNames();
    return Object.entries(counts)
      .filter(([_, count]) => count > 1)
      .map(([name]) => name);
  }

  /**
   * Check if any models have empty names
   */
  hasEmptyName() {
    return this.models.some(m => !m.name?.trim());
  }

  /**
   * Check if there are any name validation issues
   */
  hasNameIssues() {
    return this.hasDuplicateNames() || this.hasEmptyName();
  }

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
  }

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
  }

  /**
   * Set baseline for dirty tracking (after load or save)
   */
  _setBaseline() {
    this._baseline = this._snapshot();
  }

  /**
   * Check if current state differs from baseline
   */
  isDirty() {
    return this._snapshot() !== this._baseline;
  }

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
  }

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
  }

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
  }

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
    const res = await this.selectByName(name);
    try {
      // Broadcast that both story and machine context may have changed
      document.dispatchEvent(new CustomEvent('aq:story-updated', { detail: { reason: 'create-project', changedChapters: [] } }));
      document.dispatchEvent(new CustomEvent('aq:machine-updated', { detail: { reason: 'create-project' } }));
    } catch (_) {}
    return res;
  }

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
        try {
          document.dispatchEvent(new CustomEvent('aq:story-updated', { detail: { reason: 'delete-project', changedChapters: [] } }));
          document.dispatchEvent(new CustomEvent('aq:machine-updated', { detail: { reason: 'delete-project' } }));
        } catch (_) {}
      } catch (e) {
        this.error_msg = `Failed to delete project: ${e.message || e}`;
      }
  }

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
  }

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
        // Notify app to refresh views immediately
        try {
          document.dispatchEvent(new CustomEvent('aq:story-updated', { detail: { reason: 'settings-save', changedChapters: [] } }));
          document.dispatchEvent(new CustomEvent('aq:machine-updated', { detail: { reason: 'settings-save' } }));
        } catch (_) {}
      } catch (e) {
        this.error_msg = `Failed to save: ${e.message || e}`;
      }
  }

  /**
   * Get visual indicator for endpoint connection status
   * Returns checkmark or X emoji based on endpoint_ok state
   */
  endpointStatus(model) {
    if (model.endpoint_ok === undefined) return '';
    return model.endpoint_ok ? '✓' : '✗';
  }

  renderNameIssues() {
    const container = this.el?.querySelector('[data-name-issues]');
    if (!container) return;

    const hasIssues = this.hasNameIssues();
    container.style.display = hasIssues ? 'block' : 'none';

    if (!hasIssues) {
        container.innerHTML = '';
        return;
    }

    const emptyName = this.hasEmptyName();
    const duplicates = this.duplicateNamesList();

    container.innerHTML = `
        <strong>Model name issues:</strong>
        <ul style="margin:0.5rem 0 0 1rem;">
            ${emptyName ? `<li>Each model must have a non-empty name.</li>` : ''}
            ${duplicates.map(dn => `<li>Duplicate name: <code>${this.escapeHtml(dn)}</code></li>`).join('')}
        </ul>
    `;
  }

  renderSaveButton() {
      const saveBtn = this.el?.querySelector('[data-action="save"]');
      if (saveBtn) {
          const hasIssues = this.hasNameIssues();
          saveBtn.disabled = hasIssues;
          saveBtn.title = hasIssues ? 'Resolve model name issues before saving' : '';
      }
  }
}

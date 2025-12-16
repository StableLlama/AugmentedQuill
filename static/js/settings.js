import { fetchJSON, API } from './utils/utils.js';
import { Component } from './components/component.js';
import { renderTemplate } from './utils/templateLoader.js';

/**
 * Settings Page Component
 * Manages configuration of AI models, story settings, and project management.
 * Provides a centralized interface for all application settings,
 * ensuring users can customize their writing environment effectively.
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

  /**
   * Show a named tab pane in the settings dialog
   */
  _showTab(name) {
    if (!this.el) return;
    const tabs = this.el.querySelectorAll('[data-tab]');
    tabs.forEach(t => {
      if (t.getAttribute('data-tab') === name) t.classList.remove('hidden');
      else t.classList.add('hidden');
    });
  }

  /**
   * Switch tab and update sidebar button styles to reflect active tab
   */
  _switchTab(name) {
    this._showTab(name);
    if (!this.el) return;
    const btnProjects = this.el.querySelector('[data-action="tab-projects"]');
    const btnMachine = this.el.querySelector('[data-action="tab-machine"]');

    const setActive = (btn, active) => {
      if (!btn) return;
      if (active) {
        btn.classList.remove('text-stone-400', 'hover:text-stone-200', 'hover:bg-stone-900');
        btn.classList.add('bg-stone-800', 'text-indigo-400', 'border', 'border-stone-700');
      } else {
        btn.classList.remove('bg-stone-800', 'text-indigo-400', 'border', 'border-stone-700');
        btn.classList.add('text-stone-400', 'hover:text-stone-200', 'hover:bg-stone-900');
      }
    };

    setActive(btnProjects, name === 'projects');
    setActive(btnMachine, name === 'machine');
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
                if (field.startsWith('prompt_overrides.')) {
                    // Handle nested prompt_overrides
                    const overrideKey = field.split('.', 2)[1];
                    if (!model.prompt_overrides) {
                        model.prompt_overrides = {};
                    }
                    model.prompt_overrides[overrideKey] = target.value;
                } else {
                    model[field] = target.value;
                }

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
          const actionEl = e.target.closest('[data-action]');
          if (actionEl) {
            const modelCard = actionEl.closest('[data-model-index]');
            if (!modelCard) return;
            const idx = parseInt(modelCard.dataset.modelIndex, 10);
            const action = actionEl.dataset.action;

            if (action === 'remove-model') {
              this.remove(idx);
            } else if (action === 'load-remote-models') {
              this.models[idx].endpoint_ok = undefined;
              this.renderModels();
              this.loadRemoteModels(idx).then(() => this.renderModels());
            }
            return;
          }

          // If clicked on a model card (not on a button), select it for detailed config
          const modelCard = e.target.closest('[data-model-index]');
          if (modelCard) {
            const idx = parseInt(modelCard.dataset.modelIndex, 10);
            if (!isNaN(idx) && this.models[idx]) {
              this.selected_name = this.models[idx].name;
              // update selection UI immediately
              this.renderModels();
              this.renderProviderConfig();
              // probe remote models for availability and refresh UI when done
              this.loadRemoteModels(idx)
                .then(() => {
                  this.renderModels();
                  this.renderProviderConfig();
                })
                .catch(() => {});
            }
          }
        });
    }

    this.el.addEventListener('change', e => {
      if (e.target.name === 'openai_selected_name') {
        this.selected_name = e.target.value;
      }
    });

    // Tab buttons (projects / machine)
    const tabProjects = this.el.querySelector('[data-action="tab-projects"]');
    const tabMachine = this.el.querySelector('[data-action="tab-machine"]');
    if (tabProjects) tabProjects.addEventListener('click', () => this._switchTab('projects'));
    if (tabMachine) tabMachine.addEventListener('click', () => this._switchTab('machine'));

    // Default to projects tab on open
    this._switchTab('projects');
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
  async renderModels() {
    const container = this.el?.querySelector('[data-models-list]');
    if (!container) return;

    // Compact provider cards for left column; detailed config is rendered on the right
    container.innerHTML = '';
    for (let idx = 0; idx < this.models.length; idx++) {
      const m = this.models[idx];
      const isSelected = this.selected_name === m.name;
      const endpointOk = m.endpoint_ok === true;

      const statusTitle = `Endpoint: ${endpointOk ? 'OK' : 'Unknown'}`;
      const statusHtml = endpointOk ? '<span class="w-3 h-3 rounded-full bg-green-500 inline-block"></span>' : '<span class="w-3 h-3 rounded-full bg-amber-400 inline-block"></span>';
      const activeDotHtml = isSelected ? '<div class="w-2 h-2 rounded-full bg-green-500 shadow-sm shadow-green-900"></div>' : '';

      const tpl = await renderTemplate('model-item', {
        idx,
        wrapperClass: isSelected ? 'bg-indigo-900/20 border-indigo-500/50' : 'bg-stone-800 border-stone-700 hover:bg-stone-750',
        name: this.escapeHtml(m.name || '(unnamed)'),
        providerLabel: this.escapeHtml((m.provider || 'openai').toString()),
        statusTitle: this.escapeHtml(statusTitle),
        statusHtml: statusHtml,
        activeDotHtml: activeDotHtml
      });
      container.insertAdjacentHTML('beforeend', tpl);
    }

    this.renderNameIssues();
    this.renderSaveButton();
    // Also render provider config for the selected model (if any)
    this.renderProviderConfig();
  }

  /**
   * Render the right-hand provider configuration panel for the selected model
   */
  async renderProviderConfig() {
    if (!this.el) return;
    const container = this.el.querySelector('#provider-config');
    if (!container) return;
    const sel = this.selected_name || (this.models[0] && this.models[0].name) || '';
    const idx = this.models.findIndex(m => m.name === sel);
    if (idx === -1) {
      container.innerHTML = '<div class="h-full flex items-center justify-center text-stone-600">Select a provider to configure</div>';
      return;
    }
    const m = this.models[idx];
    const active = this.selected_name === m.name;
    const endpointOk = m.endpoint_ok === true;
    // Only mark model available when endpoint probe succeeded
    const modelAvailable = endpointOk && m.remote_model && Array.isArray(m.remote_models) && m.remote_models.includes(m.remote_model);

    const endpoint_html = endpointOk ? '<span class="inline-flex items-center gap-2 text-green-400"><span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span>Endpoint OK</span>' : '<span class="inline-flex items-center gap-2 text-amber-400"><span class="w-2 h-2 rounded-full bg-stone-600 inline-block"></span>Endpoint Unknown</span>';
    const model_available_html = modelAvailable ? '<span class="text-green-400">Model available</span>' : '<span class="text-amber-400">Model not found</span>';

    const tpl = await renderTemplate('provider-config', {
      name: this.escapeHtml(m.name),
      id: this.escapeHtml(m.id || m.name || ''),
      activeText: active ? 'Active' : 'Set Active',
      setActiveBtnClass: active
        ? 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 border bg-indigo-600 text-white border-transparent hover:bg-indigo-700 focus:ring-indigo-500 px-3 py-1 text-sm gap-2 disabled:opacity-50 disabled:cursor-not-allowed'
        : 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 border bg-stone-800 text-stone-200 border-stone-700 hover:bg-stone-700 focus:ring-stone-500 px-3 py-1 text-sm gap-2',
      setActiveDisabled: active ? 'disabled' : '',
      prov_name: this.escapeHtml(m.name),
      prov_base: this.escapeHtml(m.base_url || m.baseUrl || ''),
      prov_key: this.escapeHtml(m.api_key || m.apiKey || ''),
      endpoint_html: endpoint_html,
      model_available_html: model_available_html,
      prov_timeout: m.timeout_s || m.timeout || 60,
      prov_temperature: (typeof m.temperature === 'number' ? m.temperature : (m.temperature || 0.7)),
      prov_top_p: (typeof m.top_p === 'number' ? m.top_p : (m.top_p || 1.0)),
      prov_max_tokens: m.max_tokens || m.maxTokens || 2048,
      prov_system_prompt: this.escapeHtml(m.system_prompt || m.systemPrompt || ''),
      prov_continuation_prompt: this.escapeHtml(m.continuation_prompt || m.continuationPrompt || ''),
      prov_expert_hidden: (m._expertVisible ? '' : 'hidden')
    });

    container.innerHTML = tpl;
    const node = container.firstElementChild;
    // Populate model selector container without string concatenation
    const modelContainer = node.querySelector('#prov-model-container');
    if (modelContainer) {
      modelContainer.innerHTML = '';
      if (Array.isArray(m.remote_models) && m.remote_models.length) {
        const wrap = document.createElement('div');
        wrap.className = 'flex gap-2';
        const sel = document.createElement('select');
        sel.id = 'prov-modelid';
        sel.className = 'flex-1 bg-stone-950 border border-stone-700 rounded p-2 text-sm text-stone-200';
        m.remote_models.forEach(rm => {
          const opt = document.createElement('option');
          opt.value = rm;
          opt.textContent = rm;
          if (rm === (m.remote_model || m.model || '')) opt.selected = true;
          sel.appendChild(opt);
        });
        const btn = document.createElement('button');
        btn.id = 'prov-load-models';
        btn.className = 'px-3 py-1 bg-stone-800 text-stone-200 rounded';
        btn.textContent = 'Load';
        wrap.appendChild(sel);
        wrap.appendChild(btn);
        modelContainer.appendChild(wrap);
      } else {
        const inp = document.createElement('input');
        inp.id = 'prov-modelid';
        inp.value = this.escapeHtml(m.remote_model || m.model || '');
        inp.className = 'w-full bg-stone-950 border border-stone-700 rounded p-2 text-sm text-stone-200';
        modelContainer.appendChild(inp);
      }
    }
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    } catch (e) {
      void e;
    }

    const setActiveBtn = node.querySelector('#set-active-provider');
    const deleteBtn = node.querySelector('#delete-provider');
    const nameInp = node.querySelector('#prov-name');
    const typeSel = node.querySelector('#prov-type');
    const baseInp = node.querySelector('#prov-base');
    const keyInp = node.querySelector('#prov-key');
    const modelIdInp = node.querySelector('#prov-modelid');
    const timeoutInp = node.querySelector('#prov-timeout');
    const loadModelsBtn = node.querySelector('#prov-load-models');
    const toggleExpertBtn = node.querySelector('#prov-toggle-expert');
    const expertDiv = node.querySelector('#prov-expert');

    if (setActiveBtn) setActiveBtn.addEventListener('click', () => {
      this.selected_name = m.name;
      this.renderModels();
      this.renderProviderConfig();
    });
    if (deleteBtn) deleteBtn.addEventListener('click', () => {
      if (confirm(`Delete provider ${m.name}?`)) {
        this.models.splice(idx,1);
        this.selected_name = this.models[0]?.name || '';
        this.renderModels();
        this.renderProviderConfig();
      }
    });

    const updateField = (field, val) => {
      if (!this.models[idx]) return;
      // preserve old name so we can update selected_name when renaming
      const oldName = this.models[idx].name;
      if (field === 'name') this.models[idx].name = val;
      else if (field === 'provider') this.models[idx].provider = val;
      else if (field === 'base_url') this.models[idx].base_url = val;
      else if (field === 'api_key') this.models[idx].api_key = val;
      else if (field === 'remote_model') this.models[idx].remote_model = val;
      else if (field === 'timeout_s') this.models[idx].timeout_s = Number(val) || 60;
      else if (field === 'temperature') this.models[idx].temperature = Number(val) || 0.0;
      else if (field === 'top_p') this.models[idx].top_p = Number(val) || 1.0;
      else if (field === 'max_tokens') this.models[idx].max_tokens = Number(val) || 0;
      else if (field === 'system_prompt') this.models[idx].system_prompt = val;
      else if (field === 'continuation_prompt') this.models[idx].continuation_prompt = val;
      if (['base_url','api_key','timeout_s'].includes(field)) {
        this.models[idx].endpoint_ok = undefined;
      }
      // If we're renaming the currently selected provider, keep it selected
      if (field === 'name' && this.selected_name === oldName) {
        this.selected_name = val;
      }
      // Avoid full re-render here to prevent input blur while editing.
      // Lightweight UI updates (status indicators, save button) will be handled
      // elsewhere or on explicit save.
      // If the remote_model was changed via a SELECT, probe immediately to
      // refresh availability and the models list.
      if (field === 'remote_model' && typeof modelIdInp !== 'undefined' && modelIdInp && modelIdInp.tagName === 'SELECT') {
        doImmediateProbe().catch(() => {});
      }
    };

    if (nameInp) nameInp.addEventListener('input', (e)=> updateField('name', e.target.value));
    if (typeSel) typeSel.addEventListener('change', (e)=> updateField('provider', e.target.value));
    // Debounced probe for endpoint when editing base URL or API key
    let probeDebounce = null;
    const scheduleProbe = () => {
      // mark unknown immediately
      if (this.models[idx]) this.models[idx].endpoint_ok = undefined;
      if (probeDebounce) clearTimeout(probeDebounce);
      probeDebounce = setTimeout(async () => {
        try {
          await this.loadRemoteModels(idx);
        } catch (e) {
          void e;
        }
        this.renderModels();
      }, 700);
    };

    // Immediate probe helper (useful on blur or explicit test button)
    const doImmediateProbe = async () => {
      if (probeDebounce) { clearTimeout(probeDebounce); probeDebounce = null; }
      if (this.models[idx]) this.models[idx].endpoint_ok = undefined;
      try {
        await this.loadRemoteModels(idx);
      } catch (e) {
        void e;
      }
      this.renderModels();
      this.renderProviderConfig();
    };

    if (baseInp) baseInp.addEventListener('input', (e)=> { updateField('base_url', e.target.value); scheduleProbe(); });
    if (keyInp) keyInp.addEventListener('input', (e)=> { updateField('api_key', e.target.value); scheduleProbe(); });
    if (keyInp) keyInp.addEventListener('blur', () => doImmediateProbe());

    // No explicit test button: probing is triggered on input debounce, blur, or selection.
    if (modelIdInp) {
      modelIdInp.addEventListener('input', (e)=> updateField('remote_model', e.target.value));
      modelIdInp.addEventListener('change', (e)=> updateField('remote_model', e.target.value));
    }
    if (timeoutInp) timeoutInp.addEventListener('input', (e)=> updateField('timeout_s', e.target.value));

    const tempInp = node.querySelector('#prov-temperature');
    const topPInp = node.querySelector('#prov-top-p');
    const maxTokInp = node.querySelector('#prov-max-tokens');
    const sysPrompt = node.querySelector('#prov-system-prompt');
    const contPrompt = node.querySelector('#prov-continuation-prompt');

    if (tempInp) tempInp.addEventListener('input', (e)=> {
      const v = parseFloat(e.target.value);
      updateField('temperature', v);
      this.renderProviderConfig();
    });
    if (topPInp) topPInp.addEventListener('input', (e)=> {
      const v = parseFloat(e.target.value);
      updateField('top_p', v);
      this.renderProviderConfig();
    });
    if (maxTokInp) maxTokInp.addEventListener('input', (e)=> updateField('max_tokens', e.target.value));
    if (sysPrompt) sysPrompt.addEventListener('input', (e)=> updateField('system_prompt', e.target.value));
    if (contPrompt) contPrompt.addEventListener('input', (e)=> updateField('continuation_prompt', e.target.value));

    if (loadModelsBtn) loadModelsBtn.addEventListener('click', async () => {
      await this.loadRemoteModels(idx);
      this.renderModels();
      this.renderProviderConfig();
    });

    if (toggleExpertBtn) toggleExpertBtn.addEventListener('click', () => {
      if (!expertDiv) return;
      const hidden = expertDiv.classList.toggle('hidden');
      toggleExpertBtn.textContent = hidden ? 'Expert options' : 'Hide expert options';
    });
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
  async renderProjectList() {
    const listEl = this.el?.querySelector('[data-project-list]');
    if (!listEl) return;

    if (!this.available_projects || this.available_projects.length === 0) {
      listEl.innerHTML = '<div class="aq-tip">No projects found under the built-in projects folder.</div>';
      return;
    }
    listEl.innerHTML = '';
    for (const ap of this.available_projects) {
      const isActive = ap.name === this.current_project;
      const updated = ap.updatedAt || ap.updated_at || '';
      const when = updated ? `Last edited: ${new Date(updated).toLocaleDateString()}` : '';
      const wrapperClass = isActive ? 'bg-indigo-900/20 border-indigo-500/50' : 'bg-stone-800 border-stone-700 hover:border-stone-600';
      const accentClass = isActive ? 'bg-indigo-500' : 'bg-stone-600';
      const initBadge = !ap.is_valid ? '<span class="text-xs text-yellow-400">(init)</span>' : '';
      const openButtonHtml = !isActive ? `<button type="button" class="px-3 py-1 bg-stone-700 text-stone-200 rounded text-sm" data-action="open-project" data-project-name="${this.escapeHtml(ap.name).replace(/'/g, "\\'")}">Open</button>` : `<span class="text-xs font-medium text-indigo-400 bg-indigo-950/50 px-2 py-1 rounded">Active</span>`;

      const tpl = await renderTemplate('project-item', {
        wrapperClass,
        accentClass,
        name: this.escapeHtml(ap.name),
        nameEscaped: this.escapeHtml(ap.name).replace(/'/g, "\\'"),
        initBadge,
        when,
        openButtonHtml
      });
      listEl.insertAdjacentHTML('beforeend', tpl);
      const node = listEl.lastElementChild;
      // wire buttons
      const openBtn = node.querySelector('[data-action="open-project"]');
      if (openBtn) openBtn.addEventListener('click', () => this.selectByName(ap.name));
      const delBtn = node.querySelector('[data-action="delete-project"]');
      if (delBtn) delBtn.addEventListener('click', () => this.deleteProject(ap.name));
    }
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
      const newModel = {
        name: `model-${this.models.length + 1}`,
        base_url: 'https://api.openai.com/v1',
        api_key: '',
        timeout_s: 60,
        remote_model: '',
        remote_models: [],
        endpoint_ok: undefined
      };
      this.models.push(newModel);
      // Select and render the new model immediately so user sees changes
      this.selected_name = newModel.name;
        this.renderModels();
        this.renderProviderConfig();
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
   * Uses backend proxy to avoid CORS issues.
   */
  async loadRemoteModels(idx) {
      const model = this.models[idx];
      const currentSelection = model.remote_model;

      model.endpoint_ok = undefined;

      try {
        // Use backend proxy to avoid CORS issues
        const data = await this._fetchModelsViaProxy(model);

        // Extract and sort model names
        const list = Array.isArray(data.data) ? data.data : [];
        const mapped = list
        .map(x => typeof x === 'string' ? x : (x.id || x.name || ''))
        .filter(Boolean)
        .sort();
        model.remote_models = mapped;

        // If the previously selected model exists in the fetched list, keep it.
        // Otherwise, pick the first available model (or empty).
        if (currentSelection && mapped.includes(currentSelection)) {
          model.remote_model = currentSelection;
        } else {
          model.remote_model = mapped.length ? mapped[0] : '';
        }
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
      .filter(([name, count]) => name && count > 1)
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
    } catch (e) { console.warn('Failed to refresh available projects:', e); }
  }

  /**
   * Create a new project with the entered name
   */
  async createProject() {
    let name = this.new_project_name?.trim();
    if (!name) {
      const base = 'New Project';
      const existing = Array.isArray(this.available_projects) ? this.available_projects : [];
      if (!existing.includes(base)) {
        name = base;
      } else {
        let n = 2;
        while (existing.includes(`${base} (${n})`)) n += 1;
        name = `${base} (${n})`;
      }
      this.new_project_name = name;
    }
    // Create by selecting (backend creates if doesn't exist)
    const res = await this.selectByName(name);
    try {
      // Broadcast that both story and machine context may have changed
      document.dispatchEvent(new CustomEvent('aq:story-updated', { detail: { reason: 'create-project', changedChapters: [] } }));
      document.dispatchEvent(new CustomEvent('aq:machine-updated', { detail: { reason: 'create-project' } }));
    } catch (e) { console.warn('Failed to dispatch events after project creation:', e); }
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
        } catch (e) { console.warn('Failed to dispatch events after project deletion:', e); }
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
    } catch (e) { console.warn('Failed to reload story from API:', e); }
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
        } catch (e) { console.warn('Failed to dispatch events after settings save:', e); }
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

    // Build the issues list using DOM nodes to avoid string concatenation
    container.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = 'Model name issues:';
    container.appendChild(strong);
    const ul = document.createElement('ul');
    ul.style.margin = '0.5rem 0 0 1rem';
    if (emptyName) {
      const li = document.createElement('li');
      li.textContent = 'Each model must have a non-empty name.';
      ul.appendChild(li);
    }
    duplicates.forEach(dn => {
      const li = document.createElement('li');
      li.textContent = 'Duplicate name: ';
      const code = document.createElement('code');
      code.textContent = dn;
      li.appendChild(code);
      ul.appendChild(li);
    });
    container.appendChild(ul);
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

// AugmentedQuill frontend script bundle
// - Keeps HTML clean by moving non-trivial JS here
// - Provides Alpine data factories and global event hooks

(function(){
  // Footer year updater
  document.addEventListener('DOMContentLoaded', function(){
    var y = new Date().getFullYear();
    var el = document.getElementById('aq-year');
    if (el) el.textContent = y;
  });

  // Re-initialize Alpine.js on HTMX content swaps so x-data components work after partial loads
  document.addEventListener('htmx:afterSwap', function (e) {
    try {
      var target = (e.detail && e.detail.target) ? e.detail.target : e.target;
      if (window.Alpine && target) {
        window.Alpine.initTree(target);
      }
    } catch (_) { /* no-op */ }
  });

  // Settings page data factory (global)
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
      project_dir: '',
      recent_projects: [],
      async init() {
        try {
          // Load story, machine configs, and project registry via REST
          const [storyResp, machineResp, projectsResp] = await Promise.all([
            fetch('/api/story'),
            fetch('/api/machine'),
            fetch('/api/projects'),
          ]);
          const story = storyResp.ok ? await storyResp.json() : {};
          const machine = machineResp.ok ? await machineResp.json() : {};
          const projects = projectsResp.ok ? await projectsResp.json() : {current:'', recent:[]};
          this.project_dir = projects.current || '';
          this.recent_projects = Array.isArray(projects.recent) ? projects.recent : [];

          // Story
          this.project_title = story.project_title || '';
          this.format = story.format || 'markdown';
          this.chapters_text = Array.isArray(story.chapters) ? story.chapters.join('\n') : '';
          const lp = story.llm_prefs || {};
          this.llm_temperature = (typeof lp.temperature === 'number') ? lp.temperature : parseFloat(lp.temperature || '0.7') || 0.7;
          this.llm_max_tokens = (typeof lp.max_tokens === 'number') ? lp.max_tokens : parseInt(lp.max_tokens || '2048', 10) || 2048;

          // Machine models
          const openai = (machine && machine.openai) ? machine.openai : {};
          const models = Array.isArray(openai.models) ? openai.models : [];
          if (models.length) {
            this.models = models.map(m => ({...m, endpoint_ok: undefined, remote_models: m.remote_models || [], remote_model: m.model || m.remote_model || ''}));
            this.selected_name = openai.selected || (this.models[0]?.name || '');
          } else {
            this.models = [{ name: 'default', base_url: openai.base_url || 'https://api.openai.com/v1', api_key: openai.api_key || '', timeout_s: openai.timeout_s || 60, remote_model: openai.model || '', remote_models: [], endpoint_ok: undefined }];
            this.selected_name = 'default';
          }

          queueMicrotask(() => { this.models.forEach((_, idx) => this.loadRemoteModels(idx)); });
        } catch (e) {
          this.error_msg = 'Failed to load settings: ' + (e && e.message ? e.message : e);
        }
      },
      add() {
        this.models.push({ name: `model-${this.models.length+1}`, base_url: 'https://api.openai.com/v1', api_key: '', timeout_s: 60, remote_model: '', remote_models: [], endpoint_ok: undefined });
      },
      remove(idx) {
        const removed = this.models.splice(idx, 1);
        if (removed.length && this.selected_name === removed[0].name) {
          this.selected_name = this.models[0]?.name || '';
        }
      },
      async loadRemoteModels(idx) {
        const m = this.models[idx];
        const current = m.remote_model; // preserve current selection
        m.endpoint_ok = undefined;
        // Do not clear remote_models preemptively to avoid select resetting
        const directUrl = (m.base_url || '').replace(/\/$/, '') + '/models';
        const tryDirect = async () => {
          const resp = await fetch(directUrl, { headers: { 'Authorization': m.api_key ? `Bearer ${m.api_key}` : '' } });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return await resp.json();
        };
        const tryProxy = async () => {
          const resp = await fetch('/api/openai/models', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_url: m.base_url, api_key: m.api_key, timeout_s: m.timeout_s || 60 })
          });
          if (!resp.ok) throw new Error('Proxy HTTP ' + resp.status);
          return await resp.json();
        };
        try {
          let data;
          try { data = await tryDirect(); } catch (_) { data = await tryProxy(); }
          const list = Array.isArray(data.data) ? data.data : [];
          m.remote_models = list.map(x => (typeof x === 'string') ? x : (x.id || x.name || '')).filter(Boolean).sort();
          // Re-assert the current selection so the UI doesn't jump to "-- choose --"
          m.remote_model = current;
          m.endpoint_ok = true;
        } catch (_) {
          m.remote_model = current;
          m.endpoint_ok = false;
        }
      },
      hasDuplicateNames() {
        const counts = this.models.reduce((acc, m) => { const k = (m.name || '').trim(); if (!k) return acc; acc[k] = (acc[k]||0)+1; return acc; }, {});
        return Object.values(counts).some(c => c > 1);
      },
      duplicateNamesList() {
        const counts = this.models.reduce((acc, m) => { const k = (m.name || '').trim(); if (!k) return acc; acc[k] = (acc[k]||0)+1; return acc; }, {});
        return Object.entries(counts).filter(([_, c]) => c > 1).map(([n]) => n);
      },
      hasEmptyName() { return this.models.some(m => !(m.name || '').trim()); },
      hasNameIssues() { return this.hasDuplicateNames() || this.hasEmptyName(); },
      serializeModelsPayload() {
        const payload = this.models.map(m => ({ name: m.name, base_url: m.base_url, api_key: m.api_key, timeout_s: m.timeout_s, model: m.remote_model || '' }));
        return { models: payload, selected: this.selected_name };
      },
      async selectProject() {
        this.saved_msg=''; this.error_msg='';
        try {
          const resp = await fetch('/api/projects/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: this.project_dir || '' }) });
          const data = await resp.json();
          if (!resp.ok || data.ok !== true) throw new Error(data.detail || data.error || 'Selection failed');
          const reg = data.registry || { current: this.project_dir, recent: [] };
          this.project_dir = reg.current || this.project_dir;
          this.recent_projects = Array.isArray(reg.recent) ? reg.recent : [];
          const story = data.story || {};
          this.project_title = story.project_title || '';
          this.format = story.format || 'markdown';
          this.chapters_text = Array.isArray(story.chapters) ? story.chapters.join('\n') : '';
          const lp = story.llm_prefs || {};
          this.llm_temperature = (typeof lp.temperature === 'number') ? lp.temperature : parseFloat(lp.temperature || '0.7') || 0.7;
          this.llm_max_tokens = (typeof lp.max_tokens === 'number') ? lp.max_tokens : parseInt(lp.max_tokens || '2048', 10) || 2048;
          this.saved_msg = data.message || 'Project selected.';
        } catch(e) {
          this.error_msg = 'Failed to select project: ' + (e && e.message ? e.message : e);
        }
      },
      useRecent(p) { this.project_dir = p; return this.selectProject(); },
      async save() {
        this.saved_msg = ''; this.error_msg = '';
        if (this.hasNameIssues()) { this.error_msg = 'Resolve model name issues before saving.'; return; }
        const story = {
          project_title: this.project_title || 'Untitled Project',
          format: this.format || 'markdown',
          chapters: (this.chapters_text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
          llm_prefs: { temperature: this.llm_temperature, max_tokens: this.llm_max_tokens }
        };
        const machine = { openai: {} };
        const modelsPayload = this.serializeModelsPayload();
        machine.openai.models = modelsPayload.models;
        machine.openai.selected = modelsPayload.selected;
        try {
          const resp = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ story, machine }) });
          const data = await resp.json();
          if (!resp.ok || data.ok !== true) throw new Error(data.detail || data.error || 'Save failed');
          this.saved_msg = 'Settings saved successfully.';
        } catch (e) { this.error_msg = 'Failed to save: ' + (e && e.message ? e.message : e); }
      },
      endpointStatus(m) { return m.endpoint_ok === undefined ? '' : (m.endpoint_ok ? '' : ''); }
    }
  }

  // Index page data factory (global)
  function shellView() {
    return {
      chapters: [],
      status: 'unknown',
      server_time: '',
      async load() {
        try {
          const s = await fetch('/api/story');
          const sj = await s.json();
          this.chapters = Array.isArray(sj.chapters) ? sj.chapters : [];
          const h = await fetch('/api/health');
          const hj = await h.json();
          this.status = hj.status || 'unknown';
          this.server_time = hj.server_time || '';
        } catch(_) {
          this.status='error';
        }
      }
    }
  }

  // Expose factories globally for Alpine usage
  window.modelsEditor = modelsEditor;
  window.shellView = shellView;
})();

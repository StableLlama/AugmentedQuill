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
      new_project_name: '',
      current_project: '',
      available_projects: [],
      _baseline: '',
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
          const projects = projectsResp.ok ? await projectsResp.json() : {current:'', recent:[], available:[]};
          const curPath = projects.current || '';
          this.current_project = typeof curPath === 'string' && curPath ? curPath.split('/').pop() : '';
          this.available_projects = Array.isArray(projects.available) ? projects.available : [];

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

          // Establish baseline after initial load
          this._setBaseline();

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
      _snapshot() {
        // Normalize current state into a stable JSON string for change detection
        const story = {
          project_title: this.project_title || 'Untitled Project',
          format: this.format || 'markdown',
          chapters: (this.chapters_text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
          llm_prefs: { temperature: Number(this.llm_temperature), max_tokens: Number(this.llm_max_tokens) }
        };
        const machine = { openai: this.serializeModelsPayload() };
        try { return JSON.stringify({ story, machine }); } catch(_) { return ''; }
      },
      _setBaseline() { this._baseline = this._snapshot(); },
      isDirty() { return this._snapshot() !== this._baseline; },
      async selectByName(name) {
        // Do not clear saved_msg here to prevent banner collapse/expand flicker during switches
        this.error_msg='';
        // Warn if there are unsaved changes
        const targetName = (name || '').trim();
        const sameProject = !!this.current_project && this.current_project === targetName;
        if (!sameProject && this.isDirty()) {
          const proceed = confirm('You have unsaved changes in the current project. Switching projects will discard them. Continue without saving?');
          if (!proceed) return;
        }
        try {
          const resp = await fetch('/api/projects/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || '' }) });
          const data = await resp.json();
          if (!resp.ok || data.ok !== true) throw new Error(data.detail || data.error || 'Selection failed');
          const reg = data.registry || { current: '' };
          const curPath = reg.current || '';
          this.current_project = typeof curPath === 'string' && curPath ? curPath.split('/').pop() : '';
          const story = data.story || {};
          this.project_title = story.project_title || '';
          this.format = story.format || 'markdown';
          this.chapters_text = Array.isArray(story.chapters) ? story.chapters.join('\n') : '';
          const lp = story.llm_prefs || {};
          this.llm_temperature = (typeof lp.temperature === 'number') ? lp.temperature : parseFloat(lp.temperature || '0.7') || 0.7;
          this.llm_max_tokens = (typeof lp.max_tokens === 'number') ? lp.max_tokens : parseInt(lp.max_tokens || '2048', 10) || 2048;
          // Reset baseline after switching projects and loading their settings
          this._setBaseline();
          this.saved_msg = data.message || 'Project selected.';
                    // Notify other views (like index shell) to reload chapters
                    document.dispatchEvent(new CustomEvent('aq:project-selected', { detail: { name: targetName } }));
          // refresh available list
          try { const pj = await (await fetch('/api/projects')).json(); this.available_projects = Array.isArray(pj.available) ? pj.available : this.available_projects; } catch(_) {}
        } catch(e) {
          this.error_msg = 'Failed to select project: ' + (e && e.message ? e.message : e);
        }
      },
      async createProject() {
        const name = (this.new_project_name || '').trim();
        if (!name) { this.error_msg = 'Enter a project name.'; return; }
        return this.selectByName(name);
      },
      async deleteProject(name) {
        if (!name) return;
        const deletingCurrent = this.current_project && this.current_project === name;
        if (deletingCurrent && this.isDirty()) {
          const proceedDirty = confirm('You have unsaved changes in the current project. Deleting it will discard them. Continue without saving?');
          if (!proceedDirty) return;
        }
        if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
        this.saved_msg=''; this.error_msg='';
        try {
          const resp = await fetch('/api/projects/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
          const data = await resp.json();
          if (!resp.ok || data.ok !== true) throw new Error(data.detail || data.error || 'Delete failed');
          this.available_projects = Array.isArray(data.available) ? data.available : this.available_projects;
          const reg = data.registry || { current: '' };
          const curPath = reg.current || '';
          this.current_project = typeof curPath === 'string' && curPath ? curPath.split('/').pop() : '';
          // Reload story if current was deleted
          try {
            const story = await (await fetch('/api/story')).json();
            this.project_title = story.project_title || '';
            this.format = story.format || 'markdown';
            this.chapters_text = Array.isArray(story.chapters) ? story.chapters.join('\n') : '';
            const lp = story.llm_prefs || {};
            this.llm_temperature = (typeof lp.temperature === 'number') ? lp.temperature : parseFloat(lp.temperature || '0.7') || 0.7;
            this.llm_max_tokens = (typeof lp.max_tokens === 'number') ? lp.max_tokens : parseInt(lp.max_tokens || '2048', 10) || 2048;
            this._setBaseline();
          } catch(_) {}
          this.saved_msg = data.message || 'Project deleted.';
        } catch(e) {
          this.error_msg = 'Failed to delete project: ' + (e && e.message ? e.message : e);
        }
      },
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
          // Update baseline after successful save
          this._setBaseline();
        } catch (e) { this.error_msg = 'Failed to save: ' + (e && e.message ? e.message : e); }
      },
      endpointStatus(m) { return m.endpoint_ok === undefined ? '' : (m.endpoint_ok ? '' : ''); }
    }
  }

  // Index page data factory (global)
  function shellView() {
    return {
      chapters: [], // [{id,title,filename}]
      activeId: null,
      content: '',
      // rendering mode: 'raw' | 'markdown'
      renderMode: 'raw',
      // dirty tracking for editor content
      dirty: false,
      _originalContent: '',
      // inline title editing state
      editingId: null,
      editingTitle: '',
      init() {
        // Listen for project change notifications
        document.addEventListener('aq:project-selected', () => { this.refreshChapters(); });
        // Ctrl/Cmd+S to save
        window.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            if (this.dirty) this.saveContent();
          }
        });
        // Warn on navigation if dirty
        window.addEventListener('beforeunload', (e) => {
          if (this.dirty) { e.preventDefault(); e.returnValue = ''; }
        });
        this.load();
      },
      async load() {
        try {
          // Load story to set initial rendering preference
          try {
            const s = await fetch('/api/story');
            if (s.ok) {
              const sj = await s.json();
              const fmt = (sj && sj.format) ? String(sj.format).toLowerCase() : 'markdown';
              this.renderMode = (fmt === 'markdown') ? 'markdown' : 'raw';
            }
          } catch(_) { /* default stays */ }
          await this.refreshChapters();
          if (!(this.chapters && this.chapters.length)) {
            await this.ensureProjectSelected();
          }
        } catch(_) {
          /* no-op */
        }
      },
      async ensureProjectSelected() {
        try {
          const pr = await fetch('/api/projects');
          if (!pr.ok) return;
          const pj = await pr.json();
          const current = pj.current || '';
          const available = Array.isArray(pj.available) ? pj.available : [];
          if ((!current || current.trim() === '') && available.length > 0) {
            const first = available[0];
            if (first && first.name) {
              const resp = await fetch('/api/projects/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: first.name }) });
              if (resp.ok) {
                // give backend a moment then reload chapters
                await this.refreshChapters();
              }
            }
          }
        } catch(_) { /* no-op */ }
      },
      async refreshChapters() {
        try {
          const resp = await fetch('/api/chapters');
          const data = await resp.json();
          this.chapters = Array.isArray(data.chapters) ? data.chapters : [];
          // If previously selected chapter still exists, keep it; otherwise select first
          const hasActive = this.chapters.some(c => c.id === this.activeId);
          if (!hasActive && this.chapters.length) {
            const firstId = this.chapters[0].id;
            await this.openChapter(firstId);
          } else if (!this.chapters.length) {
            this.activeId = null;
            this.content = '';
          }
        } catch(_) {
          this.chapters = [];
        }
      },
      displayHtml() {
        const text = String(this.content || '');
        if (this.renderMode === 'markdown') {
          return this.mdToHtml(text);
        } else {
          return '<pre style="white-space:pre-wrap; margin:0;">' + this.escapeHtml(text) + '</pre>';
        }
      },
      escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      },
      mdToHtml(src) {
        try {
          if (window.markdownit) {
            // Use markdown-it with sensible defaults, HTML disabled for safety
            if (!this._md) {
              this._md = window.markdownit({ html: false, linkify: true, typographer: true });
            }
            return this._md.render(String(src || ''));
          }
        } catch(_) { /* fall back */ }
        // Fallback minimal renderer
        const lines = String(src || '').split(/\r?\n/);
        let html = '';
        let inCode = false;
        let codeBuf = [];
        const flushCode = () => {
          if (codeBuf.length) {
            const code = this.escapeHtml(codeBuf.join('\n'));
            html += '<pre><code>' + code + '</code></pre>';
            codeBuf = [];
          }
        };
        const paraBuf = [];
        const flushPara = () => {
          if (paraBuf.length) {
            const text = this.escapeHtml(paraBuf.join(' '));
            html += '<p>' + text + '</p>';
            paraBuf.length = 0;
          }
        };
        for (let i=0; i<lines.length; i++) {
          const line = lines[i];
          if (line.trim().startsWith('```')) {
            if (inCode) { inCode = false; flushCode(); }
            else { flushPara(); inCode = true; codeBuf = []; }
            continue;
          }
          if (inCode) { codeBuf.push(line); continue; }
          if (!line.trim()) { flushPara(); continue; }
          if (line.startsWith('### ')) { flushPara(); html += '<h3>' + this.escapeHtml(line.slice(4)) + '</h3>'; }
          else if (line.startsWith('## ')) { flushPara(); html += '<h2>' + this.escapeHtml(line.slice(3)) + '</h2>'; }
          else if (line.startsWith('# ')) { flushPara(); html += '<h1>' + this.escapeHtml(line.slice(2)) + '</h1>'; }
          else { paraBuf.push(line); }
        }
        if (inCode) { flushCode(); }
        flushPara();
        return html || '<p></p>';
      },
      onChanged() {
        this.dirty = (String(this.content || '') !== String(this._originalContent || ''));
      },
      _confirmDiscardIfDirty() {
        if (!this.dirty) return true;
        return confirm('You have unsaved changes. Discard them?');
      },
      _replaceSelection(before, after) {
        const ta = this.$refs && this.$refs.editor;
        if (!ta) return;
        const start = ta.selectionStart || 0;
        const end = ta.selectionEnd || 0;
        const v = this.content || '';
        const selected = v.slice(start, end);
        const newText = v.slice(0, start) + before + selected + after + v.slice(end);
        this.content = newText;
        queueMicrotask(() => { ta.focus(); const pos = start + before.length + selected.length + after.length; ta.setSelectionRange(pos, pos); });
        this.onChanged();
      },
      wrapSelection(before, after) { this._replaceSelection(before, after); },
      insertHeading() {
        const ta = this.$refs && this.$refs.editor; if (!ta) return;
        const v = this.content || '';
        const startLineStart = v.lastIndexOf('\n', (ta.selectionStart||0) - 1) + 1;
        const newText = v.slice(0, startLineStart) + '# ' + v.slice(startLineStart);
        this.content = newText; this.onChanged();
      },
      insertLink() {
        const ta = this.$refs && this.$refs.editor; if (!ta) return;
        const start = ta.selectionStart || 0; const end = ta.selectionEnd || 0;
        const v = this.content || '';
        const selected = v.slice(start, end) || 'text';
        const url = prompt('Enter URL', 'https://'); if (url === null) return;
        const before = '[' + selected + '](' + (url || '') + ')';
        const newText = v.slice(0, start) + before + v.slice(end);
        this.content = newText; this.onChanged();
      },
      togglePrefix(prefix) {
        const ta = this.$refs && this.$refs.editor; if (!ta) return;
        const v = this.content || '';
        const start = ta.selectionStart || 0; const end = ta.selectionEnd || 0;
        const lines = v.split(/\r?\n/);
        // determine lines affected
        let idx=0, pos=0; const startLineIdx = (()=>{ for(let i=0;i<lines.length;i++){const l=lines[i]; if (pos + l.length >= start) { return i; } pos += l.length+1; } return lines.length-1;})()
        ;
        pos = 0; const endLineIdx = (()=>{ for(let i=0;i<lines.length;i++){const l=lines[i]; if (pos + l.length >= end) { return i; } pos += l.length+1; } return lines.length-1;})()
        ;
        for (let i=startLineIdx; i<=endLineIdx; i++) {
          if (lines[i].startsWith(prefix)) lines[i] = lines[i].slice(prefix.length);
          else lines[i] = prefix + lines[i];
        }
        this.content = lines.join('\n'); this.onChanged();
      },
      toggleList(prefix) { this.togglePrefix(prefix || '- '); },
      async saveContent() {
        if (this.activeId == null) return;
        try {
          const resp = await fetch(`/api/chapters/${this.activeId}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: String(this.content||'') }) });
          const data = await resp.json().catch(()=>({}));
          if (!resp.ok || data.ok !== true) throw new Error((data && (data.detail||data.error)) || ('HTTP '+resp.status));
          this._originalContent = String(this.content||'');
          this.dirty = false;
        } catch(e) {
          alert('Failed to save: ' + (e && e.message ? e.message : e));
        }
      },
      async openChapter(id) {
        if (id == null) return;
        if (this.activeId !== null && id !== this.activeId) {
          if (!this._confirmDiscardIfDirty()) return;
        }
        // Leaving edit mode when switching chapters
        this.editingId = null; this.editingTitle = '';
        try {
          const resp = await fetch(`/api/chapters/${id}`);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const data = await resp.json();
          this.activeId = data.id;
          this.content = data.content || '';
          this._originalContent = String(this.content || '');
          this.dirty = false;
        } catch(e) {
          this.content = 'Error loading chapter: ' + (e && e.message ? e.message : e);
          this._originalContent = this.content;
          this.dirty = false;
        }
      },
      startEdit(ch) {
        this.activeId = ch.id; // ensure selected
        this.editingId = ch.id;
        this.editingTitle = ch.title || '';
        // autofocus handled in template via x-ref
        queueMicrotask(() => {
          try { this.$refs && this.$refs.titleInput && this.$refs.titleInput.focus(); } catch(_) {}
        });
      },
      async saveEdit() {
        if (this.editingId == null) return;
        const id = this.editingId;
        const title = (this.editingTitle || '').trim();
        try {
          const resp = await fetch(`/api/chapters/${id}/title`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
          const data = await resp.json();
          if (!resp.ok || data.ok !== true) throw new Error(data.detail || data.error || 'Save failed');
          // update local list
          this.chapters = this.chapters.map(c => c.id === id ? { ...c, title: data.chapter.title } : c);
        } catch(e) {
          alert('Failed to save title: ' + (e && e.message ? e.message : e));
        } finally {
          this.editingId = null; this.editingTitle = '';
        }
      },
      cancelEdit() { this.editingId = null; this.editingTitle = ''; },
      async createChapter() {
        try {
          const resp = await fetch('/api/chapters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '', content: '' }) });
          const data = await resp.json();
          if (!resp.ok || data.ok !== true) throw new Error(data.detail || data.error || 'Create failed');
          await this.refreshChapters();
          // select and begin editing the newly created chapter at the end
          const newId = data.chapter && data.chapter.id;
          if (newId != null) {
            const ch = this.chapters.find(c => c.id === newId) || data.chapter;
            this.activeId = newId;
            this.startEdit(ch);
          }
        } catch(e) {
          alert('Failed to create chapter: ' + (e && e.message ? e.message : e));
        }
      },
    }
  }

  // Expose factories globally for Alpine usage
  window.modelsEditor = modelsEditor;
  window.shellView = shellView;
})();

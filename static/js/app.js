// AugmentedQuill frontend script bundle
// Initializes core application components and manages global event handling.
// This centralizes component lifecycle to ensure consistent UI state across HTMX page updates,
// preventing memory leaks and maintaining reactivity in a single-page application context.

import { ModelsEditor } from './settings.js';
import { ShellView } from './editor.js';
import { registry } from './components/component.js';
import { ChatView } from './chat.js';


// Global Variables
let isSidebarOpen = false;
let isChatOpen = true;

// ========================================
// Application State
// ========================================

// Global app object to provide access to main components across the application.
// This enables cross-component communication and state sharing without tight coupling.
window.app = {
  shellView: null,
  modelsEditor: null,
  chatView: null,
  registry
};

// Handle input changes
document.addEventListener('input', function (e) {
  const target = e.target;
  if (target.id === 'brightness-slider') {
    const value = target.value;
    document.getElementById('brightness-value').textContent = value + '%';
    const page = document.querySelector('[data-ref="editorPage"]');
    if (page) {
      page.style.backgroundColor = `hsl(0, 0%, ${value}%)`;
    }
  } else if (target.id === 'contrast-slider') {
    const value = target.value;
    document.getElementById('contrast-value').textContent = value + '%';
    const page = document.querySelector('[data-ref="editorPage"]');
    if (page) {
      const alpha = Math.max(0, Math.min(1, Number(value) / 100));
      page.style.color = `rgba(0, 0, 0, ${alpha})`;
    }
  } else if (target.id === 'font-size-slider') {
    const value = target.value;
    document.getElementById('font-size-value').textContent = value + 'px';
    const page = document.querySelector('[data-ref="editorPage"]');
    if (page) page.style.fontSize = `${value}px`;
    // Propagate to shellView and TUI
    try {
      if (window.app && window.app.shellView) {
        window.app.shellView.fontSize = Number(value) || window.app.shellView.fontSize;
        try { window.app.shellView.contentEditor.renderFontSize(); } catch (_) {}
      }
    } catch (_) {}
  } else if (target.id === 'line-width-slider') {
    const value = target.value;
    document.getElementById('line-width-value').textContent = value + 'ch';
    const page = document.querySelector('[data-ref="editorPage"]');
    if (page) page.style.maxWidth = `${value}ch`;
    // Propagate to shellView and TUI
    try {
      if (window.app && window.app.shellView) {
        window.app.shellView.contentWidth = Number(value) || window.app.shellView.contentWidth;
        try { window.app.shellView.contentEditor.renderContentWidth(); } catch (_) {}
      }
    } catch (_) {}
  }
});

// Initialize responsive chat state once DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
  try { applyChatVisibility(); } catch (_) {}
});

// Handle global actions
document.addEventListener('click', function (e) {
  const action = e.target.closest('[data-action]');
  if (!action) return;

  const actionName = action.getAttribute('data-action');

  switch (actionName) {
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'toggle-chat':
      toggleChat();
      break;
    case 'toggle-appearance':
      toggleAppearance();
      break;
    case 'close-appearance':
      closeAppearance();
      break;
    case 'open-settings':
      openSettings();
      break;
    case 'close-settings':
      closeSettings();
      break;
    case 'modal-close':
      closeSettings();
      break;
    case 'save':
      if (window.app.shellView && typeof window.app.shellView.save === 'function') {
        window.app.shellView.save();
      } else if (window.app.modelsEditor && typeof window.app.modelsEditor.save === 'function') {
        // call models editor save and close settings when done
        try {
          const p = window.app.modelsEditor.save();
          if (p && typeof p.then === 'function') {
            p.then(() => closeSettings()).catch(e => console.warn('Failed to save settings:', e));
          } else {
            closeSettings();
          }
        } catch (e) { console.warn('Failed to call modelsEditor.save():', e); }
      }
      break;
    case 'undo':
      if (window.app.shellView) window.app.shellView.undo();
      break;
    case 'redo':
      if (window.app.shellView) window.app.shellView.redo();
      break;
    case 'update-summary':
      if (window.app.shellView) window.app.shellView.updateSummary();
      break;
  }
});

// Sidebar toggle
function toggleSidebar() {
  isSidebarOpen = !isSidebarOpen;
  updateSidebarClass();
}

function updateSidebarClass() {
  const sidebar = document.getElementById('sidebar');
  if (isSidebarOpen) {
    sidebar.classList.remove('-translate-x-full');
    sidebar.classList.add('translate-x-0');
  } else {
    sidebar.classList.remove('translate-x-0');
    sidebar.classList.add('-translate-x-full');
  }
  const overlay = document.getElementById('sidebar-overlay');
  if (isSidebarOpen) {
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

// Chat toggle
function toggleChat() {
  isChatOpen = !isChatOpen;
  applyChatVisibility();
}

function applyChatVisibility() {
  const chatPanel = document.getElementById('chat-panel');
  const btn = document.getElementById('chat-toggle-btn');
  const closeIcon = btn ? btn.querySelector('.chat-icon-close') : document.querySelector('.chat-icon-close');
  const openIcon = btn ? btn.querySelector('.chat-icon-open') : document.querySelector('.chat-icon-open');
  const label = btn ? btn.querySelector('[data-ref="chatToggleLabel"]') : document.querySelector('[data-ref="chatToggleLabel"]');

  if (!chatPanel) return;

  const isDesktop = window.matchMedia && window.matchMedia('(min-width: 768px)').matches;

  // Icon + label state (always explicit; never "toggle" to avoid drift)
  if (closeIcon) closeIcon.classList.toggle('hidden', !isChatOpen);
  if (openIcon) openIcon.classList.toggle('hidden', isChatOpen);
  if (label) label.textContent = isChatOpen ? 'Hide' : 'AI';
  if (btn) btn.setAttribute('aria-expanded', String(!!isChatOpen));

  // Panel state
  // - Desktop: use `hidden` so layout reflows and editor grows.
  // - Mobile: slide off-canvas (fixed panel) but keep it in DOM.
  if (isDesktop) {
    chatPanel.classList.toggle('hidden', !isChatOpen);
    chatPanel.classList.remove('translate-x-full');
    chatPanel.classList.add('translate-x-0');
  } else {
    chatPanel.classList.remove('hidden');
    chatPanel.classList.toggle('translate-x-full', !isChatOpen);
    chatPanel.classList.toggle('translate-x-0', isChatOpen);
  }
}

// Keep chat layout correct when crossing responsive breakpoints.
window.addEventListener('resize', () => {
  try { applyChatVisibility(); } catch (_) {}
});

// Appearance panel toggle
function toggleAppearance() {
  const panel = document.getElementById('appearance-panel');
  panel.classList.toggle('hidden');
}

function closeAppearance() {
  const panel = document.getElementById('appearance-panel');
  panel.classList.add('hidden');
}

// Settings dialog
function openSettings() {
  const dialog = document.getElementById('settings-dialog');
  dialog.classList.remove('hidden');
}

function closeSettings() {
  const dialog = document.getElementById('settings-dialog');
  dialog.classList.add('hidden');
}

// Inline editing for story metadata (title, summary, tags)
function startEditStoryField(field) {
  const display = document.querySelector(`[data-ref="${field}Display"]`);
  const input = document.querySelector(`[data-ref="${field}Input"]`);
  if (!display || !input) return;
  display.classList.add('hidden');
  input.classList.remove('hidden');
  input.value = display.textContent.trim() === 'Story title...' || display.textContent.trim() === 'Story summary...' ? '' : display.textContent.trim();
  input.focus();
  if (typeof input.select === 'function') input.select();

  const saveFn = () => saveStoryField(field);
  const keyFn = (ev) => {
    if (ev.key === 'Enter' && field !== 'storySummary') {
      ev.preventDefault();
      input.removeEventListener('blur', saveFn);
      input.removeEventListener('keydown', keyFn);
      saveFn();
    }
  };
  input.addEventListener('blur', saveFn, { once: true });
  input.addEventListener('keydown', keyFn);
}

function saveStoryField(field) {
  const display = document.querySelector(`[data-ref="${field}Display"]`);
  const input = document.querySelector(`[data-ref="${field}Input"]`);
  if (!display || !input) return;
  const val = input.value.trim();
  if (field === 'storyTags') {
    renderTagChips(val);
    display.textContent = '';
  } else if (field === 'storyTitle') {
    display.textContent = val || 'Untitled Story';
  } else if (field === 'storySummary') {
    display.textContent = val || 'A new adventure begins...';
  }
  input.classList.add('hidden');
  display.classList.remove('hidden');
}

function renderTagChips(val) {
  const container = document.querySelector('[data-ref="tagChips"]');
  if (!container) return;
  container.innerHTML = '';
  const tags = val.split(',').map(t => t.trim()).filter(Boolean);
  tags.forEach(t => {
    const s = document.createElement('span');
    s.className = 'tag-chip';
    s.textContent = t;
    container.appendChild(s);
  });
}

// Wire click actions for the inline edit buttons
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const act = btn.getAttribute('data-action');
  if (act === 'edit-story-title') {
    startEditStoryField('storyTitle');
  } else if (act === 'edit-story-summary') {
    startEditStoryField('storySummary');
  } else if (act === 'edit-story-tags') {
    startEditStoryField('storyTags');
  }
});

/**
 * Initialize all components on the page
 * Scans the DOM for component markers and instantiates corresponding classes.
 * This ensures that components are only created when their UI elements exist,
 * supporting conditional rendering and dynamic content loading.
 */
function initComponents() {
  // Initialize shell view (chapter editor) if element exists
  const shellElement = document.querySelector('[data-component="shell-view"]');
  if (shellElement && !window.app.shellView) {
    window.app.shellView = new ShellView(shellElement);
    registry.register('shellView', window.app.shellView);
    window.app.shellView.init();
  }

  // Initialize settings editor if element exists
  const settingsElement = document.querySelector('[data-component="models-editor"]');
  if (settingsElement && !window.app.modelsEditor) {
    window.app.modelsEditor = new ModelsEditor(settingsElement);
    registry.register('modelsEditor', window.app.modelsEditor);
    window.app.modelsEditor.init();
  }

  // Initialize chat view if element exists
  const chatElement = document.querySelector('[data-component="chat-view"]');
  if (chatElement && !window.app.chatView) {
    window.app.chatView = new ChatView(chatElement);
    registry.register('chatView', window.app.chatView);
    window.app.chatView.init();
  }
}

// ========================================
// DOM Event Listeners
// ========================================

// Initialize components when DOM is ready
// Ensures components are set up after the page loads, preventing initialization on incomplete DOM.
document.addEventListener('DOMContentLoaded', function() {
  // Footer year updater
  const yearElement = document.getElementById('aq-year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Initialize all components
  initComponents();

  // Initialize lucide icons if available (replace placeholders with SVGs)
  try {
    if (window.lucide) {
      if (typeof lucide.createIcons === 'function') {
        lucide.createIcons();
      } else if (typeof lucide.replace === 'function') {
        lucide.replace();
      }
    }
  } catch (_) {}

  // Apply initial appearance settings to editors (font size, brightness, line width)
  try {
    const applyAppearance = () => {
      const fontSlider = document.getElementById('font-size-slider');
      const lineWidth = document.getElementById('line-width-slider');
      const brightness = document.getElementById('brightness-slider');
      const contrast = document.getElementById('contrast-slider');
      const page = document.querySelector('[data-ref="editorPage"]');
      if (window.app && window.app.shellView) {
        if (fontSlider) {
          const v = Number(fontSlider.value) || null;
          if (v != null) {
            window.app.shellView.fontSize = v;
            try { window.app.shellView.contentEditor.renderFontSize(); } catch (_) {}
            if (page) page.style.fontSize = `${v}px`;
          }
        }
        if (lineWidth) {
          const lw = Number(lineWidth.value) || null;
          if (lw != null) {
            window.app.shellView.contentWidth = lw;
            try { window.app.shellView.contentEditor.renderContentWidth(); } catch (_) {}
            if (page) page.style.maxWidth = `${lw}ch`;
          }
        }
        // Apply initial "paper" background + text contrast
        const b = brightness ? (Number(brightness.value) || 100) : 100;
        const c = contrast ? (Number(contrast.value) || 100) : 100;
        const alpha = Math.max(0, Math.min(1, c / 100));
        if (page) {
          page.style.backgroundColor = `hsl(0, 0%, ${b}%)`;
          page.style.color = `rgba(0, 0, 0, ${alpha})`;
        }
      }
    };
    applyAppearance();
  } catch (e) { console.warn('Failed to apply initial appearance settings:', e); }

  // Update initial classes
  updateSidebarClass();
  try { applyChatVisibility(); } catch (_) {}
});

// Re-initialize components on HTMX content swaps
// HTMX allows dynamic content loading without full page reloads; this re-scans for new components
// to maintain reactivity and prevent stale component references.
document.addEventListener('htmx:afterSwap', function (e) {
  try {
    const target = e.detail?.target || e.target;
    if (target) {
      // Re-scan for new components in swapped content
      initComponents();

      // If we swapped content into the modal, show it
      const modal = document.getElementById('aq-modal');
      if (modal && target.id === 'modal-content') {
        modal.removeAttribute('hidden');
        modal.classList.add('is-open');
      }
    }
  } catch (err) {
    console.error('Failed to reinitialize components after HTMX swap:', err);
  }
});

// Ensure Lucide renders icons after HTMX swaps as well
document.addEventListener('htmx:afterSwap', function () {
  try {
    if (window.lucide) {
      if (typeof lucide.createIcons === 'function') lucide.createIcons();
      else if (typeof lucide.replace === 'function') lucide.replace();
    }
  } catch (_) {}
});

// Clean up components before content is swapped out
// Prevents memory leaks by destroying components when their DOM elements are about to be replaced,
// ensuring event listeners and reactive bindings are properly removed.
document.addEventListener('htmx:beforeSwap', function (e) {
  try {
    const target = e.detail?.target || e.target;
    if (target) {
      // Clean up any components in the target
      ['shellView', 'modelsEditor', 'chatView'].forEach(name => {
        const component = window.app[name];
        if (component && target.contains(component.el)) {
          component.destroy();
          window.app[name] = null;
          registry.components.delete(name);
        }
      });
    }
  } catch (err) {
    console.error('Failed to clean up components before HTMX swap:', err);
  }
});

// ========================================
// Modal Controls (Settings)
// ========================================

// Close modal and clean up associated components
// Ensures modal state is reset and components are destroyed to free resources,
// preventing interference with future modal openings.
function closeModal() {
  const modal = document.getElementById('aq-modal');
  const panel = document.getElementById('modal-content');
  if (!modal || !panel) return;
  try {
    // Destroy components inside the modal content
    ['modelsEditor'].forEach(name => {
      const component = window.app[name];
      if (component && panel.contains(component.el)) {
        component.destroy();
        window.app[name] = null;
        registry.components.delete(name);
      }
    });
  } catch (err) {
    console.warn('Modal cleanup failed:', err);
  }
  panel.innerHTML = '';
  modal.setAttribute('hidden', '');
  modal.classList.remove('is-open');
}

// Close on backdrop click and explicit close buttons
// Provides multiple ways for users to dismiss the modal, improving UX accessibility.
document.addEventListener('click', function (e) {
  const modal = document.getElementById('aq-modal');
  if (!modal || modal.hasAttribute('hidden')) return;
  const target = e.target;
  if (target.matches('.aq-modal-backdrop') || target.matches('[data-action="modal-close"]')) {
    e.preventDefault();
    closeModal();
  }
});

// Close on Escape
// Standard keyboard shortcut for modal dismissal, following web accessibility guidelines.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('aq-modal');
    if (modal && !modal.hasAttribute('hidden')) {
      e.preventDefault();
      closeModal();
    }
  }
});

// Expose for debugging if needed
window.aqCloseModal = closeModal;

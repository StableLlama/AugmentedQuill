// AugmentedQuill frontend script bundle
// - Initializes components and global event hooks

import { ModelsEditor } from './settings.js';
import { ShellView } from './editor.js';
import { registry } from './component.js';
import { ChatView } from './chat.js';

// ========================================
// Application State
// ========================================

window.app = {
  shellView: null,
  modelsEditor: null,
  chatView: null,
  registry
};

// ========================================
// Component Initialization
// ========================================

/**
 * Initialize all components on the page
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
document.addEventListener('DOMContentLoaded', function() {
  // Footer year updater
  const yearElement = document.getElementById('aq-year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Initialize all components
  initComponents();
});

// Re-initialize components on HTMX content swaps
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

// Clean up components before content is swapped out
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

// AugmentedQuill frontend script bundle
// - Initializes Alpine components and global event hooks

import { modelsEditor } from './settings.js';
import { shellView } from './editor.js';

// ========================================
// Global Exports for Alpine.js
// ========================================

window.modelsEditor = modelsEditor;
window.shellView = shellView;

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

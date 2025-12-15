import { DEFAULTS, UI_STRINGS } from '../constants/editorConstants.js';

/**
 * Debounce utility function.
 * Delays function execution to prevent excessive API calls during rapid user input,
 * improving performance and reducing server load.
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The delay in ms.
 * @returns {Function} The debounced function.
 */
export function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

/**
 * Ensures a toast host element exists.
 * @returns {HTMLElement} The toast host.
 */
export function ensureToastHost() {
  let host = document.querySelector('.aq-toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'aq-toasts';
    document.body.appendChild(host);
  }
  return host;
}

/**
 * Shows a toast message.
 * Provides non-intrusive user feedback for actions like saves and errors,
 * enhancing UX without blocking the interface.
 * @param {string} message - The message.
 * @param {string} variant - The variant ('info', 'success', 'error').
 * @param {number} timeoutMs - Timeout in ms.
 */
export function toast(message, variant = 'info', timeoutMs = DEFAULTS.TOAST_TIMEOUT) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = `aq-toast ${variant}`;
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => {
    try { el.remove(); } catch (_) {}
    if (!host.childElementCount) host.remove();
  }, timeoutMs);
}
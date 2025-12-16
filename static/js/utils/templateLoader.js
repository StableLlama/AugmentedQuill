// Simple HTML template loader with caching and basic replacements.
// Supports escaped replacements with {{key}} and raw HTML with {{{key}}}.
const cache = new Map();

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadTemplate(name) {
  if (cache.has(name)) return cache.get(name);
  const url = `/static/templates/${name}.html`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error('Template not found: ' + name);
  const text = await res.text();
  cache.set(name, text);
  return text;
}

export async function renderTemplate(name, data = {}) {
  const tpl = await loadTemplate(name);
  // replace raw {{{key}}} first
  let out = tpl.replace(/\{\{\{\s*([\w.-]+)\s*\}\}\}/g, (m, key) => {
    const val = data[key];
    return val == null ? '' : String(val);
  });
  // replace escaped {{key}}
  out = out.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key) => {
    const val = data[key];
    return escapeHtml(val == null ? '' : String(val));
  });
  return out;
}

export function clearTemplateCache() { cache.clear(); }

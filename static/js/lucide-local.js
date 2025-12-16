// Local Lucide loader: replace <i data-lucide="..."> placeholders with local SVG files
(function () {
  async function fetchSvg(name) {
    try {
      const res = await fetch(`/static/lucide-static/${name}.svg`, { cache: 'force-cache' });
      if (!res.ok) throw new Error('Not found');
      return await res.text();
    } catch (e) {
      return null;
    }
  }

  async function createIcons() {
    const nodes = Array.from(document.querySelectorAll('i[data-lucide]'));
    await Promise.all(nodes.map(async (i) => {
      try {
        const name = i.getAttribute('data-lucide');
        if (!name) return;
        if (i.querySelector('svg')) return; // already rendered
        const svgText = await fetchSvg(name);
        if (!svgText) {
          console.warn('lucide-local: icon not found', name);
          return;
        }
        i.innerHTML = svgText;
        const svg = i.querySelector('svg');
        if (svg) {
          // Remove explicit width/height attributes so CSS on the <i> controls sizing.
          try { svg.removeAttribute('width'); } catch(_) {}
          try { svg.removeAttribute('height'); } catch(_) {}
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          svg.setAttribute('aria-hidden', 'true');
          svg.setAttribute('focusable', 'false');
          svg.style.display = 'block';
        }
      } catch (err) { console.warn('Local lucide render failed for', i, err); }
    }));
  }

  // expose API so existing code calling lucide.createIcons() continues to work
  window.lucide = window.lucide || {};
  window.lucide.createIcons = createIcons;

  document.addEventListener('DOMContentLoaded', () => setTimeout(createIcons, 0));
  document.addEventListener('htmx:afterSwap', () => setTimeout(createIcons, 0));
})();

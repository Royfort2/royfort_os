/**
 * Total grid cards = sum over products of (distinct color values at the color option).
 * products.json often uses options as [{ name: "Color", values: [...] }], not plain strings;
 * if we fail to read names, every product falls back to 1 → total looks like product count.
 *
 * Toolbar #ProductCount holds the authoritative total. Load-more progress reads that total
 * and counts .f-column.card in #ProductsList for “shown”.
 */
(function () {
  /** @returns {string[]} option display names in order (option1 / option2 / option3) */
  function optionLabels(product) {
    const raw = product.options;
    if (!raw || !raw.length) return [];
    return raw.map((o) => {
      if (typeof o === 'string') return o;
      if (o && typeof o.name === 'string') return o.name;
      return '';
    });
  }

  /**
   * Mirrors theme Liquid: color_swatch_trigger can be comma-separated (see product-variant-picker).
   * Matches option names with contains logic + colour/coloUr pair.
   * @returns {number} option index 0–2, or -1
   */
  function colorOptionIndex(product, triggerSetting) {
    const labels = optionLabels(product);
    if (!labels.length) return -1;

    const tokens = String(triggerSetting || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    function tryMatchToken(t) {
      if (!t) return -1;
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].toLowerCase() === t) return i;
      }
      for (let i = 0; i < labels.length; i++) {
        const option_name = labels[i].toLowerCase();
        if (!option_name) continue;
        if (t.includes(option_name)) return i;
        if (option_name.includes(t)) return i;
        if (t.includes('color') && option_name.includes('colour')) return i;
        if (t.includes('colour') && option_name.includes('color')) return i;
      }
      return -1;
    }

    for (const t of tokens) {
      const idx = tryMatchToken(t);
      if (idx >= 0) return idx;
    }

    for (let i = 0; i < labels.length; i++) {
      const n = labels[i].toLowerCase();
      if (n.includes('color') || n.includes('colour') || n.includes('farbe')) return i;
    }

    return -1;
  }

  function optionValue(variant, idx) {
    if (idx === 0) return variant.option1;
    if (idx === 1) return variant.option2;
    if (idx === 2) return variant.option3;
    return null;
  }

  function countProductCards(product, trigger) {
    const idx = colorOptionIndex(product, trigger);
    if (idx < 0) return 1;
    const seen = new Set();
    for (const v of product.variants || []) {
      const val = optionValue(v, idx);
      if (val != null && val !== '') seen.add(String(val));
    }
    return seen.size > 0 ? seen.size : 1;
  }

  async function loadTotal(trigger, productsJsonHref) {
    const endpoint = new URL(productsJsonHref, window.location.origin);
    const incoming = new URLSearchParams(window.location.search);
    incoming.delete('page');
    incoming.forEach((value, key) => {
      endpoint.searchParams.set(key, value);
    });

    let page = 1;
    let total = 0;
    const maxPerPage = 250;

    while (true) {
      endpoint.searchParams.set('limit', String(maxPerPage));
      endpoint.searchParams.set('page', String(page));
      const res = await fetch(endpoint.toString());
      if (!res.ok) break;
      const data = await res.json();
      const products = data.products || [];
      if (products.length === 0) break;
      for (const product of products) {
        total += countProductCards(product, trigger);
      }
      if (products.length < maxPerPage) break;
      page += 1;
    }

    return total;
  }

  function countVariantCardsInGrid() {
    const list = document.getElementById('ProductsList');
    if (!list) return 0;
    return list.querySelectorAll(':scope > .f-column.card').length;
  }

  /** Variant total already written into #ProductCount by loadTotal (same number as toolbar). */
  function getVariantTotalFromProductCount() {
    const pc = document.getElementById('ProductCount');
    if (!pc || !pc.hasAttribute('data-variant-card-count')) return null;
    const span = pc.querySelector('span');
    if (!span) return null;
    const n = parseInt(String(span.textContent).replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  }

  /**
   * @returns {{ trigger: string, href: string } | null}
   */
  function getVariantCountConfig() {
    const fromToolbar = document.querySelector('#ProductCount[data-variant-card-count]');
    const fromPagination = document.querySelector('[data-variant-pagination][data-products-json-href]');
    const el = fromToolbar || fromPagination;
    if (!el) return null;
    const href = el.getAttribute('data-products-json-href');
    if (!href) return null;
    return {
      trigger: el.getAttribute('data-color-trigger') || '',
      href,
    };
  }

  function syncVariantPaginationProgress() {
    const root = document.querySelector('[data-variant-pagination]');
    if (!root) return;
    const shown = countVariantCardsInGrid();
    const total = getVariantTotalFromProductCount();
    const shownEl = root.querySelector('.pagination-load-more__shown');
    const totalEl = root.querySelector('.pagination-load-more__total');
    if (shownEl) shownEl.textContent = String(shown);
    if (totalEl && total != null) totalEl.textContent = String(total);
    const pct = total != null && total > 0 ? Math.min(100, Math.round((shown / total) * 100)) : 0;
    const fill = root.querySelector('.pagination-load-more__fill');
    if (fill) fill.style.setProperty('--pagination-progress', pct + '%');
    const track = root.querySelector('.pagination-load-more__track');
    if (track && total != null) {
      track.setAttribute('aria-valuenow', String(shown));
      track.setAttribute('aria-valuemax', String(total));
    }
  }

  function run() {
    const cfg = getVariantCountConfig();
    if (!cfg) return;
    syncVariantPaginationProgress();
    loadTotal(cfg.trigger, cfg.href)
      .then((total) => {
        const pc = document.getElementById('ProductCount');
        if (pc) {
          const span = pc.querySelector('span');
          if (span) span.textContent = String(total);
        }
        syncVariantPaginationProgress();
      })
      .catch(() => {
        syncVariantPaginationProgress();
      });
  }

  function initListeners() {
    document.addEventListener('collection:rerendered', () => requestAnimationFrame(run));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      run();
      initListeners();
    });
  } else {
    run();
    initListeners();
  }
})();

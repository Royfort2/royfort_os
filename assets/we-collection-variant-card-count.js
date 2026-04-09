/**
 * Total grid cards = sum over products of (distinct color values at the color option).
 * products.json often uses options as [{ name: "Color", values: [...] }], not plain strings;
 * if we fail to read names, every product falls back to 1 → total looks like product count.
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

  function run() {
    const root = document.querySelector('#ProductCount[data-variant-card-count]');
    if (!root) return;
    const trigger = root.getAttribute('data-color-trigger') || '';
    const href = root.getAttribute('data-products-json-href');
    if (!href) return;

    loadTotal(trigger, href)
      .then((total) => {
        const span = root.querySelector('span');
        if (span) span.textContent = String(total);
      })
      .catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  if (typeof FoxTheme !== 'undefined' && FoxTheme.pubsub && FoxTheme.pubsub.PUB_SUB_EVENTS) {
    FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.facetUpdate, () => {
      requestAnimationFrame(() => run());
    });
  }
})();

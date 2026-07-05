/**
 * Total grid cards = sum over products of (distinct color values at the color option).
 * products.json often uses options as [{ name: "Color", values: [...] }], not plain strings;
 * if we fail to read names, every product falls back to 1 → total looks like product count.
 *
 * Toolbar #ProductCount holds the authoritative total. Load-more progress reads that total
 * and counts .f-column.card in #ProductsList for “shown”.
 */
(function () {
  /** @constant Prefix for storefront variant-option facet query keys */
  const FILTER_VARIANT_OPTION_PREFIX = 'filter.v.option.';
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

    if (window.WeColorI18n?.isColorOptionName) {
      for (let i = 0; i < labels.length; i++) {
        if (window.WeColorI18n.isColorOptionName(labels[i], triggerSetting)) return i;
      }
      return -1;
    }

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

  function stripDiacritics(s) {
    return String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /** Keys that may appear after the variant-option facet prefix (from Liquid). */
  function readColorFacetSuffixes() {
    const el = document.getElementById('ProductCount');
    const raw = el?.getAttribute('data-variant-count-facet-suffixes');
    if (!raw) return new Set(['farbe', 'colour', 'color']);
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length)
        return new Set(arr.map((x) => String(x).toLowerCase().trim()).filter(Boolean));
    } catch (_) {}
    return new Set(['farbe', 'colour', 'color']);
  }

  /** Pipe-wrapped allowlist from Liquid (`|red||blue|`) when a color facet is active. */
  function readDomColorAllowlist() {
    const el = document.getElementById('ProductCount');
    const raw = el?.getAttribute('data-variant-count-allowlist');
    if (!raw) return null;
    const out = new Set();
    const parts = raw.split('|');
    for (const p of parts) {
      const t = p.trim().toLowerCase();
      if (t) {
        out.add(t);
        out.add(stripDiacritics(t));
      }
    }
    return out.size ? out : null;
  }

  /**
   * Reads filter.v.option query params only for keys that match color facets on this store.
   * Avoids substring-matching arbitrary option keys against the trigger (could zero totals).
   */
  function parseVariantColorFilterValues(searchParams, allowedSuffixes) {
    const vals = new Set();

    searchParams.forEach((value, keyRaw) => {
      if (!keyRaw.startsWith(FILTER_VARIANT_OPTION_PREFIX)) return;
      let optSlug;
      try {
        optSlug = decodeURIComponent(
          keyRaw.slice(FILTER_VARIANT_OPTION_PREFIX.length)
        )
          .toLowerCase()
          .trim();
      } catch (_) {
        optSlug = keyRaw.slice(FILTER_VARIANT_OPTION_PREFIX.length).toLowerCase().trim();
      }
      if (!optSlug || !allowedSuffixes.has(optSlug)) return;
      let v;
      try {
        v = decodeURIComponent(String(value)).toLowerCase().trim();
      } catch (_) {
        v = String(value).toLowerCase().trim();
      }
      if (v) {
        vals.add(v);
        vals.add(stripDiacritics(v));
      }
    });

    return vals;
  }

  function variantMatchesColorRestriction(val, restrict) {
    if (!restrict || restrict.size === 0) return true;
    if (val == null || val === '') return false;
    const raw = String(val).toLowerCase().trim();
    if (restrict.has(raw)) return true;
    return restrict.has(stripDiacritics(raw));
  }

  function countProductCards(product, trigger, restrictedColorVals) {
    const idx = colorOptionIndex(product, trigger);
    if (idx < 0) return 1;
    const seen = new Set();
    const restrict =
      restrictedColorVals && restrictedColorVals.size > 0 ? restrictedColorVals : null;
    for (const v of product.variants || []) {
      const val = optionValue(v, idx);
      if (val == null || val === '') continue;
      if (restrict && !variantMatchesColorRestriction(val, restrict)) continue;
      seen.add(String(val));
    }
    if (restrict) return seen.size;
    return seen.size > 0 ? seen.size : 1;
  }

  function buildColorRestrictions(searchParams) {
    const fromDom = readDomColorAllowlist();
    if (fromDom) return fromDom;
    const suffixes = readColorFacetSuffixes();
    return parseVariantColorFilterValues(searchParams, suffixes);
  }

  /**
   * Localized collection path from the current URL, e.g. /de/collections/bedding.
   * Used so /collections/.../products.json matches the storefront path (filters + markets).
   */
  function collectionBasePathFromLocation(pathname) {
    const marker = '/collections/';
    const ix = pathname.indexOf(marker);
    if (ix < 0) return null;
    const after = pathname.slice(ix + marker.length);
    const end = after.indexOf('/');
    const handle = end < 0 ? after : after.slice(0, end);
    if (!handle) return null;
    return pathname.slice(0, ix + marker.length + handle.length);
  }

  /** Build /…/collections/{handle}/products.json from the live URL; falls back to theme href. */
  function resolveProductsJsonUrl(hrefFromTheme) {
    const base = collectionBasePathFromLocation(window.location.pathname);
    if (base)
      return new URL(
        (base.endsWith('/') ? base.slice(0, -1) : base) + '/products.json',
        window.location.origin
      );
    return new URL(hrefFromTheme, window.location.origin);
  }

  /**
   * Copy storefront query params for the JSON request. Use append (not set) so repeated
   * filter.v.option.* keys (OR values) are preserved — set() drops duplicates and widens results.
   */
  function applyStorefrontParamsToEndpoint(endpoint, searchParams) {
    const skip = new Set(['page', 'section_id', 'limit']);
    endpoint.search = '';
    searchParams.forEach((value, key) => {
      if (skip.has(key)) return;
      endpoint.searchParams.append(key, value);
    });
  }

  async function loadTotal(trigger, productsJsonHref) {
    const ssrTotal = readSsrVariantCardTotal();
    if (ssrTotal != null) return ssrTotal;

    const endpoint = resolveProductsJsonUrl(productsJsonHref);
    const incoming = new URLSearchParams(window.location.search);
    const colorRestrictions = buildColorRestrictions(incoming);
    applyStorefrontParamsToEndpoint(endpoint, incoming);

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
        total += countProductCards(product, trigger, colorRestrictions);
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

  function readSsrVariantCardTotal() {
    const pc = document.getElementById('ProductCount');
    const raw = pc?.getAttribute('data-ssr-variant-card-total');
    if (raw === null || raw === '') return null;
    const n = parseInt(String(raw).trim(), 10);
    return Number.isNaN(n) ? null : n;
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

/**
 * Syncs hidden `items[n][id]` / `items[n][quantity]` inputs for each `variant-selects` in a `product-info`
 * section (1-based n, contiguous for pickers that have a resolved variant). Disables the legacy
 * `input[name="id"]` when at least one line item is present so the cart receives line-item fields only.
 */
(function () {
  /** Prefer JSON from section fetches; fall back to `data-selected-variant-id` (SSR / last sync). */
  function parseVariantIdFromPicker(vs) {
    const script = vs.querySelector('script[data-selected-variant]');
    const raw = script?.textContent?.trim();
    if (raw && raw !== 'null') {
      try {
        const v = JSON.parse(raw);
        if (v?.id != null) return String(v.id);
      } catch {
        /* fall through */
      }
    }
    const attr = vs.getAttribute('data-selected-variant-id')?.trim();
    return attr || '';
  }

  function escapeAttrSelector(value) {
    return typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(value)
      : String(value).replace(/"/g, '\\"');
  }

  /**
   * Reads we-quantity-selector value (radios may be portaled under `body` on mobile).
   * Returns `null` when this picker has no inline quantity UI.
   */
  function resolveWeQuantityFromVariantSelects(vs) {
    if (!vs?.querySelector) return null;
    const qtyRoot = vs.querySelector('.we-quantity-selector');
    if (!qtyRoot) return null;

    let checked = qtyRoot.querySelector('input[type="radio"][data-we-qty-selector]:checked');
    if (!checked) {
      const pid = vs.getAttribute('data-product-id');
      if (pid) {
        const esc = escapeAttrSelector(`quantity-${pid}`);
        checked = document.querySelector(
          `input[type="radio"][name="${esc}"]:checked[data-we-qty-selector]`
        );
      }
    }
    if (checked) return String(checked.value);

    const summary = qtyRoot.querySelector('.we-select-container__summary');
    const t = summary?.textContent?.trim();
    if (t && /^\d+$/.test(t)) return t;
    return '1';
  }

  function getQuantityFromPicker(vs) {
    const fromWe = resolveWeQuantityFromVariantSelects(vs);
    return fromWe != null ? fromWe : '1';
  }

  /**
   * Applies chosen inline we-quantity to the product form’s `name="quantity"` field (or a hidden fallback).
   */
  function applyWeQuantityToProductForm(form, qtyStr) {
    let qtyInput = form.querySelector('input[name="quantity"]');
    if (!qtyInput) {
      qtyInput = document.createElement('input');
      qtyInput.type = 'hidden';
      qtyInput.name = 'quantity';
      qtyInput.className = 'js-we-inline-qty-sync';
      form.appendChild(qtyInput);
    }

    const raw = parseInt(String(qtyStr), 10);
    let v = Number.isFinite(raw) && raw > 0 ? raw : 1;

    const min = parseInt(qtyInput.getAttribute('min') || qtyInput.dataset?.min || '1', 10);
    const maxAttr = qtyInput.getAttribute('max') ?? qtyInput.dataset?.max;
    const max = maxAttr != null && String(maxAttr).length ? parseInt(maxAttr, 10) : null;

    if (Number.isFinite(min) && v < min) v = min;
    if (max != null && Number.isFinite(max) && v > max) v = max;

    qtyInput.value = String(v);
    qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function ensureSubmitQuantitySyncBound(form) {
    if (!form || form.dataset.weInlineQtySubmitBound === 'true') return;
    form.dataset.weInlineQtySubmitBound = 'true';
    form.addEventListener(
      'submit',
      () => {
        if (form.classList.contains('pdp-set-bundle')) return;
        const pi = form.closest('product-info');
        if (!pi) return;
        const pickers = getUniqueVariantPickers(pi);
        if (pickers.length !== 1) return;
        const q = resolveWeQuantityFromVariantSelects(pickers[0]);
        if (q != null) applyWeQuantityToProductForm(form, q);
      },
      true
    );
  }

  /**
   * `product-info` only swaps the first `variant-selects` (`variantSelectors`); extra copies in the
   * section (duplicate blocks, responsive clones) stay stale. Only one line-item row per product id.
   * First `variant-selects` in DOM order per `data-product-id` matches what section fetches update.
   */
  function getUniqueVariantPickers(productInfoEl) {
    const seen = new Set();
    const out = [];
    productInfoEl.querySelectorAll('variant-selects').forEach((vs) => {
      const pid = vs.getAttribute('data-product-id');
      const key = pid && pid.length ? pid : vs.id || `__noid_${out.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(vs);
    });
    return out;
  }

  function syncProductFormLineItems(productInfoEl) {
    if (!productInfoEl?.querySelector) return;
    const form = productInfoEl.querySelector('form[is="product-form"]');
    if (!form) return;
    if (form.classList.contains('pdp-set-bundle')) return;

    form.querySelectorAll('input[type="hidden"][name^="items"]').forEach((el) => el.remove());
    const extraContainers = form.querySelectorAll('.js-product-form-line-items');
    extraContainers.forEach((node, i) => {
      if (i > 0) node.remove();
    });

    const pickers = getUniqueVariantPickers(productInfoEl);
    const legacyId = form.querySelector('input[name="id"].product-variant-id');
    let container = form.querySelector('.js-product-form-line-items');
    if (!container) {
      container = document.createElement('div');
      container.className = 'js-product-form-line-items';
      container.hidden = true;
      container.setAttribute('aria-hidden', 'true');
      form.appendChild(container);
    }
    container.innerHTML = '';

    if (pickers.length === 0) {
      if (legacyId) legacyId.disabled = false;
      return;
    }

    /**
     * Single main `variant-selects` on a normal PDP must keep submitting `name="id"` (not `items[n][id]`).
     * Sync `we-quantity-selector` → `input[name="quantity"]` so add-to-cart uses the chosen qty.
     */
    if (pickers.length === 1) {
      if (legacyId) legacyId.disabled = false;
      const weQty = resolveWeQuantityFromVariantSelects(pickers[0]);
      if (weQty != null) applyWeQuantityToProductForm(form, weQty);
      ensureSubmitQuantitySyncBound(form);
      return;
    }

    let idx = 0;
    pickers.forEach((vs) => {
      const vid = parseVariantIdFromPicker(vs);
      if (vid) vs.setAttribute('data-selected-variant-id', vid);
      else vs.removeAttribute('data-selected-variant-id');
      if (!vid) return;
      idx += 1;
      const qty = getQuantityFromPicker(vs);
      const idIn = document.createElement('input');
      idIn.type = 'hidden';
      idIn.name = `items[${idx}][id]`;
      idIn.value = vid;
      const qIn = document.createElement('input');
      qIn.type = 'hidden';
      qIn.name = `items[${idx}][quantity]`;
      qIn.value = qty;
      container.appendChild(idIn);
      container.appendChild(qIn);
    });

    if (legacyId) {
      legacyId.disabled = idx > 0;
    }
  }

  window.syncProductFormLineItems = syncProductFormLineItems;

  document.addEventListener(
    'change',
    (e) => {
      const t = e.target;
      let pi = null;
      if (t?.closest?.('.we-quantity-selector')) {
        pi = t.closest('product-info');
      } else if (
        t?.type === 'radio' &&
        t.hasAttribute?.('data-we-qty-selector') &&
        (t.getAttribute('name') || '').startsWith('quantity-')
      ) {
        const nm = t.getAttribute('name') || '';
        const m = /^quantity-(\d+)$/.exec(nm);
        if (m) {
          const vs = document.querySelector(`variant-selects[data-product-id="${m[1]}"]`);
          pi = vs?.closest?.('product-info') || null;
        }
      }
      if (pi) syncProductFormLineItems(pi);
    },
    true
  );

  if (typeof FoxTheme !== 'undefined' && FoxTheme.pubsub && FoxTheme.pubsub.PUB_SUB_EVENTS) {
    FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, (event) => {
      const sid = event?.data?.sectionId;
      if (sid == null) return;
      const want = String(sid);
      document.querySelectorAll('product-info[data-section]').forEach((el) => {
        if (el.dataset.section === want) syncProductFormLineItems(el);
      });
    });
  }

  function initWeQtySync() {
    document.querySelectorAll('product-info').forEach((pi) => syncProductFormLineItems(pi));
    document.querySelectorAll('form[is="product-form"]').forEach((form) => {
      if (!form.classList.contains('pdp-set-bundle')) ensureSubmitQuantitySyncBound(form);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWeQtySync);
  } else {
    initWeQtySync();
  }
})();

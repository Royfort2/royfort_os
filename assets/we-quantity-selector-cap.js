/**
 * Limits `we-quantity-selector` radios to min(10, available inventory, quantity_rule.max).
 */
(function () {
  const HARD_CAP = 10;

  function escapeAttrSelector(value) {
    return typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(value)
      : String(value).replace(/"/g, '\\"');
  }

  function parseSelectedVariant(vs) {
    const script = vs.querySelector('script[data-selected-variant]');
    const raw = script?.textContent?.trim();
    if (!raw || raw === 'null') return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function computeMaxOrderable(variant) {
    if (!variant) return HARD_CAP;
    if (variant.available === false) return 0;

    let max = HARD_CAP;

    const rule = variant.quantity_rule;
    if (rule && rule.max != null && rule.max !== '') {
      const rm = Number(rule.max);
      if (Number.isFinite(rm) && rm >= 0) {
        max = Math.min(max, Math.floor(rm));
      }
    }

    const q = variant.inventory_quantity;
    if (typeof q === 'number') {
      const inv = Math.max(0, Math.floor(q));
      max = Math.min(max, inv);
    }

    return Math.max(0, max);
  }

  function resolveVariantSelectsFromTarget(target) {
    if (!target) return null;
    let vs = target.closest?.('variant-selects');
    if (!vs && target.type === 'radio') {
      const rid = target.dataset?.vsRoot || target.getAttribute?.('data-vs-root');
      if (rid) vs = document.getElementById(rid);
    }
    return vs;
  }

  function setQuantitySelectorUiDisabled(qtyRoot, disabled) {
    if (!qtyRoot) return;
    qtyRoot.classList.toggle('we-quantity-selector--disabled', disabled);

    const det = qtyRoot.querySelector('details.we-select-container');
    if (det) {
      if (disabled) {
        det.removeAttribute('open');
      }
      if (disabled) {
        det.setAttribute('aria-disabled', 'true');
      } else {
        det.removeAttribute('aria-disabled');
      }
    }

    const summary = qtyRoot.querySelector('.we-select-container__summary');
    if (summary) {
      if (disabled) {
        summary.setAttribute('tabindex', '-1');
      } else {
        summary.removeAttribute('tabindex');
      }
    }
  }

  function syncWeQuantitySelectorCap(variantSelects) {
    if (!variantSelects?.matches?.('variant-selects')) return;
    const qtyRoot = variantSelects.querySelector('.we-quantity-selector');
    if (!qtyRoot) return;

    const variant = parseSelectedVariant(variantSelects);
    const maxQty = computeMaxOrderable(variant);

    const pid = variantSelects.getAttribute('data-product-id');
    if (!pid) return;
    const name = `quantity-${pid}`;
    const esc = escapeAttrSelector(name);

    const allInputs = document.querySelectorAll(
      `input[type="radio"][name="${esc}"][data-we-qty-selector]`
    );

    allInputs.forEach((input) => {
      const v = parseInt(input.value, 10);
      const item = input.closest('.we-select__item');
      if (!Number.isFinite(v) || v < 1) return;

      if (maxQty < 1) {
        input.disabled = true;
        input.checked = false;
        item?.classList.add('we-select__item--we-qty-hidden');
        return;
      }

      if (v > maxQty) {
        input.disabled = true;
        input.checked = false;
        item?.classList.add('we-select__item--we-qty-hidden');
      } else {
        input.disabled = false;
        item?.classList.remove('we-select__item--we-qty-hidden');
      }
    });

    const summary = qtyRoot.querySelector('.we-select-container__summary');
    const unitShort = (qtyRoot.dataset.qtyUnitShort || '').trim();

    if (maxQty < 1) {
      if (summary) summary.textContent = '—';
      setQuantitySelectorUiDisabled(qtyRoot, true);
      return;
    }

    setQuantitySelectorUiDisabled(qtyRoot, false);

    let checked = document.querySelector(`input[name="${esc}"]:checked[data-we-qty-selector]`);
    if (!checked) checked = qtyRoot.querySelector('input[data-we-qty-selector]:checked');
    const cur = parseInt(checked?.value || '1', 10);
    const targetVal = Math.min(Math.max(1, Number.isFinite(cur) ? cur : 1), maxQty);

    const desired =
      document.querySelector(`input[name="${esc}"][data-we-qty-selector][value="${targetVal}"]`) ||
      qtyRoot.querySelector(`input[data-we-qty-selector][value="${targetVal}"]`);

    function setQtySummaryText(n) {
      if (!summary) return;
      const text = unitShort ? `${n}\u00A0${unitShort}` : String(n);
      const wrap = summary.querySelector('.pdp-inline-qty-we-select__value');
      if (wrap) {
        wrap.textContent = text;
      } else {
        summary.textContent = text;
      }
    }

    if (desired && !desired.disabled) {
      if (checked && checked !== desired) checked.checked = false;
      if (!desired.checked) {
        desired.checked = true;
        desired.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setQtySummaryText(targetVal);
    } else {
      setQtySummaryText(targetVal);
    }
  }

  function syncAllInProductInfo(productInfo) {
    if (!productInfo?.querySelectorAll) return;
    productInfo.querySelectorAll('variant-selects').forEach((vs) => syncWeQuantitySelectorCap(vs));
  }

  function syncAll() {
    document.querySelectorAll('variant-selects').forEach((vs) => syncWeQuantitySelectorCap(vs));
  }

  window.syncWeQuantitySelectorCap = syncWeQuantitySelectorCap;

  document.addEventListener(
    'change',
    (e) => {
      const t = e.target;
      if (t?.hasAttribute?.('data-we-qty-selector')) return;

      const vs = resolveVariantSelectsFromTarget(t);
      if (!vs?.querySelector?.('.we-quantity-selector')) return;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => syncWeQuantitySelectorCap(vs));
      });
    },
    true
  );

  document.addEventListener('variant:changed', () => {
    syncAll();
  });

  if (typeof FoxTheme !== 'undefined' && FoxTheme.pubsub && FoxTheme.pubsub.PUB_SUB_EVENTS) {
    FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, (event) => {
      const sid = event?.data?.sectionId;
      if (sid == null) return;
      const want = String(sid);
      document.querySelectorAll('product-info[data-section]').forEach((el) => {
        if (el.dataset.section === want) syncAllInProductInfo(el);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncAll);
  } else {
    syncAll();
  }

  document.addEventListener('quick-view:loaded', syncAll);
})();

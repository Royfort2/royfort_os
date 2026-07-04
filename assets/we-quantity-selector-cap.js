/**
 * Limits inline quantity radios to min(10, available inventory, quantity_rule.max).
 * Supports `.we-quantity-selector` (we picker) and `.pdp-inline-quantity` (custom dropdown picker).
 */
(function () {
  const HARD_CAP = 10;

  function escapeAttrSelector(value) {
    return typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(value)
      : String(value).replace(/"/g, '\\"');
  }

  function normOptionValue(s) {
    return String(s ?? '')
      .trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ');
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

  function getVariantsArray(vs) {
    const pid = vs.dataset?.productId;
    const productInfo = vs.closest('product-info');
    let scriptEl = null;
    if (pid && productInfo && String(pid) !== String(productInfo.dataset?.productId)) {
      scriptEl = document.querySelector(`script[data-set-product-variants="${pid}"]`);
    } else if (productInfo) {
      scriptEl = productInfo.querySelector('script[data-product-variants-for-url]');
    }
    if (!scriptEl?.textContent?.trim()) return null;
    try {
      const v = JSON.parse(scriptEl.textContent.trim());
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  function findCheckedOptionRadio(wrap, productInfo) {
    if (productInfo && typeof productInfo.findCheckedOptionRadio === 'function') {
      return productInfo.findCheckedOptionRadio(wrap);
    }

    const locals = wrap.querySelectorAll(
      'input[type="radio"]:checked:not([data-pdp-inline-qty-value]):not([data-we-qty-selector])'
    );
    for (const input of locals) {
      if (input.closest('.we-quantity-selector')) continue;
      if (input.closest('.pdp-inline-quantity')) continue;
      return input;
    }

    const groupName =
      wrap.querySelector('details.we-select-container[data-radio-group-name]:not([data-radio-group-name^="quantity-"])')
        ?.dataset?.radioGroupName ||
      wrap.querySelector('details.we-select-container')?.dataset?.radioGroupName;
    if (!groupName || String(groupName).startsWith('quantity-')) return null;
    const esc = escapeAttrSelector(groupName);
    return document.querySelector(
      `input[type="radio"][name="${esc}"]:checked:not([data-pdp-inline-qty-value]):not([data-we-qty-selector])`
    );
  }

  function variantMatchesSelectedOptions(variant, selected) {
    if (!variant || !selected.length) return false;
    const vo = [variant.option1, variant.option2, variant.option3].filter(
      (x) => x != null && String(x).length
    );
    if (vo.length !== selected.length) return false;
    for (let i = 0; i < selected.length; i++) {
      if (normOptionValue(vo[i]) !== normOptionValue(selected[i])) return false;
    }
    return true;
  }

  /** Prefer live picker state; fall back to SSR JSON when options are not fully chosen. */
  function resolveVariantFromPicker(vs) {
    const variants = getVariantsArray(vs);
    const groups = [];
    vs.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
      const hasOption =
        wrap.querySelector('select[name^="options"]') ||
        wrap.querySelector('input[type="radio"][data-option-value-id]') ||
        wrap.querySelector(
          'details.we-select-container[data-radio-group-name]:not([data-radio-group-name^="quantity-"])'
        );
      if (hasOption) groups.push(wrap);
    });
    if (!variants?.length || !groups.length) return parseSelectedVariant(vs);

    const productInfo = vs.closest('product-info');
    const selected = [];

    for (const wrap of groups) {
      const selectEl = wrap.querySelector('select[name^="options"]');
      if (selectEl) {
        const opt = selectEl.selectedOptions?.[0];
        if (!opt?.value) return parseSelectedVariant(vs);
        selected.push(String(opt.value));
        continue;
      }
      const checked = findCheckedOptionRadio(wrap, productInfo);
      if (!checked) return parseSelectedVariant(vs);
      selected.push(String(checked.value));
    }

    const found = variants.find((v) => variantMatchesSelectedOptions(v, selected));
    return found || parseSelectedVariant(vs);
  }

  function computeMinOrderable(variant) {
    const rule = variant?.quantity_rule;
    const min = rule?.min != null ? Number(rule.min) : 1;
    if (Number.isFinite(min) && min > 0) return Math.floor(min);
    return 1;
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

    const tracksInventory = variant.inventory_management === 'shopify';
    const denyWhenOut = variant.inventory_policy !== 'continue';
    if (tracksInventory && denyWhenOut && typeof variant.inventory_quantity === 'number') {
      const inv = Math.max(0, Math.floor(variant.inventory_quantity));
      max = Math.min(max, inv);
    }

    const min = computeMinOrderable(variant);
    if (max < min) max = min;

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

  function collectQtyInputs(qtyRoot, attrName) {
    const local = qtyRoot.querySelectorAll(`input[type="radio"][${attrName}]`);
    const names = new Set();
    local.forEach((input) => {
      const nm = input.getAttribute('name');
      if (nm) names.add(nm);
    });

    const out = new Set(local);
    names.forEach((name) => {
      const esc = escapeAttrSelector(name);
      document.querySelectorAll(`input[type="radio"][name="${esc}"][${attrName}]`).forEach((input) => {
        out.add(input);
      });
    });

    return [...out];
  }

  function setQuantityPickerUiDisabled(qtyRoot, disabled, disabledClass) {
    if (!qtyRoot) return;
    qtyRoot.classList.toggle(disabledClass, disabled);

    const det = qtyRoot.querySelector('details.we-select-container');
    if (det) {
      if (disabled) det.removeAttribute('open');
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

  function syncQtyRadios({ qtyRoot, attrName, unitShort, summaryValueSelector }, variant, maxQty, minQty) {
    const allInputs = collectQtyInputs(qtyRoot, attrName);

    allInputs.forEach((input) => {
      const v = parseInt(input.value, 10);
      const item = input.closest('.we-select__item');
      if (!Number.isFinite(v) || v < 1) return;

      if (maxQty < 1 || v < minQty || v > maxQty) {
        input.disabled = true;
        input.checked = false;
        item?.classList.add('we-select__item--we-qty-hidden');
      } else {
        input.disabled = false;
        item?.classList.remove('we-select__item--we-qty-hidden');
      }
    });

    const summary = qtyRoot.querySelector('.we-select-container__summary');
    const disabledClass =
      qtyRoot.classList.contains('pdp-inline-quantity') ? 'pdp-inline-quantity--disabled' : 'we-quantity-selector--disabled';

    if (maxQty < 1) {
      if (summary) {
        const wrap = summary.querySelector(summaryValueSelector);
        if (wrap) wrap.textContent = '—';
        else summary.textContent = '—';
      }
      setQuantityPickerUiDisabled(qtyRoot, true, disabledClass);
      return;
    }

    setQuantityPickerUiDisabled(qtyRoot, false, disabledClass);

    const checked = allInputs.find((input) => input.checked && !input.disabled);
    const cur = parseInt(checked?.value || String(minQty), 10);
    const targetVal = Math.min(Math.max(minQty, Number.isFinite(cur) ? cur : minQty), maxQty);

    const desired = allInputs.find(
      (input) => parseInt(input.value, 10) === targetVal && !input.disabled
    );

    function setQtySummaryText(n) {
      if (!summary) return;
      const text = unitShort ? `${n}\u00A0${unitShort}` : String(n);
      const wrap = summary.querySelector(summaryValueSelector);
      if (wrap) wrap.textContent = text;
      else summary.textContent = text;
    }

    if (desired) {
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

  function syncWeQuantitySelectorCap(variantSelects, variantOverride) {
    if (!variantSelects?.matches?.('variant-selects')) return;

    const variant = variantOverride || resolveVariantFromPicker(variantSelects);
    const maxQty = computeMaxOrderable(variant);
    const minQty = computeMinOrderable(variant);

    const weQtyRoot = variantSelects.querySelector('.we-quantity-selector');
    if (weQtyRoot) {
      syncQtyRadios(
        {
          qtyRoot: weQtyRoot,
          attrName: 'data-we-qty-selector',
          unitShort: (weQtyRoot.dataset.qtyUnitShort || '').trim(),
          summaryValueSelector: '.pdp-inline-qty-we-select__value',
        },
        variant,
        maxQty,
        minQty
      );
    }

    const inlineRoot = variantSelects.querySelector('.pdp-inline-quantity');
    if (inlineRoot) {
      const unitShort =
        inlineRoot.querySelector('[data-qty-unit-short]')?.dataset?.qtyUnitShort ||
        inlineRoot.dataset?.qtyUnitShort ||
        '';
      syncQtyRadios(
        {
          qtyRoot: inlineRoot,
          attrName: 'data-pdp-inline-qty-value',
          unitShort,
          summaryValueSelector: '.pdp-inline-qty-we-select__value',
        },
        variant,
        maxQty,
        minQty
      );
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
      if (t?.hasAttribute?.('data-pdp-inline-qty-value')) return;

      const vs = resolveVariantSelectsFromTarget(t);
      if (!vs?.querySelector?.('.we-quantity-selector, .pdp-inline-quantity')) return;

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
      const changedVariant = event?.data?.variant;
      if (sid == null) return;
      const want = String(sid);
      document.querySelectorAll('product-info[data-section]').forEach((el) => {
        if (el.dataset.section !== want) return;
        el.querySelectorAll('variant-selects').forEach((vs) => {
          const isMainPicker =
            !vs.dataset?.productId || String(vs.dataset.productId) === String(el.dataset?.productId);
          if (isMainPicker && changedVariant) {
            syncWeQuantitySelectorCap(vs, changedVariant);
          } else {
            syncWeQuantitySelectorCap(vs);
          }
        });
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

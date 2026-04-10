/**
 * PDP set bundles: submits cart line items as items[n][id] / items[n][quantity].
 * First set product is always included; optional set cards only when their checkbox is checked.
 * Disables the submit button if the main product, first set product, or any selected optional is unavailable.
 */
(function () {
  let pdpSetBundleChangeDelegationBound = false;

  function getVariantsForProduct(productId) {
    const el = document.querySelector(`script[data-set-product-variants="${productId}"]`);
    if (!el?.textContent) return [];
    try {
      return JSON.parse(el.textContent) || [];
    } catch (e) {
      return [];
    }
  }

  function getSelectedOptionValues(variantSelects) {
    const values = [];
    if (!variantSelects) return values;
    variantSelects.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
      const checked = wrap.querySelector(
        'input[type="radio"]:checked:not([data-pdp-inline-qty-value])'
      );
      if (checked) values.push(checked.value);
    });
    return values;
  }

  function getIncompleteSelection(variantSelects) {
    if (!variantSelects) return false;
    const groups = variantSelects.querySelectorAll(':scope > .product-form__input');
    for (const wrap of groups) {
      if (!wrap.querySelector('input[type="radio"]:checked:not([data-pdp-inline-qty-value])'))
        return true;
    }
    return false;
  }

  function findVariantByOptions(variants, selected) {
    if (!variants?.length || !selected.length) return null;
    return variants.find((v) => {
      for (let i = 0; i < selected.length; i++) {
        const key = `option${i + 1}`;
        if (v[key] !== selected[i]) return false;
      }
      return true;
    });
  }

  function resolveVariant(variantSelects, productId) {
    if (!variantSelects) return null;
    const variants = getVariantsForProduct(productId);
    const selected = getSelectedOptionValues(variantSelects);
    let variant = findVariantByOptions(variants, selected);
    if (!variant && variantSelects) {
      const script = variantSelects.querySelector('[data-selected-variant]');
      if (script?.textContent) {
        const raw = script.textContent.trim();
        if (raw === 'null' || raw === '') {
          variant = null;
        } else {
          try {
            variant = JSON.parse(script.textContent);
          } catch (e) {}
        }
      }
    }
    return variant;
  }

  function findVariantById(variants, id) {
    if (!variants?.length || id == null || id === '') return null;
    const sid = String(id);
    return variants.find((v) => String(v.id) === sid) || null;
  }

  /**
   * Full variant object for availability checks (includes `available` from Shopify JSON).
   */
  function getResolvedVariant(sectionId, productId, fallbackId) {
    const vs = document.getElementById(`variant-selects-${sectionId}-${productId}`);
    if (vs && getIncompleteSelection(vs)) return null;
    let variant = resolveVariant(vs, productId);
    if (!variant && fallbackId != null && fallbackId !== '') {
      variant = findVariantById(getVariantsForProduct(productId), fallbackId);
    }
    if (!variant && vs) {
      const script = vs.querySelector('[data-selected-variant]');
      if (script?.textContent) {
        const raw = script.textContent.trim();
        if (raw === 'null' || raw === '') {
          variant = null;
        } else {
          try {
            variant = JSON.parse(script.textContent);
          } catch (e) {}
        }
      }
    }
    return variant;
  }

  function getDefaultVariantIdFromDom(productId) {
    const el = document.querySelector(`script[data-set-default-variant-id="${productId}"]`);
    if (!el?.textContent) return '';
    try {
      return String(JSON.parse(el.textContent));
    } catch (e) {
      return '';
    }
  }

  function getVariantIdForProduct(sectionId, productId, fallbackId) {
    const vs = document.getElementById(`variant-selects-${sectionId}-${productId}`);
    if (vs) {
      if (getIncompleteSelection(vs)) return '';
      const v = resolveVariant(vs, productId);
      if (v?.id) return String(v.id);
    }
    if (fallbackId != null && fallbackId !== '') return String(fallbackId);
    return getDefaultVariantIdFromDom(productId);
  }

  /**
   * Inline quantity lives under each variant-selects (we-select radios with data-pdp-inline-qty-value).
   * Set-bundle embedded pickers use name qty-inline-*; values must be read per product for cart lines.
   */
  function getInlineQuantityForProduct(sectionId, productId) {
    const vs = document.getElementById(`variant-selects-${sectionId}-${productId}`);
    if (!vs) return 1;
    const checked = vs.querySelector(
      '.pdp-inline-quantity input[type="radio"][data-pdp-inline-qty-value]:checked'
    );
    if (!checked) return 1;
    const raw = checked.getAttribute('data-pdp-inline-qty-value') || checked.value;
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function isVariantPurchasable(variant) {
    return Boolean(variant && variant.available === true);
  }

  /**
   * Zwischensumme: main bundle product + first set product + checked optionals; prices/qty from current variant + inline qty.
   */
  function updatePdpSetZwischensumme(form) {
    const cfgEl = form.querySelector('script[data-pdp-set-config]');
    const productInfo = form.closest('product-info');
    const root = productInfo?.querySelector('[data-pdp-set-zwischensumme]');
    if (!cfgEl?.textContent || !root) return;

    let cfg;
    try {
      cfg = JSON.parse(cfgEl.textContent);
    } catch (e) {
      return;
    }

    const { sectionId, firstSetProductId, firstVariantFallback, optionalProductIds = [] } = cfg;
    const mainProductId = productInfo?.dataset?.productId;
    const metaEl = root.querySelector('[data-pdp-set-zwischensumme-meta]');
    let titles = {};
    if (metaEl?.textContent) {
      try {
        const meta = JSON.parse(metaEl.textContent);
        titles = meta.titles || {};
      } catch (e) {}
    }

    const fmt = window.FoxTheme?.Currency?.formatMoney;
    const mf = window.FoxTheme?.settings?.moneyFormat;
    if (typeof fmt !== 'function') return;

    const lines = [];

    if (mainProductId) {
      const vMain = getResolvedVariant(sectionId, mainProductId, null);
      const qMain = getInlineQuantityForProduct(sectionId, mainProductId);
      if (vMain) {
        lines.push({
          title: titles[String(mainProductId)] || '',
          variant: vMain,
          qty: qMain,
        });
      }
    }

    const vFirst = getResolvedVariant(sectionId, firstSetProductId, firstVariantFallback);
    const qFirst = getInlineQuantityForProduct(sectionId, firstSetProductId);
    if (vFirst) {
      lines.push({
        title: titles[String(firstSetProductId)] || '',
        variant: vFirst,
        qty: qFirst,
      });
    }

    optionalProductIds.forEach((pid) => {
      const cb = productInfo.querySelector(
        `input.product-set-picker__toggle[data-set-optional-product-id="${pid}"]`
      );
      if (!cb?.checked) return;
      const v = getResolvedVariant(sectionId, pid, getDefaultVariantIdFromDom(pid));
      const q = getInlineQuantityForProduct(sectionId, pid);
      if (v) {
        lines.push({
          title: titles[String(pid)] || '',
          variant: v,
          qty: q,
        });
      }
    });

    let saleTotal = 0;
    let compareTotal = 0;
    lines.forEach((line) => {
      saleTotal += line.variant.price * line.qty;
      const unitCompare =
        line.variant.compare_at_price && line.variant.compare_at_price > line.variant.price
          ? line.variant.compare_at_price
          : line.variant.price;
      compareTotal += unitCompare * line.qty;
    });

    const compareEl = root.querySelector('.pdp-set-zwischensumme__compare');
    const saleEl = root.querySelector('.pdp-set-zwischensumme__sale');
    const badgeEl = root.querySelector('.pdp-set-zwischensumme__badge');
    const breakdownEl = root.querySelector('.pdp-set-zwischensumme__breakdown');

    if (saleEl) saleEl.textContent = fmt(saleTotal, mf);

    if (compareTotal > saleTotal) {
      if (compareEl) {
        compareEl.textContent = fmt(compareTotal, mf);
        compareEl.hidden = false;
      }
      if (badgeEl) {
        const pct = Math.round(((compareTotal - saleTotal) * 100) / compareTotal);
        badgeEl.textContent = `-${pct}%`;
        badgeEl.hidden = false;
      }
    } else {
      if (compareEl) {
        compareEl.textContent = '';
        compareEl.hidden = true;
      }
      if (badgeEl) badgeEl.hidden = true;
    }

    if (breakdownEl) {
      const parts = lines.map((line) => {
        const lineSale = line.variant.price * line.qty;
        return `${line.qty}x ${line.title} (${fmt(lineSale, mf)})`;
      });
      breakdownEl.textContent = parts.join(' + ');
    }
  }

  function updatePdpSetSubmitButton(form) {
    const cfgEl = form.querySelector('script[data-pdp-set-config]');
    if (!cfgEl?.textContent) return;

    let cfg;
    try {
      cfg = JSON.parse(cfgEl.textContent);
    } catch (e) {
      return;
    }

    const { sectionId, firstSetProductId, firstVariantFallback, optionalProductIds = [] } = cfg;
    const productInfo = form.closest('product-info');
    const mainProductId = productInfo?.dataset?.productId;
    const submitBtn = document.getElementById(`ProductSubmitButton-${sectionId}`);
    if (!submitBtn || !mainProductId) return;

    const toCheck = [];

    toCheck.push(getResolvedVariant(sectionId, mainProductId, null));
    toCheck.push(getResolvedVariant(sectionId, firstSetProductId, firstVariantFallback));

    optionalProductIds.forEach((pid) => {
      const cb = productInfo.querySelector(`input.product-set-picker__toggle[data-set-optional-product-id="${pid}"]`);
      if (!cb?.checked) return;
      toCheck.push(getResolvedVariant(sectionId, pid, getDefaultVariantIdFromDom(pid)));
    });

    const allPurchasable = toCheck.every(isVariantPurchasable);

    const soldOut =
      typeof FoxTheme !== 'undefined' && FoxTheme.variantStrings && FoxTheme.variantStrings.soldOut
        ? FoxTheme.variantStrings.soldOut
        : 'Sold out';
    const addToCart =
      typeof FoxTheme !== 'undefined' && FoxTheme.variantStrings && FoxTheme.variantStrings.addToCart
        ? FoxTheme.variantStrings.addToCart
        : 'Add to cart';
    const selectVariant = 'Select a variant';

    const span = submitBtn.querySelector('span');

    const incomplete =
      getIncompleteSelection(document.getElementById(`variant-selects-${sectionId}-${mainProductId}`)) ||
      getIncompleteSelection(document.getElementById(`variant-selects-${sectionId}-${firstSetProductId}`));
    let incompleteOptional = false;
    optionalProductIds.forEach((pid) => {
      const cb = productInfo.querySelector(`input.product-set-picker__toggle[data-set-optional-product-id="${pid}"]`);
      if (cb?.checked && getIncompleteSelection(document.getElementById(`variant-selects-${sectionId}-${pid}`))) {
        incompleteOptional = true;
      }
    });

    if (incomplete || incompleteOptional) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('disabled', 'disabled');
      if (span) span.textContent = selectVariant;
      submitBtn.style.pointerEvents = 'none';
      submitBtn.style.opacity = '0.6';
      return;
    }

    if (!allPurchasable) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('disabled', 'disabled');
      if (span) span.textContent = soldOut;
      submitBtn.style.pointerEvents = 'none';
      submitBtn.style.opacity = '0.6';
    } else {
      submitBtn.disabled = false;
      submitBtn.removeAttribute('disabled');
      if (span) span.textContent = addToCart;
      submitBtn.style.pointerEvents = '';
      submitBtn.style.opacity = '';
    }
  }

  function syncSetCartLineItems(form) {
    const root = form.querySelector('[data-pdp-set-line-items]');
    const cfgEl = form.querySelector('script[data-pdp-set-config]');
    if (!root || !cfgEl?.textContent) return;

    let cfg;
    try {
      cfg = JSON.parse(cfgEl.textContent);
    } catch (e) {
      return;
    }

    const { sectionId, firstSetProductId, firstVariantFallback, optionalProductIds = [] } = cfg;
    root.replaceChildren();

    const lines = [];

    const firstId = getVariantIdForProduct(sectionId, firstSetProductId, firstVariantFallback);
    if (firstId) {
      lines.push({
        id: firstId,
        quantity: getInlineQuantityForProduct(sectionId, firstSetProductId),
      });
    }

    const productInfo = form.closest('product-info');

    optionalProductIds.forEach((pid) => {
      const cb = productInfo?.querySelector(
        `input.product-set-picker__toggle[data-set-optional-product-id="${pid}"]`
      );
      if (!cb?.checked) return;
      const vid = getVariantIdForProduct(sectionId, pid, '');
      if (vid) {
        lines.push({
          id: vid,
          quantity: getInlineQuantityForProduct(sectionId, pid),
        });
      }
    });

    lines.forEach((line, n) => {
      const idInput = document.createElement('input');
      idInput.type = 'hidden';
      idInput.name = `items[${n}][id]`;
      idInput.value = line.id;
      root.appendChild(idInput);
      const qInput = document.createElement('input');
      qInput.type = 'hidden';
      qInput.name = `items[${n}][quantity]`;
      qInput.value = String(line.quantity);
      root.appendChild(qInput);
    });
  }

  function refresh(form) {
    syncSetCartLineItems(form);
    updatePdpSetZwischensumme(form);
    updatePdpSetSubmitButton(form);
  }

  function shouldRefreshPdpSetBundle(target) {
    if (!target) return false;
    if (target.classList?.contains('product-set-picker__toggle')) return true;
    if (target.hasAttribute?.('data-pdp-inline-qty-value')) return true;
    if (target.closest?.('variant-selects')) return true;
    return false;
  }

  function bindForm(form) {
    if (!form.classList.contains('pdp-set-bundle')) return;
    if (form.dataset.pdpSetBundleSubmitBound === 'true') return;
    form.dataset.pdpSetBundleSubmitBound = 'true';

    refresh(form);

    form.addEventListener('submit', () => refresh(form), { capture: true });
  }

  function bindPdpSetBundleChangeDelegation() {
    if (pdpSetBundleChangeDelegationBound) return;
    pdpSetBundleChangeDelegationBound = true;
    document.addEventListener(
      'change',
      (e) => {
        if (!shouldRefreshPdpSetBundle(e.target)) return;
        document.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
          refresh(form);
        });
      },
      true
    );
  }

  function init() {
    bindPdpSetBundleChangeDelegation();
    document.querySelectorAll('form.pdp-set-bundle').forEach(bindForm);

    document.addEventListener('pdp-set:bind-bundle-forms', () => {
      document.querySelectorAll('form.pdp-set-bundle').forEach(bindForm);
    });

    document.addEventListener('pdp-set:refresh-submit', () => {
      document.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
        refresh(form);
      });
    });

    if (typeof FoxTheme !== 'undefined' && FoxTheme.pubsub && FoxTheme.pubsub.PUB_SUB_EVENTS) {
      FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, () => {
        document.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
          refresh(form);
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

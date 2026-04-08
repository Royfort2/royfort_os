/**
 * PDP set bundles: submits cart line items as items[n][id] / items[n][quantity].
 * First set product is always included; optional set cards only when their checkbox is checked.
 * Disables the submit button if the main product, first set product, or any selected optional is unavailable.
 */
(function () {
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
      const checked = wrap.querySelector('input[type="radio"]:checked');
      if (checked) values.push(checked.value);
    });
    return values;
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
    const variants = getVariantsForProduct(productId);
    const selected = getSelectedOptionValues(variantSelects);
    let variant = findVariantByOptions(variants, selected);
    if (!variant && variantSelects) {
      const script = variantSelects.querySelector('[data-selected-variant]');
      if (script?.textContent) {
        try {
          variant = JSON.parse(script.textContent);
        } catch (e) {}
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
    let variant = resolveVariant(vs, productId);
    if (!variant && fallbackId != null && fallbackId !== '') {
      variant = findVariantById(getVariantsForProduct(productId), fallbackId);
    }
    if (!variant && vs) {
      const script = vs.querySelector('[data-selected-variant]');
      if (script?.textContent) {
        try {
          variant = JSON.parse(script.textContent);
        } catch (e) {}
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
      const v = resolveVariant(vs, productId);
      if (v?.id) return String(v.id);
    }
    if (fallbackId != null && fallbackId !== '') return String(fallbackId);
    return getDefaultVariantIdFromDom(productId);
  }

  function isVariantPurchasable(variant) {
    return Boolean(variant && variant.available === true);
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

    const span = submitBtn.querySelector('span');

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
    if (firstId) lines.push({ id: firstId, quantity: 1 });

    const productInfo = form.closest('product-info');

    optionalProductIds.forEach((pid) => {
      const cb = productInfo?.querySelector(
        `input.product-set-picker__toggle[data-set-optional-product-id="${pid}"]`
      );
      if (!cb?.checked) return;
      const vid = getVariantIdForProduct(sectionId, pid, '');
      if (vid) lines.push({ id: vid, quantity: 1 });
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
    updatePdpSetSubmitButton(form);
  }

  function bindForm(form) {
    if (!form.classList.contains('pdp-set-bundle')) return;

    const productInfo = form.closest('product-info');
    refresh(form);

    form.addEventListener('submit', () => refresh(form), { capture: true });

    if (productInfo) {
      productInfo.addEventListener('change', (e) => {
        if (
          e.target.closest?.('variant-selects') ||
          e.target.classList?.contains('product-set-picker__toggle')
        ) {
          refresh(form);
        }
      });
    }
  }

  function init() {
    document.querySelectorAll('form.pdp-set-bundle').forEach(bindForm);

    document.addEventListener('pdp-set:refresh-submit', () => {
      document.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
        updatePdpSetSubmitButton(form);
      });
    });

    if (typeof FoxTheme !== 'undefined' && FoxTheme.pubsub && FoxTheme.pubsub.PUB_SUB_EVENTS) {
      FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, () => {
        document.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
          updatePdpSetSubmitButton(form);
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

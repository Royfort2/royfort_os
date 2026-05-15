/**
 * [we] Custom variant dropdown: per-option price + inventory marker (respects other selected options).
 */
(function () {
  function normOptionValue(s) {
    return String(s ?? '')
      .trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function getVariantsArray(vs) {
    const pid = vs.dataset?.productId;
    const productInfo = vs.closest('product-info');
    let scriptEl = null;
    if (pid && productInfo && String(pid) !== String(productInfo.dataset?.productId)) {
      scriptEl = document.querySelector(`script[data-set-product-variants="${pid}"]`);
    } else {
      scriptEl = productInfo?.querySelector('script[data-product-variants-for-url]');
    }
    if (!scriptEl?.textContent?.trim()) return null;
    try {
      const v = JSON.parse(scriptEl.textContent.trim());
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }

  function getSelectedOptionValues(vs, productInfo) {
    const selected = [];
    vs.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
      const selectEl = wrap.querySelector('select[name^="options"]');
      if (selectEl) {
        selected.push(selectEl.selectedOptions?.[0]?.value ?? '');
        return;
      }
      const checked =
        productInfo && typeof productInfo.findCheckedOptionRadio === 'function'
          ? productInfo.findCheckedOptionRadio(wrap)
          : null;
      selected.push(checked?.value ?? '');
    });
    return selected;
  }

  function findVariantForRow(variants, selectedValues, optionPosition1Based, rowValue) {
    const n = selectedValues.length;
    if (!n) return null;
    const pIdx = optionPosition1Based - 1;
    const hyp = [];
    for (let i = 0; i < n; i++) {
      hyp[i] = i === pIdx ? rowValue : selectedValues[i];
    }
    for (let i = 0; i < n; i++) {
      if (i === pIdx) continue;
      if (!hyp[i]) return null;
    }
    return variants.find((v) => {
      for (let i = 0; i < n; i++) {
        const key = `option${i + 1}`;
        if (normOptionValue(v[key]) !== normOptionValue(hyp[i])) return false;
      }
      return true;
    });
  }

  function stockLevel(variant, threshold) {
    if (!variant || variant.available === false) return 'out';
    const q = variant.inventory_quantity;
    if (typeof q !== 'number') return 'ok';
    // When policy is "continue", Shopify keeps available: true with qty 0 — do not show sold-out.
    if (q <= 0) return 'ok';
    if (q <= threshold) return 'low';
    return 'ok';
  }

  function formatMoney(cents) {
    const fmt = window.FoxTheme?.Currency?.formatMoney;
    const moneyFormat = window.FoxTheme?.settings?.moneyFormat;
    if (typeof fmt !== 'function' || !moneyFormat) return '';
    return fmt(cents, moneyFormat);
  }

  function updateDropdownDetails(detailsEl, vs, variants, productInfo) {
    const posStr = detailsEl.dataset.weOptionPosition;
    const optionPosition = parseInt(posStr, 10);
    if (!optionPosition) return;

    const threshold = Math.max(1, parseInt(vs.dataset.weLowStockThreshold, 10) || 5);
    const soldOutLabel = vs.dataset.soldOutLabel || 'Sold out';

    const selectedValues = getSelectedOptionValues(vs, productInfo);

    detailsEl.querySelectorAll('.we-select__item').forEach((item) => {
      const input = item.querySelector('input[type="radio"]');
      const label = item.querySelector('label.we-select__label--with-meta');
      if (!input || !label) return;

      const rowValue = input.value;
      const meta = label.querySelector('.we-select__meta');
      const priceBlock = label.querySelector('.we-select__price-block');
      const marker = label.querySelector('.we-select__stock-marker');
      const valueText = label.querySelector('.we-select__value-text');

      const variant = findVariantForRow(variants, selectedValues, optionPosition, rowValue);

      item.classList.toggle('we-select__item--unavailable', !!(variant && variant.available === false));
      if (valueText) {
        valueText.classList.toggle('we-select__value-text--unavailable', !!(variant && variant.available === false));
      }

      if (!meta || !priceBlock || !marker) return;

      if (!variant) {
        meta.hidden = false;
        priceBlock.innerHTML = `<span class="we-select__price-placeholder">—</span>`;
        marker.dataset.stockLevel = '';
        marker.hidden = true;
        return;
      }

      meta.hidden = false;
      marker.hidden = false;

      if (variant.available === false) {
        priceBlock.innerHTML = `<span class="we-select__soldout">${soldOutLabel}</span>`;
        marker.dataset.stockLevel = 'out';
        return;
      }
      
      const price = variant.price;
      const compare = variant.compare_at_price;
      const onSale = compare != null && Number(compare) > Number(price);

      if (onSale) {
        priceBlock.innerHTML = `<span class="we-select__compare-at"><s>${formatMoney(compare)}</s></span><span class="we-select__current-price we-select__current-price--sale">${formatMoney(price)}</span>`;
      } else {
        priceBlock.innerHTML = `<span class="we-select__current-price">${formatMoney(price)}</span>`;
      }

      marker.dataset.stockLevel = stockLevel(variant, threshold);
    });
  }

  function updateVariantSelectDropdownMeta(vs) {
    if (!vs?.matches?.('variant-selects[data-we-dropdown-meta]')) return;
    const variants = getVariantsArray(vs);
    if (!variants?.length) return;
    const productInfo = vs.closest('product-info');

    vs.querySelectorAll('details.we-select-container[data-we-option-position]').forEach((det) => {
      if (det.dataset.radioGroupName?.startsWith('quantity-')) return;
      updateDropdownDetails(det, vs, variants, productInfo);
    });
  }

  function initWeVariantDropdownMeta(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const list =
      root?.matches?.('variant-selects[data-we-dropdown-meta]') ?
        [root]
      : scope.querySelectorAll?.('variant-selects[data-we-dropdown-meta]') || [];
    list.forEach((vs) => updateVariantSelectDropdownMeta(vs));
  }

  let scheduled = null;
  function scheduleUpdateFromEvent(e) {
    const t = e.target;
    if (!t) return;
    if (t.closest?.('.we-quantity-selector')) return;
    if (t.hasAttribute?.('data-we-qty-selector')) return;
    if (t.hasAttribute?.('data-pdp-inline-qty-value')) return;

    let vs = t.closest?.('variant-selects');
    if (!vs && t.type === 'radio') {
      const rid = t.dataset?.vsRoot || t.getAttribute?.('data-vs-root');
      if (rid) vs = document.getElementById(rid);
    }
    if (!vs?.matches?.('variant-selects[data-we-dropdown-meta]')) return;

    if (scheduled) cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => {
      scheduled = null;
      updateVariantSelectDropdownMeta(vs);
    });
  }

  window.initWeVariantDropdownMeta = initWeVariantDropdownMeta;

  document.addEventListener('change', scheduleUpdateFromEvent, true);
  document.addEventListener(
    'variant:changed',
    () => {
      document.querySelectorAll('variant-selects[data-we-dropdown-meta]').forEach((vs) =>
        updateVariantSelectDropdownMeta(vs)
      );
    },
    true
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWeVariantDropdownMeta(document));
  } else {
    initWeVariantDropdownMeta(document);
  }
})();

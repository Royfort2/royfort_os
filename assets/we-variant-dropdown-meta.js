/**
 * [we] Custom variant dropdown: per-option price + inventory marker.
 * When other options are already chosen, rows resolve to a single variant; when they are not,
 * stock is aggregated across all variants that include that row’s option value.
 *
 * Non-existent option combos (no Shopify variant) are hidden when other options constrain the row.
 * Sold-out variants that exist remain visible and selectable (PDP stock block handles OOS).
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

  function getOptionGroupPosition(wrap) {
    if (!wrap) return 0;
    const details = wrap.querySelector('details.we-select-container[data-we-option-position]');
    if (details?.dataset?.weOptionPosition) {
      return parseInt(details.dataset.weOptionPosition, 10) || 0;
    }
    const probe =
      wrap.querySelector('input[type="radio"][data-option-value-id]') ||
      wrap.querySelector('select[name^="options"] option[data-option-value-id]');
    return getOptionPositionFromInput(probe || {});
  }

  function getSelectedOptionValues(vs, productInfo) {
    const byPosition = {};
    let maxPos = 0;
    vs.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
      const hasOption =
        wrap.querySelector('select[name^="options"]') ||
        wrap.querySelector('input[type="radio"][data-option-value-id]') ||
        wrap.querySelector(
          'details.we-select-container[data-radio-group-name]:not([data-radio-group-name^="quantity-"])'
        );
      if (!hasOption) return;

      const pos = getOptionGroupPosition(wrap);
      if (!pos) return;
      maxPos = Math.max(maxPos, pos);

      const selectEl = wrap.querySelector('select[name^="options"]');
      if (selectEl) {
        byPosition[pos] = selectEl.selectedOptions?.[0]?.value ?? '';
        return;
      }
      const checked =
        productInfo && typeof productInfo.findCheckedOptionRadio === 'function'
          ? productInfo.findCheckedOptionRadio(wrap)
          : null;
      byPosition[pos] = checked?.value ?? '';
    });

    const selected = [];
    for (let i = 1; i <= maxPos; i++) {
      selected.push(byPosition[i] ?? '');
    }
    return selected;
  }

  /**
   * Variants that match this row's option value; other option slots only constrain when a
   * selection exists (so with two unchosen dropdowns, each row aggregates across the other option).
   */
  function findVariantsForRow(variants, selectedValues, optionPosition1Based, rowValue) {
    const n = selectedValues.length;
    if (!n) return [];
    const pIdx = optionPosition1Based - 1;
    const rowNorm = normOptionValue(rowValue);
    return variants.filter((v) => {
      if (normOptionValue(v[`option${pIdx + 1}`]) !== rowNorm) return false;
      for (let i = 0; i < n; i++) {
        if (i === pIdx) continue;
        const sel = normOptionValue(selectedValues[i]);
        if (!sel) continue;
        if (normOptionValue(v[`option${i + 1}`]) !== sel) return false;
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

  function aggregateStockLevel(matches, threshold) {
    const available = matches.filter((v) => v.available !== false);
    if (!available.length) return 'out';
    if (available.some((v) => stockLevel(v, threshold) === 'low')) return 'low';
    return 'ok';
  }

  function formatMoney(cents) {
    const fmt = window.FoxTheme?.Currency?.formatMoney;
    const moneyFormat = window.FoxTheme?.settings?.moneyFormat;
    if (typeof fmt !== 'function' || !moneyFormat) return '';
    return fmt(cents, moneyFormat);
  }

  function isConstrainedByOtherOptions(selectedValues, rowIdx0) {
    return selectedValues.some((sv, i) => i !== rowIdx0 && normOptionValue(sv));
  }

  function setOptionValueHidden(input, hidden) {
    const item = input.closest('.we-select__item');
    if (item) {
      item.classList.toggle('we-select__item--option-hidden', hidden);
      return;
    }
    input.classList.toggle('we-option-value-hidden', hidden);
  }

  function isOptionInputHidden(input) {
    if (!input) return false;
    const item = input.closest('.we-select__item');
    if (item?.classList.contains('we-select__item--option-hidden')) return true;
    return input.classList.contains('we-option-value-hidden');
  }

  function resetOptionVisibilityState(vs) {
    if (!vs?.querySelectorAll) return;
    vs.querySelectorAll('.we-select__item--option-hidden').forEach((item) => {
      item.classList.remove('we-select__item--option-hidden');
    });
    vs.querySelectorAll('.we-option-value-hidden').forEach((el) => {
      el.classList.remove('we-option-value-hidden');
    });
    vs.querySelectorAll('select[name^="options"] option').forEach((opt) => {
      opt.hidden = false;
      opt.removeAttribute('hidden');
      opt.disabled = false;
      opt.removeAttribute('disabled');
    });
  }

  function getOptionPositionFromInput(input) {
    const name = input.getAttribute('name') || '';
    const nameMatch = name.match(/-o(\d+)$/);
    if (nameMatch) return parseInt(nameMatch[1], 10);
    const id = input.id || '';
    const idMatch = id.match(/-(\d+)-\d+$/);
    if (idMatch) return parseInt(idMatch[1], 10);
    return 0;
  }

  function updateDropdownDetails(detailsEl, vs, variants, productInfo) {
    const posStr = detailsEl.dataset.weOptionPosition;
    const optionPosition = parseInt(posStr, 10);
    if (!optionPosition) return;

    const threshold = Math.max(1, parseInt(vs.dataset.weLowStockThreshold, 10) || 5);
    const soldOutLabel = vs.dataset.soldOutLabel || 'Sold out';

    const selectedValues = getSelectedOptionValues(vs, productInfo);
    const rowIdx0 = optionPosition - 1;
    const constrainedByOtherOptions = isConstrainedByOtherOptions(selectedValues, rowIdx0);

    detailsEl.querySelectorAll('.we-select__item').forEach((item) => {
      const input = item.querySelector('input[type="radio"]');
      const label = item.querySelector('label.we-select__label--with-meta, label');
      if (!input || !label) return;

      const rowValue = input.value;
      const meta = label.querySelector('.we-select__meta');
      const priceBlock = label.querySelector('.we-select__price-block');
      const marker = label.querySelector('.we-select__stock-marker');
      const valueText = label.querySelector('.we-select__value-text');

      const matches = findVariantsForRow(variants, selectedValues, optionPosition, rowValue);

      if (matches.length === 0 && constrainedByOtherOptions) {
        item.classList.remove('we-select__item--unavailable');
        if (valueText) valueText.classList.remove('we-select__value-text--unavailable');
        item.classList.add('we-select__item--option-hidden');
        return;
      }

      item.classList.remove('we-select__item--option-hidden');

      if (matches.length === 0) {
        item.classList.remove('we-select__item--unavailable');
        if (valueText) valueText.classList.remove('we-select__value-text--unavailable');
        if (!meta || !priceBlock || !marker) return;
        meta.hidden = false;
        priceBlock.innerHTML = `<span class="we-select__price-placeholder"></span>`;
        marker.dataset.stockLevel = '';
        marker.hidden = true;
        return;
      }

      const anyAvailable = matches.some((v) => v.available !== false);
      item.classList.remove('we-select__item--unavailable');
      input.classList.remove('disabled');
      if (valueText) {
        valueText.classList.remove('we-select__value-text--unavailable');
      }

      if (!meta || !priceBlock || !marker) return;

      meta.hidden = false;
      marker.hidden = false;

      if (matches.length === 1) {
        const variant = matches[0];
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
        return;
      }

      if (!anyAvailable) {
        priceBlock.innerHTML = `<span class="we-select__soldout">${soldOutLabel}</span>`;
        marker.dataset.stockLevel = 'out';
        return;
      }

      priceBlock.innerHTML = `<span class="we-select__price-placeholder"></span>`;
      marker.dataset.stockLevel = aggregateStockLevel(matches, threshold);
    });
  }

  function updateNativeSelectVisibility(vs, variants, productInfo) {
    const selectedValues = getSelectedOptionValues(vs, productInfo);

    vs.querySelectorAll('select[name^="options"]').forEach((selectEl) => {
      const sample = selectEl.querySelector('option[data-option-value-id]');
      const optionPosition = getOptionPositionFromInput(sample || selectEl);
      if (!optionPosition) return;

      const rowIdx0 = optionPosition - 1;
      const constrainedByOtherOptions = isConstrainedByOtherOptions(selectedValues, rowIdx0);

      selectEl.querySelectorAll('option').forEach((opt) => {
        if (!opt.value) return;
        const matches = findVariantsForRow(variants, selectedValues, optionPosition, opt.value);
        const hide = matches.length === 0 && constrainedByOtherOptions;
        opt.hidden = hide;
        opt.toggleAttribute('hidden', hide);
        opt.disabled = hide;
        if (hide) opt.setAttribute('disabled', 'disabled');
        else opt.removeAttribute('disabled');
      });
    });
  }

  /** Swatches, buttons, and non-meta dropdowns: hide values with no matching variant. */
  function updateRadioOptionVisibility(vs, variants, productInfo) {
    const selectedValues = getSelectedOptionValues(vs, productInfo);

    vs.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
      const inputs = wrap.querySelectorAll(
        'input[type="radio"][data-option-value-id]:not([data-we-qty-selector]):not([data-pdp-inline-qty-value])'
      );
      if (!inputs.length) return;

      const optionPosition = getOptionPositionFromInput(inputs[0]);
      if (!optionPosition) return;

      const rowIdx0 = optionPosition - 1;
      const constrainedByOtherOptions = isConstrainedByOtherOptions(selectedValues, rowIdx0);

      inputs.forEach((input) => {
        if (input.closest('details.we-select-container[data-we-option-position]')) return;

        const matches = findVariantsForRow(variants, selectedValues, optionPosition, input.value);

        if (matches.length === 0 && constrainedByOtherOptions) {
          setOptionValueHidden(input, true);
          return;
        }

        setOptionValueHidden(input, false);
        input.classList.remove('disabled');
      });
    });

    vs.querySelectorAll('details.we-select-container[data-we-option-position]').forEach((det) => {
      if (det.dataset.radioGroupName?.startsWith('quantity-')) return;
      if (vs.matches('variant-selects[data-we-dropdown-meta]')) return;
      updateDropdownDetails(det, vs, variants, productInfo);
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

  function findFirstVisibleRadioInWrap(wrap, productInfo) {
    const details = wrap.querySelector('details.we-select-container[data-we-option-position]');
    if (details) {
      for (const item of details.querySelectorAll('.we-select__item')) {
        if (item.classList.contains('we-select__item--option-hidden')) continue;
        const input = item.querySelector('input[type="radio"]');
        if (input) return input;
      }
      return null;
    }

    for (const input of wrap.querySelectorAll(
      'input[type="radio"][data-option-value-id]:not([data-we-qty-selector]):not([data-pdp-inline-qty-value])'
    )) {
      if (!isOptionInputHidden(input)) return input;
    }
    return null;
  }

  function autoSelectFirstVisibleOption(vs, productInfo) {
    if (!vs) return false;
    let changed = false;

    vs.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
      const selectEl = wrap.querySelector('select[name^="options"]');
      if (selectEl) {
        const selected = selectEl.selectedOptions?.[0];
        if (selected && (selected.hidden || selected.disabled)) {
          const firstVisible = Array.from(selectEl.options).find((opt) => opt.value && !opt.hidden && !opt.disabled);
          if (firstVisible && firstVisible.value !== selectEl.value) {
            selectEl.value = firstVisible.value;
            changed = true;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        return;
      }

      const checked =
        productInfo && typeof productInfo.findCheckedOptionRadio === 'function'
          ? productInfo.findCheckedOptionRadio(wrap)
          : wrap.querySelector('input[type="radio"][data-option-value-id]:checked');

      if (checked && isOptionInputHidden(checked)) {
        const fallback = findFirstVisibleRadioInWrap(wrap, productInfo);
        if (fallback && fallback !== checked) {
          fallback.checked = true;
          changed = true;
          fallback.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    return changed;
  }

  function updateVariantSelectOptionVisibility(vs) {
    if (!vs?.matches?.('variant-selects')) return;
    const productInfo = vs.closest('product-info');
    resetOptionVisibilityState(vs);
    const variants = getVariantsArray(vs);
    if (!variants?.length) return;

    updateRadioOptionVisibility(vs, variants, productInfo);
    updateNativeSelectVisibility(vs, variants, productInfo);
    updateVariantSelectDropdownMeta(vs);

    if (autoSelectFirstVisibleOption(vs, productInfo)) {
      resetOptionVisibilityState(vs);
      updateRadioOptionVisibility(vs, variants, productInfo);
      updateNativeSelectVisibility(vs, variants, productInfo);
      updateVariantSelectDropdownMeta(vs);
    }
  }

  function initWeVariantDropdownMeta(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const list =
      root?.matches?.('variant-selects') ?
        [root]
      : scope.querySelectorAll?.('variant-selects') || [];
    list.forEach((vs) => updateVariantSelectOptionVisibility(vs));
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
    if (!vs?.matches?.('variant-selects')) return;

    if (scheduled) cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => {
      scheduled = null;
      updateVariantSelectOptionVisibility(vs);
    });
  }

  window.initWeVariantDropdownMeta = initWeVariantDropdownMeta;

  document.addEventListener('change', scheduleUpdateFromEvent, true);
  document.addEventListener(
    'variant:changed',
    () => {
      document.querySelectorAll('variant-selects').forEach((vs) => updateVariantSelectOptionVisibility(vs));
    },
    true
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWeVariantDropdownMeta(document));
  } else {
    initWeVariantDropdownMeta(document);
  }
})();

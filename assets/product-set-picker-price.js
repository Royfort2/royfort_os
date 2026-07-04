/**
 * Set-product card price: shows theme "from" pricing while the card is unchecked;
 * when selected, shows the active variant price. Variant changes only apply while selected.
 * Also updates the card thumbnail to match the selected variant (e.g. color).
 */
(function () {
  function normOption(s) {
    return String(s ?? '')
      .trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function getVariantsForProduct(productId) {
    const el = document.querySelector(`script[data-set-product-variants="${productId}"]`);
    if (!el?.textContent) return [];
    try {
      return JSON.parse(el.textContent) || [];
    } catch (e) {
      return [];
    }
  }

  function getVariantImageMap(productId) {
    const el = document.querySelector(`script[data-set-product-variant-images="${productId}"]`);
    if (!el?.textContent?.trim()) return null;
    try {
      return JSON.parse(el.textContent.trim());
    } catch {
      return null;
    }
  }

  function getOptionGroupPosition(wrap) {
    if (!wrap) return 0;
    const selectEl = wrap.querySelector('select[name^="options"][data-we-option-position]');
    if (selectEl?.dataset?.weOptionPosition) {
      return parseInt(selectEl.dataset.weOptionPosition, 10) || 0;
    }
    const details = wrap.querySelector('details.we-select-container[data-we-option-position]');
    if (details?.dataset?.weOptionPosition) {
      return parseInt(details.dataset.weOptionPosition, 10) || 0;
    }
    const probe = wrap.querySelector('input[type="radio"][data-option-value-id]');
    if (!probe) return 0;
    const name = probe.getAttribute('name') || '';
    const nameMatch = name.match(/-o(\d+)$/);
    if (nameMatch) return parseInt(nameMatch[1], 10);
    const id = probe.id || '';
    const idMatch = id.match(/-(\d+)-\d+$/);
    if (idMatch) return parseInt(idMatch[1], 10);
    return 0;
  }

  function getSelectedOptionValues(variantSelects) {
    const productInfo = variantSelects.closest('product-info');
    const byPosition = {};
    let maxPos = 0;
    variantSelects.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
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
          : wrap.querySelector('input[type="radio"]:checked');
      byPosition[pos] = checked?.value ?? '';
    });
    const values = [];
    for (let i = 1; i <= maxPos; i++) {
      values.push(byPosition[i] ?? '');
    }
    return values;
  }

  function findVariantByOptions(variants, selected) {
    if (!variants?.length || !selected.length) return null;
    return variants.find((v) => {
      for (let i = 0; i < selected.length; i++) {
        const key = `option${i + 1}`;
        if (normOption(v[key]) !== normOption(selected[i])) return false;
      }
      return true;
    });
  }

  /**
   * Match only options the shopper has chosen (non-empty). Used when e.g. color is set
   * but size dropdown is still unset — so the card image can follow the color immediately.
   */
  function findVariantByPartialOptions(variants, selected) {
    if (!variants?.length || !selected?.length) return null;
    const candidates = variants.filter((v) => {
      for (let i = 0; i < selected.length; i++) {
        const sel = selected[i];
        if (sel == null || !String(sel).trim()) continue;
        const key = `option${i + 1}`;
        if (normOption(v[key]) !== normOption(sel)) return false;
      }
      return true;
    });
    if (!candidates.length) return null;
    return candidates.find((v) => v.available !== false) || candidates[0];
  }

  /**
   * Full variant match (every option has a chosen value). Used for card **price** so we do not
   * show a specific variant price while a dropdown is still on the placeholder (partial selection
   * is only for thumbnail / preview).
   */
  function resolveVariantForPrice(variantSelects) {
    const variants = getVariantsForProduct(variantSelects.dataset.productId);
    const selected = getSelectedOptionValues(variantSelects);
    if (!selected.length || !selected.every((v) => v != null && String(v).trim() !== '')) {
      const script = variantSelects.querySelector('[data-selected-variant]');
      const raw = script?.textContent?.trim();
      if (raw && raw !== 'null') {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) return parsed;
        } catch (e) {}
      }
      return null;
    }
    return findVariantByOptions(variants, selected);
  }

  /** Thumbnail / preview: allow partial option match (e.g. color swatch before size is chosen). */
  function resolveVariant(variantSelects) {
    const variants = getVariantsForProduct(variantSelects.dataset.productId);
    const selected = getSelectedOptionValues(variantSelects);

    const full = findVariantByOptions(variants, selected);
    if (full) return full;

    const partial = findVariantByPartialOptions(variants, selected);
    if (partial) return partial;

    const script = variantSelects.querySelector('[data-selected-variant]');
    const raw = script?.textContent?.trim();
    if (raw && raw !== 'null') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id) return parsed;
      } catch (e) {}
    }
    return null;
  }

  function formatFromPriceLabel(priceHtml) {
    const tpl = window.FoxTheme?.variantStrings?.fromPriceHtml;
    if (!tpl || !String(tpl).includes('[price]')) return priceHtml;
    return String(tpl).replace('[price]', priceHtml);
  }

  function formatPriceHtml(variant) {
    const mf = window.FoxTheme?.settings?.moneyFormat || '${{amount}}';
    const fmt = window.FoxTheme?.Currency?.formatMoney;
    if (!variant || typeof fmt !== 'function') return '';

    const price = fmt(variant.price, mf);
    const priceLabel = formatFromPriceLabel(price);
    const onSale = variant.compare_at_price && variant.compare_at_price > variant.price;
    if (onSale) {
      const compare = fmt(variant.compare_at_price, mf);
      return (
        `<div class="f-price f-price--on-sale product-set-picker__f-price">` +
        `<div class="f-price__sale">` +
        `<span class="f-price-item f-price-item--regular"><s>${compare}</s></span>` +
        `<span class="f-price-item f-price-item--sale">${priceLabel}</span>` +
        `</div></div>`
      );
    }
    return (
      `<div class="f-price product-set-picker__f-price">` +
      `<div class="f-price__regular">` +
      `<span class="f-price-item f-price-item--regular">${priceLabel}</span>` +
      `</div></div>`
    );
  }

  function restoreDefaultPriceFromTemplate(priceHost) {
    const tid = priceHost.dataset.defaultPriceTemplate;
    if (!tid) return;
    const tpl = document.getElementById(tid);
    if (!tpl?.content) return;
    priceHost.replaceChildren(tpl.content.cloneNode(true));
  }

  function isCardSelected(card) {
    return Boolean(card?.querySelector('.product-set-picker__toggle')?.checked);
  }

  function updateThumbForCard(card, productId, variant) {
    const thumb = card?.querySelector('.product-set-picker__thumb');
    const img = thumb?.querySelector('img.product-set-picker__thumb-img');
    if (!thumb || !variant?.id) return;
    const map = getVariantImageMap(String(productId));
    if (!map) return;
    const url = map[String(variant.id)];
    if (url == null || url === 'null' || !String(url).trim()) return;
    if (img) {
      img.src = String(url);
      img.removeAttribute('srcset');
      img.sizes = '';
    }
  }

  function restoreDefaultThumb(card) {
    const thumb = card?.querySelector('.product-set-picker__thumb');
    const img = thumb?.querySelector('img.product-set-picker__thumb-img');
    const url = thumb?.dataset?.defaultThumbUrl;
    if (img && url) {
      img.src = url;
      img.removeAttribute('srcset');
    }
  }

  function resolveVariantSelectsFromEventTarget(target) {
    if (!target) return null;
    let vs = target.closest?.('variant-selects');
    if (!vs && target.type === 'radio') {
      const rid = target.dataset?.vsRoot || target.getAttribute?.('data-vs-root');
      if (rid) vs = document.getElementById(rid);
    }
    return vs;
  }

  function updateCardForVariantSelects(variantSelects) {
    if (!variantSelects?.dataset?.productId) return;
    const card = variantSelects.closest('.product-set-picker__card');
    if (!isCardSelected(card)) return;

    const pid = variantSelects.dataset.productId;
    const variantForPrice = resolveVariantForPrice(variantSelects);
    const variantForThumb = resolveVariant(variantSelects);

    const priceHost = card?.querySelector('[data-set-card-price][data-product-id="' + pid + '"]');
    if (priceHost) {
      if (variantForPrice) {
        const html = formatPriceHtml(variantForPrice);
        if (html) priceHost.innerHTML = html;
      } else {
        restoreDefaultPriceFromTemplate(priceHost);
      }
    }

    updateThumbForCard(card, pid, variantForThumb);
  }

  function syncCheckedSetPickers() {
    document.querySelectorAll('.product-set-picker__card').forEach((card) => {
      if (!isCardSelected(card)) return;
      const vs = card.querySelector('.product-set-picker__expand variant-selects[data-product-id]');
      if (vs) updateCardForVariantSelects(vs);
    });
  }

  document.addEventListener(
    'change',
    function (e) {
      const vs = resolveVariantSelectsFromEventTarget(e.target);
      if (!vs?.dataset?.productId || !vs.closest('.product-set-picker__expand')) return;
      const card = vs.closest('.product-set-picker__card');
      if (!isCardSelected(card)) return;
      updateCardForVariantSelects(vs);
    },
    true
  );

  document.addEventListener('change', function (e) {
    if (!e.target.classList?.contains('product-set-picker__toggle')) return;
    const card = e.target.closest('.product-set-picker__card');
    const priceHost = card?.querySelector('[data-set-card-price]');
    const vs = card?.querySelector('.product-set-picker__expand variant-selects[data-product-id]');

    if (e.target.checked) {
      if (vs) updateCardForVariantSelects(vs);
    } else {
      if (priceHost) restoreDefaultPriceFromTemplate(priceHost);
      restoreDefaultThumb(card);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncCheckedSetPickers);
  } else {
    syncCheckedSetPickers();
  }

  document.addEventListener('quick-view:loaded', syncCheckedSetPickers);

  document.addEventListener('variant:changed', syncCheckedSetPickers);

  /** Called after embedded set-product `variant-selects` HTML is swapped (e.g. default size applied). */
  window.syncProductSetPickerCards = syncCheckedSetPickers;
})();

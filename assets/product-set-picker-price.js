/**
 * Set-product card price: shows theme "from" pricing while the card is unchecked;
 * when selected, shows the active variant price. Variant changes only apply while selected.
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

  function resolveVariant(variantSelects) {
    const variants = getVariantsForProduct(variantSelects.dataset.productId);
    const selected = getSelectedOptionValues(variantSelects);
    let variant = findVariantByOptions(variants, selected);
    if (!variant) {
      const script = variantSelects.querySelector('[data-selected-variant]');
      if (script?.textContent) {
        try {
          variant = JSON.parse(script.textContent);
        } catch (e) {}
      }
    }
    return variant;
  }

  function formatPriceHtml(variant) {
    const mf = window.FoxTheme?.settings?.moneyFormat || '${{amount}}';
    const fmt = window.FoxTheme?.Currency?.formatMoney;
    if (!variant || typeof fmt !== 'function') return '';

    const price = fmt(variant.price, mf);
    const onSale = variant.compare_at_price && variant.compare_at_price > variant.price;
    if (onSale) {
      const compare = fmt(variant.compare_at_price, mf);
      return (
        `<div class="f-price f-price--on-sale product-set-picker__f-price">` +
        `<div class="f-price__sale">` +
        `<span class="f-price-item f-price-item--regular"><s>${compare}</s></span>` +
        `<span class="f-price-item f-price-item--sale">${price}</span>` +
        `</div></div>`
      );
    }
    return (
      `<div class="f-price product-set-picker__f-price">` +
      `<div class="f-price__regular">` +
      `<span class="f-price-item f-price-item--regular">${price}</span>` +
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

  function updateCardForVariantSelects(variantSelects) {
    if (!variantSelects?.dataset?.productId) return;
    const card = variantSelects.closest('.product-set-picker__card');
    if (!isCardSelected(card)) return;

    const priceHost = card?.querySelector('[data-set-card-price][data-product-id="' + variantSelects.dataset.productId + '"]');
    if (!priceHost) return;

    const variant = resolveVariant(variantSelects);
    if (!variant) return;

    const html = formatPriceHtml(variant);
    if (html) priceHost.innerHTML = html;
  }

  function syncCheckedSetPickers() {
    document.querySelectorAll('.product-set-picker__card').forEach((card) => {
      if (!isCardSelected(card)) return;
      const vs = card.querySelector('.product-set-picker__expand variant-selects[data-product-id]');
      if (vs) updateCardForVariantSelects(vs);
    });
  }

  document.addEventListener('change', function (e) {
    const vs = e.target.closest?.('variant-selects');
    if (!vs?.dataset?.productId || !vs.closest('.product-set-picker__expand')) return;
    const card = vs.closest('.product-set-picker__card');
    if (!isCardSelected(card)) return;
    updateCardForVariantSelects(vs);
  });

  document.addEventListener('change', function (e) {
    if (!e.target.classList?.contains('product-set-picker__toggle')) return;
    const card = e.target.closest('.product-set-picker__card');
    const priceHost = card?.querySelector('[data-set-card-price]');
    const vs = card?.querySelector('.product-set-picker__expand variant-selects[data-product-id]');

    if (e.target.checked) {
      if (vs) updateCardForVariantSelects(vs);
    } else if (priceHost) {
      restoreDefaultPriceFromTemplate(priceHost);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncCheckedSetPickers);
  } else {
    syncCheckedSetPickers();
  }

  document.addEventListener('quick-view:loaded', syncCheckedSetPickers);
})();

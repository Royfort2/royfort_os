/**
 * PDP set bundles: submits cart line items as items[n][id] / items[n][quantity] / items[n][properties][_set].
 *
 * ATC: the first two set-product `variant-selects` (excluding the bundle PDP picker) must
 * have a full variant selection; then the add button is enabled if those variants are available.
 */
(function () {
  const LISTENERS_KEY = '__pdpSetBundleListenersBound';
  const DELEGATION_KEY = '__pdpSetBundleDelegationBound';
  const PUBSUB_KEY = '__pdpSetBundlePubsubBound';

  function getVariantsForProduct(productId, scope) {
    const roots = [];
    if (scope) roots.push(scope);
    const openPi = document.querySelector('quick-view-modal[open] product-info');
    if (openPi && !roots.includes(openPi)) roots.push(openPi);
    if (!roots.includes(document)) roots.push(document);

    for (const root of roots) {
      const el = root.querySelector?.(`script[data-set-product-variants="${productId}"]`);
      if (!el?.textContent) continue;
      try {
        return JSON.parse(el.textContent) || [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /**
   * Matches `variant-selects` behavior: option radios may live in a mobile portal under `body`,
   * so we resolve the checked input by radio group name when not found inside `wrap`.
   */
  function findCheckedOptionRadioInWrap(wrap) {
    const locals = wrap.querySelectorAll(
      'input[type="radio"]:checked:not([data-pdp-inline-qty-value]):not([data-we-qty-selector])'
    );
    let local = null;
    for (const input of locals) {
      if (input.closest('.we-quantity-selector')) continue;
      local = input;
      break;
    }
    if (local) return local;
    const groupName = wrap.querySelector('details.we-select-container')?.dataset?.radioGroupName;
    if (!groupName || typeof document === 'undefined') return null;
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(groupName) : groupName.replace(/"/g, '\\"');
    return document.querySelector(
      `input[type="radio"][name="${esc}"]:checked:not([data-pdp-inline-qty-value])`
    );
  }

  function getVariantSelectsEl(sectionId, productId, productInfo) {
    const id = `variant-selects-${sectionId}-${productId}`;
    const escId =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
    return (
      productInfo?.querySelector?.(`#${escId}`) ||
      productInfo?.querySelector?.(`variant-selects[data-product-id="${productId}"]`) ||
      document.getElementById(id)
    );
  }

  function getOptionGroupCount(vs) {
    if (!vs || vs.tagName !== 'VARIANT-SELECTS') return 0;
    return vs.querySelectorAll(':scope > .product-form__input').length;
  }

  function variantCoversOptionGroups(variant, groupCount) {
    if (!variant?.id) return false;
    if (groupCount <= 0) return true;
    let filled = 0;
    for (let i = 1; i <= 3; i++) {
      if (variant[`option${i}`]) filled++;
    }
    return filled >= groupCount;
  }

  function getWeSelectValueFromWrap(wrap) {
    const details = wrap.querySelector('details.we-select-container');
    if (!details || details.classList.contains('we-select-container--placeholder')) return null;

    const checked = findCheckedOptionRadioInWrap(wrap);
    if (checked?.value) return checked.value;

    const valueText = details.querySelector('.we-select__value-text')?.textContent?.trim();
    if (valueText) return valueText;

    const summaryText = details
      .querySelector('.we-select-container__summary')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
    return summaryText || null;
  }

  function getSelectedOptionValues(variantSelects) {
    const values = [];
    if (!variantSelects) return values;
    variantSelects.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
      const optionSelect = wrap.querySelector('select[name^="options"]');
      if (optionSelect) {
        const opt = optionSelect.selectedOptions?.[0];
        if (opt?.value) values.push(opt.value);
        return;
      }
      const checked = findCheckedOptionRadioInWrap(wrap);
      if (checked?.value) {
        values.push(checked.value);
        return;
      }
      const weSelectVal = getWeSelectValueFromWrap(wrap);
      if (weSelectVal) {
        values.push(weSelectVal);
        return;
      }
      const swatchLabel = wrap.querySelector('[data-selected-swatch-value]')?.textContent?.trim();
      if (swatchLabel) values.push(swatchLabel);
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

  /** JSON from the section-swapped `<script data-selected-variant>` inside each `<variant-selects>` (we picker). */
  function parseDataSelectedVariant(vs) {
    if (!vs) return null;
    const script = vs.querySelector('[data-selected-variant]');
    if (!script?.textContent) return null;
    const raw = script.textContent.trim();
    if (!raw || raw === 'null') return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /**
   * True when every option group has a selected value (portaled we-select radios included).
   * Uses the same value strings as `getSelectedOptionValues` — not `<variant-selects>.selectedOptionValues`,
   * which only counts radios that have `data-option-value-id`; missing ids would keep the ATC disabled.
   * Does not treat SSR `[data-selected-variant]` alone as complete for multi-option pickers.
   * When no `<variant-selects>` exists (single-variant set line), only one variant in JSON counts as resolved.
   */
  function wePickerHasResolvedVariant(vs, productId, cfg) {
    if (!vs) {
      if (productId == null || productId === '') return false;
      const variants = getVariantsForProduct(productId);
      return variants.length === 1;
    }
    if (vs.tagName !== 'VARIANT-SELECTS') {
      const fromScript = parseDataSelectedVariant(vs);
      return fromScript?.id != null && fromScript.id !== '';
    }

    const groupCount = getOptionGroupCount(vs);
    const pid = String(productId || vs.dataset?.productId || '');
    const sectionId = vs.dataset?.section || cfg?.sectionId || '';
    const fallback =
      vs.dataset?.selectedVariantId ||
      (String(pid) === String(cfg?.firstSetProductId) ? cfg?.firstVariantFallback : null) ||
      getDefaultVariantIdFromDom(pid, vs.closest('product-info'));
    const resolved = getResolvedVariant(sectionId, pid, fallback, vs.closest('product-info'));

    const values = getSelectedOptionValues(vs);
    if (groupCount > 0 && values.length >= groupCount) return true;

    if (resolved?.id && variantCoversOptionGroups(resolved, groupCount)) {
      if (values.length === 0) return true;
      for (let i = 0; i < values.length; i++) {
        if (resolved[`option${i + 1}`] !== values[i]) return false;
      }
      return true;
    }

    try {
      const sel = vs.selectedOptionValues;
      if (Array.isArray(sel) && groupCount > 0 && sel.length >= groupCount) return true;
    } catch (e) {
      /* ignore */
    }

    return false;
  }

  /**
   * One `<variant-selects>` per product id (responsive duplicates share the same `data-product-id`).
   */
  function getProductInfoForBundleForm(form) {
    if (!form) return null;

    const inTree = form.closest('product-info');
    if (inTree) return inTree;

    const modal =
      form.closest('quick-view-modal') ||
      form.closest('.drawer__inner')?.closest('quick-view-modal');
    if (modal) {
      const pi = modal.querySelector('product-info');
      if (pi) return pi;
    }

    const drawerContent = form.closest('.quick-view__content, .drawer__body');
    if (drawerContent) {
      const pi = drawerContent.querySelector('product-info');
      if (pi) return pi;
    }

    const openModal = document.querySelector('quick-view-modal[open]');
    return openModal?.querySelector('product-info') || null;
  }

  function getUniqueVariantSelects(productInfo) {
    if (!productInfo) return [];
    const seen = new Set();
    const out = [];
    productInfo.querySelectorAll('variant-selects').forEach((vs) => {
      const pid = vs.getAttribute('data-product-id');
      const key = pid && pid.length ? pid : vs.id || `__noid_${out.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(vs);
    });
    return out;
  }

  /**
   * Pickers that count for set-bundle ATC: every set picker in the section, excluding the bundle
   * product’s own picker (cart uses `items[]` lines, not `name="id"`), and excluding optional set
   * lines whose checkbox is off (when a checkbox exists).
   */
  function getSetBundlePickersToValidate(productInfo, cfg) {
    if (!productInfo) return [];

    const optionalIds = (cfg?.optionalProductIds || []).map(String);
    const mainId = String(productInfo.dataset?.productId || '');

    return getUniqueVariantSelects(productInfo).filter((vs) => {
      const pid = String(vs.dataset?.productId || '');
      if (!pid) return false;
      if (mainId && pid === mainId) return false;

      if (optionalIds.includes(pid)) {
        const cb = productInfo.querySelector(
          `input.product-set-picker__toggle[data-set-optional-product-id="${pid}"]`
        );
        if (cb && !cb.checked) return false;
      }
      return true;
    });
  }

  /** First two set pickers in DOM order (after filters). Used only for ATC enable rules. */
  function getFirstTwoSetPickers(productInfo, cfg) {
    return getSetBundlePickersToValidate(productInfo, cfg).slice(0, 2);
  }

  /**
   * Full variant object for availability checks (includes `available` from Shopify JSON).
   */
  function getResolvedVariant(sectionId, productId, fallbackId, productInfo) {
    const vs = getVariantSelectsEl(sectionId, productId, productInfo);
    let variant = resolveVariant(vs, productId);
    if (!variant && vs) {
      variant = parseDataSelectedVariant(vs);
    }
    if (!variant && fallbackId != null && fallbackId !== '') {
      variant = findVariantById(getVariantsForProduct(productId), fallbackId);
    }
    return variant;
  }

  function getDefaultVariantIdFromDom(productId, scope) {
    const roots = [];
    if (scope) roots.push(scope);
    const openPi = document.querySelector('quick-view-modal[open] product-info');
    if (openPi && !roots.includes(openPi)) roots.push(openPi);
    if (!roots.includes(document)) roots.push(document);

    for (const root of roots) {
      const el = root.querySelector?.(`script[data-set-default-variant-id="${productId}"]`);
      if (!el?.textContent) continue;
      try {
        return String(JSON.parse(el.textContent));
      } catch (e) {
        return '';
      }
    }
    return '';
  }

  function getVariantIdForProduct(sectionId, productId, fallbackId, productInfo) {
    const vs = getVariantSelectsEl(sectionId, productId, productInfo);
    if (vs) {
      const v = resolveVariant(vs, productId) || parseDataSelectedVariant(vs);
      if (v?.id) return String(v.id);
    }
    if (fallbackId != null && fallbackId !== '') return String(fallbackId);
    return getDefaultVariantIdFromDom(productId, productInfo);
  }

  /**
   * Inline quantity per set line: `product-variant-picker` uses `.pdp-inline-quantity` + data-pdp-inline-qty-value;
   * `we-product-variant-picker` uses `.we-quantity-selector` + data-we-qty-selector (name quantity-{id}).
   * Mobile may portal radios under body — resolve by name like option radios.
   */
  function getInlineQuantityForProduct(sectionId, productId) {
    const vs = document.getElementById(`variant-selects-${sectionId}-${productId}`);
    if (!vs) return 1;

    const inlineRoot = vs.querySelector('.pdp-inline-quantity');
    if (inlineRoot) {
      let inlineChecked = inlineRoot.querySelector(
        'input[type="radio"][data-pdp-inline-qty-value]:checked'
      );
      if (!inlineChecked) {
        const sample = inlineRoot.querySelector('input[data-pdp-inline-qty-value]');
        const nm = sample?.getAttribute('name');
        if (nm) {
          const esc =
            typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nm) : nm.replace(/"/g, '\\"');
          inlineChecked = document.querySelector(
            `input[type="radio"][name="${esc}"]:checked[data-pdp-inline-qty-value]`
          );
        }
      }
      if (inlineChecked) {
        const raw =
          inlineChecked.getAttribute('data-pdp-inline-qty-value') || inlineChecked.value;
        const n = parseInt(String(raw), 10);
        return Number.isFinite(n) && n > 0 ? n : 1;
      }

      const summaryVal = inlineRoot.querySelector('.pdp-inline-qty-we-select__value');
      const t = summaryVal?.textContent?.trim();
      const m = t?.match(/^(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }

    const weLocal = vs.querySelector(
      '.we-quantity-selector input[type="radio"][data-we-qty-selector]:checked'
    );
    if (weLocal) {
      const n = parseInt(String(weLocal.value), 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }

    const groupName = `quantity-${productId}`;
    const esc =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(groupName) : groupName.replace(/"/g, '\\"');
    const portaled = document.querySelector(
      `input[type="radio"][name="${esc}"]:checked[data-we-qty-selector]`
    );
    if (portaled) {
      const n = parseInt(String(portaled.value), 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }

    const summary = vs.querySelector('.we-quantity-selector .we-select-container__summary');
    const t = summary?.textContent?.trim();
    const m = t?.match(/^(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }

    return 1;
  }

  function isVariantPurchasable(variant) {
    if (!variant) return false;
    if (variant.available === false) return false;
    return true;
  }

  function minPriceCentsForProduct(productId, priceMinById) {
    const k = String(productId);
    if (priceMinById && priceMinById[k] != null) {
      const n = Number(priceMinById[k]);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    const vars = getVariantsForProduct(k);
    if (!vars?.length) return 0;
    return Math.min(...vars.map((v) => Number(v.price) || 0));
  }

  function formatZwFromTotal(fromPrefix, cents, fmt, mf) {
    const m = fmt(cents, mf);
    const p = String(fromPrefix || '').trim();
    if (!p) return m;
    return `${p} ${m}`.replace(/\s+/g, ' ').trim();
  }

  function lineSaleCents(line, priceMinById) {
    if (line.resolved && line.variant) return line.variant.price * line.qty;
    const unit = line.priceMinCents || minPriceCentsForProduct(line.productId, priceMinById);
    return unit * line.qty;
  }

  function lineCompareCents(line, priceMinById) {
    if (line.resolved && line.variant) {
      const u =
        line.variant.compare_at_price && line.variant.compare_at_price > line.variant.price
          ? line.variant.compare_at_price
          : line.variant.price;
      return u * line.qty;
    }
    const unit = line.priceMinCents || minPriceCentsForProduct(line.productId, priceMinById);
    return unit * line.qty;
  }

  /**
   * Keeps `#price-{sectionId}` in sync with zwischensumme (same cents + same sale/compare rules).
   * Preserves `.f-price__unit-wrapper` from SSR when present.
   */
  function syncMainPriceWithZwischensumme(
    productInfo,
    sectionId,
    fmt,
    mf,
    saleTotal,
    compareTotal,
    setDiscountAmount,
    useFromTotals,
    fromPrefix
  ) {
    if (sectionId == null || sectionId === '') return;
    const host = document.getElementById(`price-${sectionId}`);
    if (!host) return;

    const prevUnit = host.querySelector('.f-price__unit-wrapper');
    const unitHtml = prevUnit ? prevUnit.outerHTML : '<div class="f-price__unit-wrapper hidden"></div>';

    const onSale = setDiscountAmount > 0 || compareTotal > saleTotal;
    const saleStr = useFromTotals ? formatZwFromTotal(fromPrefix, saleTotal, fmt, mf) : fmt(saleTotal, mf);
    const compareStr = fmt(compareTotal, mf);

    let rootClass = 'f-price f-price--large';
    if (onSale) rootClass += ' f-price--on-sale';

    let inner;
    if (onSale) {
      inner =
        `<div class="${rootClass}">` +
        '<div class="f-price__regular">' +
        '<span class="visually-hidden visually-hidden--inline"></span>' +
        `<span class="f-price-item f-price-item--regular">${saleStr}</span>` +
        '</div>' +
        '<div class="f-price__sale">' +
        '<span class="visually-hidden visually-hidden--inline"></span>' +
        `<span class="f-price-item f-price-item--sale">${saleStr}</span>` +
        '<span class="visually-hidden visually-hidden--inline"></span>' +
        `<span class="f-price-item f-price-item--regular"><s>${compareStr}</s></span>` +
        '</div>' +
        unitHtml +
        '</div>';
    } else {
      inner =
        `<div class="${rootClass}">` +
        '<div class="f-price__regular">' +
        '<span class="visually-hidden visually-hidden--inline"></span>' +
        `<span class="f-price-item f-price-item--regular">${saleStr}</span>` +
        '</div>' +
        '<div class="f-price__sale">' +
        '<span class="visually-hidden visually-hidden--inline"></span>' +
        `<span class="f-price-item f-price-item--sale">${saleStr}</span>` +
        '<span class="visually-hidden visually-hidden--inline"></span>' +
        '<span class="f-price-item f-price-item--regular"><s></s></span>' +
        '</div>' +
        unitHtml +
        '</div>';
    }

    host.innerHTML = inner;
  }

  /**
   * Zwischensumme: main bundle product + first set product + checked optionals; prices/qty from current variant + inline qty.
   */
  function updatePdpSetZwischensumme(form) {
    const cfgEl = form.querySelector('script[data-pdp-set-config]');
    const productInfo = getProductInfoForBundleForm(form);
    const root = productInfo?.querySelector('[data-pdp-set-zwischensumme]');
    if (!cfgEl?.textContent || !root) return;

    let cfg;
    try {
      cfg = JSON.parse(cfgEl.textContent);
    } catch (e) {
      return;
    }

    const {
      sectionId,
      firstSetProductId,
      firstVariantFallback,
      optionalProductIds = [],
      omitMainProductFromZwischensumme = false,
      requiredSetProductIds = [],
      setDiscountAmount: setDiscountAmountRaw = 0,
    } = cfg;
    const setDiscountAmount = Math.max(0, Number(setDiscountAmountRaw) || 0);
    const mainProductId = productInfo?.dataset?.productId;
    const metaEl = root.querySelector('[data-pdp-set-zwischensumme-meta]');
    let titles = {};
    let fromPrefix = '';
    let priceMinById = {};
    if (metaEl?.textContent) {
      try {
        const meta = JSON.parse(metaEl.textContent);
        titles = meta.titles || {};
        fromPrefix = String(meta.fromPrefix ?? '').trim();
        priceMinById = meta.priceMinById || {};
      } catch (e) {}
    }

    const fmt = window.FoxTheme?.Currency?.formatMoney;
    const mf = window.FoxTheme?.settings?.moneyFormat;
    if (typeof fmt !== 'function') return;

    const firstTwoPickers = getFirstTwoSetPickers(productInfo, cfg);
    const requiredGateIds = (requiredSetProductIds || []).map(String).slice(0, 2);
    const bothFirstTwoResolved =
      firstTwoPickers.length >= 2 &&
      firstTwoPickers.every((vs) =>
        wePickerHasResolvedVariant(vs, String(vs.dataset?.productId || ''), cfg)
      );

    const useFromTotals = !bothFirstTwoResolved;

    const lines = [];

    if (!omitMainProductFromZwischensumme && mainProductId) {
      const vMain = getResolvedVariant(sectionId, mainProductId, null, productInfo);
      const qMain = getInlineQuantityForProduct(sectionId, mainProductId);
      if (vMain) {
        lines.push({
          productId: String(mainProductId),
          title: titles[String(mainProductId)] || '',
          variant: vMain,
          qty: qMain,
          gated: false,
          resolved: true,
          priceMinCents: 0,
        });
      }
    }

    if (omitMainProductFromZwischensumme && Array.isArray(requiredSetProductIds) && requiredSetProductIds.length > 0) {
      requiredSetProductIds.forEach((pidRaw) => {
        const pid = String(pidRaw);
        const gated = requiredGateIds.includes(pid);
        const vs = getVariantSelectsEl(sectionId, pid, productInfo);
        const resolved = !gated || wePickerHasResolvedVariant(vs, pid, cfg);
        const q = getInlineQuantityForProduct(sectionId, pid);
        const priceMinCents = minPriceCentsForProduct(pid, priceMinById);
        const fallback =
          String(pid) === String(firstSetProductId) ? firstVariantFallback : getDefaultVariantIdFromDom(pid, productInfo);
        if (!resolved) {
          if (priceMinCents <= 0) return;
          lines.push({
            productId: pid,
            title: titles[pid] || titles[String(pid)] || '',
            variant: null,
            qty: q,
            gated,
            resolved: false,
            priceMinCents,
          });
        } else {
          const v = getResolvedVariant(sectionId, pid, fallback, productInfo);
          if (!v) return;
          lines.push({
            productId: pid,
            title: titles[pid] || titles[String(pid)] || '',
            variant: v,
            qty: q,
            gated,
            resolved: true,
            priceMinCents,
          });
        }
      });
    } else {
      const pid = String(firstSetProductId);
      const gated = requiredGateIds.includes(pid);
      const vs = getVariantSelectsEl(sectionId, pid, productInfo);
      const resolved = !gated || wePickerHasResolvedVariant(vs, pid, cfg);
      const qFirst = getInlineQuantityForProduct(sectionId, firstSetProductId);
      const priceMinCents = minPriceCentsForProduct(pid, priceMinById);
      if (!resolved) {
        if (priceMinCents > 0) {
          lines.push({
            productId: pid,
            title: titles[pid] || titles[String(pid)] || '',
            variant: null,
            qty: qFirst,
            gated,
            resolved: false,
            priceMinCents,
          });
        }
      } else {
        const vFirst = getResolvedVariant(sectionId, firstSetProductId, firstVariantFallback, productInfo);
        if (vFirst) {
          lines.push({
            productId: pid,
            title: titles[pid] || titles[String(pid)] || '',
            variant: vFirst,
            qty: qFirst,
            gated,
            resolved: true,
            priceMinCents,
          });
        }
      }
    }

    optionalProductIds.forEach((pidRaw) => {
      const pid = String(pidRaw);
      const cb = productInfo.querySelector(
        `input.product-set-picker__toggle[data-set-optional-product-id="${pid}"]`
      );
      if (!cb?.checked) return;
      const v = getResolvedVariant(sectionId, pid, getDefaultVariantIdFromDom(pid, productInfo), productInfo);
      const q = getInlineQuantityForProduct(sectionId, pid);
      if (v) {
        lines.push({
          productId: pid,
          title: titles[pid] || titles[String(pid)] || '',
          variant: v,
          qty: q,
          gated: false,
          resolved: true,
          priceMinCents: minPriceCentsForProduct(pid, priceMinById),
        });
      }
    });

    let lineSaleSum = 0;
    let lineCompareSum = 0;
    lines.forEach((line) => {
      lineSaleSum += lineSaleCents(line, priceMinById);
      lineCompareSum += lineCompareCents(line, priceMinById);
    });

    let saleTotal = lineSaleSum;
    let compareTotal = lineCompareSum;

    if (setDiscountAmount > 0) {
      compareTotal = lineSaleSum;
      saleTotal = Math.floor((lineSaleSum * (100 - setDiscountAmount)) / 100);
    }

    const compareEl = root.querySelector('.pdp-set-zwischensumme__compare');
    const saleEl = root.querySelector('.pdp-set-zwischensumme__sale');
    const badgeEl = root.querySelector('.pdp-set-zwischensumme__badge');
    const breakdownEl = root.querySelector('.pdp-set-zwischensumme__breakdown');

    if (saleEl) {
      saleEl.textContent = useFromTotals ? formatZwFromTotal(fromPrefix, saleTotal, fmt, mf) : fmt(saleTotal, mf);
    }

    if (setDiscountAmount > 0) {
      if (compareEl) {
        compareEl.textContent = fmt(compareTotal, mf);
        compareEl.hidden = false;
      }
      if (badgeEl) {
        badgeEl.textContent = `-${setDiscountAmount}%`;
        badgeEl.hidden = false;
      }
    } else if (compareTotal > saleTotal) {
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
        const cents = lineSaleCents(line, priceMinById);
        const money = fmt(cents, mf);
        const inner =
          line.gated && !line.resolved && fromPrefix ? formatZwFromTotal(fromPrefix, cents, fmt, mf) : money;
        return `${line.qty}x ${line.title} (${inner})`;
      });
      breakdownEl.textContent = parts.join(' + ');
    }

    syncMainPriceWithZwischensumme(
      productInfo,
      sectionId,
      fmt,
      mf,
      saleTotal,
      compareTotal,
      setDiscountAmount,
      useFromTotals,
      fromPrefix
    );
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

    const { sectionId, firstSetProductId, firstVariantFallback } = cfg;
    const productInfo = getProductInfoForBundleForm(form);
    const submitBtn =
      form.querySelector(`#ProductSubmitButton-${sectionId}`) ||
      form.querySelector('.product-form__submit[type="submit"]');
    if (!submitBtn) return;

    if (!productInfo) return;

    /** Only the first two set pickers gate the add-to-cart button. */
    const firstTwoPickers = getFirstTwoSetPickers(productInfo, cfg);
    const requiredPickerCount = Math.min(2, (cfg.requiredSetProductIds || []).length || 2);

    const toCheck = firstTwoPickers.map((vs) => {
      const pid = String(vs.dataset.productId);
      const fallback =
        String(pid) === String(firstSetProductId) ? firstVariantFallback : getDefaultVariantIdFromDom(pid, productInfo);
      return getResolvedVariant(sectionId, pid, fallback, productInfo);
    });

    const allPurchasable =
      firstTwoPickers.length >= requiredPickerCount &&
      toCheck.length >= requiredPickerCount &&
      toCheck.every(isVariantPurchasable);

    const soldOut =
      typeof FoxTheme !== 'undefined' && FoxTheme.variantStrings && FoxTheme.variantStrings.soldOut
        ? FoxTheme.variantStrings.soldOut
        : 'Sold out';
    const addToCart =
      typeof FoxTheme !== 'undefined' && FoxTheme.variantStrings && FoxTheme.variantStrings.addToCart
        ? FoxTheme.variantStrings.addToCart
        : 'Add to cart';
    const selectVariant =
      typeof FoxTheme !== 'undefined' &&
      FoxTheme.variantStrings &&
      String(FoxTheme.variantStrings.select_variant_text || '').trim()
        ? String(FoxTheme.variantStrings.select_variant_text).trim()
        : 'Select variant';

    const span = submitBtn.querySelector('span');

    let incomplete = firstTwoPickers.length < requiredPickerCount;
    firstTwoPickers.forEach((vs) => {
      const pid = String(vs.dataset.productId);
      if (!wePickerHasResolvedVariant(vs, pid, cfg)) incomplete = true;
    });

    if (incomplete) {
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
      const errWrap = form.querySelector('.product-form__error-message-wrapper');
      const errMsg = form.querySelector('.product-form__error-message');
      if (errWrap) errWrap.hidden = true;
      if (errMsg) {
        errMsg.hidden = true;
        errMsg.textContent = '';
      }
    }
  }

  function buildSetBundleLines(productInfo, cfg) {
    const { sectionId, firstSetProductId, firstVariantFallback } = cfg;
    const lines = [];
    const pickers = getSetBundlePickersToValidate(productInfo, cfg);

    const pushLine = (pid) => {
      const fallback =
        String(pid) === String(firstSetProductId) ? firstVariantFallback : getDefaultVariantIdFromDom(pid, productInfo);
      const vid = getVariantIdForProduct(sectionId, pid, fallback, productInfo);
      if (vid) {
        lines.push({
          id: vid,
          quantity: getInlineQuantityForProduct(sectionId, pid),
        });
      }
    };

    if (pickers.length > 0) {
      pickers.forEach((vs) => pushLine(String(vs.dataset.productId)));
      return lines;
    }

    // Quick view can fire bind/submit before variant-selects are in the DOM — fall back to config ids.
    (cfg.requiredSetProductIds || []).forEach((pid) => pushLine(String(pid)));

    (cfg.optionalProductIds || []).forEach((pid) => {
      const pidStr = String(pid);
      const cb = productInfo.querySelector(
        `input.product-set-picker__toggle[data-set-optional-product-id="${pidStr}"]`
      );
      if (cb && !cb.checked) return;
      pushLine(pidStr);
    });

    return lines;
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

    root.replaceChildren();

    const productInfo = getProductInfoForBundleForm(form);
    if (!productInfo) return;

    const lines = buildSetBundleLines(productInfo, cfg);

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
      const setPropInput = document.createElement('input');
      setPropInput.type = 'hidden';
      setPropInput.name = `items[${n}][properties][_set]`;
      setPropInput.value = 'true';
      root.appendChild(setPropInput);
    });
  }

  function refresh(form) {
    syncSetCartLineItems(form);
    updatePdpSetZwischensumme(form);
    updatePdpSetSubmitButton(form);
  }

  /** Resolve `product-info` for portaled we-select radios (under `body`) via `data-vs-root`. */
  function getProductInfoForBundleEventTarget(target) {
    if (!target) return null;
    let pi = target.closest?.('product-info');
    if (pi) return pi;

    const bundleForm = target.closest?.('form.pdp-set-bundle');
    if (bundleForm) {
      pi = getProductInfoForBundleForm(bundleForm);
      if (pi) return pi;
    }

    const vid = target.dataset?.vsRoot || target.getAttribute?.('data-vs-root');
    if (vid) {
      const vs = document.getElementById(vid);
      return vs?.closest?.('product-info') || null;
    }
    const nm = target.getAttribute?.('name') || '';
    if (target.type === 'radio' && (nm.startsWith('vs-') || nm.startsWith('quantity-'))) {
      try {
        const esc =
          typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nm) : nm.replace(/"/g, '\\"');
        const one = document.querySelector(`input[type="radio"][name="${esc}"]`);
        const details = one?.closest?.('details.we-select-container');
        const vs = details?.closest?.('variant-selects');
        return vs?.closest?.('product-info') || null;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function collectBundleFormsForProductInfo(productInfo) {
    const forms = new Set();
    if (!productInfo) return forms;

    productInfo.querySelectorAll('form.pdp-set-bundle').forEach((form) => forms.add(form));

    const modal = productInfo.closest('quick-view-modal');
    if (modal) {
      modal.querySelectorAll('form.pdp-set-bundle').forEach((form) => forms.add(form));
    }

    return forms;
  }

  function collectBundleFormsFromScope(scope) {
    const forms = new Set();
    if (!scope) return forms;

    if (scope.matches?.('form.pdp-set-bundle')) {
      forms.add(scope);
      return forms;
    }

    if (scope.matches?.('product-info')) {
      collectBundleFormsForProductInfo(scope).forEach((form) => forms.add(form));
      return forms;
    }

    const drawerInner = scope.closest?.('.drawer__inner') || scope;
    drawerInner.querySelectorAll?.('form.pdp-set-bundle')?.forEach((form) => forms.add(form));

    const productInfo =
      scope.querySelector?.('product-info') || scope.closest?.('product-info');
    if (productInfo) {
      collectBundleFormsForProductInfo(productInfo).forEach((form) => forms.add(form));
    }

    return forms;
  }

  function refreshActiveBundleForms() {
    const forms = new Set();
    document
      .querySelectorAll('quick-view-modal[open] form.pdp-set-bundle')
      .forEach((form) => forms.add(form));
    document.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
      if (!form.closest('quick-view-modal')) forms.add(form);
    });
    forms.forEach((form) => refresh(form));
  }

  function refreshBundleFormsFromEvent(event) {
    const detail = event?.detail || {};

    if (detail.form?.classList?.contains('pdp-set-bundle')) {
      refresh(detail.form);
      return;
    }

    if (detail.sectionId) {
      const matches = document.querySelectorAll(
        `product-info[data-section="${detail.sectionId}"]`
      );
      const forms = new Set();
      matches.forEach((pi) => {
        collectBundleFormsForProductInfo(pi).forEach((form) => forms.add(form));
      });
      if (forms.size > 0) {
        forms.forEach((form) => refresh(form));
        return;
      }
    }

    const scope = detail.root || detail.productInfo;
    if (scope) {
      const forms = collectBundleFormsFromScope(scope);
      if (forms.size > 0) {
        forms.forEach((form) => refresh(form));
        return;
      }
    }

    refreshActiveBundleForms();
  }

  function refreshPdpSetBundleFormsForTarget(target) {
    const pi = getProductInfoForBundleEventTarget(target);
    if (!pi) return;

    const forms = collectBundleFormsForProductInfo(pi);
    forms.forEach((form) => refresh(form));
  }

  function bindForm(form) {
    if (!form.classList.contains('pdp-set-bundle')) return;
    if (form.dataset.pdpSetBundleSubmitBound === 'true') return;
    form.dataset.pdpSetBundleSubmitBound = 'true';

    refresh(form);

    form.addEventListener('submit', () => refresh(form), { capture: true });
  }

  function bindAllBundleForms(root) {
    const scope = root || document;
    scope.querySelectorAll('form.pdp-set-bundle').forEach(bindForm);
  }

  function bindPdpSetBundleChangeDelegation() {
    if (window[DELEGATION_KEY]) return;
    window[DELEGATION_KEY] = true;
    const onInteraction = (e) => {
      refreshPdpSetBundleFormsForTarget(e.target);
    };
    document.addEventListener('change', onInteraction, true);
    document.addEventListener('input', onInteraction, true);
  }

  function bindGlobalListenersOnce() {
    if (window[LISTENERS_KEY]) return;
    window[LISTENERS_KEY] = true;

    document.addEventListener('pdp-set:bind-bundle-forms', (event) => {
      const root = event.detail?.root;
      bindAllBundleForms(root || document);
    });

    document.addEventListener('pdp-set:refresh-submit', refreshBundleFormsFromEvent);

    if (typeof FoxTheme !== 'undefined' && FoxTheme.pubsub && FoxTheme.pubsub.PUB_SUB_EVENTS) {
      if (!window[PUBSUB_KEY]) {
        window[PUBSUB_KEY] = true;
        FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, (event) => {
          if (event?.data?.sectionId) {
            refreshBundleFormsFromEvent({
              detail: { sectionId: event.data.sectionId },
            });
            return;
          }
          refreshActiveBundleForms();
        });
      }
    }
  }

  function init() {
    bindPdpSetBundleChangeDelegation();
    bindAllBundleForms();
    bindGlobalListenersOnce();

    window.refreshPdpSetBundleForms = refreshActiveBundleForms;

    window.refreshPdpSetBundleFormsInScope = function (scope) {
      const forms = collectBundleFormsFromScope(scope);
      if (forms.size > 0) {
        forms.forEach((form) => refresh(form));
      } else {
        refreshActiveBundleForms();
      }
    };

    window.syncPdpSetBundleForm = function (form) {
      if (!form?.classList?.contains('pdp-set-bundle')) return;
      bindForm(form);
      refresh(form);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

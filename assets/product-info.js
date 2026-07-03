if (!customElements.get('product-info')) {
  customElements.define(
    'product-info',
    class ProductInfo extends HTMLElement {
      abortController = undefined;
      /** Cleared whenever gallery updates so stale retries cannot re-apply an older variant. */
      timer = undefined;
      /** Mobile PDP: restore window scroll after variant section fetch (gallery reflow can jump the viewport). */
      _pendingScrollRestoreY = null;
      /** Last variant used for gallery color filtering (quick view: detect color-only changes). */
      _lastGalleryVariant = null;
      pendingRequestUrl = null;
      preProcessHtmlCallbacks = [];
      postProcessHtmlCallbacks = [];
      cartUpdateUnsubscriber = undefined;

      constructor() {
        super();
      }

      get variantSelectors() {
        return this.querySelector('variant-selects');
      }

      get productId() {
        return this.getAttribute('data-product-id');
      }

      get sectionId() {
        return this.dataset.originalSection || this.dataset.section;
      }

      get pickupAvailability() {
        return this.querySelector(`pickup-availability`);
      }

      get productForm() {
        return this.querySelector('form[is="product-form"]');
      }

      get quantityInput() {
        return this.querySelector('quantity-input input');
      }

      /**
       * Bundle (set) PDP: gallery uses the main product variant; the first `variant-selects` in the DOM
       * is often an embedded line-product picker whose `data-selected-variant` is a line variant — wrong
       * `optionN` keys for `applyColorAltFilter` on the bundle media gallery (including metafield images).
       */
      getBundleVariantForGallery(productInfoNode) {
        const variants = this._getMainProductVariantsFromDom();
        if (!variants?.length) return null;
        const sid = this.dataset?.section;
        if (!sid) return null;
        const form =
          productInfoNode.querySelector(`#product-form-${sid}`) ||
          productInfoNode.querySelector('form[is="product-form"]');
        const input = form?.querySelector?.('input[name="id"].product-variant-id');
        const vid = input?.value?.trim();
        if (!vid) return null;
        return variants.find((x) => String(x.id) === String(vid)) || null;
      }

      /**
       * Selected variant from [data-selected-variant], or first available from [data-pdp-bootstrap-variant]
       * when the picker is still pending (null JSON) or as fallback if no variant is in the URL.
       */
      getInitialVariantForGallery(productInfoNode) {
        if (this._isPdpSetBundleForm()) {
          const bundleVariant = this.getBundleVariantForGallery(productInfoNode);
          if (bundleVariant) return bundleVariant;
        }
        const selected = this.getSelectedVariant(productInfoNode);
        if (selected) return selected;
        const root = productInfoNode.querySelector('variant-selects');
        const raw = root?.querySelector('[data-pdp-bootstrap-variant]')?.textContent?.trim();
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }

      connectedCallback() {
        this.initializeProductSwapUtility();

        /**
         * Document capture: embedded set pickers share one form; mobile we-select portaled radios
         * do not bubble through variant-selects.
         */
        document.addEventListener('change', this._onDocumentOptionChange, true);
        document.addEventListener('change', this._onMainPdpQtyChange, true);

        this.initQuantityHandlers();

        this.currentVariant = this.getInitialVariantForGallery(this);
        if (this.currentVariant) {
          this.updateMedia(this.currentVariant);
        }
        requestAnimationFrame(() => {
          if (this._isPdpSetBundleForm()) {
            const firstSetId = this._getPdpSetFirstSetProductId();
            if (firstSetId) {
              const vs = document.getElementById(`variant-selects-${this.dataset.section}-${firstSetId}`);
              if (vs) this.syncMainMediaGalleryFromFirstSetPicker(vs);
            }
          }
          this._syncFormLineItems();
          if (!this._isPdpSetBundleForm()) {
            this._syncMainPdpPriceDisplay(this.currentVariant);
          }
        });
      }

      disconnectedCallback() {
        document.removeEventListener('change', this._onDocumentOptionChange, true);
        document.removeEventListener('change', this._onMainPdpQtyChange, true);
        this.cartUpdateUnsubscriber?.();
      }

      /**
       * This product's add-to-cart form (avoids wrong `input.form` when duplicate ids exist on the page).
       */
      getScopedProductForm() {
        const sid = this.dataset?.section;
        if (!sid) return this.querySelector('form[is="product-form"]');
        return (
          this.querySelector(`#product-form-${sid}`) || this.querySelector('form[is="product-form"]')
        );
      }

      _syncFormLineItems() {
        if (typeof window.syncProductFormLineItems === 'function') {
          window.syncProductFormLineItems(this);
        }
      }

      _onDocumentOptionChange = (e) => {
        const t = e.target;
        if (!t) return;
        if (t.closest?.('.pdp-inline-quantity')) return;
        if (t.closest?.('.we-quantity-selector')) return;
        if (t.hasAttribute?.('data-pdp-inline-qty-value')) return;
        if (t.tagName === 'SELECT' && t.getAttribute?.('name') === 'quantity') return;
        if (t.type !== 'radio' && t.tagName !== 'SELECT') return;
        if (t.tagName === 'SELECT') {
          const nm = t.getAttribute('name') || '';
          if (!nm.startsWith('options')) return;
        }
        if (t.type === 'radio') {
          const nm = t.getAttribute('name') || '';
          if (nm.startsWith('qty-inline-')) return;
          // Portaled to `body`; `closest('.we-quantity-selector')` no longer matches.
          if (nm.startsWith('quantity-')) return;
        }

        let vs = t.closest('variant-selects');
        const vsRootId = t.dataset?.vsRoot || t.getAttribute?.('data-vs-root');
        if (!vs && vsRootId) {
          vs = document.getElementById(vsRootId);
        }

        const scopedForm = this.getScopedProductForm();
        const form = scopedForm || t.form;
        /** Mobile we-select moves radios under `body`; WebKit often leaves `input.form` null even with `form="…"`. */
        const portaledOptionRadio =
          t.type === 'radio' &&
          vs?.tagName === 'VARIANT-SELECTS' &&
          this.contains(vs);

        if (!portaledOptionRadio && (!form || !this.contains(form))) return;

        if (!vs || !this.contains(vs)) return;

        const target =
          t.tagName === 'SELECT' && t.selectedOptions?.length ? t.selectedOptions[0] : t;
        if (!target) return;

        this.handleOptionValueChange({
          data: {
            event: e,
            target,
            selectedOptionValues: vs.selectedOptionValues,
          },
        });
      };

      initializeProductSwapUtility() {
        this.postProcessHtmlCallbacks.push((newNode) => {
          window?.Shopify?.PaymentButton?.init();
          window?.ProductModel?.loadShopifyXR();
          if (
            typeof window.initWeVariantDropdownMeta === 'function' &&
            newNode?.matches?.('variant-selects')
          ) {
            window.initWeVariantDropdownMeta(newNode);
          }
          if (typeof window.syncWeQuantitySelectorCap === 'function' && newNode?.matches?.('variant-selects')) {
            window.syncWeQuantitySelectorCap(newNode);
          }
        });
      }

      /**
       * Mobile we-select portals option radios to `document.body`; they are no longer under `.product-form__input`.
       * Must ignore inline quantity radios (`data-we-qty-selector`) in the same row as `we-product-variant-picker`.
       */
      findCheckedOptionRadio(wrap) {
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
        const optDetails =
          wrap.querySelector(
            'details.we-select-container[data-radio-group-name]:not([data-radio-group-name^="quantity-"])'
          ) || wrap.querySelector('details.we-select-container');
        const groupName = optDetails?.dataset?.radioGroupName;
        if (!groupName || String(groupName).startsWith('quantity-')) return null;
        const esc =
          typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(groupName) : groupName.replace(/"/g, '\\"');
        return document.querySelector(
          `input[type="radio"][name="${esc}"]:checked:not([data-pdp-inline-qty-value]):not([data-we-qty-selector])`
        );
      }

      _escapeAttrSelector(value) {
        return typeof CSS !== 'undefined' && CSS.escape
          ? CSS.escape(value)
          : String(value).replace(/"/g, '\\"');
      }

      /** Checked radio with this `name` (works when inputs are portaled under `body`). */
      _findCheckedRadioByName(name) {
        if (!name || typeof document === 'undefined') return null;
        const esc = this._escapeAttrSelector(name);
        return document.querySelector(`input[type="radio"][name="${esc}"]:checked`);
      }

      /**
       * Snapshot we-select option groups + inline quantity before `variant-selects` is replaced (e.g. color swatch).
       */
      _captureWePickerUiState(variantSelectsEl) {
        if (!variantSelectsEl?.querySelectorAll) return null;
        const state = { groups: [], quantity: null };
        variantSelectsEl
          .querySelectorAll('details.we-select-container[data-radio-group-name]')
          .forEach((det) => {
            const name = det.dataset.radioGroupName;
            if (!name) return;
            if (name.startsWith('quantity-')) {
              const checked = this._findCheckedRadioByName(name);
              if (checked) {
                state.quantity = checked.value;
              } else {
                const summary = det.querySelector('.we-select-container__summary');
                const t = summary?.textContent?.trim();
                if (t && /^\d+$/.test(t)) state.quantity = t;
              }
              return;
            }
            const checked = this._findCheckedRadioByName(name);
            if (checked) state.groups.push({ name, value: checked.value });
          });
        if (!state.groups.length && state.quantity == null) return null;
        return state;
      }

      _applyRadioNameValue(name, value) {
        const esc = this._escapeAttrSelector(name);
        const inputs = document.querySelectorAll(`input[type="radio"][name="${esc}"]`);
        const want = this.normOptionValue(value);
        for (const input of inputs) {
          if (this.normOptionValue(input.value) !== want) continue;
          // Sold-out options use class="disabled" for styling only — still a valid selection.
          if (input.disabled) return false;
          input.checked = true;
          return true;
        }
        return false;
      }

      _getMainOptionInputGroups(vs) {
        if (!vs) return [];
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
        return groups;
      }

      _getOptionGroupPosition(wrap) {
        if (!wrap) return 0;
        const probe =
          wrap.querySelector('input[type="radio"][data-option-value-id]') ||
          wrap.querySelector('select[name^="options"] option[data-option-value-id]');
        const radioId = probe?.id || '';
        const oMatch = radioId.match(/-o(\d+)-/i);
        if (oMatch) return parseInt(oMatch[1], 10);
        const posMatch = radioId.match(/-(\d+)-\d+$/);
        if (posMatch) return parseInt(posMatch[1], 10);
        const selectEl = wrap.querySelector('select[name^="options"]');
        if (selectEl?.id) {
          const selMatch = selectEl.id.match(/-(\d+)$/);
          if (selMatch) return parseInt(selMatch[1], 10) + 1;
        }
        return 0;
      }

      _applyVariantOptionsToMainPicker(variant, vs) {
        if (!variant || !vs) return;

        const optionValues = Array.isArray(variant.options)
          ? variant.options.filter((x) => x != null && String(x).length)
          : [variant.option1, variant.option2, variant.option3].filter((x) => x != null && String(x).length);

        for (const wrap of this._getMainOptionInputGroups(vs)) {
          const pos = this._getOptionGroupPosition(wrap);
          const val = pos > 0 ? optionValues[pos - 1] : optionValues[0];
          if (val == null || !String(val).length) continue;

          const selectEl = wrap.querySelector('select[name^="options"]');
          if (selectEl) {
            const opt = Array.from(selectEl.options).find(
              (o) => this.normOptionValue(o.value) === this.normOptionValue(val)
            );
            if (opt) selectEl.value = opt.value;
            continue;
          }

          const details = wrap.querySelector(
            'details.we-select-container[data-radio-group-name]:not([data-radio-group-name^="quantity-"])'
          );
          const groupName = details?.dataset?.radioGroupName;
          if (groupName) this._applyRadioNameValue(groupName, val);
        }
      }

      /**
       * Sticky ATC (native variant select) → main we-select / variant-selects.
       */
      syncMainPickerFromVariant(variant) {
        if (!variant?.id) return false;
        const vs = this.variantSelectors;
        if (!vs) return false;

        this._applyVariantOptionsToMainPicker(variant, vs);

        this._forceSectionVariantId = String(variant.id);

        if (typeof window.initWeDetailsSelects === 'function') {
          window.initWeDetailsSelects(vs);
        }

        let changeTarget = null;
        for (const wrap of this._getMainOptionInputGroups(vs)) {
          const checked = this.findCheckedOptionRadio(wrap);
          if (checked) changeTarget = checked;
        }

        if (!changeTarget) return false;

        const target =
          changeTarget.tagName === 'SELECT' && changeTarget.selectedOptions?.length
            ? changeTarget.selectedOptions[0]
            : changeTarget;

        this.handleOptionValueChange({
          data: {
            event: { target: changeTarget },
            target,
            selectedOptionValues: vs.selectedOptionValues,
          },
        });
        return true;
      }

      _restoreWePickerUiState(variantSelectsEl, state) {
        if (!variantSelectsEl || !state) return;
        for (const { name, value } of state.groups) {
          this._applyRadioNameValue(name, value);
        }
        if (state.quantity != null && String(state.quantity).length) {
          const qtyDetails = variantSelectsEl.querySelector(
            '.we-quantity-selector details.we-select-container[data-radio-group-name]'
          );
          const qName = qtyDetails?.dataset?.radioGroupName;
          if (qName) this._applyRadioNameValue(qName, String(state.quantity));
        }
        if (typeof window.initWeDetailsSelects === 'function') {
          window.initWeDetailsSelects(variantSelectsEl);
        }
      }

      normOptionValue(s) {
        return String(s)
          .trim()
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ');
      }

      /**
       * Shopify Liquid sets product.selected_variant from the `variant` query param, not `option_values` alone.
       * Resolve the matching variant id from current picker UI so section fetches return correct SSR (summary + radios).
       */
      resolveVariantIdFromSelectedOptions(productInfo, variantSelectsEl) {
        if (!variantSelectsEl) return null;
        const pickerProductId = variantSelectsEl.dataset?.productId;
        let scriptEl = null;
        if (pickerProductId && String(pickerProductId) !== String(this.productId)) {
          scriptEl = document.querySelector(`script[data-set-product-variants="${pickerProductId}"]`);
        } else {
          scriptEl = productInfo.querySelector('script[data-product-variants-for-url]');
        }
        if (!scriptEl?.textContent?.trim()) return null;
        let variants;
        try {
          variants = JSON.parse(scriptEl.textContent.trim());
        } catch {
          return null;
        }
        if (!Array.isArray(variants) || !variants.length) return null;

        let groups = this._getMainOptionInputGroups(variantSelectsEl);
        if (!groups.length) return null;

        const selected = [];
        for (const wrap of groups) {
          const selectEl = wrap.querySelector('select[name^="options"]');
          if (selectEl) {
            const opt = selectEl.selectedOptions?.[0];
            if (!opt) return null;
            selected.push(String(opt.value));
            continue;
          }
          const checked = this.findCheckedOptionRadio(wrap);
          if (!checked) return null;
          selected.push(String(checked.value));
        }

        const matchesOptions = (v, sel) => {
          if (Array.isArray(v.options) && v.options.length > 0) {
            const vo = v.options.filter((x) => x != null && String(x).length);
            if (vo.length !== sel.length) return false;
            for (let i = 0; i < sel.length; i++) {
              if (this.normOptionValue(vo[i]) !== this.normOptionValue(sel[i])) return false;
            }
            return true;
          }
          const vo = [v.option1, v.option2, v.option3].filter((x) => x != null && String(x).length);
          if (vo.length !== sel.length) return false;
          for (let i = 0; i < sel.length; i++) {
            if (this.normOptionValue(vo[i]) !== this.normOptionValue(sel[i])) return false;
          }
          return true;
        };

        const found = variants.find((v) => matchesOptions(v, selected));
        return found?.id != null ? String(found.id) : null;
      }

      /**
       * PDP set bundles: main product has no variant picker, but gallery should follow the same color as the
       * first set product. Map the color option value from that picker to a main-product variant and update media.
       */
      _getPdpSetFirstSetProductId() {
        const form = document.getElementById(`product-form-${this.dataset.section}`);
        const cfgEl = form?.querySelector?.('script[data-pdp-set-config]');
        if (!cfgEl?.textContent?.trim()) return null;
        try {
          const cfg = JSON.parse(cfgEl.textContent);
          return cfg.firstSetProductId != null ? String(cfg.firstSetProductId) : null;
        } catch {
          return null;
        }
      }

      _getMainProductVariantsFromDom() {
        const scriptEl = this.querySelector('script[data-product-variants-for-url]');
        if (!scriptEl?.textContent?.trim()) return null;
        try {
          const v = JSON.parse(scriptEl.textContent.trim());
          return Array.isArray(v) ? v : null;
        } catch {
          return null;
        }
      }

      /**
       * Option values in order (size, color, …), allowing empty strings for groups not yet chosen.
       */
      _getSelectedOptionValuesFromVariantSelects(vs) {
        if (!vs?.querySelectorAll) return [];
        const selected = [];
        for (const wrap of this._getMainOptionInputGroups(vs)) {
          const selectEl = wrap.querySelector('select[name^="options"]');
          if (selectEl) {
            const opt = selectEl.selectedOptions?.[0];
            selected.push(opt?.value ?? '');
            continue;
          }
          const checked = this.findCheckedOptionRadio(wrap);
          selected.push(checked?.value ?? '');
        }
        return selected;
      }

      /**
       * True when at least one product option row has no value yet (e.g. we-select placeholder, no radio checked).
       * Distinguished from “all options chosen but no Shopify variant”.
       */
      _isVariantSelectionIncomplete(vs) {
        const vals = this._getSelectedOptionValuesFromVariantSelects(vs);
        if (!vals.length) return false;
        return vals.some((v) => !this.normOptionValue(v));
      }

      _isPasPriceMode(vs) {
        const root = vs || this.variantSelectors;
        return root?.dataset?.wePdpPreisNachGrose === 'true';
      }

      _getPasSizeOptionGroup(vs) {
        if (!vs?.querySelectorAll) return null;
        const sizePos = parseInt(vs.dataset.weSizeOptionPosition, 10) || 0;
        if (sizePos < 1) return null;

        for (const wrap of vs.querySelectorAll(':scope > .product-form__input')) {
          const probe =
            wrap.querySelector('input[type="radio"][data-option-value-id]') ||
            wrap.querySelector('select[name^="options"] option[data-option-value-id]');
          if (!probe) continue;

          const radioId = probe.id || '';
          const idMatch = radioId.match(/-(\d+)-\d+$/);
          if (idMatch && parseInt(idMatch[1], 10) === sizePos) return wrap;

          const selectEl = wrap.querySelector('select[name^="options"]');
          if (selectEl) {
            const opt = selectEl.selectedOptions?.[0];
            const optId = opt?.id || '';
            const optMatch = optId.match(/-(\d+)-\d+$/);
            if (optMatch && parseInt(optMatch[1], 10) === sizePos) return wrap;
          }
        }
        return null;
      }

      _getPasSizeSelectedValue(vs) {
        const wrap = this._getPasSizeOptionGroup(vs);
        if (!wrap) return '';
        const selectEl = wrap.querySelector('select[name^="options"]');
        if (selectEl) {
          const opt = selectEl.selectedOptions?.[0];
          return opt?.value ?? '';
        }
        const checked = this.findCheckedOptionRadio(wrap);
        return checked?.value ?? '';
      }

      _isPasSizeSelected(vs) {
        return Boolean(this.normOptionValue(this._getPasSizeSelectedValue(vs)));
      }

      _resolvePasPriceVariant(resolvedVariant, vs, variants) {
        if (resolvedVariant != null) {
          const cents = resolvedVariant.price;
          if (cents != null && !Number.isNaN(Number(cents))) {
            return resolvedVariant;
          }
          const fromList = variants?.find((v) => String(v.id) === String(resolvedVariant.id));
          if (fromList) return fromList;
        }
        if (!vs || !variants?.length) return null;

        const sizeVal = this._getPasSizeSelectedValue(vs);
        if (!this.normOptionValue(sizeVal)) return null;

        const sizePos = parseInt(vs.dataset.weSizeOptionPosition, 10) || 0;
        if (sizePos < 1) return null;

        const want = this.normOptionValue(sizeVal);
        const key = `option${sizePos}`;
        const matchesSize = (v) =>
          this.normOptionValue(v[key] ?? v.options?.[sizePos - 1] ?? '') === want;

        return (
          variants.find((v) => matchesSize(v) && v.available !== false) ||
          variants.find((v) => matchesSize(v)) ||
          null
        );
      }

      _writePasPriceHtml(priceRoot, displayHtml) {
        if (!priceRoot || displayHtml == null || !String(displayHtml).trim()) return;

        const write = (el) => {
          if (!el || el.closest('s')) return;
          el.innerHTML = displayHtml;
        };

        write(priceRoot.querySelector('.f-price__regular > .f-price-item--regular'));
        write(priceRoot.querySelector('.f-price__sale > .f-price-item--sale'));

        priceRoot.querySelectorAll('.f-price-item--regular, .f-price-item--sale').forEach((el) => {
          if (!el.closest('s')) write(el);
        });
      }

      _getMinVariantPriceCents(variants) {
        if (!variants?.length) return null;
        return variants.reduce((min, v) => (v.price < min ? v.price : min), variants[0].price);
      }

      _formatPasPriceHtml(priceCents, useFromPrefix) {
        const moneyFormat = FoxTheme.settings.moneyFormat;
        const formatted = FoxTheme.Currency.formatMoney(priceCents, moneyFormat);
        if (!useFromPrefix) return formatted;
        const tpl = FoxTheme.variantStrings?.fromPriceHtml || 'ab [price]';
        return tpl.replace('[price]', formatted).replace(/\{\{\s*price\s*\}\}/g, formatted);
      }

      _getMinPriceForPartialSelection(vs, variants) {
        if (!variants?.length) return null;
        if (!vs) return this._getMinVariantPriceCents(variants);

        const selected = this._getSelectedOptionValuesFromVariantSelects(vs);
        const hasAny = selected.some((v) => this.normOptionValue(v));
        if (!hasAny) return this._getMinVariantPriceCents(variants);

        const matching = variants.filter((v) => {
          for (let i = 0; i < selected.length; i++) {
            const sel = this.normOptionValue(selected[i]);
            if (!sel) continue;
            const opt = v[`option${i + 1}`] ?? v.options?.[i] ?? '';
            if (this.normOptionValue(opt) !== sel) return false;
          }
          return true;
        });

        if (!matching.length) return this._getMinVariantPriceCents(variants);
        return this._getMinVariantPriceCents(matching);
      }

      _resolveVariantFromDom(vs, variants) {
        const id = this.resolveVariantIdFromSelectedOptions(this, vs);
        if (!id) return null;
        return variants.find((v) => String(v.id) === String(id)) || null;
      }

      _readInlineQtyFromRoot(qtyRoot, attrName, portaledName) {
        if (!qtyRoot) return null;

        let checked = qtyRoot.querySelector(`input[type="radio"][${attrName}]:checked`);
        if (!checked && portaledName) {
          const esc = this._escapeAttrSelector(portaledName);
          checked = document.querySelector(
            `input[type="radio"][name="${esc}"]:checked[${attrName}]`
          );
        }
        if (checked) {
          const n = parseInt(checked.value, 10);
          if (Number.isFinite(n) && n > 0) return n;
        }

        const summaryVal = qtyRoot.querySelector('.pdp-inline-qty-we-select__value');
        const t = (summaryVal?.textContent || qtyRoot.querySelector('.we-select-container__summary')?.textContent || '')
          .trim();
        const m = t.match(/^(\d+)/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n) && n > 0) return n;
        }
        return null;
      }

      _getMainInlineQuantity() {
        const vs = this.variantSelectors;
        if (!vs) return 1;

        const inlineRoot = vs.querySelector('.pdp-inline-quantity');
        if (inlineRoot) {
          const sample = inlineRoot.querySelector('input[data-pdp-inline-qty-value]');
          const fromInline = this._readInlineQtyFromRoot(
            inlineRoot,
            'data-pdp-inline-qty-value',
            sample?.getAttribute('name') || null
          );
          if (fromInline != null) return fromInline;
        }

        const qtyRoot = vs.querySelector('.we-quantity-selector');
        if (!qtyRoot) return 1;

        const pid = vs.getAttribute('data-product-id') || this.productId;
        const fromWe = this._readInlineQtyFromRoot(
          qtyRoot,
          'data-we-qty-selector',
          pid ? `quantity-${pid}` : null
        );
        return fromWe != null ? fromWe : 1;
      }

      _onMainPdpQtyChange = (e) => {
        if (this._isPdpSetBundleForm()) return;
        const t = e.target;
        if (!t) return;

        let isQty = t.hasAttribute?.('data-we-qty-selector');
        if (!isQty && !t.closest?.('.we-quantity-selector')) return;

        const vs = this.variantSelectors;
        if (!vs) return;
        const pickerPid = vs.dataset?.productId || this.productId;
        if (String(pickerPid) !== String(this.productId)) return;

        if (t.type === 'radio' && t.hasAttribute('data-we-qty-selector')) {
          const nm = t.getAttribute('name') || '';
          const m = /^quantity-(\d+)$/.exec(nm);
          if (m && String(m[1]) !== String(this.productId)) return;
        }

        this._syncMainPdpPriceDisplay(this.currentVariant);
      };

      /**
       * PDP “Preis nach Größe”: Section Rendering API does not expose option_values in Liquid
       * (request.query_string is empty). Apply ab vs. fixed price from picker state + variant JSON.
       */
      _applyPasPriceDisplay(resolvedVariant) {
        this._syncMainPdpPriceDisplay(resolvedVariant);
      }

      /**
       * Non-set PDP: keep #price in sync with resolved variant, partial selection (“from”), and inline qty.
       */
      _syncMainPdpPriceDisplay(resolvedVariant) {
        if (this._isPdpSetBundleForm()) return;

        const vs = this.variantSelectors;
        const variants = this._getMainProductVariantsFromDom();
        if (!variants?.length) return;

        const priceRoot = this.querySelector(`#price-${this.dataset.section} .f-price`);
        if (!priceRoot) return;

        const qty = this._getMainInlineQuantity();
        const incomplete = vs && this._isVariantSelectionIncomplete(vs);
        const pasMode = vs && this._isPasPriceMode(vs);

        let unitPriceCents;
        let unitCompareCents = 0;
        let useFrom = false;
        let resolvedForAvailability = null;

        if (pasMode) {
          const sizeSelected = this._isPasSizeSelected(vs);
          let variant = null;
          if (sizeSelected && !incomplete) {
            variant = this._resolvePasPriceVariant(resolvedVariant, vs, variants);
          }
          useFrom = incomplete || !sizeSelected || !variant;
          if (useFrom) {
            unitPriceCents = incomplete
              ? this._getMinPriceForPartialSelection(vs, variants)
              : this._getMinVariantPriceCents(variants);
          } else {
            unitPriceCents = variant.price;
            unitCompareCents = variant.compare_at_price || 0;
            resolvedForAvailability = variant;
          }
        } else if (incomplete) {
          useFrom = true;
          unitPriceCents = this._getMinPriceForPartialSelection(vs, variants);
        } else {
          let variant = resolvedVariant;
          if (!variant?.price) {
            variant = this._resolveVariantFromDom(vs, variants);
          }
          if (!variant) return;
          unitPriceCents = variant.price;
          unitCompareCents = variant.compare_at_price || 0;
          resolvedForAvailability = variant;
        }

        if (unitPriceCents == null || Number.isNaN(Number(unitPriceCents))) return;

        const priceCents = unitPriceCents * qty;
        const compareCents = unitCompareCents * qty;
        const displayHtml = this._formatPasPriceHtml(priceCents, useFrom);
        if (!displayHtml.trim()) return;

        const onSale = !useFrom && compareCents > priceCents;

        priceRoot.classList.toggle('f-price--on-sale', onSale);
        if (!useFrom && resolvedForAvailability) {
          priceRoot.classList.toggle('f-price--sold-out', resolvedForAvailability.available === false);
        } else {
          priceRoot.classList.remove('f-price--sold-out');
        }

        this._writePasPriceHtml(priceRoot, displayHtml);

        if (onSale) {
          const compareHtml = FoxTheme.Currency.formatMoney(compareCents, FoxTheme.settings.moneyFormat);
          priceRoot
            .querySelectorAll(
              '.f-price__sale .f-price-item--regular s, .f-price__regular .f-price-item--regular s'
            )
            .forEach((s) => {
              s.innerHTML = compareHtml;
            });
        }

        this._ensurePriceVisible();
        this._syncStickyAtcPriceFromMain();
      }

      _ensurePriceVisible() {
        const price = document.getElementById(`price-${this.dataset.section}`);
        if (price) price.classList.remove('hidden');
      }

      _updatePriceFromSectionHtml(html) {
        const source = html.getElementById(`price-${this.sectionId}`);
        const destination = this.querySelector(`#price-${this.dataset.section}`);
        if (!source || !destination) return;
        destination.innerHTML = source.innerHTML;
        destination.classList.toggle('hidden', source.classList.contains('hidden'));
        this._syncMainPdpPriceDisplay(null);
      }

      syncStickyPriceFromMain() {
        this._syncStickyAtcPriceFromMain();
      }

      _syncStickyAtcPriceFromMain() {
        const mainPrice = this.querySelector(`#price-${this.dataset.section} .f-price`);
        const stickyPrice = document.querySelector('sticky-atc-bar .f-price');
        if (!mainPrice || !stickyPrice) return;

        stickyPrice.classList.toggle('f-price--on-sale', mainPrice.classList.contains('f-price--on-sale'));
        stickyPrice.classList.toggle('f-price--sold-out', mainPrice.classList.contains('f-price--sold-out'));
        const mainRegular = mainPrice.querySelector('.f-price__regular .f-price-item--regular');
        const stickyRegular = stickyPrice.querySelector('.f-price__regular .f-price-item--regular');
        const mainRegularText = mainRegular?.innerHTML?.trim() || '';
        if (mainRegular && stickyRegular && mainRegularText) {
          stickyRegular.innerHTML = mainRegular.innerHTML;
        }
        const mainSale = mainPrice.querySelector('.f-price__sale .f-price-item--sale');
        const stickySale = stickyPrice.querySelector('.f-price__sale .f-price-item--sale');
        const mainSaleText = mainSale?.innerHTML?.trim() || '';
        if (mainSale && stickySale && mainSaleText) {
          stickySale.innerHTML = mainSale.innerHTML;
        }
        const mainCompare = mainPrice.querySelector('.f-price__sale .f-price-item--regular s, .f-price__regular .f-price-item--regular s');
        const stickyCompare = stickyPrice.querySelector('.f-price__sale .f-price-item--regular s, .f-price__regular .f-price-item--regular s');
        if (mainCompare && stickyCompare) {
          stickyCompare.innerHTML = mainCompare.innerHTML;
        }
      }

      syncMainMediaGalleryFromFirstSetPicker(variantSelectsEl) {
        if (!variantSelectsEl || !this._isPdpSetBundleForm()) return;
        const firstSetId = this._getPdpSetFirstSetProductId();
        if (!firstSetId || String(variantSelectsEl.dataset?.productId) !== firstSetId) return;

        const productMedia = this.querySelector(`[id^="MediaGallery-${this.dataset.section}"]`);
        if (!productMedia) return;

        const mainBundleColorIdx = parseInt(productMedia.dataset?.colorOptionIndex, 10) || 0;
        if (mainBundleColorIdx < 1) return;

        const lineColorPos = parseInt(variantSelectsEl.dataset?.lineColorOptionPosition, 10) || 0;
        const selected = this._getSelectedOptionValuesFromVariantSelects(variantSelectsEl);

        /** Color from first set picker: indices follow line product option order (Liquid `option.position` is 1-based). */
        let colorValue = '';
        if (lineColorPos > 0) {
          const fromDom = selected[lineColorPos - 1];
          if (fromDom != null && String(fromDom).trim() !== '') {
            colorValue = String(fromDom).trim();
          }
        }

        /** `data-selected-variant` can lag behind checked radios until the section response swaps HTML. */
        if (!colorValue) {
          const rawSv = variantSelectsEl.querySelector('[data-selected-variant]')?.textContent?.trim();
          if (rawSv && lineColorPos > 0) {
            try {
              const lineVariant = JSON.parse(rawSv);
              const lv = lineVariant?.[`option${lineColorPos}`];
              if (lv != null && String(lv).trim() !== '') {
                colorValue = String(lv).trim();
              }
            } catch {
              /* ignore */
            }
          }
        }

        /** No swatch trigger match on the line picker: fragile fallback if option order mirrors the bundle product. */
        if (!colorValue && mainBundleColorIdx > 0) {
          const cv = selected[mainBundleColorIdx - 1];
          if (cv != null && String(cv).trim() !== '') {
            colorValue = String(cv).trim();
          }
        }

        if (!colorValue) return;

        const variants = this._getMainProductVariantsFromDom();
        if (!variants?.length) return;

        const key = `option${mainBundleColorIdx}`;
        const norm = (s) => this.normOptionValue(s);
        const want = norm(colorValue);
        const match = (v) => norm(v[key]) === want;

        const variant =
          variants.find((v) => match(v) && v.available !== false) || variants.find((v) => match(v));

        if (variant) {
          this.updateMedia(variant);
        }
      }

      /**
       * Regular PDPs: when not all options are chosen, `resolveVariantIdFromSelectedOptions` is null and the
       * section response has no `data-selected-variant`, so `updateMedia` never runs. Still map the chosen color
       * (when `colorOptionIndex` is set) to any matching main-product variant so the gallery filters/slides like
       * set-bundle PDPs when only color is selected first.
       */
      syncMainMediaGalleryFromColorOnly(variantSelectsEl) {
        if (!variantSelectsEl || this._isPdpSetBundleForm()) return;
        const pickerId = variantSelectsEl.dataset?.productId;
        if (pickerId != null && String(pickerId) !== String(this.productId)) return;

        const productMedia = this.querySelector(`[id^="MediaGallery-${this.dataset.section}"]`);
        if (!productMedia) return;

        const colorIdx = parseInt(productMedia.dataset?.colorOptionIndex, 10) || 0;
        if (colorIdx < 1) return;

        const selected = this._getSelectedOptionValuesFromVariantSelects(variantSelectsEl);
        const cv = selected[colorIdx - 1];
        if (cv == null || String(cv).trim() === '') return;

        const variants = this._getMainProductVariantsFromDom();
        if (!variants?.length) return;

        const key = `option${colorIdx}`;
        const norm = (s) => this.normOptionValue(s);
        const want = norm(cv);
        const match = (v) => norm(v[key]) === want;

        const variant =
          variants.find((v) => match(v) && v.available !== false) || variants.find((v) => match(v));

        if (variant) {
          this.updateMedia(variant);
        }
      }

      handleOptionValueChange(payload) {
        const event = payload?.data?.event;
        const target = payload?.data?.target;
        const selectedOptionValues = payload?.data?.selectedOptionValues;
        if (!event) return;

        const el = event.target;
        let variantSelectsEl = el.closest('variant-selects');
        if (!variantSelectsEl && el?.dataset?.vsRoot) {
          variantSelectsEl = document.getElementById(el.dataset.vsRoot);
        }
        if (!variantSelectsEl || !this.contains(variantSelectsEl)) return;

        const variantSelectsId = variantSelectsEl?.id;

        const mainProductId = String(this.productId);
        const pickerProductId = variantSelectsEl?.dataset?.productId;
        const isEmbeddedPicker =
          pickerProductId != null && String(pickerProductId) !== mainProductId;

        if (isEmbeddedPicker) {
          this.syncMainMediaGalleryFromFirstSetPicker(variantSelectsEl);
        }

        this.disableButtons();

        const productUrlFromInput = target.dataset.productUrl;
        const pickerBaseUrl = variantSelectsEl?.dataset?.url;

        let productUrl =
          productUrlFromInput || pickerBaseUrl || this.pendingRequestUrl || this.dataset.url;

        if (isEmbeddedPicker && !productUrlFromInput && pickerBaseUrl) {
          productUrl = pickerBaseUrl;
        }

        const pathnameOnly = (u) => {
          if (!u) return '';
          try {
            return new URL(u, window.location.origin).pathname;
          } catch {
            return String(u).split('?')[0];
          }
        };

        const shouldSwapProduct =
          !isEmbeddedPicker && pathnameOnly(this.dataset.url) !== pathnameOnly(productUrl);

        const shouldFetchFullPage = this.dataset.updateUrl === 'true' && shouldSwapProduct;
        const viewMode = this.dataset.viewMode || 'main-product';

        const variantIdForFetch =
          this._forceSectionVariantId || this.resolveVariantIdFromSelectedOptions(this, variantSelectsEl);
        this._forceSectionVariantId = null;
        this._pendingSectionVariantId = variantIdForFetch;

        if (!isEmbeddedPicker && variantIdForFetch == null) {
          this.syncMainMediaGalleryFromColorOnly(variantSelectsEl);
        }

        this.renderProductInfo({
          requestUrl: this.buildRequestUrlWithParams(
            productUrl,
            selectedOptionValues,
            shouldFetchFullPage,
            variantIdForFetch
          ),
          targetId: target.id,
          callback: shouldSwapProduct
            ? this.handleSwapProduct(productUrl, shouldFetchFullPage, viewMode)
            : this.handleUpdateProductInfo(productUrl, viewMode, variantSelectsId),
        });
      }

      handleSwapProduct(productUrl, updateFullPage, viewMode) {
        return (html) => {
          const quickView = html.querySelector('#MainProduct-quick-view__content');
          if (quickView && viewMode === 'quick-view') {
            html = quickView.content.cloneNode(true);
          }
          const selector = updateFullPage ? "product-info[id^='MainProduct']" : 'product-info';
          const variant = this.getSelectedVariant(html.querySelector(selector));

          this.updateURL(productUrl, variant?.id);

          if (updateFullPage) {
            document.querySelector('head title').innerHTML = html.querySelector('head title').innerHTML;
            HTMLUpdateUtility.viewTransition(
              document.querySelector('main'),
              html.querySelector('main'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
            HTMLUpdateUtility.viewTransition(
              document.getElementById('shopify-section-sticky-atc-bar'),
              html.getElementById('shopify-section-sticky-atc-bar'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );

            if (!variant) {
              const pi = html.querySelector(selector);
              const vs = pi?.querySelector('variant-selects');
              if (
                vs &&
                !this._isPdpSetBundleForm() &&
                this._isVariantSelectionIncomplete(vs)
              ) {
                this.setIncompleteVariantPrompt();
              } else {
                this.setUnavailable();
              }
              return;
            }
          } else {
            HTMLUpdateUtility.viewTransition(
              this,
              html.querySelector('product-info'),
              this.preProcessHtmlCallbacks,
              this.postProcessHtmlCallbacks
            );
          }

          this.currentVariant = variant;
        };
      }

      isMainProductVariantPicker(variantSelectsId) {
        if (!variantSelectsId) return true;
        const el = document.getElementById(variantSelectsId);
        if (!el?.dataset?.productId) return true;
        return String(el.dataset.productId) === String(this.productId);
      }

      handleUpdateProductInfo(productUrl, viewMode, variantSelectsId) {
        return (html) => {
          const pendingVariantId = this._pendingSectionVariantId;
          this._pendingSectionVariantId = null;

          const quickView = html.querySelector('#MainProduct-quick-view__content');
          if (quickView && viewMode === 'quick-view') {
            html = quickView.content.cloneNode(true);
          }

          const isMainPicker = this.isMainProductVariantPicker(variantSelectsId);
          let variant = this.getSelectedVariant(html, variantSelectsId);
          if (!variant && pendingVariantId) {
            const script =
              html.querySelector('script[data-product-variants-for-url]') ||
              this.querySelector('script[data-product-variants-for-url]');
            if (script?.textContent?.trim()) {
              try {
                const list = JSON.parse(script.textContent.trim());
                if (Array.isArray(list)) {
                  const v = list.find((x) => String(x.id) === String(pendingVariantId));
                  if (v) variant = v;
                }
              } catch (e) {}
            }
          }

          this.updateOptionValues(html, variantSelectsId);

          const vsLive =
            (variantSelectsId && document.getElementById(variantSelectsId)) ||
            this.variantSelectors;
          if (
            variant &&
            vsLive &&
            !this._isPdpSetBundleForm() &&
            this._isVariantSelectionIncomplete(vsLive)
          ) {
            variant = null;
          }

          if (!isMainPicker) {
            this.enableButtons();
            requestAnimationFrame(() => {
              const sourcePrice = html.getElementById(`price-${this.sectionId}`);
              const destPrice = this.querySelector(`#price-${this.dataset.section}`);
              if (sourcePrice && destPrice) {
                destPrice.innerHTML = sourcePrice.innerHTML;
                destPrice.classList.toggle('hidden', sourcePrice.classList.contains('hidden'));
              }
              const vsRoot = variantSelectsId ? document.getElementById(variantSelectsId) : null;
              if (typeof window.initWeDetailsSelects === 'function' && vsRoot) {
                window.initWeDetailsSelects(vsRoot);
              }
              if (typeof window.initWeVariantDropdownMeta === 'function' && vsRoot) {
                window.initWeVariantDropdownMeta(vsRoot);
              }
              if (typeof window.syncWeQuantitySelectorCap === 'function' && vsRoot) {
                window.syncWeQuantitySelectorCap(vsRoot);
              }
              if (typeof window.syncProductSetPickerCards === 'function') {
                window.syncProductSetPickerCards();
              }
              if (this._isPdpSetBundleForm()) {
                const fid = this._getPdpSetFirstSetProductId();
                if (fid) {
                  const sid = this.dataset?.section || this.sectionId;
                  const vsFirst = sid
                    ? document.getElementById(`variant-selects-${sid}-${fid}`)
                    : null;
                  if (vsFirst) this.syncMainMediaGalleryFromFirstSetPicker(vsFirst);
                }
              }
              document.dispatchEvent(
                new CustomEvent('pdp-set:refresh-submit', {
                  bubbles: true,
                  detail: { sectionId: this.dataset.section },
                })
              );
              this._syncFormLineItems();
            });
            return;
          }

          this.pickupAvailability?.update(variant);
          this.updateURL(productUrl, variant?.id);
          this.updateShareUrl(variant?.id);
          this.updateVariantInputs(variant?.id);
          this._syncFormLineItems();

          if (!variant) {
            if (variantSelectsId && !this._isPdpSetBundleForm()) {
              const vs = document.getElementById(variantSelectsId);
              this.syncMainMediaGalleryFromColorOnly(vs);
            }
            const vsIncomplete =
              (variantSelectsId && document.getElementById(variantSelectsId)) ||
              (!variantSelectsId && this.variantSelectors);
            this._updatePriceFromSectionHtml(html);
            this._ensurePriceVisible();
            const pasMode = vsIncomplete && this._isPasPriceMode(vsIncomplete);
            const incomplete =
              vsIncomplete &&
              !this._isPdpSetBundleForm() &&
              this._isVariantSelectionIncomplete(vsIncomplete);
            if (pasMode || incomplete) {
              this.setIncompleteVariantPrompt();
            } else {
              this.setUnavailable();
            }
            this.currentVariant = null;
            return;
          }

          this.currentVariant = variant;
          this.updateMedia(variant);

          const updateSourceFromDestination = (id, shouldHide = (source) => false) => {
            const source = html.getElementById(`${id}-${this.sectionId}`);
            const destination = this.querySelector(`#${id}-${this.dataset.section}`);
            if (source && destination) {
              destination.innerHTML = source.innerHTML;
              destination.classList.toggle('hidden', shouldHide(source));
            }
          };

          updateSourceFromDestination('price');
          updateSourceFromDestination('Sku');
          updateSourceFromDestination('Inventory');
          updateSourceFromDestination('Badges');
          updateSourceFromDestination('PricePerItem');
          updateSourceFromDestination('Volume');
          this._syncMainPdpPriceDisplay(variant);
          this._ensurePriceVisible();

          this.updateQuantityRules(this.sectionId, this.productId, html);
          updateSourceFromDestination('QuantityRules');
          updateSourceFromDestination('VolumeNote');

          HTMLUpdateUtility.viewTransition(
            document.querySelector(`#SizeChart-${this.sectionId}-${this.productId}`),
            html.querySelector(`#SizeChart-${this.sectionId}-${this.productId}`),
            this.preProcessHtmlCallbacks,
            this.postProcessHtmlCallbacks
          );

          const stickyAtcBar = document.getElementById(`shopify-section-sticky-atc-bar`);
          if (stickyAtcBar) {
            stickyAtcBar.classList.remove('hidden');
          }

          const newAddButton = html.getElementById(`ProductSubmitButton-${this.sectionId}`);
          let isDisabled = !newAddButton || newAddButton.hasAttribute('disabled');
          if (!this._isPdpSetBundleForm() && variant && variant.available === true) {
            isDisabled = false;
          }
          this.updateButtonsState(isDisabled, {
            updateText: true,
            text: isDisabled ? FoxTheme.variantStrings.soldOut : null,
          });

          FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, {
            data: {
              sectionId: this.sectionId,
              html,
              variant,
            },
          });

          document.dispatchEvent(
            new CustomEvent('variant:changed', {
              detail: {
                variant: variant,
              },
            })
          );
        };
      }

      buildRequestUrlWithParams(url, optionValues, shouldFetchFullPage = false, variantId = null) {
        const params = [];

        !shouldFetchFullPage && params.push(`section_id=${this.sectionId}`);

        if (variantId != null && String(variantId).length > 0) {
          params.push(`variant=${encodeURIComponent(String(variantId))}`);
        }

        const ids = (optionValues || []).filter((id) => id != null && String(id).length > 0);
        if (ids.length) {
          params.push(`option_values=${ids.join(',')}`);
        }

        const sep = String(url).includes('?') ? '&' : '?';
        return `${url}${sep}${params.join('&')}`;
      }

      getSelectedVariant(productInfoNode, variantSelectsId) {
        if (!productInfoNode) return null;
        let root = null;
        if (variantSelectsId) {
          if (typeof productInfoNode.getElementById === 'function') {
            root = productInfoNode.getElementById(variantSelectsId);
          }
          if (!root && typeof productInfoNode.querySelector === 'function') {
            try {
              const esc =
                typeof CSS !== 'undefined' && CSS.escape
                  ? CSS.escape(variantSelectsId)
                  : String(variantSelectsId).replace(/\\/g, '\\\\');
              root = productInfoNode.querySelector(`#${esc}`);
            } catch {
              root = null;
            }
          }
        } else {
          root = productInfoNode.querySelector?.('variant-selects') ?? null;
        }
        const raw = root?.querySelector('[data-selected-variant]')?.textContent?.trim();
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }

      renderProductInfo({ requestUrl, targetId, callback }) {
        this.abortController?.abort();
        this.abortController = new AbortController();

        fetch(requestUrl, { signal: this.abortController.signal })
          .then((response) => response.text())
          .then((responseText) => {
            this.pendingRequestUrl = null;
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            const viewMode = this.dataset.viewMode || 'main-product';
            const preserveScroll =
              viewMode === 'main-product' &&
              typeof FoxTheme !== 'undefined' &&
              FoxTheme.config?.mqlMobile === true;
            const scrollYBefore = preserveScroll ? window.scrollY : null;

            callback(html);

            if (scrollYBefore != null) {
              this._pendingScrollRestoreY = scrollYBefore;
            }
          })
          .then(() => {
            /* Default focus() scrolls the target into view — on set PDPs that yanks the page toward the pickers on every fetch. */
            if (targetId) document.getElementById(targetId)?.focus({ preventScroll: true });

            if (this._pendingScrollRestoreY == null) return;
            const y = this._pendingScrollRestoreY;
            this._pendingScrollRestoreY = null;
            requestAnimationFrame(() => {
              window.scrollTo(0, y);
              requestAnimationFrame(() => {
                window.scrollTo(0, y);
              });
            });
          })
          .catch((error) => {
            if (error.name === 'AbortError') {
              console.log('Fetch aborted by user');
            } else {
              console.error(error);
            }
          });
      }

      updateOptionValues(html, variantSelectsId) {
        const swapVariantSelects = (destination, source) => {
          if (!source || !destination) return;
          /*
           * Set-product embedded pickers: replacing `variant-selects` destroys the DOM while a mobile
           * we-select sheet can still have portaled markup under `body` and `overflow:hidden` on `body`.
           * Main-picker updates publish `variantChange`, which clears that — embedded updates do not.
           * Closing open sheets first runs toggle handlers so the portal is restored and scroll unlocks.
           */
          destination.querySelectorAll('details.we-select-container[open]').forEach((det) => {
            det.removeAttribute('open');
          });
          const wePickerState = this._captureWePickerUiState(destination);
          if (wePickerState) {
            const postProcess = [...(this.postProcessHtmlCallbacks || []), (newNode) => {
              if (newNode?.matches?.('variant-selects')) {
                this._restoreWePickerUiState(newNode, wePickerState);
              }
            }];
            HTMLUpdateUtility.viewTransition(destination, source, this.preProcessHtmlCallbacks, postProcess);
          } else {
            HTMLUpdateUtility.viewTransition(destination, source, this.preProcessHtmlCallbacks);
          }
        };

        if (variantSelectsId) {
          let source = html.getElementById(variantSelectsId);
          const destination = document.getElementById(variantSelectsId);
          if (!source && destination?.dataset?.productId) {
            source = html.querySelector(
              `variant-selects[data-product-id="${destination.dataset.productId}"]`
            );
          }
          swapVariantSelects(destination, source);
          return;
        }
        const variantSelects = html.querySelector('variant-selects');
        if (variantSelects && this.variantSelectors) {
          swapVariantSelects(this.variantSelectors, variantSelects);
        }
      }

      updateURL(url, variantId) {
        if (this.dataset.updateUrl === 'false') return;
        window.history.replaceState({}, '', `${url}${variantId ? `?variant=${variantId}` : ''}`);
      }

      updateVariantInputs(variantId) {
        document
          .querySelectorAll(`#product-form-${this.dataset.section}, #product-form-installment-${this.dataset.section}`)
          .forEach((productForm) => {
            const input = productForm.querySelector('input[name="id"]');
            input.value = variantId ?? '';
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
      }

      updateMedia(variant) {
        if (this.timer != null) {
          clearInterval(this.timer);
          this.timer = undefined;
        }

        const productMedia = this.querySelector(`[id^="MediaGallery-${this.dataset.section}"]`);
        if (!productMedia) return; // Early return if productMedia is not found

        const viewMode = this.dataset.viewMode || 'main-product';
        const colorIdx = parseInt(productMedia.dataset?.colorOptionIndex, 10) || 0;
        let skipColorFilter = false;
        if (viewMode === 'quick-view' && colorIdx > 0 && variant && this._lastGalleryVariant) {
          const key = `option${colorIdx}`;
          const prev = String(this._lastGalleryVariant[key] ?? '')
            .trim()
            .toLowerCase();
          const next = String(variant[key] ?? '')
            .trim()
            .toLowerCase();
          skipColorFilter = prev === next;
        }
        if (variant) {
          this._lastGalleryVariant = variant;
        }

        const setActiveMedia = () => {
          if (typeof productMedia.setActiveMedia === 'function') {
            productMedia.init();
            productMedia.setActiveMedia(variant, { skipColorFilter });
            return true; // Indicate success
          }
          return false; // Indicate failure
        };

        if (!setActiveMedia()) {
          this.timer = setInterval(() => {
            if (setActiveMedia()) {
              clearInterval(this.timer);
              this.timer = undefined;
            }
          }, 100);
        }
      }

      updateShareUrl(variantId) {
        if (!variantId) return;
        const shareButton = document.getElementById(`ProductShare-${this.dataset.section}`);
        if (!shareButton || !shareButton.updateUrl) return;
        shareButton.updateUrl(`${window.shopUrl}${this.dataset.url}?variant=${variantId}`);
      }

      _getProductForm() {
        return (
          this.querySelector(`#product-form-${this.dataset.section}`) ||
          this.closest('quick-view-modal')?.querySelector(`#product-form-${this.dataset.section}`)
        );
      }

      /** Set PDPs: ATC state comes from `product-set-cart-items.js` (we-variant pickers only), not `input[name="id"]`. */
      _isPdpSetBundleForm() {
        const productForm = this._getProductForm();
        return Boolean(productForm?.classList?.contains('pdp-set-bundle'));
      }

      updateButtonsState(disabled, options = {}) {
        const { updateText = false, text = null, updateStyles = true } = options;

        const productForm = this._getProductForm();
        if (productForm?.classList?.contains('pdp-set-bundle')) {
          const addButton = productForm.querySelector('[name="add"]');
          const addButtonText = productForm.querySelector('[name="add"] > span');
          if (disabled) {
            if (addButton) {
              addButton.setAttribute('disabled', 'disabled');
              if (updateText && text && addButtonText) {
                addButtonText.textContent = this.decoded(text);
              }
              if (updateStyles) {
                addButton.style.pointerEvents = 'none';
                addButton.style.opacity = '0.6';
              }
            }
            return;
          }
          document.dispatchEvent(
            new CustomEvent('pdp-set:refresh-submit', {
              bubbles: true,
              detail: { sectionId: this.dataset.section },
            })
          );
          return;
        }

        // Handle main add button in product form
        if (productForm) {
          const addButton = productForm.querySelector('[name="add"]');
          const addButtonText = productForm.querySelector('[name="add"] > span');

          if (addButton) {
            if (disabled) {
              addButton.setAttribute('disabled', 'disabled');
              if (updateText && text && addButtonText) {
                addButtonText.textContent = this.decoded(text);
              }
            } else {
              const variantId = productForm.querySelector('[name="id"]')?.value;
              if (variantId) {
                addButton.removeAttribute('disabled');
                if (updateText && addButtonText) {
                  addButtonText.textContent = this.decoded(FoxTheme.variantStrings.addToCart);
                }
              }
            }

            if (updateStyles) {
              addButton.style.pointerEvents = disabled ? 'none' : '';
              addButton.style.opacity = disabled ? '0.6' : '';
            }
          }
        }

        // Handle sticky ATC button
        const otherButtonSelectors = ['.sticky-atc-bar [name="add"]'];
        otherButtonSelectors.forEach((selector) => {
          const buttons = document.querySelectorAll(selector);
          buttons.forEach((button) => {
            if (disabled) {
              button.setAttribute('disabled', 'disabled');
              if (updateText && text) {
                const stickySpan = button.querySelector(':scope > span');
                if (stickySpan) stickySpan.textContent = this.decoded(text);
              }
              if (updateStyles) {
                button.style.pointerEvents = 'none';
                button.style.opacity = '0.6';
              }
            } else {
              button.removeAttribute('disabled');
              if (updateStyles) {
                button.style.pointerEvents = '';
                button.style.opacity = '';
              }
            }
          });
        });
      }

      decoded(text) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = text;
        const decoded = tempDiv.textContent;
        return decoded;
      }

      setUnavailable() {
        if (this._isPdpSetBundleForm()) {
          document.dispatchEvent(
            new CustomEvent('pdp-set:refresh-submit', {
              bubbles: true,
              detail: { sectionId: this.dataset.section },
            })
          );
        } else {
          this.updateButtonsState(true, {
            updateText: true,
            text: FoxTheme.variantStrings.unavailable,
          });
        }
        const price = document.getElementById(`price-${this.dataset.section}`);
        const inventory = document.getElementById(`Inventory-${this.dataset.section}`);
        const sku = document.getElementById(`Sku-${this.dataset.section}`);
        const volumePricing = document.getElementById(`Volume-${this.dataset.section}`);
        const stickyAtcBar = document.getElementById(`shopify-section-sticky-atc-bar`);

        if (price) price.classList.add('hidden');
        if (inventory) inventory.classList.add('hidden');
        if (sku) sku.classList.add('hidden');
        if (volumePricing) volumePricing.classList.add('hidden');
        if (stickyAtcBar) stickyAtcBar.classList.add('hidden');
      }

      /** Partial variant selection — keep PDP chrome visible (unlike unavailable). */
      setIncompleteVariantPrompt() {
        if (this._isPdpSetBundleForm()) {
          document.dispatchEvent(
            new CustomEvent('pdp-set:refresh-submit', {
              bubbles: true,
              detail: { sectionId: this.dataset.section },
            })
          );
          return;
        }
        const hint =
          (typeof FoxTheme !== 'undefined' && FoxTheme.variantStrings?.select_variant_text) || '';
        this.updateButtonsState(true, {
          updateText: Boolean(hint),
          text: hint,
        });
        this._ensurePriceVisible();
        const stickyAtcBar = document.getElementById(`shopify-section-sticky-atc-bar`);
        if (stickyAtcBar) stickyAtcBar.classList.remove('hidden');
      }

      initQuantityHandlers() {
        if (!this.quantityInput) return;

        this.setQuantityBoundries();
        if (!this.hasAttribute('data-original-section')) {
          this.cartUpdateUnsubscriber = FoxTheme.pubsub.subscribe(
            FoxTheme.pubsub.PUB_SUB_EVENTS.cartUpdate,
            this.fetchQuantityRules.bind(this)
          );
        }
      }

      setQuantityBoundries() {
        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.quantityBoundries, {
          data: {
            sectionId: this.sectionId,
            productId: this.productId,
          },
        });
      }

      fetchQuantityRules() {
        const currentVariantId = this.productForm?.productIdInput?.value;
        if (!currentVariantId) return;

        this.querySelector('.quantity__rules-cart')?.classList.add('btn--loading');

        fetch(`${this.getAttribute('data-url')}?variant=${currentVariantId}&section_id=${this.sectionId}`)
          .then((response) => response.text())
          .then((responseText) => {
            const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');
            this.updateQuantityRules(this.sectionId, this.productId, parsedHTML);
          })
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            this.querySelector('.quantity__rules-cart')?.classList.remove('btn--loading');
          });
      }

      updateQuantityRules(sectionId, productId, parsedHTML) {
        if (!this.quantityInput) return;

        FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.quantityRules, {
          data: {
            sectionId,
            productId,
            parsedHTML,
          },
        });

        this.setQuantityBoundries();
      }

      disableButtons() {
        this.updateButtonsState(true);
      }

      enableButtons() {
        this.updateButtonsState(false);
      }
    }
  );
}

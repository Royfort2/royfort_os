if (!customElements.get('product-info')) {
  customElements.define(
    'product-info',
    class ProductInfo extends HTMLElement {
      abortController = undefined;
      pendingRequestUrl = null;
      preProcessHtmlCallbacks = [];
      postProcessHtmlCallbacks = [];
      cartUpdateUnsubscriber = undefined;
      /** When true, next embedded variant-selects swap should replay the inline quantity width/opacity transition. */
      pendingEmbeddedQtyReveal = false;

      constructor() {
        super();
      }

      /**
       * Embedded set pickers: section HTML arrives with the quantity column already “open”, so CSS transition
       * never runs. After initWeDetailsSelects, force a max-width Web Animations API tween (same easing/duration
       * as theme CSS). Does not rely on class-toggle timing.
       */
      animateEmbeddedInlineQtyReveal(vsRoot) {
        if (!vsRoot) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

        const inlineQty =
          vsRoot.querySelector('.pdp-variant-qty-row--has-variant .pdp-inline-quantity') ||
          vsRoot.querySelector('.pdp-inline-quantity');
        if (!inlineQty || typeof inlineQty.animate !== 'function') return;

        inlineQty.getAnimations?.().forEach((a) => a.cancel());

        inlineQty.style.width = '0px';
        inlineQty.style.minWidth = '0px';
        inlineQty.style.maxWidth = '0px';
        inlineQty.style.opacity = '0';
        void inlineQty.offsetWidth;

        requestAnimationFrame(() => {
          const anim = inlineQty.animate(
            [
              {
                width: '0px',
                minWidth: '0px',
                maxWidth: '0px',
                opacity: 0,
              },
              {
                width: '8rem',
                minWidth: '8rem',
                maxWidth: '8rem',
                opacity: 1,
              },
            ],
            { duration: 400, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
          );
          anim.finished
            .then(() => {
              inlineQty.style.removeProperty('width');
              inlineQty.style.removeProperty('min-width');
              inlineQty.style.removeProperty('max-width');
              inlineQty.style.removeProperty('opacity');
            })
            .catch(() => {});
        });
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
       * Selected variant from [data-selected-variant], or first available from [data-pdp-bootstrap-variant]
       * when the picker is still pending (null JSON) or as fallback if no variant is in the URL.
       */
      getInitialVariantForGallery(productInfoNode) {
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

        this.initQuantityHandlers();

        this.currentVariant = this.getInitialVariantForGallery(this);
        if (this.currentVariant) {
          this.updateMedia(this.currentVariant);
        }
      }

      disconnectedCallback() {
        document.removeEventListener('change', this._onDocumentOptionChange, true);
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

      _onDocumentOptionChange = (e) => {
        const t = e.target;
        if (!t) return;
        if (t.closest?.('.pdp-inline-quantity')) return;
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
        }

        const scopedForm = this.getScopedProductForm();
        const form = scopedForm || t.form;
        if (!form || !this.contains(form)) return;

        let vs = t.closest('variant-selects');
        if (!vs && t.dataset?.vsRoot) {
          vs = document.getElementById(t.dataset.vsRoot);
        }
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
        });
      }

      /**
       * Mobile we-select portals option radios to `document.body`; they are no longer under `.product-form__input`.
       */
      findCheckedOptionRadio(wrap) {
        const local = wrap.querySelector(
          'input[type="radio"]:checked:not([data-pdp-inline-qty-value])'
        );
        if (local) return local;
        const groupName = wrap.querySelector('details.we-select-container')?.dataset?.radioGroupName;
        if (!groupName) return null;
        const esc =
          typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(groupName) : groupName.replace(/"/g, '\\"');
        return document.querySelector(
          `input[type="radio"][name="${esc}"]:checked:not([data-pdp-inline-qty-value])`
        );
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

        const groups = variantSelectsEl.querySelectorAll(':scope > .product-form__input');
        if (!groups.length) return null;

        const selected = [];
        for (const wrap of groups) {
          const selectEl = wrap.querySelector('select[name^="options"]');
          if (selectEl) {
            const opt = selectEl.selectedOptions?.[0];
            if (!opt) return null;
            selected.push(opt.value);
            continue;
          }
          const checked = this.findCheckedOptionRadio(wrap);
          if (!checked) return null;
          selected.push(checked.value);
        }

        const found = variants.find((v) => {
          const vo = [v.option1, v.option2, v.option3].filter((x) => x != null && String(x).length);
          if (vo.length !== selected.length) return false;
          for (let i = 0; i < selected.length; i++) {
            if (this.normOptionValue(vo[i]) !== this.normOptionValue(selected[i])) return false;
          }
          return true;
        });
        return found?.id != null ? String(found.id) : null;
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

        this.pendingEmbeddedQtyReveal = variantSelectsEl?.dataset?.pdpEmbeddedPending === 'true';

        const variantIdForFetch = this.resolveVariantIdFromSelectedOptions(this, variantSelectsEl);

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
              this.setUnavailable();
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
          const quickView = html.querySelector('#MainProduct-quick-view__content');
          if (quickView && viewMode === 'quick-view') {
            html = quickView.content.cloneNode(true);
          }

          const isMainPicker = this.isMainProductVariantPicker(variantSelectsId);
          const variant = this.getSelectedVariant(html, variantSelectsId);

          let hadQtyRowExpandedBefore = false;
          let incomingQtyRowExpanded = false;
          if (variantSelectsId && !isMainPicker) {
            const destBefore = document.getElementById(variantSelectsId);
            hadQtyRowExpandedBefore = !!destBefore?.querySelector('.pdp-variant-qty-row--has-variant');
            let sourceVs = null;
            if (destBefore?.dataset?.productId) {
              sourceVs = html.querySelector(
                `variant-selects[data-product-id="${destBefore.dataset.productId}"]`
              );
            }
            if (!sourceVs) {
              sourceVs = html.getElementById(variantSelectsId);
            }
            incomingQtyRowExpanded = !!sourceVs?.querySelector('.pdp-variant-qty-row--has-variant');
          }

          this.updateOptionValues(html, variantSelectsId);

          if (!isMainPicker) {
            const shouldRevealQty =
              this.pendingEmbeddedQtyReveal ||
              (!hadQtyRowExpandedBefore && incomingQtyRowExpanded);
            this.pendingEmbeddedQtyReveal = false;
            this.enableButtons();
            requestAnimationFrame(() => {
              const vsRoot = variantSelectsId ? document.getElementById(variantSelectsId) : null;
              if (typeof window.initWeDetailsSelects === 'function' && vsRoot) {
                window.initWeDetailsSelects(vsRoot);
              }
              const revealAfterInit =
                shouldRevealQty ||
                (!hadQtyRowExpandedBefore &&
                  !!vsRoot?.querySelector('.pdp-variant-qty-row--has-variant .pdp-inline-quantity'));
              if (revealAfterInit && vsRoot) {
                this.animateEmbeddedInlineQtyReveal(vsRoot);
              }
              document.dispatchEvent(new CustomEvent('pdp-set:refresh-submit', { bubbles: true }));
            });
            return;
          }

          this.pickupAvailability?.update(variant);
          this.updateURL(productUrl, variant?.id);
          this.updateShareUrl(variant?.id);
          this.updateVariantInputs(variant?.id);

          if (!variant) {
            this.setUnavailable();
            return;
          }

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
          const isDisabled = !newAddButton || newAddButton.hasAttribute('disabled');
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
        const root = variantSelectsId
          ? productInfoNode.getElementById(variantSelectsId)
          : productInfoNode.querySelector('variant-selects');
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
            callback(html);
          })
          .then(() => {
            if (targetId) document.getElementById(targetId)?.focus();
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
        if (variantSelectsId) {
          let source = html.getElementById(variantSelectsId);
          const destination = document.getElementById(variantSelectsId);
          if (!source && destination?.dataset?.productId) {
            source = html.querySelector(
              `variant-selects[data-product-id="${destination.dataset.productId}"]`
            );
          }
          if (source && destination) {
            HTMLUpdateUtility.viewTransition(destination, source, this.preProcessHtmlCallbacks);
          }
          return;
        }
        const variantSelects = html.querySelector('variant-selects');
        if (variantSelects && this.variantSelectors) {
          HTMLUpdateUtility.viewTransition(this.variantSelectors, variantSelects, this.preProcessHtmlCallbacks);
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
        const productMedia = this.querySelector(`[id^="MediaGallery-${this.dataset.section}"]`);
        if (!productMedia) return; // Early return if productMedia is not found

        const setActiveMedia = () => {
          if (typeof productMedia.setActiveMedia === 'function') {
            productMedia.init();
            productMedia.setActiveMedia(variant);
            return true; // Indicate success
          }
          return false; // Indicate failure
        };

        if (!setActiveMedia()) {
          this.timer = setInterval(() => {
            if (setActiveMedia()) {
              clearInterval(this.timer);
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

      updateButtonsState(disabled, options = {}) {
        const { updateText = false, text = null, updateStyles = true } = options;

        // Handle main add button in product form
        const productForm = document.getElementById(`product-form-${this.dataset.section}`);
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
        this.updateButtonsState(true, {
          updateText: true,
          text: FoxTheme.variantStrings.unavailable,
        });
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

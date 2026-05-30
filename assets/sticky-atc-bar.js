if (!customElements.get('sticky-atc-bar')) {
  customElements.define(
    'sticky-atc-bar',
    class StickyAtcBar extends HTMLElement {
      constructor() {
        super();
        document.body.classList.add('sticky-atc-bar-enabled');

        this.selectors = {
          variantIdSelect: '[name="id"]',
        };
      }

      get quantityInput() {
        return this.querySelector('quantity-input input');
      }
      get quantity() {
        return this.querySelector('quantity-input');
      }
      get sectionId() {
        return this.dataset.originalSection || this.dataset.section;
      }
      get productId() {
        return this.getAttribute('data-product-id');
      }
      get select() {
        return this.querySelector('select');
      }
      get productForm() {
        return this.querySelector('form[is="product-form"]');
      }

      connectedCallback() {
        this.productFormActions = document.querySelector(`.main-product-form[data-product-id="${this.productId}"]`);
        this.mainProductInfo = document.querySelector(`product-info[data-product-id="${this.productId}"]`);
        this.container = this.closest('.sticky-atc-bar');
        this.submitButton = this.querySelector('[type="submit"]');
        this.selectedVariantId = this.querySelector(this.selectors.variantIdSelect).value;

        this.variantData = this.getVariantData();
        this.mainVariantSelects =
          this.mainProductInfo && this.mainProductInfo.querySelector('variant-selects');

        this.init();
        this.syncWithMainProductForm();

        const pasMode = this.mainVariantSelects?.dataset?.wePdpPreisNachGrose === 'true';
        if (pasMode && typeof this.mainProductInfo?.syncStickyPriceFromMain === 'function') {
          requestAnimationFrame(() => this.mainProductInfo.syncStickyPriceFromMain());
        }

        this.select.addEventListener('change', () => {
          if (this.isUpdating) return;
          this.isUpdating = true;

          const selectedVariantId = this.querySelector(this.selectors.variantIdSelect).value;
          this.selectedVariantId = selectedVariantId;
          const pasMode = this.mainVariantSelects?.dataset?.wePdpPreisNachGrose === 'true';

          if (!selectedVariantId) {
            if (pasMode && typeof this.mainProductInfo?.syncStickyPriceFromMain === 'function') {
              this.mainProductInfo.syncStickyPriceFromMain();
            }
            this.isUpdating = false;
            this.updateButton(true, '', true);
            return;
          }

          this.currentVariant = this.variantData.find((variant) => variant.id === Number(selectedVariantId));

          const synced =
            this.mainProductInfo &&
            typeof this.mainProductInfo.syncMainPickerFromVariant === 'function' &&
            this.currentVariant &&
            this.mainProductInfo.syncMainPickerFromVariant(this.currentVariant);

          if (!synced) {
            this.isUpdating = false;
          } else {
            setTimeout(() => {
              this.isUpdating = false;
            }, 5000);
          }

          if (this.currentVariant) {
            this.updatePrice();
          }

          this.updateButton(true, '', false);
          if (!this.currentVariant) {
            this.updateButton(true, '', true);
          } else {
            this.updateButton(!this.currentVariant.available, FoxTheme.variantStrings.soldOut);
          }

          if (this.currentVariant) {
            this.updateQuantityInput();
          } else if (!synced) {
            this.isUpdating = false;
          }
        });

        const hasRequiredFields = this.validateMainProductRequiredFields();
        if (hasRequiredFields) {
          this.submitButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.productFormActions.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
              this.productFormActions.requestSubmit();
            }, 300);
          });
        }
      }

      validateMainProductRequiredFields() {
        const mainForm = this.mainProductInfo;
        if (!mainForm) return true;
        const requiredFields = mainForm.querySelectorAll('[data-custom-property]');
        return requiredFields.length > 0;
      }

      updateQuantityInput() {
        this.currentVariant = this.variantData.find((variant) => variant.id === Number(this.selectedVariantId));
        fetch(`${this.getAttribute('data-url')}?variant=${this.currentVariant.id}&section_id=${this.sectionId}`)
          .then((response) => response.text())
          .then((responseText) => {
            const parsedHTML = new DOMParser().parseFromString(responseText, 'text/html');
            const quantity = document.querySelector(`#QuantitySticky-${this.sectionId}`);
            const newQuantity = parsedHTML.querySelector(`#QuantitySticky-${this.sectionId}`);
            if (newQuantity) {
              quantity.innerHTML = newQuantity.innerHTML;
            }
          })
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {});
      }

      getVariantData() {
        this.variantData =
          this.variantData || JSON.parse(this.container.querySelector('[type="application/json"]').textContent);
        return this.variantData;
      }

      init() {
        if (!this.productFormActions) {
          this.container.classList.add('sticky-atc-bar--show');
          return;
        }

        const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
        mql.onchange = this.checkDevice.bind(this);
        this.checkDevice();

        const rootMargin = `-80px 0px 0px 0px`;
        this.observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              const method = entry.intersectionRatio !== 1 ? 'add' : 'remove';
              this.container.classList[method]('sticky-atc-bar--show');
            });
          },
          { threshold: 1, rootMargin }
        );
        this.setObserveTarget();
      }

      setObserveTarget() {
        this.observer.observe(this.productFormActions);
        this.observeTarget = this.productFormActions;
      }

      checkDevice(e) {
        document.documentElement.style.setProperty('--sticky-atc-bar-height', this.clientHeight + 'px');
      }

      updateButton(disable = true, text, modifyClass = true) {
        const productForm = this.querySelector('#product-form-sticky-atc-bar');
        if (!productForm) return;

        const addButton = productForm.querySelector('[name="add"]');
        if (!addButton) return;

        const addButtonText = addButton.querySelector('span');
        if (disable) {
          addButton.setAttribute('disabled', 'disabled');
          if (text) addButtonText.textContent = text;
        } else {
          addButton.removeAttribute('disabled');
          addButtonText.textContent = FoxTheme.variantStrings.addToCart;
        }
      }

      updatePrice() {
        const classes = {
          onSale: 'f-price--on-sale',
          soldOut: 'f-price--sold-out',
        };
        const selectors = {
          priceWrapper: '.f-price',
          salePrice: '.f-price-item--sale',
          compareAtPrice: ['.f-price-item--regular'],
          unitPriceWrapper: '.f-price__unit-wrapper',
        };
        const moneyFormat = FoxTheme.settings.moneyFormat;
        const { priceWrapper, salePrice, unitPriceWrapper, compareAtPrice } = FoxTheme.utils.queryDomNodes(
          selectors,
          this
        );
        const unitPrice = unitPriceWrapper.querySelector('.f-price__unit');

        const { compare_at_price, price, unit_price_measurement } = this.currentVariant;
        const formattedPrice = FoxTheme.Currency.formatMoney(price, moneyFormat);

        // On sale.
        if (compare_at_price && compare_at_price > price) {
          priceWrapper.classList.add(classes.onSale);
        } else {
          priceWrapper.classList.remove(classes.onSale);
        }

        // Sold out.
        if (!this.currentVariant.available) {
          priceWrapper.classList.add(classes.soldOut);
        } else {
          priceWrapper.classList.remove(classes.soldOut);
        }

        const regularPrice = priceWrapper.querySelector('.f-price__regular > .f-price-item--regular');
        if (regularPrice) regularPrice.innerHTML = formattedPrice;
        if (salePrice) salePrice.innerHTML = formattedPrice;

        if (compareAtPrice && compareAtPrice.length && compare_at_price > price) {
          const formattedCompare = FoxTheme.Currency.formatMoney(compare_at_price, moneyFormat);
          compareAtPrice.forEach((item) => {
            if (item.closest('s')) item.innerHTML = formattedCompare;
          });
        }

        if (unit_price_measurement && unitPrice) {
          unitPriceWrapper.classList.remove('hidden');
          const unitPriceContent = `<span>${FoxTheme.Currency.formatMoney(
            this.currentVariant.unit_price,
            moneyFormat
          )}</span>/<span data-unit-price-base-unit>${FoxTheme.Currency.getBaseUnit(this.currentVariant)}</span>`;
          unitPrice.innerHTML = unitPriceContent;
        } else {
          unitPriceWrapper.classList.add('hidden');
        }
      }

      syncWithMainProductForm() {
        FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, (event) => {
          const mainSectionId =
            this.mainProductInfo?.dataset?.originalSection || this.mainProductInfo?.dataset?.section;
          const isMainProduct = event.data.sectionId === mainSectionId;
          if (!isMainProduct) return;

          if (this.isUpdating) {
            this.isUpdating = false;
          }

          const variant = event.data.variant;
          const variantInput = this.querySelector('[name="id"]');

          this.currentVariant = variant;
          if (variant?.id != null) {
            variantInput.value = String(variant.id);
            this.selectedVariantId = String(variant.id);
          }

          const pasMode = this.mainVariantSelects?.dataset?.wePdpPreisNachGrose === 'true';
          if (pasMode && typeof this.mainProductInfo?.syncStickyPriceFromMain === 'function') {
            this.mainProductInfo.syncStickyPriceFromMain();
            const stickyRegular = this.querySelector('.f-price__regular .f-price-item--regular');
            const stickyText = stickyRegular?.innerText?.trim().toLowerCase() || '';
            if (variant && (stickyText.startsWith('ab') || !stickyText)) {
              this.updatePrice();
            }
          } else if (variant) {
            this.updatePrice();
          }

          this.updateButton(true, '', false);
          if (!variant) {
            this.updateButton(true, '', true);
          } else {
            this.updateButton(!variant.available, FoxTheme.variantStrings.soldOut);
          }

          if (variant) {
            this.updateQuantityInput();
          }
        });
      }
    }
  );
}

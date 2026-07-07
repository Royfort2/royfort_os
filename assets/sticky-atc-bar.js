if (!customElements.get('sticky-atc-bar')) {
  customElements.define(
    'sticky-atc-bar',
    class StickyAtcBar extends HTMLElement {
      constructor() {
        super();
      }

      get productId() {
        return this.getAttribute('data-product-id');
      }

      connectedCallback() {
        this.mainProductInfo = document.querySelector(`product-info[data-product-id="${this.productId}"]`);
        this.productFormActions = document.querySelector(
          `.main-product-form[data-product-id="${this.productId}"]`
        );
        this.container = this.closest('.sticky-atc-bar');
        this.submitButton = this.querySelector('[data-sticky-atc-submit]');

        this.initVisibility();
        this.bindSubmit();
        this.bindSync();

        requestAnimationFrame(() => this.syncFromMain());
      }

      setBarVisible(visible) {
        this.container?.classList.toggle('sticky-atc-bar--show', visible);
        document.body.classList.toggle('sticky-atc-bar-enabled', visible);
        if (visible) {
          this.updateBarHeight();
        } else {
          document.documentElement.style.setProperty('--sticky-atc-bar-height', '0px');
        }
      }

      initVisibility() {
        const sectionId = this.mainProductInfo?.dataset?.section;
        const observeTarget =
          (sectionId && document.getElementById(`ProductSubmitButton-${sectionId}`)) ||
          this.mainProductInfo?.querySelector('.product__block--buy_buttons .product-form__submit') ||
          this.productFormActions;

        if (!observeTarget) {
          this.setBarVisible(true);
          return;
        }

        this.observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
              this.setBarVisible(scrolledPast);
            });
          },
          { threshold: 0 }
        );
        this.observer.observe(observeTarget);
        this.setBarVisible(false);
        window.addEventListener('resize', () => {
          if (this.container?.classList.contains('sticky-atc-bar--show')) {
            this.updateBarHeight();
          }
        }, { passive: true });
      }

      updateBarHeight() {
        document.documentElement.style.setProperty('--sticky-atc-bar-height', `${this.clientHeight}px`);
      }

      bindSubmit() {
        this.submitButton?.addEventListener('click', (e) => {
          e.preventDefault();
          if (this.submitButton.disabled || !this.productFormActions) return;
          this.productFormActions.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => this.productFormActions.requestSubmit(), 300);
        });
      }

      bindSync() {
        document.addEventListener('pdp-set:refresh-submit', () => this.syncFromMain());
        if (typeof FoxTheme !== 'undefined' && FoxTheme.pubsub?.PUB_SUB_EVENTS) {
          FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, () => {
            requestAnimationFrame(() => this.syncFromMain());
          });
        }
      }

      syncFromMain() {
        if (!this.mainProductInfo) {
          this.updateBarHeight();
          return;
        }

        if (typeof this.mainProductInfo.syncStickyPriceFromMain === 'function') {
          this.mainProductInfo.syncStickyPriceFromMain();
        }

        const breakdownSrc = this.mainProductInfo.querySelector('.pdp-set-zwischensumme__breakdown');
        const breakdownDst = this.querySelector('[data-sticky-atc-breakdown]');
        if (breakdownDst) {
          const text = breakdownSrc?.textContent?.trim() || '';
          breakdownDst.textContent = text;
          breakdownDst.hidden = !text;
        }

        const sectionId = this.mainProductInfo.dataset.section;
        const mainBtn = document.getElementById(`ProductSubmitButton-${sectionId}`);
        const stickyBtn = this.submitButton;
        if (mainBtn && stickyBtn) {
          stickyBtn.disabled = mainBtn.disabled;
          stickyBtn.style.pointerEvents = mainBtn.style.pointerEvents;
          stickyBtn.style.opacity = mainBtn.style.opacity;

          const mainLabel = mainBtn.querySelector(':scope > span');
          const stickyMain = stickyBtn.querySelector('.pdp-atc-label__main');
          const stickyCount = stickyBtn.querySelector('.pdp-atc-label__count');
          const mainMain = mainLabel?.querySelector('.pdp-atc-label__main');
          const mainCount = mainLabel?.querySelector('.pdp-atc-label__count');

          if (stickyMain && mainMain) {
            stickyMain.textContent = mainMain.textContent;
            if (stickyCount && mainCount) {
              stickyCount.textContent = mainCount.textContent;
              stickyCount.hidden = mainCount.hidden;
            }
          } else if (mainLabel && stickyMain) {
            stickyMain.textContent = mainLabel.textContent.trim();
            if (stickyCount) stickyCount.hidden = true;
          }
        }

        this.updateBarHeight();
      }
    }
  );
}

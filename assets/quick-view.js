if (!customElements.get('quick-view-modal')) {
  customElements.define(
    'quick-view-modal',
    class QuickViewModal extends DrawerComponent {
      constructor() {
        super();

        this._classes = {
          loaded: 'quick-view-loaded',
        };
        this.drawerBody = this.querySelector(this.selector);

        this._QV_GLOBAL_SCRIPTS = [
          'product-form-line-items.js',
          'product-set-cart-items.js',
          'product-info.js',
          'we-details-select.js',
          'we-variant-dropdown-meta.js',
          'we-quantity-selector-cap.js',
        ];
      }

      get selector() {
        return '.quick-view__content';
      }

      get sourceSelector() {
        return '#MainProduct-quick-view__content';
      }

      get requiresBodyAppended() {
        return !(Shopify.designMode && this.closest('.section-group-overlay-quick-view'));
      }

      shouleBeShow() {
        const sectionId = this.getProductQuickViewSectionId();
        return typeof sectionId === 'string';
      }

      prepareToShow() {
        super.prepareToShow();
        this.quickview();
      }

      handleAfterShow() {
        super.handleAfterShow();
        document.dispatchEvent(
          new CustomEvent('quick-view:open', {
            detail: { productUrl: this.dataset.productUrl },
          })
        );
      }

      handleAfterHide() {
        super.handleAfterHide();
        this._stickyActionsObserver?.disconnect();
        this._stickyActionsObserver = null;
        if (this._stickyActionsRelocateTimer) {
          clearTimeout(this._stickyActionsRelocateTimer);
          this._stickyActionsRelocateTimer = null;
        }
        if (this._stickyActionsResizeHandler) {
          window.removeEventListener('resize', this._stickyActionsResizeHandler);
          this._stickyActionsResizeHandler = null;
        }
        this.querySelector('.quick-view__footer')?.remove();
        const drawerContent = this.querySelector(this.selector);
        drawerContent.innerHTML = '';
        this.classList.remove(this._classes.loaded);
      }

      getProductQuickViewSectionId() {
        let sectionId = FoxTheme.QuickViewSectionId || false;

        if (!sectionId) {
          // Get section id from overlay groups.
          const productQuickView = document.querySelector('.section-group-overlay-quick-view');
          if (productQuickView) {
            sectionId = FoxTheme.utils.getSectionId(productQuickView);
          }

          // Cache for better performance.
          FoxTheme.QuickViewSectionId = sectionId;
        }

        return sectionId;
      }

      getDrawerInner(drawerContent) {
        return drawerContent?.closest('.drawer__inner') || null;
      }

      syncBundleForms(drawerContent) {
        const drawerInner = this.getDrawerInner(drawerContent);
        const scope = drawerInner || drawerContent;
        scope.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
          if (typeof window.syncPdpSetBundleForm === 'function') {
            window.syncPdpSetBundleForm(form);
          }
        });
      }

      dispatchBundleSync(drawerContent) {
        const drawerInner = this.getDrawerInner(drawerContent);
        const root = drawerInner || drawerContent;
        const detail = { root };

        document.dispatchEvent(
          new CustomEvent('pdp-set:bind-bundle-forms', { bubbles: true, detail })
        );
        document.dispatchEvent(
          new CustomEvent('pdp-set:refresh-submit', { bubbles: true, detail })
        );
        this.syncBundleForms(drawerContent);
      }

      quickview() {
        const drawerContent = this.querySelector(this.selector);
        const sectionId = this.getProductQuickViewSectionId();
        const basePath = this.dataset.productUrl.split('?')[0];
        const params = new URLSearchParams();
        params.set('section_id', sectionId);
        try {
          const u = new URL(this.dataset.productUrl, window.location.origin);
          const v = u.searchParams.get('variant');
          if (v) params.set('variant', v);
        } catch (e) {
          /* ignore */
        }
        const sectionUrl = `${basePath}?${params.toString()}`;
        fetch(sectionUrl)
          .then((response) => response.text())
          .then((responseText) => {
            const productElement = new DOMParser()
              .parseFromString(responseText, 'text/html')
              .querySelector(this.sourceSelector);

            this.setInnerHTML(drawerContent, productElement.content.cloneNode(true));
            FoxTheme.a11y.trapFocus(this, this.focusElement);

            if (window.Shopify && Shopify.PaymentButton) {
              Shopify.PaymentButton.init();
            }

            if (typeof window.initWeDetailsSelects === 'function') {
              window.initWeDetailsSelects(drawerContent);
            }
            if (typeof window.initWeVariantDropdownMeta === 'function') {
              window.initWeVariantDropdownMeta(drawerContent);
            }

            this.relocateStickyActionsForMobile(drawerContent);
            this.observeStickyActions(drawerContent);

            requestAnimationFrame(() => {
              this.relocateStickyActionsForMobile(drawerContent);
              this.dispatchBundleSync(drawerContent);
            });

            document.dispatchEvent(
              new CustomEvent('quick-view:loaded', {
                detail: { productUrl: this.dataset.productUrl },
              })
            );

            setTimeout(() => {
              this.classList.add(this._classes.loaded);
              this.relocateStickyActionsForMobile(drawerContent);
              this.dispatchBundleSync(drawerContent);
            }, 300);
          })
          .catch((e) => {
            console.error(e);
          });
      }

      relocateStickyActionsForMobile(drawerContent) {
        const drawerInner = drawerContent.closest('.drawer__inner');
        const stickyBar =
          drawerContent.querySelector('.quick-view__sticky-actions') ||
          drawerInner?.querySelector('.quick-view__sticky-actions');
        const blocks = drawerContent.querySelector('.product__info-container .product__blocks');

        if (!stickyBar) return;

        if (!window.matchMedia('(max-width: 767.98px)').matches) {
          if (blocks && stickyBar.parentElement !== blocks) {
            blocks.appendChild(stickyBar);
          }
          drawerInner?.querySelector('.quick-view__footer')?.remove();
          return;
        }

        if (!drawerInner) return;

        let footer = drawerInner.querySelector('.quick-view__footer');
        if (!footer) {
          footer = document.createElement('div');
          footer.className = 'quick-view__footer';
          drawerInner.appendChild(footer);
        }

        footer.appendChild(stickyBar);
      }

      observeStickyActions(drawerContent) {
        this._stickyActionsObserver?.disconnect();

        const scheduleRelocate = () => {
          if (this._stickyActionsRelocateTimer) {
            clearTimeout(this._stickyActionsRelocateTimer);
          }
          this._stickyActionsRelocateTimer = setTimeout(() => {
            this._stickyActionsRelocateTimer = null;
            this.relocateStickyActionsForMobile(drawerContent);
            if (typeof window.refreshPdpSetBundleFormsInScope === 'function') {
              const drawerInner = this.getDrawerInner(drawerContent);
              window.refreshPdpSetBundleFormsInScope(drawerInner || drawerContent);
            }
          }, 80);
        };

        this._stickyActionsObserver = new MutationObserver(scheduleRelocate);
        this._stickyActionsObserver.observe(drawerContent, { childList: true, subtree: true });

        if (!this._stickyActionsResizeHandler) {
          this._stickyActionsResizeHandler = () => {
            if (!this.open) return;
            this.relocateStickyActionsForMobile(this.querySelector(this.selector));
            if (typeof window.refreshPdpSetBundleFormsInScope === 'function') {
              const drawerContent = this.querySelector(this.selector);
              const drawerInner = this.getDrawerInner(drawerContent);
              window.refreshPdpSetBundleFormsInScope(drawerInner || drawerContent);
            }
          };
          window.addEventListener('resize', this._stickyActionsResizeHandler);
        }
      }

      setInnerHTML(element, innerHTML) {
        element.innerHTML = '';
        element.appendChild(innerHTML);
        element.querySelectorAll('script').forEach((oldScriptTag) => {
          const src = oldScriptTag.getAttribute('src') || '';
          const isGlobalScript = this._QV_GLOBAL_SCRIPTS.some((name) => src.includes(name));
          if (isGlobalScript) {
            oldScriptTag.remove();
            return;
          }

          const newScriptTag = document.createElement('script');
          Array.from(oldScriptTag.attributes).forEach((attribute) => {
            newScriptTag.setAttribute(attribute.name, attribute.value);
          });
          newScriptTag.appendChild(document.createTextNode(oldScriptTag.innerHTML));
          oldScriptTag.parentNode.replaceChild(newScriptTag, oldScriptTag);
        });
      }

      disconnectedCallback() {
        super.disconnectedCallback();
        this.handleAfterHide();
      }
    }
  );
}

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
          'variant-selects.js',
          'product-set-picker-price.js',
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
        this._invalidateQuickViewRequest();
        this._stickyActionsObserver?.disconnect();
        this._stickyActionsObserver = null;
        if (this._stickyActionsRelocateTimer) {
          clearTimeout(this._stickyActionsRelocateTimer);
          this._stickyActionsRelocateTimer = null;
        }
        if (this._quickViewLoadedTimer) {
          clearTimeout(this._quickViewLoadedTimer);
          this._quickViewLoadedTimer = null;
        }
        if (this._stickyActionsResizeHandler) {
          window.removeEventListener('resize', this._stickyActionsResizeHandler);
          this._stickyActionsResizeHandler = null;
        }
        this._cleanupQuickViewUiState();
        this.querySelector('.quick-view__footer')?.remove();
        const drawerContent = this.querySelector(this.selector);
        if (drawerContent) drawerContent.innerHTML = '';
        this.classList.remove(this._classes.loaded);
      }

      _invalidateQuickViewRequest() {
        this._quickViewRequestId = (this._quickViewRequestId || 0) + 1;
      }

      _cleanupQuickViewUiState() {
        const drawerContent = this.querySelector(this.selector);
        drawerContent?.querySelectorAll('details.we-select-container[open]').forEach((details) => {
          details.removeAttribute('open');
          details.classList.remove('we-select-container--closing');
        });

        // Only clear body-portaled sheets when no dropdown OUTSIDE this modal is still open,
        // so we don't tear down a background PDP's open mobile sheet.
        const openOutside = Array.from(
          document.querySelectorAll('details.we-select-container[open]')
        ).some((el) => !this.contains(el));

        if (!openOutside) {
          if (typeof window.cleanupWeSelectBodyState === 'function') {
            window.cleanupWeSelectBodyState();
          } else {
            document.querySelectorAll('body > .we-select-mobile-portal').forEach((portal) => {
              portal.remove();
            });
            document.body.style.overflow = '';
          }
        }
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
        if (!drawerContent) return;

        const requestId = (this._quickViewRequestId = (this._quickViewRequestId || 0) + 1);
        if (this._quickViewLoadedTimer) {
          clearTimeout(this._quickViewLoadedTimer);
          this._quickViewLoadedTimer = null;
        }
        this.classList.remove(this._classes.loaded);

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
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Quick view fetch failed: ${response.status}`);
            }
            return response.text();
          })
          .then((responseText) => {
            if (requestId !== this._quickViewRequestId || !this.open) return;

            const productElement = new DOMParser()
              .parseFromString(responseText, 'text/html')
              .querySelector(this.sourceSelector);

            if (!productElement?.content) {
              throw new Error('Quick view: product template missing');
            }

            this._cleanupQuickViewUiState();
            this.setInnerHTML(drawerContent, productElement.content.cloneNode(true));
            if (requestId !== this._quickViewRequestId || !this.open) return;

            // Best-effort re-inits. A throwing third-party widget (e.g. Stamped's widget.min.js)
            // or a failing theme init must NOT leave the drawer stuck on the loading spinner.
            const safe = (fn) => {
              try {
                fn();
              } catch (err) {
                console.error('Quick view init error (continuing):', err);
              }
            };

            safe(() => FoxTheme.a11y.trapFocus(this, this.focusElement));
            safe(() => {
              if (window.Shopify && Shopify.PaymentButton) Shopify.PaymentButton.init();
            });
            safe(() => {
              if (typeof window.initWeDetailsSelects === 'function') {
                window.initWeDetailsSelects(drawerContent);
              }
            });
            safe(() => {
              if (typeof window.initWeVariantDropdownMeta === 'function') {
                window.initWeVariantDropdownMeta(drawerContent);
              }
            });
            safe(() => this.relocateStickyActionsForMobile(drawerContent));
            safe(() => this.observeStickyActions(drawerContent));

            // Reveal the product and clear the spinner NOW, before any deferred/refinement work,
            // so nothing downstream can strand the user on an endless spinner.
            this.classList.add(this._classes.loaded);

            requestAnimationFrame(() => {
              if (requestId !== this._quickViewRequestId || !this.open) return;
              safe(() => this.relocateStickyActionsForMobile(drawerContent));
              safe(() => this.dispatchBundleSync(drawerContent));
            });

            safe(() =>
              document.dispatchEvent(
                new CustomEvent('quick-view:loaded', {
                  detail: { productUrl: this.dataset.productUrl },
                })
              )
            );

            this._quickViewLoadedTimer = setTimeout(() => {
              if (requestId !== this._quickViewRequestId || !this.open) return;
              this.classList.add(this._classes.loaded);
              safe(() => this.relocateStickyActionsForMobile(drawerContent));
              safe(() => this.dispatchBundleSync(drawerContent));
            }, 300);
          })
          .catch((e) => {
            console.error(e);
            // Don't leave the user staring at an infinite spinner — fall back to the product page.
            if (requestId === this._quickViewRequestId && this.open && this.dataset.productUrl) {
              window.location.href = this.dataset.productUrl;
            }
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

        if (stickyBar.parentElement !== footer) {
          footer.appendChild(stickyBar);
        }
      }

      observeStickyActions(drawerContent) {
        this._stickyActionsObserver?.disconnect();

        const scheduleRelocate = () => {
          if (this._stickyActionsRelocateTimer) {
            clearTimeout(this._stickyActionsRelocateTimer);
          }
          this._stickyActionsRelocateTimer = setTimeout(() => {
            this._stickyActionsRelocateTimer = null;
            if (!this.open) return;
            const stickyBar =
              drawerContent.querySelector('.quick-view__sticky-actions') ||
              this.getDrawerInner(drawerContent)?.querySelector('.quick-view__sticky-actions');
            const parentBefore = stickyBar?.parentElement || null;
            this.relocateStickyActionsForMobile(drawerContent);
            const parentAfter = stickyBar?.parentElement || null;
            if (
              parentBefore !== parentAfter &&
              typeof window.refreshPdpSetBundleFormsInScope === 'function'
            ) {
              const drawerInner = this.getDrawerInner(drawerContent);
              window.refreshPdpSetBundleFormsInScope(drawerInner || drawerContent);
            }
          }, 120);
        };

        this._stickyActionsObserver = new MutationObserver(scheduleRelocate);
        this._stickyActionsObserver.observe(drawerContent, { childList: true, subtree: true });

        if (!this._stickyActionsResizeHandler) {
          this._stickyActionsResizeHandler = () => {
            if (!this.open) return;
            this.relocateStickyActionsForMobile(this.querySelector(this.selector));
            if (typeof window.refreshPdpSetBundleFormsInScope === 'function') {
              const dc = this.querySelector(this.selector);
              const drawerInner = this.getDrawerInner(dc);
              window.refreshPdpSetBundleFormsInScope(drawerInner || dc);
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

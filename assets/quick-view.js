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
        this.querySelector('.quick-view__footer')?.remove();
        const drawerContent = this.querySelector(this.selector);
        drawerContent.innerHTML = '';
        this.classList.remove(this._classes.loaded);
      }

<<<<<<< Updated upstream
=======
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

>>>>>>> Stashed changes
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
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Quick view fetch failed: ${response.status}`);
            }
            return response.text();
          })
          .then((responseText) => {
            const productElement = new DOMParser()
              .parseFromString(responseText, 'text/html')
              .querySelector(this.sourceSelector);

<<<<<<< Updated upstream
            this.setInnerHTML(drawerContent, productElement.content.cloneNode(true));
            FoxTheme.a11y.trapFocus(this, this.focusElement);
=======
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
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
            if (typeof window.initWeDetailsSelects === 'function') {
              window.initWeDetailsSelects(drawerContent);
            }
            if (typeof window.initWeVariantDropdownMeta === 'function') {
              window.initWeVariantDropdownMeta(drawerContent);
            }
            document.dispatchEvent(new CustomEvent('pdp-set:bind-bundle-forms', { bubbles: true }));
            if (typeof window.syncPdpSetBundleForm === 'function') {
              drawerContent.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
                window.syncPdpSetBundleForm(form);
              });
            }
=======
            // Reveal the product and clear the spinner NOW, before any deferred/refinement work,
            // so nothing downstream can strand the user on an endless spinner.
            this.classList.add(this._classes.loaded);

            requestAnimationFrame(() => {
              if (requestId !== this._quickViewRequestId || !this.open) return;
              safe(() => this.relocateStickyActionsForMobile(drawerContent));
              safe(() => this.dispatchBundleSync(drawerContent));
            });
>>>>>>> Stashed changes

            safe(() =>
              document.dispatchEvent(
                new CustomEvent('quick-view:loaded', {
                  detail: { productUrl: this.dataset.productUrl },
                })
              )
            );

            this.relocateStickyActionsForMobile(drawerContent);
            this.observeStickyActions(drawerContent);

            setTimeout(() => {
              this.classList.add(this._classes.loaded);
<<<<<<< Updated upstream
              this.relocateStickyActionsForMobile(drawerContent);
              document.dispatchEvent(new CustomEvent('pdp-set:bind-bundle-forms', { bubbles: true }));
              if (typeof window.syncPdpSetBundleForm === 'function') {
                drawerContent.querySelectorAll('form.pdp-set-bundle').forEach((form) => {
                  window.syncPdpSetBundleForm(form);
                });
              }
=======
              safe(() => this.relocateStickyActionsForMobile(drawerContent));
              safe(() => this.dispatchBundleSync(drawerContent));
>>>>>>> Stashed changes
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
        if (!window.matchMedia('(max-width: 767.98px)').matches) return;

        const stickyBar = drawerContent.querySelector('.quick-view__sticky-actions');
        const drawerInner = drawerContent.closest('.drawer__inner');
        if (!stickyBar || !drawerInner) return;

        let footer = drawerInner.querySelector('.quick-view__footer');
        if (!footer) {
          footer = document.createElement('div');
          footer.className = 'quick-view__footer';
          drawerInner.appendChild(footer);
        }

        footer.appendChild(stickyBar);
      }

      observeStickyActions(drawerContent) {
        if (!window.matchMedia('(max-width: 767.98px)').matches) return;

        this._stickyActionsObserver?.disconnect();
        this._stickyActionsObserver = new MutationObserver(() => {
          const stickyBar = drawerContent.querySelector('.quick-view__sticky-actions');
          const footer = drawerContent.closest('.drawer__inner')?.querySelector('.quick-view__footer');
          if (stickyBar && stickyBar.parentElement !== footer) {
            this.relocateStickyActionsForMobile(drawerContent);
          }
        });
        this._stickyActionsObserver.observe(drawerContent, { childList: true, subtree: true });
      }

      setInnerHTML(element, innerHTML) {
        element.innerHTML = '';
        element.appendChild(innerHTML);
        element.querySelectorAll('script').forEach((oldScriptTag) => {
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

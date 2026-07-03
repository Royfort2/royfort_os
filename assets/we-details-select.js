(function () {
  if (window.__weDetailsSelectBootstrapped) {
    if (typeof window.initWeDetailsSelects === 'function') {
      window.initWeDetailsSelects(document);
    }
    return;
  }
  window.__weDetailsSelectBootstrapped = true;

  /**
   * One instance per <details> container. Global listeners (document pointerdown / window resize)
   * are bound ONCE at module scope and dispatch to live instances via this WeakMap — so instances
   * created on every quick-view open don't leak a growing pile of global listeners.
   */
  const instanceByContainer = new WeakMap();
  let globalWeSelectListenersBound = false;

  function bindGlobalWeSelectListeners() {
    if (globalWeSelectListenersBound) return;
    globalWeSelectListenersBound = true;

    document.addEventListener(
      'pointerdown',
      (event) => {
        document.querySelectorAll('details.we-select-container[open]').forEach((container) => {
          const inst = instanceByContainer.get(container);
          if (inst) inst._onDocumentPointerDown(event);
        });
      },
      true
    );

    window.addEventListener('resize', () => {
      document.querySelectorAll('details.we-select-container').forEach((container) => {
        const inst = instanceByContainer.get(container);
        if (inst) inst._onResize();
      });
    });
  }

  class detailSelect {
    constructor(container) {
      this.container = container;
      this.portalEl = container.querySelector('.we-select-mobile-portal');
      const scope = this.portalEl || container;
      this.options = scope.querySelectorAll('.we-select > .we-select__item');
      const checked = scope.querySelector('.we-select input[type="radio"]:checked');
      this.value = checked ? checked.value : null;
      this.mouseDown = false;
      this._portaled = false;
      this._placeholder = null;
      this._isClosingSheet = false;
      this._sheetAnimationEndHandler = null;
      this._closeSheetFallbackTimer = null;
      this._onResize = this._onResize.bind(this);
      this._onDocumentPointerDown = this._onDocumentPointerDown.bind(this);
      instanceByContainer.set(container, this);
      this._addEventListeners();
      this._setAria();
      this._syncActiveFromDom();
      this.updateValue();
      bindGlobalWeSelectListeners();
    }

    /**
     * Move only the overlay (not <details>) to body so fixed positioning uses the viewport
     * while .we-select-container stays in .product-form__input.
     */
    _portalToBody() {
      if (this._portaled || !this._isMobileSheet() || !this.portalEl) return;
      const parent = this.portalEl.parentNode;
      if (!parent) return;
      this._placeholder = document.createComment('we-select-portal');
      parent.insertBefore(this._placeholder, this.portalEl);
      document.body.appendChild(this.portalEl);
      this.portalEl.classList.add('we-select-container--portaled');
      const styleCtx = this.container.closest('.we-product-block');
      if (styleCtx) {
        this.portalEl.classList.add('we-product-block');
      }
      this._portaled = true;
    }

    _restoreFromBody() {
      if (!this._portaled || !this.portalEl) return;
      if (this._placeholder && this._placeholder.parentNode) {
        this._placeholder.parentNode.insertBefore(this.portalEl, this._placeholder);
        this._placeholder.remove();
      }
      this._placeholder = null;
      this.portalEl.classList.remove('we-select-container--portaled', 'we-product-block');
      this._portaled = false;
    }

    _isMobileSheet() {
      return window.matchMedia('(max-width: 767.98px)').matches;
    }

    _setBodyScrollLock(locked) {
      if (!this._isMobileSheet()) return;
      document.body.style.overflow = locked ? 'hidden' : '';
    }

    _onResize() {
      if (!this._isMobileSheet()) {
        this._setBodyScrollLock(false);
        if (this.container.open) {
          this._cancelClosingSheetListeners();
          this._isClosingSheet = false;
          this.container.classList.remove('we-select-container--closing');
          this.portalEl?.classList.remove('we-select-container--closing');
          this._restoreFromBody();
          this.container.removeAttribute('open');
        }
      }
    }

    /**
     * Desktop: close this dropdown when a pointerdown lands outside it. `focusout` alone misses
     * clicks on non-focusable page chrome, so this is the reliable outside-click close.
     * Mobile uses the backdrop/sheet close instead.
     */
    _onDocumentPointerDown(event) {
      if (!this.container.open) return;
      if (this._isMobileSheet()) return;
      const target = event.target;
      if (this.container.contains(target)) return;
      if (this.portalEl && this.portalEl.contains(target)) return;
      this.container.removeAttribute('open');
    }

    _cancelClosingSheetListeners() {
      if (this._closeSheetFallbackTimer) {
        clearTimeout(this._closeSheetFallbackTimer);
        this._closeSheetFallbackTimer = null;
      }
      if (this._sheetAnimationEndHandler) {
        const sheet = this.portalEl?.querySelector('.we-select-mobile-sheet');
        if (sheet) sheet.removeEventListener('animationend', this._sheetAnimationEndHandler);
        this._sheetAnimationEndHandler = null;
      }
    }

    /**
     * Close mobile sheet with exit animation (theme drawer–style), then remove [open].
     */
    _closeMobileSheet() {
      if (!this._isMobileSheet() || !this.container.open) return;
      if (this._isClosingSheet) return;

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this._finishClosingSheet();
        return;
      }

      this._isClosingSheet = true;
      this.container.classList.add('we-select-container--closing');
      this.portalEl?.classList.add('we-select-container--closing');

      const sheet = this.portalEl?.querySelector('.we-select-mobile-sheet');
      if (!sheet) {
        this._finishClosingSheet();
        return;
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this._cancelClosingSheetListeners();
        this._finishClosingSheet();
      };

      this._sheetAnimationEndHandler = (e) => {
        if (e.target !== sheet) return;
        const name = e.animationName || '';
        if (!String(name).includes('we-select-sheet-out')) return;
        finish();
      };

      sheet.addEventListener('animationend', this._sheetAnimationEndHandler);
      this._closeSheetFallbackTimer = setTimeout(finish, 450);
    }

    _finishClosingSheet() {
      this._isClosingSheet = false;
      this.container.classList.remove('we-select-container--closing');
      this.portalEl?.classList.remove('we-select-container--closing');
      this._cancelClosingSheetListeners();
      if (this.container.open) {
        this.container.removeAttribute('open');
      }
      /* Belt-and-suspenders: ensure scroll isn’t left locked if toggle ordering differs by browser. */
      this._setBodyScrollLock(false);
    }

    _syncActiveFromDom() {
      this.options.forEach((opt) => {
        const input = opt.querySelector('input[type="radio"]');
        if (!input) return;
        if (input.checked) {
          opt.classList.add('active');
          opt.setAttribute('aria-selected', 'true');
        } else {
          opt.classList.remove('active');
          opt.setAttribute('aria-selected', 'false');
        }
      });
    }

    _currentOptionIndex() {
      const checked = (this.portalEl || this.container).querySelector('.we-select__item input[type="radio"]:checked');
      if (!checked) return 0;
      const item = checked.closest('.we-select__item');
      return Math.max(0, [...this.options].indexOf(item));
    }

    _addEventListeners() {
      this.container.addEventListener('toggle', () => {
        if (this._isMobileSheet()) {
          if (this.container.open) {
            this.container.classList.remove('we-select-container--closing');
            this.portalEl?.classList.remove('we-select-container--closing');
            this._isClosingSheet = false;
            this._portalToBody();
            this._setBodyScrollLock(true);
          } else {
            this._restoreFromBody();
            this._setBodyScrollLock(false);
            this.updateValue();
          }
          return;
        }
        if (this.container.open) return;
        this.updateValue();
      });

      const backdrop = (this.portalEl || this.container).querySelector('.we-select-mobile-backdrop');
      if (backdrop) {
        backdrop.addEventListener('click', () => {
          if (this._isMobileSheet()) {
            this._closeMobileSheet();
          } else {
            this.container.removeAttribute('open');
          }
        });
      }

      const sheetClose = (this.portalEl || this.container).querySelector('.we-select-mobile-sheet__close');
      if (sheetClose) {
        sheetClose.addEventListener('click', (e) => {
          e.preventDefault();
          if (this._isMobileSheet()) {
            this._closeMobileSheet();
          } else {
            this.container.removeAttribute('open');
          }
        });
      }

      this.container.addEventListener('focusout', (e) => {
        if (this.mouseDown) return;
        if (this._isMobileSheet()) return;
        // Stay open while focus moves within the listbox (e.g. summary → option radios/labels).
        if (e.relatedTarget != null && this.container.contains(e.relatedTarget)) return;
        this.container.removeAttribute('open');
      });

      this.options.forEach((opt) => {
        opt.addEventListener('mousedown', () => {
          this.mouseDown = true;
        });
        opt.addEventListener('mouseup', () => {
          this.mouseDown = false;
          // Close after click/change; mouseup/touch fires before radio `change` on mobile too — defer like desktop.
          if (this._isMobileSheet()) {
            setTimeout(() => this._closeMobileSheet(), 0);
          } else {
            setTimeout(() => {
              this.container.removeAttribute('open');
            }, 0);
          }
        });
      });

      const vsRoot = this.container.closest('variant-selects');
      (this.portalEl || this.container).querySelectorAll('.we-select > .we-select__item input[type="radio"]').forEach((input) => {
        if (vsRoot?.id) input.dataset.vsRoot = vsRoot.id;
        input.addEventListener('change', () => {
          if (input.checked) this.setValue(input);
        });
      });

      this.container.addEventListener('keyup', (e) => {
        const keycode = e.which;
        const current = this._currentOptionIndex();
        switch (keycode) {
          case 27:
            if (this.container.open) {
              // Close only the dropdown; don't let Escape bubble to the drawer/modal handler.
              e.stopPropagation();
            }
            if (this._isMobileSheet()) {
              this._closeMobileSheet();
            } else {
              this.container.removeAttribute('open');
            }
            break;
          case 35:
            e.preventDefault();
            if (!this.container.open) this.container.setAttribute('open', '');
            this.setChecked(this.options[this.options.length - 1].querySelector('input'));
            break;
          case 36:
            e.preventDefault();
            if (!this.container.open) this.container.setAttribute('open', '');
            this.setChecked(this.options[0].querySelector('input'));
            break;
          case 38:
            e.preventDefault();
            if (!this.container.open) this.container.setAttribute('open', '');
            this.setChecked(this.options[current > 0 ? current - 1 : 0].querySelector('input'));
            break;
          case 40:
            e.preventDefault();
            if (!this.container.open) this.container.setAttribute('open', '');
            this.setChecked(
              this.options[current < this.options.length - 1 ? current + 1 : this.options.length - 1].querySelector(
                'input'
              )
            );
            break;
        }
      });
    }

    _setAria() {
      this.container.setAttribute('aria-haspopup', 'listbox');
      const listbox = (this.portalEl || this.container).querySelector('.we-select');
      if (listbox) listbox.setAttribute('role', 'listbox');
      const summary = this.container.querySelector('.we-select-container__summary');
      if (summary) {
        summary.setAttribute('aria-live', 'polite');
      }
      this.options.forEach((opt) => {
        opt.setAttribute('role', 'option');
      });
    }

    updateValue() {
      const scope = this.portalEl || this.container;
      const that = scope.querySelector('.we-select input[type="radio"]:checked');
      if (!that) return;
      this.setValue(that);
    }

    setChecked(that) {
      if (!that) return;
      that.checked = true;
      this.setValue(that);
    }

    setValue(that) {
      if (!that) return;

      const summary = this.container.querySelector('.we-select-container__summary');
      const label = that.parentNode && that.parentNode.querySelector('label');
      if (!summary || !label) return;

      this.container.classList.remove('we-select-container--placeholder');

      const pos = [...this.options].indexOf(that.parentNode) + 1;

      if (this.value !== that.value) {
        this.value = that.value;
      }

      const shortQtyLine = label.querySelector('.we-select__qty-line--short');
      const inlineQtyVal = summary.querySelector('.pdp-inline-qty-we-select__value');
      if (shortQtyLine) {
        if (inlineQtyVal) {
          inlineQtyVal.innerHTML = shortQtyLine.innerHTML;
        } else {
          summary.innerHTML = shortQtyLine.innerHTML;
        }
      } else {
        const primary = label.querySelector('.we-select__label-primary');
        summary.innerHTML = primary ? primary.innerHTML : label.innerHTML;
      }
      summary.setAttribute('aria-label', `${that.value}, listbox ${pos} of ${this.options.length}`);

      const isInlineQuantityDropdown =
        !!this.container.closest('.pdp-inline-quantity') || !!this.container.closest('.we-quantity-selector');
      if (!isInlineQuantityDropdown) {
        const fieldset = this.container.closest('.product-form__input');
        const legendSwatch = fieldset?.querySelector('[data-selected-swatch-value]');
        if (legendSwatch) {
          if (shortQtyLine) {
            legendSwatch.textContent = shortQtyLine.textContent.replace(/\s+/g, ' ').trim();
          } else {
            const primaryForLegend = label.querySelector('.we-select__label-primary');
            legendSwatch.innerHTML = primaryForLegend ? primaryForLegend.innerHTML : label.innerHTML;
          }
        }
      }

      this.options.forEach((opt) => {
        opt.classList.remove('active');
        opt.setAttribute('aria-selected', 'false');
      });
      that.parentNode.classList.add('active');
      that.parentNode.setAttribute('aria-selected', 'true');
    }
  }

  function initWeDetailsSelects(root = document) {
    root.querySelectorAll('details.we-select-container:not([data-we-details-init])').forEach((el) => {
      el.dataset.weDetailsInit = 'true';
      new detailSelect(el);
    });
  }

  window.initWeDetailsSelects = initWeDetailsSelects;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWeDetailsSelects());
  } else {
    initWeDetailsSelects();
  }

  if (typeof FoxTheme !== 'undefined' && FoxTheme.pubsub && FoxTheme.pubsub.PUB_SUB_EVENTS) {
    FoxTheme.pubsub.subscribe(FoxTheme.pubsub.PUB_SUB_EVENTS.variantChange, () => {
      document.body.style.overflow = '';
      document.querySelectorAll('body > .we-select-mobile-portal.we-select-container--portaled').forEach((el) => {
        el.remove();
      });
      requestAnimationFrame(() => initWeDetailsSelects(document));
    });
  }

  function clearBodyScrollLockFromSheet() {
    if (
      window.matchMedia('(max-width: 767.98px)').matches &&
      document.querySelector('details.we-select-container[open]')
    ) {
      return;
    }
    document.body.style.overflow = '';
  }

  /*
   * Mobile sheet sets body overflow:hidden. After full load (images/layout) and on every pageshow,
   * clear a stuck lock — but not while a mobile sheet is still open.
   */
  window.addEventListener('load', clearBodyScrollLockFromSheet);
  window.addEventListener('pageshow', clearBodyScrollLockFromSheet);
})();

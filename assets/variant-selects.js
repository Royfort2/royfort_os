if (!customElements.get('variant-selects')) {
  customElements.define(
    'variant-selects',
    class VariantSelects extends HTMLElement {
      constructor() {
        super();
      }

      /** Mobile we-select portals radios to body; resolve checked input when it is no longer under this wrap. */
      _findCheckedOptionRadio(wrap) {
        /** Quantity radios stay in the wrap; option radios may be portaled — never treat qty as the option value. */
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

      get selectedOptionValues() {
        const ids = [];
        const optionValueId = (el) =>
          el?.dataset?.optionValueId ?? el?.getAttribute?.('data-option-value-id');

        this.querySelectorAll(':scope > .product-form__input').forEach((wrap) => {
          const optionSelect = wrap.querySelector('select[name^="options"]');
          if (optionSelect) {
            const opt = optionSelect.selectedOptions?.[0];
            const id = optionValueId(opt);
            if (id) ids.push(id);
            return;
          }
          const checked = this._findCheckedOptionRadio(wrap);
          if (checked) {
            const id = optionValueId(checked);
            if (id) ids.push(id);
          }
        });

        return ids;
      }

      connectedCallback() {
        this._onOptionChange = (event) => {
          const el = event.target;
          if (el?.closest?.('.pdp-inline-quantity')) return;
          if (el?.closest?.('.we-quantity-selector')) return;
          if (el?.tagName === 'SELECT' && el?.getAttribute?.('name') === 'quantity') return;

          this.updateSelectedSwatchValue(event);
        };

        this.addEventListener('change', this._onOptionChange);

        /** Mobile we-select portals radios under body; change does not bubble through variant-selects. */
        this._onDocumentChange = (event) => {
          const el = event.target;
          const vsRoot = el?.dataset?.vsRoot || el?.getAttribute?.('data-vs-root');
          if (el?.type !== 'radio' || vsRoot !== this.id) return;
          if (this.contains(el)) return;
          this._onOptionChange(event);
        };
        document.addEventListener('change', this._onDocumentChange, true);
      }

      disconnectedCallback() {
        this.removeEventListener('change', this._onOptionChange);
        if (this._onDocumentChange) {
          document.removeEventListener('change', this._onDocumentChange, true);
        }
      }

      updateSelectedSwatchValue({ target }) {
        const { value, tagName } = target;

        if (tagName === 'SELECT' && target.selectedOptions.length) {
          Array.from(target.options)
            .find((option) => option.getAttribute('selected'))
            .removeAttribute('selected');
          target.selectedOptions[0].setAttribute('selected', 'selected');

          const swatchValue = target.selectedOptions[0].dataset.optionSwatchValue;
          const selectedDropdownSwatchValue = target
            .closest('.product-form__input')
            .querySelector('[data-selected-value] > .swatch');
          if (!selectedDropdownSwatchValue) return;
          if (swatchValue) {
            selectedDropdownSwatchValue.style.setProperty('--swatch--background', swatchValue);
            selectedDropdownSwatchValue.classList.remove('swatch--unavailable');
          } else {
            selectedDropdownSwatchValue.style.setProperty('--swatch--background', 'unset');
            selectedDropdownSwatchValue.classList.add('swatch--unavailable');
          }

          selectedDropdownSwatchValue.style.setProperty(
            '--swatch-focal-point',
            target.selectedOptions[0].dataset.optionSwatchFocalPoint || 'unset'
          );
        } else if (tagName === 'INPUT' && target.type === 'radio') {
          if (target.hasAttribute('data-pdp-inline-qty-value')) return;
          if (target.closest?.('.we-quantity-selector')) return;
          if (target.closest?.('details.we-select-container')) {
            return;
          }
          let fieldset = target.closest('.product-form__input');
          if (!fieldset && target.dataset?.vsRoot) {
            const vs = document.getElementById(target.dataset.vsRoot);
            const nm = target.getAttribute('name');
            if (vs && nm) {
              const det = Array.from(vs.querySelectorAll('details.we-select-container')).find(
                (d) => d.dataset.radioGroupName === nm
              );
              fieldset = det?.closest('.product-form__input');
            }
          }
          const selectedSwatchValue =
            fieldset?.querySelector('[data-selected-swatch-value]') ||
            fieldset?.querySelector('[data-selected-value]');
          if (selectedSwatchValue) selectedSwatchValue.innerHTML = value;
        }
      }
    }
  );
}

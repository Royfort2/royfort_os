if (!customElements.get('variant-selects')) {
  customElements.define(
    'variant-selects',
    class VariantSelects extends HTMLElement {
      constructor() {
        super();
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
          const checked = wrap.querySelector(
            'input[type="radio"]:checked:not([data-pdp-inline-qty-value])'
          );
          if (checked) {
            const id = optionValueId(checked);
            if (id) ids.push(id);
          }
        });

        return ids;
      }

      getInputForEventTarget(target) {
        return target.tagName === 'SELECT' ? target.selectedOptions[0] : target;
      }

      connectedCallback() {
        this.addEventListener('change', (event) => {
          const el = event.target;
          if (el?.closest?.('.pdp-inline-quantity')) return;
          if (el?.tagName === 'SELECT' && el?.getAttribute?.('name') === 'quantity') return;

          const target = this.getInputForEventTarget(event.target);
          this.updateSelectedSwatchValue(event);
          FoxTheme.pubsub.publish(FoxTheme.pubsub.PUB_SUB_EVENTS.optionValueSelectionChange, {
            data: {
              event,
              target,
              selectedOptionValues: this.selectedOptionValues,
            },
          });
        });
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
          const fieldset = target.closest('.product-form__input');
          const selectedSwatchValue = fieldset?.querySelector(
            '[data-selected-swatch-value], [data-selected-value]'
          );
          if (selectedSwatchValue) selectedSwatchValue.innerHTML = value;
        }
      }
    }
  );
}

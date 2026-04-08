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

        this.querySelectorAll('select, input[type="radio"]:checked').forEach((el) => {
          if (el.tagName === 'SELECT') {
            const opt = el.selectedOptions?.[0];
            const id = optionValueId(opt);
            if (id) ids.push(id);
          } else if (el.type === 'radio' && el.checked) {
            const id = optionValueId(el);
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

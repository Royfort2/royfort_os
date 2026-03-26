if (!customElements.get('we-product-card')) {
  customElements.define(
    'we-product-card',
    class WeProductCard extends HTMLElement {
      constructor() {
        super();
        this.carouselInstance = null;
      }

      connectedCallback() {
        this.swiperEl = this.querySelector('.we-product-card__swiper');
        this.paginationEl = this.querySelector('.we-product-card__pagination');
        this.wrapperEl = this.querySelector('.swiper-wrapper');
        this.initialVariantId = this.dataset.initialVariantId;
        if (!this.swiperEl || !this.wrapperEl) return;

        requestAnimationFrame(() => {
          if (!this.carouselInstance) {
            this.initCarousel();
          }
        });
      }

      disconnectedCallback() {
        this.destroyCarousel();
      }

      destroyCarousel() {
        if (this.carouselInstance?.slider) {
          this.carouselInstance.slider.destroy(true, true);
          this.carouselInstance = null;
        }
      }

      initCarousel() {
        this.destroyCarousel();
        this.carouselInstance = new FoxTheme.Carousel(
          this.swiperEl,
          {
            slidesPerView: 1,
            grabCursor: true,
            allowTouchMove: true,
            threshold: 5,
            pagination: {
              el: this.paginationEl,
              type: 'progressbar',
            },
          },
          null
        );
        this.carouselInstance.init();
      }

      switchVariant(variantId) {
        const id = String(variantId);
        const current = this.dataset.activeVariantId || this.initialVariantId;
        if (String(current) === id) return;

        const template = this.querySelector(`template[data-variant-id="${id}"]`);
        if (!template) return;

        this.dataset.activeVariantId = id;
        this.wrapperEl.innerHTML = '';
        this.wrapperEl.appendChild(template.content.cloneNode(true));

        this.destroyCarousel();
        this.initCarousel();
        this.updateSwatchButtons();
        this.updateTitleLink();
      }

      updateTitleLink() {
        const card = this.closest('.product-card');
        if (!card) return;
        const activeId = this.dataset.activeVariantId || this.initialVariantId;
        const btn = card.querySelector(
          `.swatches--product-card button[data-variant-id="${String(activeId)}"]`
        );
        const titleLink = card.querySelector('.product-card__title a');
        if (!titleLink || !btn?.dataset?.variantUrl) return;
        titleLink.setAttribute('href', btn.dataset.variantUrl);
      }

      updateSwatchButtons() {
        const card = this.closest('.product-card');
        if (!card) return;
        const activeId = this.dataset.activeVariantId || this.initialVariantId;
        card.querySelectorAll('.swatches--product-card button[data-variant-id]').forEach((btn) => {
          const on = String(btn.dataset.variantId) === String(activeId);
          btn.classList.toggle('is-active', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
    }
  );
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.swatches--product-card button[data-variant-id]');
  if (!btn) return;
  const card = btn.closest('.product-card');
  const host = card?.querySelector('we-product-card');
  if (!host) return;
  host.switchVariant(btn.dataset.variantId);
});

if (!customElements.get('we-usp-swiper')) {
  customElements.define(
    'we-usp-swiper',
    class WeUspSwiper extends HTMLElement {
      constructor() {
        super();
        this.sliderInstance = null;
      }

      connectedCallback() {
        const el = this.querySelector('.swiper');
        if (!el) return;

        const slides = el.querySelectorAll('.swiper-slide');
        if (slides.length === 0) return;

        const progressEl = this.querySelector('.product__media-gallery-progress');
        const nextEl = this.querySelector('.we-usp-swiper-button-next');
        const prevEl = this.querySelector('.we-usp-swiper-button-prev');

        /** Omit pagination/navigation when unused — Swiper can error on explicit `false`. */
        this.sliderOptions = {
          slidesPerView: 1,
          spaceBetween: 24,
          grabCursor: true,
          ...(progressEl
            ? {
                pagination: {
                  el: progressEl,
                  type: 'progressbar',
                },
              }
            : {}),
          ...(nextEl && prevEl ? { navigation: { nextEl, prevEl } } : {}),
        };

        this.sliderInstance = new window.FoxTheme.Carousel(el, this.sliderOptions);
        this.sliderInstance.init();
      }

      disconnectedCallback() {
        if (this.sliderInstance?.slider?.destroy) {
          try {
            this.sliderInstance.slider.destroy(true, true);
          } catch (e) {
            /* noop */
          }
        }
        this.sliderInstance = null;
      }
    }
  );
}

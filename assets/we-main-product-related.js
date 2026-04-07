/**
 * Main product only: loads related-product recommendations (intent=related) via Section Rendering API.
 * Does not use or modify product-recommendations.js.
 */
if (!customElements.get('we-related-products-slider')) {
  customElements.define(
    'we-related-products-slider',
    class WeRelatedProductsSlider extends HTMLElement {
      connectedCallback() {
        this.initSlider();
      }

      disconnectedCallback() {
        this.destroySlider();
      }

      destroySlider() {
        if (this._carousel?.slider) {
          this._carousel.slider.destroy(true, true);
        }
        this._carousel = null;
      }

      initSlider() {
        const container = this.querySelector('.swiper.we-main-product-related__swiper');
        if (!container || typeof FoxTheme === 'undefined' || !FoxTheme.Carousel) return;

        this.destroySlider();

        const prevEl = this.closest('.related-products-inline__aside')?.querySelector('.swiper-button-prev');
        const nextEl = this.closest('.related-products-inline__aside')?.querySelector('.swiper-button-next');

        this._carousel = new FoxTheme.Carousel(container, {
          slidesPerView: 1.7,
          spaceBetween: 4,
          watchOverflow: true,
          autoHeight: true,
          mousewheel: true,
          breakpoints: {
            768: {
              slidesPerView: 2,
              spaceBetween: 4,
            },
          },
          navigation: {
            prevEl,
            nextEl,
          },
          pagination: false,
        });
        this._carousel.init();
      }
    }
  );
}

if (!customElements.get('we-main-product-related')) {
  customElements.define(
    'we-main-product-related',
    class WeMainProductRelated extends HTMLElement {
      connectedCallback() {
        if (this.dataset.loaded === 'true') return;

        const run = () => this.load();

        if ('requestIdleCallback' in window) {
          requestIdleCallback(run, { timeout: 1500 });
        } else if (window.FoxTheme?.Motion?.inView) {
          FoxTheme.Motion.inView(this, run, { margin: '0px 0px 400px 0px' });
        } else {
          run();
        }
      }

      load() {
        if (this.dataset.loaded === 'true') return;

        const url = this.dataset.url;
        const rootId = this.dataset.rootId;
        if (!url || !rootId) return;

        this.dataset.loaded = 'true';

        fetch(url)
          .then((response) => response.text())
          .then((responseText) => {
            const doc = new DOMParser().parseFromString(responseText, 'text/html');
            const incoming = doc.getElementById(rootId);
            if (!incoming) return;

            if (!incoming.querySelector('.product-card')) {
              this.closest('.product__block')?.remove();
              return;
            }

            this.innerHTML = incoming.innerHTML;
            this.dispatchEvent(new CustomEvent('main-product-related:loaded', { bubbles: true }));
          })
          .catch((e) => {
            console.error(e);
          });
      }
    }
  );
}

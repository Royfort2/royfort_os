if (!customElements.get('we-product-card')) {
  customElements.define(
    'we-product-card',
    class WeProductCard extends HTMLElement {
      constructor() {
        super();
        /** Matches Swiper `speed` — smooth slide change on hover and touch */
        this.slideTransitionMs = 450;
        this.carouselInstance = null;
        this.mediaLink = null;
        this.card = null;
        this.swatchList = null;
        this.hoverBound = false;
        this.swatchPreviewBound = false;
        this.lastPreviewVariantId = null;
        /** Non-swiper cards: swap variant images in .we-product-card__static-inner */
        this.staticMode = false;
        this.staticInnerEl = null;
        this.handleMediaEnter = this.handleMediaEnter.bind(this);
        this.handleMediaLeave = this.handleMediaLeave.bind(this);
        this.handleSwatchMouseOver = this.handleSwatchMouseOver.bind(this);
        this.handleSwatchListEnter = this.handleSwatchListEnter.bind(this);
        this.handleSwatchListLeave = this.handleSwatchListLeave.bind(this);
      }

      connectedCallback() {
        this.mediaLink = this.querySelector('.we-product-card__media-link');
        this.initialVariantId = this.dataset.initialVariantId;
        this.staticMode = this.dataset.static === 'true';
        this.staticInnerEl = this.querySelector('.we-product-card__static-inner');

        if (this.staticMode) {
          if (!this.staticInnerEl) return;
          this.wrapperEl = this.staticInnerEl;
          this.card = this.closest('.product-card');
          requestAnimationFrame(() => this.bindSwatchPreview());
          return;
        }

        this.swiperEl = this.querySelector('.we-product-card__swiper');
        this.paginationEl = this.querySelector('.we-product-card__pagination');
        this.wrapperEl = this.querySelector('.swiper-wrapper');
        if (!this.swiperEl || !this.wrapperEl) return;

        this.card = this.closest('.product-card');

        requestAnimationFrame(() => {
          if (!this.carouselInstance) {
            this.initCarousel();
          }
          this.bindHoverNavigation();
          this.bindSwatchPreview();
        });
      }

      disconnectedCallback() {
        this.unbindHoverNavigation();
        this.unbindSwatchPreview();
        this.card?.classList.remove('we-product-card--swatch-preview');
        this.destroyCarousel();
      }

      destroyCarousel() {
        if (this.carouselInstance?.slider) {
          this.carouselInstance.slider.destroy(true, true);
          this.carouselInstance = null;
        }
      }

      bindHoverNavigation() {
        if (!this.mediaLink || this.hoverBound) return;
        this.hoverBound = true;
        this.mediaLink.addEventListener('mouseenter', this.handleMediaEnter);
        this.mediaLink.addEventListener('mouseleave', this.handleMediaLeave);
      }

      unbindHoverNavigation() {
        if (!this.mediaLink || !this.hoverBound) return;
        this.mediaLink.removeEventListener('mouseenter', this.handleMediaEnter);
        this.mediaLink.removeEventListener('mouseleave', this.handleMediaLeave);
        this.hoverBound = false;
      }

      handleMediaEnter() {
        const s = this.carouselInstance?.slider;
        if (!s || s.slides.length < 2) return;
        s.slideTo(1, this.slideTransitionMs);
      }

      handleMediaLeave() {
        const s = this.carouselInstance?.slider;
        if (!s) return;
        s.slideTo(0, this.slideTransitionMs);
      }

      bindSwatchPreview() {
        if (!this.card || this.swatchPreviewBound) return;
        if (!this.querySelector('template[data-variant-id]')) return;
        this.swatchList = this.card.querySelector('.swatches--product-card');
        if (!this.swatchList) return;
        this.swatchPreviewBound = true;
        this.swatchList.addEventListener('mouseenter', this.handleSwatchListEnter);
        this.swatchList.addEventListener('mouseover', this.handleSwatchMouseOver);
        this.swatchList.addEventListener('mouseleave', this.handleSwatchListLeave);
      }

      unbindSwatchPreview() {
        if (!this.swatchList || !this.swatchPreviewBound) return;
        this.swatchList.removeEventListener('mouseenter', this.handleSwatchListEnter);
        this.swatchList.removeEventListener('mouseover', this.handleSwatchMouseOver);
        this.swatchList.removeEventListener('mouseleave', this.handleSwatchListLeave);
        this.swatchPreviewBound = false;
        this.swatchList = null;
      }

      handleSwatchListEnter() {
        this.card?.classList.add('we-product-card--swatch-preview');
      }

      handleSwatchMouseOver(event) {
        // closest() only walks ancestors; hover often hits <li> padding or the tooltip span, not the <a>.
        const item = event.target.closest('ul.swatches--product-card li');
        const link =
          item?.querySelector?.('[data-variant-id]') || event.target.closest('[data-variant-id]');
        if (!link || !this.swatchList?.contains(link)) return;
        const id = link.dataset.variantId;
        if (!id || id === this.lastPreviewVariantId) return;
        this.lastPreviewVariantId = id;
        this.previewVariant(id);
      }

      handleSwatchListLeave() {
        this.lastPreviewVariantId = null;
        this.card?.classList.remove('we-product-card--swatch-preview');
        this.resetToInitialVariant();
      }

      /**
       * Fade out slides only (not pagination), swap markup + reinit Swiper, then fade back in.
       */
      fadeOutSwapIn(swapFn) {
        const el = this.wrapperEl;
        if (!el) {
          swapFn();
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          let finished = false;
          const done = () => {
            if (finished) return;
            finished = true;
            swapFn();
            requestAnimationFrame(() => {
              el.classList.remove('we-product-card__slides-fade-out');
              resolve();
            });
          };

          const onEnd = (e) => {
            if (e.target !== el || e.propertyName !== 'opacity') return;
            el.removeEventListener('transitionend', onEnd);
            clearTimeout(fallback);
            done();
          };

          el.addEventListener('transitionend', onEnd);
          const fallback = setTimeout(() => {
            el.removeEventListener('transitionend', onEnd);
            done();
          }, 280);

          el.classList.add('we-product-card__slides-fade-out');
        });
      }

      previewVariant(variantId) {
        const template = this.querySelector(`template[data-variant-id="${variantId}"]`);
        if (!template) return;

        if (this.staticMode && this.staticInnerEl) {
          const inner = template.content.querySelector('.we-product-card__static-inner');
          if (!inner) return;
          // No opacity fade: avoids blink and keeps swap instant (swiper path still fades).
          this.staticInnerEl.innerHTML = inner.innerHTML;
          return;
        }

        this.fadeOutSwapIn(() => {
          this.wrapperEl.innerHTML = '';
          this.wrapperEl.appendChild(template.content.cloneNode(true));

          this.destroyCarousel();
          this.initCarousel();

          const s = this.carouselInstance?.slider;
          if (s && this.mediaLink?.matches(':hover') && s.slides.length >= 2) {
            s.slideTo(1, this.slideTransitionMs);
          }
        });
      }

      resetToInitialVariant() {
        const template = this.querySelector(`template[data-variant-id="${this.initialVariantId}"]`);
        if (!template) return;

        if (this.staticMode && this.staticInnerEl) {
          const inner = template.content.querySelector('.we-product-card__static-inner');
          if (!inner) return;
          this.staticInnerEl.innerHTML = inner.innerHTML;
          return;
        }

        this.fadeOutSwapIn(() => {
          this.wrapperEl.innerHTML = '';
          this.wrapperEl.appendChild(template.content.cloneNode(true));

          this.destroyCarousel();
          this.initCarousel();

          const s = this.carouselInstance?.slider;
          if (s && this.mediaLink?.matches(':hover') && s.slides.length >= 2) {
            s.slideTo(1, this.slideTransitionMs);
          }
        });
      }

      initCarousel() {
        this.destroyCarousel();
        const ms = this.slideTransitionMs;
        this.carouselInstance = new FoxTheme.Carousel(
          this.swiperEl,
          {
            slidesPerView: 1,
            speed: ms,
            effect: 'slide',
            grabCursor: true,
            allowTouchMove: true,
            threshold: 8,
            cssMode: false,
            pagination: {
              el: this.paginationEl,
              type: 'progressbar',
            },
          },
          null
        );
        this.carouselInstance.init();
      }
    }
  );
}

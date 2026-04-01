if (!customElements.get('media-gallery')) {
  customElements.define(
    'media-gallery',
    class MediaGallery extends HTMLElement {
      constructor() {
        super();

        this.selectors = {
          viewer: '[id^="GalleryViewer"]',
          thumbnails: '[id^="GalleryThumbnails"]',
          mediaList: '[id^="Slider-Gallery"]',
          mediaItems: ['.product__media-item'],
        };

        this.sliderInstance = false;
        this.thumbsInstance = false;
        this.lightbox = null;
        this._lightboxZoomUnsub = null;
      }

      connectedCallback() {
        // this.init();
        FoxTheme.Motion.inView(this, this.init.bind(this));
      }

      init() {
        this.elements = window.FoxTheme.utils.queryDomNodes(this.selectors, this);
        this.mediaLayout = this.dataset.mediaLayout;
        this.onlyImage = this.dataset.onlyImage === 'true';
        this.enableDesktopSlider = this.dataset.enableDesktopSlider === 'true';
        this.enableMobileThumbnails = this.dataset.enableMobileThumbnails === 'true';
        this.enableImageZoom = this.dataset.enableImageZoom === 'true';
        this.colorOptionIndex = parseInt(this.dataset.colorOptionIndex, 10) || 0;
        this.setSliderOptions();

        const mql = window.matchMedia(FoxTheme.config.mediaQueryMobile);
        mql.onchange = this.updateMediaLayout.bind(this);
        this.updateMediaLayout();

        if (this.enableImageZoom) {
          this.initImageZoom();
        }
      }

      setSliderOptions() {
        const mediaItemGap = parseInt(this.dataset.mediaItemGap);

        this.sliderOptions = {
          init: false,
          slidesPerView: '1',
          spaceBetween: mediaItemGap,
          loop: false,
          grabCursor: true,
          allowTouchMove: true,
          autoHeight: true,
          navigation: {
            nextEl: this.querySelector('.swiper-button-next'),
            prevEl: this.querySelector('.swiper-button-prev'),
          },
          pagination: {
            el: this.querySelector('.swiper-pagination'),
            clickable: true,
            type: 'fraction',
          },
          threshold: 2,
        };

        this.thumbsOptions = {
          slidesPerView: 4,
          breakpoints: {
            461: {
              slidesPerView: 5,
            },
          },
          spaceBetween: mediaItemGap,
          loop: false,
          freeMode: true,
          watchSlidesProgress: true,
          threshold: 2,
        };

        switch (this.mediaLayout) {
          case 'vertical-carousel':
            this.thumbsOptions = Object.assign({}, this.thumbsOptions, {
              breakpoints: {
                768: {
                  direction: 'vertical',
                  slidesPerView: 'auto',
                },
              },
            });
            break;
          case 'slider-freemode':
            this.sliderOptions = Object.assign({}, this.sliderOptions, {
              slidesPerView: 'auto',
            });
            break;
        }
      }

      updateMediaLayout() {
        if (FoxTheme.config.mqlMobile) {
          this.initSlider();
        } else {
          if (this.enableDesktopSlider) {
            this.initSlider();
          } else {
            this.destroySlider();
          }
        }
        this.syncGridMixLayout();
      }

      initSlider() {
        if (typeof this.sliderInstance !== 'object') {
          if ((this.enableDesktopSlider || this.enableMobileThumbnails) && this.elements.thumbnails) {
            this.thumbsInstance = new window.FoxTheme.Carousel(this.elements.thumbnails, this.thumbsOptions);
            this.thumbsInstance.init();

            this.sliderOptions.thumbs = {
              swiper: this.thumbsInstance.slider,
              autoScrollOffset: 2,
            };
          }

          this.sliderInstance = new window.FoxTheme.Carousel(this.elements.viewer, this.sliderOptions, [
            FoxTheme.Swiper.Thumbs,
          ]);
          this.sliderInstance.init();

          this.handleSliderAfterInit();
          this.handleSlideChange();

          this.sliderInstance.slider.init();
        }
      }

      destroySlider() {
        if (typeof this.sliderInstance === 'object') {
          this.sliderInstance.slider.destroy();
          this.sliderInstance = false;
        }
      }

      initThumbsSlider() {
        if (typeof this.thumbsInstance !== 'object') {
          this.thumbsInstance = new window.FoxTheme.Carousel(this.selectors.thumbnails, this.thumbsOptions);
          this.thumbsInstance.init();
        }
      }

      getVisibleMediaSlides() {
        return [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')].filter(
          (m) => !m.classList.contains('product__media-item--color-hidden')
        );
      }

      buildLightboxDataSource() {
        const dataSource = [];
        this.getVisibleMediaSlides().forEach((media) => {
          switch (media.dataset.mediaType) {
            case 'model':
              dataSource.push({
                id: media.dataset.mediaIndex,
                html: `<div class="pswp__item--${media.dataset.mediaType}">${
                  media.querySelector('product-model').outerHTML
                }</div>`,
                mediaType: media.dataset.mediaType,
              });
              break;
            case 'video':
            case 'external_video':
              dataSource.push({
                id: media.dataset.mediaIndex,
                html: `<div class="pswp__item--${media.dataset.mediaType}">${
                  media.querySelector('video-element').outerHTML
                }</div>`,
                mediaType: media.dataset.mediaType,
              });
              break;
            case 'image':
              dataSource.push({
                id: media.dataset.mediaIndex,
                src: media.dataset.src,
                width: media.dataset.pswpWidth,
                height: media.dataset.pswpHeight,
                mediaType: media.dataset.mediaType,
              });
              break;
          }
        });
        return dataSource;
      }

      getLightboxIndexForMediaId(mediaId) {
        let idx = 0;
        for (const media of this.getVisibleMediaSlides()) {
          const t = media.dataset.mediaType;
          if (t === 'model' || t === 'video' || t === 'external_video' || t === 'image') {
            if (String(media.dataset.mediaId) === String(mediaId)) return idx;
            idx++;
          }
        }
        return -1;
      }

      destroyImageZoom() {
        if (this._lightboxZoomUnsub) {
          this._lightboxZoomUnsub();
          this._lightboxZoomUnsub = null;
        }
        if (this.lightbox) {
          if (typeof this.lightbox.destroy === 'function') {
            this.lightbox.destroy();
          }
          this.lightbox = null;
        }
      }

      refreshImageZoom() {
        if (!this.enableImageZoom) return;
        this.initImageZoom();
      }

      initImageZoom() {
        this.destroyImageZoom();
        const dataSource = this.buildLightboxDataSource();
        if (!dataSource.length) return;

        this.lightbox = new window.FoxTheme.PhotoSwipeLightbox({
          dataSource: dataSource,
          pswpModule: window.FoxTheme.PhotoSwipe,
          bgOpacity: 1,
          arrowPrev: false,
          arrowNext: false,
          zoom: false,
          close: false,
          counter: false,
          preloader: false,
        });

        this.lightbox.addFilter('thumbEl', (thumbEl, { id }, index) => {
          if (this.sliderInstance && this.sliderInstance.slider) {
            const { slides, activeIndex } = this.sliderInstance.slider;
            if (slides[activeIndex]) {
              const el = slides[activeIndex].querySelector('img');
              if (el) {
                return el;
              }
            }
          }

          return thumbEl;
        });

        this.lightbox.addFilter('placeholderSrc', (placeholderSrc, { data: { id } }) => {
          if (this.sliderInstance && this.sliderInstance.slider) {
            const { slides, activeIndex } = this.sliderInstance.slider;
            if (slides[activeIndex]) {
              const el = slides[activeIndex].querySelector('img');
              if (el) {
                return el.src;
              }
            }
          }

          return placeholderSrc;
        });

        this.lightbox.on('change', () => {
          window.pauseAllMedia(this);
        });

        this.lightbox.on('destroy', () => {
          const { currIndex } = this.lightbox.pswp;

          if (this.sliderInstance && this.sliderInstance.slider) {
            this.sliderInstance.slider.slideToLoop(currIndex, 0, false);
          }
        });

        this.lightbox.on('pointerDown', (e) => {
          if (this.lightbox.pswp.currSlide.data.mediaType != 'image') {
            e.preventDefault();
          }
        });

        this.lightbox.on('uiRegister', () => {
          if (!this.onlyImage) {
            this.lightbox.pswp.ui.registerElement({
              name: 'next',
              ariaLabel: 'Next slide',
              order: 3,
              isButton: true,
              html: '<svg class="pswp-icon-next flip-x" viewBox="0 0 100 100"><path d="M 10,50 L 60,100 L 65,90 L 25,50  L 65,10 L 60,0 Z"></path></svg>',
              onClick: (event, el) => {
                this.lightbox.pswp.next();
              },
            });
            this.lightbox.pswp.ui.registerElement({
              name: 'prev',
              ariaLabel: 'Previous slide',
              order: 1,
              isButton: true,
              html: '<svg class="pswp-icon-prev rtl-flip-x" viewBox="0 0 100 100"><path d="M 10,50 L 60,100 L 65,90 L 25,50  L 65,10 L 60,0 Z"></path></svg>',
              onClick: (event, el) => {
                this.lightbox.pswp.prev();
              },
            });
          }
          this.lightbox.pswp.ui.registerElement({
            name: 'close-zoom',
            ariaLabel: 'Close zoom image',
            order: 2,
            isButton: true,
            html: '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" role="presentation" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
            onClick: (event, el) => {
              this.lightbox.pswp.close();
            },
          });
        });

        this.lightbox.init();

        this._lightboxZoomUnsub = FoxTheme.utils.addEventDelegate({
          selector: '.js-photoswipe--zoom',
          context: this,
          handler: (e, media) => {
            if (media.dataset.mediaType === 'image') {
              const index = this.getLightboxIndexForMediaId(media.dataset.mediaId);
              if (index >= 0) {
                this.lightbox.loadAndOpen(index);
              }
            }
          },
        });
      }

      handleSliderAfterInit() {
        this.sliderInstance.slider.on('afterInit', (swiper) => {
          const { slides, activeIndex } = swiper;

          if (slides[activeIndex]) {
            const isModelMediaType = slides[activeIndex].dataset.mediaType === 'model';
            this.toggleSliderDraggableState(!isModelMediaType);
          }
        });
      }

      handleSlideChange() {
        this.sliderInstance.slider.on('realIndexChange', (swiper) => {
          const { slides, activeIndex, thumbs } = swiper;

          if (thumbs.swiper) {
            thumbs.swiper.slideTo(activeIndex);
          }

          if (slides[activeIndex]) {
            this.playActiveMedia(slides[activeIndex]);

            const isModelMediaType = slides[activeIndex].dataset.mediaType === 'model';
            this.toggleSliderDraggableState(!isModelMediaType);
          }
        });

        this.sliderInstance.slider.on('slideChange', () => {
          if (!this.colorOptionIndex) return;
          requestAnimationFrame(() => this.ensureActiveSlideIsVisible());
        });
      }

      ensureActiveSlideIsVisible() {
        if (this._ensuringSlide) return;
        const swiper = this.sliderInstance?.slider;
        if (!swiper) return;

        const slides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        const real = swiper.realIndex;
        const current = slides[real];
        if (!current?.classList.contains('product__media-item--color-hidden')) return;

        let nextIdx = slides.findIndex(
          (s, idx) => idx >= real && !s.classList.contains('product__media-item--color-hidden')
        );
        if (nextIdx < 0) {
          nextIdx = slides.findIndex((s) => !s.classList.contains('product__media-item--color-hidden'));
        }
        if (nextIdx >= 0 && nextIdx !== real) {
          this._ensuringSlide = true;
          swiper.slideToLoop(nextIdx, 0, false);
          requestAnimationFrame(() => {
            this._ensuringSlide = false;
          });
        }
      }

      toggleSliderDraggableState(isDraggable) {
        if (this.sliderInstance.slider.allowTouchMove !== isDraggable) {
          this.sliderInstance.slider.allowTouchMove = isDraggable;
        }
      }

      playActiveMedia(selected) {
        const deferredMedia = selected.querySelector('product-model');
        if (deferredMedia) deferredMedia.loadContent(false);
      }

      setActiveMedia(variant) {
        if (!variant) return;

        this.applyColorAltFilter(variant);

        if (!variant.featured_media) {
          this.goToFirstVisibleSlide();
        } else if (this.sliderInstance.slider) {
          const slideIdx = this.getSlideIndexByMediaId(variant.featured_media.id);
          const slides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
          const slide = slideIdx >= 0 ? slides[slideIdx] : null;
          const featuredVisible =
            slide && !slide.classList.contains('product__media-item--color-hidden');
          const targetIndex = featuredVisible ? slideIdx : this.getFirstVisibleSlideIndex();
          this.sliderInstance.slider.slideToLoop(targetIndex, 0, false);
        } else {
          this.sortMediaItems(variant);
        }

        this.refreshImageZoom();
      }

      getSlideIndexByMediaId(mediaId) {
        if (mediaId == null) return -1;
        const slides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        return slides.findIndex((s) => String(s.dataset.mediaId) === String(mediaId));
      }

      getFirstVisibleSlideIndex() {
        const slides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        return Math.max(
          0,
          slides.findIndex((s) => !s.classList.contains('product__media-item--color-hidden'))
        );
      }

      goToFirstVisibleSlide() {
        if (this.sliderInstance.slider) {
          this.sliderInstance.slider.slideToLoop(this.getFirstVisibleSlideIndex(), 0, false);
        }
      }

      refreshSwipersAfterFilter() {
        if (this.sliderInstance && this.sliderInstance.slider) {
          this.sliderInstance.slider.update();
          if (this.thumbsInstance && this.thumbsInstance.slider) {
            this.thumbsInstance.slider.update();
          }
        }
      }

      clearColorFilter() {
        this.querySelectorAll('.product__media-item--color-hidden').forEach((el) => {
          el.classList.remove('product__media-item--color-hidden');
        });
        this.querySelectorAll('.product__thumbs-item--color-hidden').forEach((el) => {
          el.classList.remove('product__thumbs-item--color-hidden');
        });
        this.syncGridMixLayout();
      }

      /**
       * When color filtering hides slides, :nth-child(3n+1) still counts hidden nodes and breaks grid-mix.
       * Reassigns full/half widths from visible order only (same pattern as theme CSS: full, half, half, …).
       * Last orphan when visible count % 3 === 2 becomes full width.
       */
      syncGridMixLayout() {
        if (this.mediaLayout !== 'grid-mix') return;

        const mainSlides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        mainSlides.forEach((s) => {
          s.classList.remove('we-grid-mix--full', 'we-grid-mix--half');
        });

        const hasFilter =
          this.colorOptionIndex > 0 &&
          mainSlides.some((s) => s.classList.contains('product__media-item--color-hidden'));
        if (!hasFilter) return;

        const visible = mainSlides.filter((s) => !s.classList.contains('product__media-item--color-hidden'));
        const n = visible.length;

        visible.forEach((slide, v) => {
          let isFull = v % 3 === 0;
          if (v === n - 1 && n % 3 === 2) {
            isFull = true;
          }
          slide.classList.add(isFull ? 'we-grid-mix--full' : 'we-grid-mix--half');
        });
      }

      applyColorAltFilter(variant) {
        const colorIdx = this.colorOptionIndex;
        if (!colorIdx || !variant) {
          this.clearColorFilter();
          return;
        }

        const optionKey = `option${colorIdx}`;
        const colorValue = (variant[optionKey] || '').trim();
        if (!colorValue) {
          this.clearColorFilter();
          return;
        }

        const normalized = colorValue.toLowerCase();
        const mainSlides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        let visibleCount = 0;

        mainSlides.forEach((slide) => {
          const isGlobal = slide.dataset.mediaFilterGlobal === 'true';
          const alt = (slide.dataset.mediaAlt || '').trim().toLowerCase();
          const match = isGlobal || alt === normalized;
          slide.classList.toggle('product__media-item--color-hidden', !match);
          if (match) visibleCount++;

          const thumb = this.querySelector(
            `.product__thumbs-item[data-target="${slide.dataset.mediaId}"]`
          );
          if (thumb) thumb.classList.toggle('product__thumbs-item--color-hidden', !match);
        });

        if (visibleCount === 0) {
          this.clearColorFilter();
          this.refreshSwipersAfterFilter();
          return;
        }

        this.refreshSwipersAfterFilter();
        this.syncGridMixLayout();
      }

      sortMediaItems(variant) {
        let newMedias = Array.from(this.elements.mediaItems);

        newMedias.sort(function (a, b) {
          return a.dataset.mediaIndex - b.dataset.mediaIndex;
        });

        let target = newMedias.find((m) => String(m.dataset.mediaId) === String(variant.featured_media.id));
        if (target?.classList.contains('product__media-item--color-hidden')) {
          target = newMedias.find((m) => !m.classList.contains('product__media-item--color-hidden'));
        }
        if (target) {
          const idx = newMedias.indexOf(target);
          const [element] = newMedias.splice(idx, 1);
          newMedias.unshift(element);
        }

        this.elements.mediaList.innerHTML = '';
        newMedias.forEach((media) => {
          this.elements.mediaList.appendChild(media);
        });

        if (!FoxTheme.config.mqlMobile) {
          const selectedMedia = this.querySelector(
            `.product__media-item:not(.product__media-item--color-hidden)[data-media-id="${variant.featured_media.id}"]`
          );
          const scrollTarget =
            selectedMedia ||
            this.querySelector('.product__media-item:not(.product__media-item--color-hidden)');
          if (scrollTarget) {
            window.scrollTo({ top: scrollTarget.offsetTop, behavior: 'smooth' });
          }
        }

        this.syncGridMixLayout();
      }
    }
  );
}

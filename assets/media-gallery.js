/**
 * Match gallery image alt text to the selected color option value.
 * Requires exact normalized equality to avoid partial overlaps
 * (e.g. "weiss" must not match "cremeweiss").
 */
function colorAltMatchesOption(altRaw, normalizedOption) {
  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const alt = normalize(altRaw);
  const opt = normalize(normalizedOption);
  if (!alt || !opt) return false;
  return alt === opt;
}

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
        this._onImageTooltipClick = this._onImageTooltipClick.bind(this);
        this._onOverflowExpandClick = this._onOverflowExpandClick.bind(this);
        /** Set once — product-info calls init() on every variant change; re-running breaks Swiper + listeners. */
        this._galleryInitDone = false;
      }

      connectedCallback() {
        // this.init();
        FoxTheme.Motion.inView(this, this.init.bind(this));
      }

      init() {
        if (this._galleryInitDone) {
          return;
        }
        this._galleryInitDone = true;

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

        this.addEventListener('click', this._onImageTooltipClick);
        if (this.dataset.weGalleryOverflow === 'true') {
          this.addEventListener('click', this._onOverflowExpandClick);
        }
      }

      _removeOverflowStacks() {
        this.querySelectorAll('.we-media-gallery__overflow-stack').forEach((stack) => stack.remove());
      }

      _clearOverflowCollapseClasses() {
        this.querySelectorAll('.product__media-item.we-media-gallery__overflow-hidden').forEach((el) => {
          el.classList.remove('we-media-gallery__overflow-hidden');
        });
        this.querySelectorAll('.product__thumbs-item.we-media-gallery__thumb-overflow-hidden').forEach((el) => {
          el.classList.remove('we-media-gallery__thumb-overflow-hidden');
        });
      }

      _overflowExpandAria(remainder) {
        const tpl = (this.dataset.overflowExpandAria || '').trim();
        if (!tpl) return `Show ${remainder} more gallery images`;
        return tpl.replace(/\b__N__\b/g, String(remainder));
      }

      /** Mount/update the sixth-tile (+N) control (desktop grid collapse). */
      _mountOverflowStack(container, { sliderGalleryId = '', remainder = 2 } = {}) {
        let stack = container.querySelector('.we-media-gallery__overflow-stack');
        const aria = this._overflowExpandAria(remainder);
        if (!stack) {
          stack = document.createElement('div');
          stack.className = 'we-media-gallery__overflow-stack';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn--inherit we-media-gallery__overflow-hit focus-inset';
          btn.setAttribute('aria-expanded', 'false');
          if (sliderGalleryId) btn.setAttribute('aria-controls', sliderGalleryId);
          btn.setAttribute('aria-label', aria);
          const label = document.createElement('span');
          label.className = 'we-media-gallery__overflow-hit-label';
          label.setAttribute('aria-hidden', 'true');
          label.textContent = `+${remainder}`;
          btn.appendChild(label);
          stack.appendChild(btn);
          container.appendChild(stack);
          return;
        }
        const btn = stack.querySelector('.we-media-gallery__overflow-hit');
        const lbl = stack.querySelector('.we-media-gallery__overflow-hit-label');
        if (btn) {
          btn.setAttribute('aria-expanded', 'false');
          if (sliderGalleryId) btn.setAttribute('aria-controls', sliderGalleryId);
          btn.setAttribute('aria-label', aria);
        }
        if (lbl) lbl.textContent = `+${remainder}`;
      }

      /**
       * Desktop grid (+N overlay and folded tail) tracks slides visible after color alt filtering,
       * ordered as in the DOM (`getVisibleMediaSlides`), not full product.media count.
       */
      syncGalleryOverflowState() {
        if (this.dataset.weGalleryOverflow !== 'true') return;

        if (FoxTheme.config.mqlMobile) {
          this._removeOverflowStacks();
          this._clearOverflowCollapseClasses();
          this.classList.remove('we-media-gallery--expanded');
          return;
        }

        const visibleSlides = this.getVisibleMediaSlides();
        const v = visibleSlides.length;
        const expanded = this.classList.contains('we-media-gallery--expanded');
        const sliderGalleryId = this.querySelector('[id^="Slider-Gallery"]')?.id || '';

        if (v <= 6) {
          this._removeOverflowStacks();
          this._clearOverflowCollapseClasses();
          this.classList.remove('we-media-gallery--expanded');
          this.syncGridMixLayout();
          return;
        }

        if (expanded) {
          /* Full gallery revealed; thumbs must ignore collapse-only hiding rules */
          this._clearOverflowCollapseClasses();
          this.syncGridMixLayout();
          return;
        }

        const remainder = v - 5;
        this._clearOverflowCollapseClasses();
        this._removeOverflowStacks();

        visibleSlides.forEach((slide, idx) => {
          if (idx >= 6) slide.classList.add('we-media-gallery__overflow-hidden');
          if (idx === 5) {
            const container = slide.querySelector('.product__media-container');
            if (container) {
              this._mountOverflowStack(container, { sliderGalleryId, remainder });
            }
          }
        });

        const orderIds = visibleSlides.map((s) => String(s.dataset.mediaId));
        [...this.querySelectorAll('.product__thumbs-item:not(.swiper-slide-duplicate)')].forEach((thumb) => {
          const ti = orderIds.indexOf(String(thumb.dataset.target));
          if (ti >= 6) thumb.classList.add('we-media-gallery__thumb-overflow-hidden');
        });

        this.syncGridMixLayout();
      }

      /**
       * Desktop grid: reveal media hidden behind the sixth-tile (+N) overlay (see snippets/product-media-gallery.liquid).
       */
      _onOverflowExpandClick(event) {
        if (this.classList.contains('we-media-gallery--expanded')) return;

        const hit = event.target.closest('.we-media-gallery__overflow-hit');
        if (!hit || !this.contains(hit)) return;

        event.preventDefault();
        event.stopPropagation();

        this.classList.add('we-media-gallery--expanded');

        const mainHidden = [
          ...this.querySelectorAll(
            '.we-media-gallery__overflow-hidden:not(.swiper-slide-duplicate)'
          ),
        ];
        const thumbHidden = [...this.querySelectorAll('.we-media-gallery__thumb-overflow-hidden')];

        mainHidden.forEach((el, idx) => {
          el.style.setProperty('--we-overflow-reveal-delay', `${Math.min(idx, 20) * 45}ms`);
        });

        thumbHidden.forEach((el, idx) => {
          el.style.setProperty('--we-overflow-reveal-delay', `${Math.min(mainHidden.length + idx, 24) * 45}ms`);
        });

        this.querySelectorAll('.product__thumbs-item.we-media-gallery__thumb-overflow-hidden').forEach((thumb) =>
          thumb.classList.remove('we-media-gallery__thumb-overflow-hidden')
        );

        this.querySelectorAll('.we-media-gallery__overflow-hit').forEach((btn) => {
          btn.setAttribute('aria-expanded', 'true');
        });

        this.refreshSwipersAfterFilter();
        this.syncGridMixLayout();

        window.requestAnimationFrame(() => this._syncSwiperHeightAndImages());
      }

      _onImageTooltipClick(event) {
        const btn = event.target.closest('.product__image-tooltip-trigger-button');
        if (!btn || !this.contains(btn)) return;
        event.preventDefault();
        event.stopPropagation();

        const panelId = btn.getAttribute('aria-controls');
        if (!panelId) return;
        const panel = document.getElementById(panelId);
        if (!panel || !this.contains(panel)) return;

        const willOpen = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        panel.classList.toggle('is-open', willOpen);
        panel.setAttribute('aria-hidden', willOpen ? 'false' : 'true');
        if (willOpen) {
          requestAnimationFrame(() => panel.focus({ preventScroll: true }));
        }
      }

      setSliderOptions() {
        const mediaItemGap = parseInt(this.dataset.mediaItemGap);
        const progressEl = this.querySelector('.product__media-gallery-progress');

        this.sliderOptions = {
          init: false,
          slidesPerView: '1',
          spaceBetween: mediaItemGap,
          loop: false,
          grabCursor: true,
          allowTouchMove: true,
          autoHeight: true,
          navigation: false,
          pagination:
            progressEl != null
              ? {
                  el: progressEl,
                  type: 'progressbar',
                }
              : false,
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
            if (this.dataset.verticalThumbsAlways === 'true') {
              /* Quick view drawer: always vertical thumbs + horizontal main (narrow viewport < 768). */
              this.thumbsOptions = {
                slidesPerView: 'auto',
                spaceBetween: mediaItemGap,
                loop: false,
                freeMode: true,
                watchSlidesProgress: true,
                threshold: 2,
                direction: 'vertical',
              };
            } else {
              this.thumbsOptions = Object.assign({}, this.thumbsOptions, {
                breakpoints: {
                  768: {
                    direction: 'vertical',
                    slidesPerView: 'auto',
                  },
                },
              });
            }
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
        this.syncGalleryOverflowState();
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

          const swiper = this.sliderInstance.slider;
          swiper.init();

          requestAnimationFrame(() => this.syncImageTooltips());
        }
      }

      destroySlider() {
        if (typeof this.sliderInstance === 'object') {
          try {
            this.sliderInstance.slider.destroy(true, true);
          } catch (e) {
            /* noop */
          }
          this.sliderInstance = false;
        }
        if (typeof this.thumbsInstance === 'object') {
          try {
            this.thumbsInstance.slider.destroy(true, true);
          } catch (e) {
            /* noop */
          }
          this.thumbsInstance = false;
        }
        if (this.sliderOptions?.thumbs) {
          delete this.sliderOptions.thumbs;
        }
      }

      /**
       * With loop:false, slideToLoop can misbehave; autoHeight needs a visible slide or height stays 0.
       */
      slideToSlideIndex(index) {
        const swiper = this.sliderInstance?.slider;
        if (!swiper || index < 0) return;
        const max = Math.max(0, (swiper.slides?.length || 0) - 1);
        const i = Math.min(Math.max(0, index), max);
        if (swiper.params?.loop) {
          swiper.slideToLoop(i, 0, false);
        } else {
          swiper.slideTo(i, 0, false);
        }
        this._syncSwiperHeightAndImages();
      }

      _syncSwiperHeightAndImages() {
        const swiper = this.sliderInstance?.slider;
        if (!swiper) return;
        swiper.update();
        if (typeof swiper.updateAutoHeight === 'function') {
          swiper.updateAutoHeight(0);
        }
        /*
         * image-lazy + `.media-wrapper.loading > img { opacity: 0 }` (theme.css) hide images until `load`.
         * Color-filtered slides use `display: none`; native lazy + image-lazy never finish loading in that
         * state, so `load` may never fire and the gallery stays blank while Swiper still sizes the slide.
         */
        this.querySelectorAll('.product__media-item:not(.product__media-item--color-hidden) img').forEach((img) => {
          img.removeAttribute('loading');
          img.loading = 'eager';
          const wrap = img.closest('.media-wrapper');
          const markLoaded = () => {
            wrap?.classList.remove('loading');
            wrap?.classList.add('loaded');
            img.classList.add('loaded');
          };
          if (img.complete && img.naturalWidth) {
            markLoaded();
            return;
          }
          img.addEventListener('load', markLoaded, { once: true });
          img.addEventListener('error', () => wrap?.classList.remove('loading'), { once: true });
          if (wrap?.classList.contains('loading')) {
            wrap.classList.remove('loading');
          }
          if (!img.complete && img.src) {
            requestAnimationFrame(() => {
              if (!img.complete) img.src = img.src;
            });
          }
        });
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
          /* Refocusing the zoom <button> after close breaks horizontal swipe on that slide (iOS / overlay). */
          returnFocus: false,
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

        this.lightbox.on('closingAnimationEnd', () => {
          const pswp = this.lightbox.pswp;
          this._syncSwiperAfterLightboxClose(pswp);
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

      closeImageTooltips() {
        this.querySelectorAll('.product__image-tooltip-content.is-open').forEach((panel) => {
          panel.classList.remove('is-open');
          panel.setAttribute('aria-hidden', 'true');
          const id = panel.getAttribute('id');
          if (!id) return;
          const b = this.querySelector(`.product__image-tooltip-trigger-button[aria-controls="${id}"]`);
          if (b) b.setAttribute('aria-expanded', 'false');
        });
      }

      /**
       * Desktop keeps filtered slides in original order unless we rebuild; swiping can land on display:none
       * slides and collapse autoHeight. Jump to the next visible slide before thumbs sync.
       */
      _fixIndexIfOnHiddenSlide(swiper) {
        if (!swiper || swiper.destroyed) return;
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
          swiper.slideTo(nextIdx, 0, false);
        }
      }

      handleSlideChange() {
        this.sliderInstance.slider.on('realIndexChange', (swiper) => {
          this.closeImageTooltips();

          if (this.colorOptionIndex) {
            this._fixIndexIfOnHiddenSlide(swiper);
          }

          const activeIndex = swiper.realIndex;
          const { slides, thumbs } = swiper;
          const activeSlide = slides[activeIndex];

          if (thumbs.swiper && activeSlide && !activeSlide.classList.contains('product__media-item--color-hidden')) {
            thumbs.swiper.slideTo(activeIndex, 0, false);
          }

          if (activeSlide) {
            this.playActiveMedia(activeSlide);

            const isModelMediaType = activeSlide.dataset.mediaType === 'model';
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
          this.slideToSlideIndex(nextIdx);
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

      /**
       * After PhotoSwipe closes, sync the main Swiper index and force a layout/touch refresh.
       * Running this on `destroy` was too late and could leave mobile Swiper in a broken touch state.
       */
      _blurZoomTriggerIfFocused() {
        const el = document.activeElement;
        if (el && this.contains(el) && el.classList?.contains('js-photoswipe--zoom')) {
          el.blur();
        }
      }

      _syncSwiperAfterLightboxClose(pswp) {
        if (!pswp || typeof pswp.currIndex !== 'number' || pswp.currIndex < 0) return;
        const swiper = this.sliderInstance?.slider;
        if (!swiper) return;

        const target = pswp.currIndex;

        const finalize = () => {
          this._blurZoomTriggerIfFocused();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this._blurZoomTriggerIfFocused();
              if (typeof queueMicrotask === 'function') {
                queueMicrotask(() => this._blurZoomTriggerIfFocused());
              }
              const sw = this.sliderInstance?.slider;
              if (!sw) return;
              sw.update();
              if (typeof sw.updateAutoHeight === 'function') {
                sw.updateAutoHeight(0);
              }
              const slides = sw.slides;
              const ai = sw.realIndex;
              if (slides[ai]) {
                const isModelMediaType = slides[ai].dataset.mediaType === 'model';
                this.toggleSliderDraggableState(!isModelMediaType);
              }
            });
          });
        };

        const runSlideSync = () => {
          this.slideToSlideIndex(target);
          finalize();
        };

        /*
         * Closing without changing the lightbox slide leaves realIndex unchanged; Swiper often no-ops
         * slideTo(sameIndex) and touch tracking stays broken on that slide. Nudge to a neighbor then
         * slide back (same pattern as changing slides in the lightbox, which already worked).
         */
        if (target === swiper.realIndex && swiper.slides.length > 1) {
          const nudge = target === 0 ? 1 : target - 1;
          swiper.slideTo(nudge, 0, false);
          requestAnimationFrame(runSlideSync);
        } else {
          runSlideSync();
        }
      }

      playActiveMedia(selected) {
        const deferredMedia = selected.querySelector('product-model');
        if (deferredMedia) deferredMedia.loadContent(false);
      }

      setActiveMedia(variant, options = {}) {
        if (!variant) return;
        const { skipColorFilter = false } = options;

        if (!skipColorFilter) {
          this.applyColorAltFilter(variant);
        }

        const navigate = () => {
          if (!this.sliderInstance?.slider) {
            this.sortMediaItems(variant);
            this.refreshImageZoom();
            return;
          }

          const isMetafieldGallery = this.dataset.weMetafieldMedia === 'true';

          if (!variant.featured_media || isMetafieldGallery) {
            this.goToFirstVisibleSlide();
          } else {
            const slideIdx = this.getSlideIndexByMediaId(variant.featured_media.id);
            const slides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
            const slide = slideIdx >= 0 ? slides[slideIdx] : null;
            const featuredVisible =
              slide && !slide.classList.contains('product__media-item--color-hidden');
            const targetIndex = featuredVisible ? slideIdx : this.getFirstVisibleSlideIndex();
            this.slideToSlideIndex(targetIndex);
          }

          requestAnimationFrame(() => {
            this.ensureActiveSlideIsVisible();
            this._syncSwiperHeightAndImages();
            this.refreshImageZoom();
            const sw = this.sliderInstance?.slider;
            if (sw && !sw.destroyed) {
              const slide = sw.slides[sw.activeIndex];
              const isModel = slide?.dataset?.mediaType === 'model';
              sw.allowTouchMove = !isModel;
            }
          });
        };

        /* Mobile reinit leaves Swiper on slide 0; that slide may be color-hidden → autoHeight 0 until we jump. */
        if (FoxTheme.config.mqlMobile) {
          requestAnimationFrame(() => requestAnimationFrame(navigate));
        } else {
          navigate();
        }
      }

      getSlideIndexByMediaId(mediaId) {
        if (mediaId == null) return -1;
        const slides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        return slides.findIndex((s) => String(s.dataset.mediaId) === String(mediaId));
      }

      getFirstVisibleSlideIndex() {
        const slides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        const idx = slides.findIndex((s) => !s.classList.contains('product__media-item--color-hidden'));
        return idx >= 0 ? idx : 0;
      }

      /**
       * After toggling color-hidden, the active slide can still be hidden → Swiper autoHeight becomes 0 and the
       * gallery vanishes. Move the main swiper to a visible slide before swiper.update() / refresh.
       */
      _ensureMainSwiperNotOnHiddenSlide() {
        const swiper = this.sliderInstance?.slider;
        if (!swiper || swiper.destroyed) return;
        const slides = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        if (!slides.length) return;
        const cur = slides[swiper.realIndex];
        if (cur && !cur.classList.contains('product__media-item--color-hidden')) return;
        const idx = this.getFirstVisibleSlideIndex();
        if (idx >= 0) {
          swiper.slideTo(idx, 0, false);
        }
        /* Thumbs sync via Swiper Thumbs module on slideChange — forced slideTo breaks when thumb slides are hidden. */
      }

      goToFirstVisibleSlide() {
        if (this.sliderInstance.slider) {
          this.slideToSlideIndex(this.getFirstVisibleSlideIndex());
        }
      }

      /**
       * `display:none` on swiper slides breaks Swiper (autoHeight, translate, slide 0 often hidden).
       * Move visible slides to the front of the wrapper so index 0 is always a visible slide; restore
       * original `data-media-index` order when no filter. Thumbs follow main order by `data-target`.
       */
      _reorderMobileSlidesForSwiper() {
        const mediaList = this.querySelector('[id^="Slider-Gallery"]');
        if (!mediaList) return;

        let mainSlides = [...mediaList.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')];
        if (mainSlides.length === 0) return;

        const hasHidden = mainSlides.some((s) => s.classList.contains('product__media-item--color-hidden'));

        if (!hasHidden) {
          mainSlides.sort((a, b) => {
            const ai = parseInt(a.dataset.mediaIndex, 10);
            const bi = parseInt(b.dataset.mediaIndex, 10);
            return (Number.isFinite(ai) ? ai : 0) - (Number.isFinite(bi) ? bi : 0);
          });
        } else {
          const visible = mainSlides.filter((s) => !s.classList.contains('product__media-item--color-hidden'));
          const hidden = mainSlides.filter((s) => s.classList.contains('product__media-item--color-hidden'));
          mainSlides = [...visible, ...hidden];
        }

        const frag = document.createDocumentFragment();
        mainSlides.forEach((n) => frag.appendChild(n));
        mediaList.appendChild(frag);

        const thumbList = this.querySelector('[id^="Slider-Thumbnails"]');
        if (thumbList) {
          const orderIds = mainSlides.map((s) => String(s.dataset.mediaId));
          const thumbs = [...thumbList.querySelectorAll('.product__thumbs-item')];
          thumbs.sort((a, b) => {
            const ia = orderIds.indexOf(String(a.dataset.target));
            const ib = orderIds.indexOf(String(b.dataset.target));
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
          });
          const tfrag = document.createDocumentFragment();
          thumbs.forEach((t) => tfrag.appendChild(t));
          thumbList.appendChild(tfrag);
        }
      }

      refreshSwipersAfterFilter() {
        /*
         * Reorder so visible slides come first when filtering. Swiper must rebuild when slides are hidden
         * only if this layout actually uses Swiper (mobile, or desktop carousel). Desktop grid has no
         * slider — rebuilding Swiper here used to force a broken mobile swiper on large viewports.
         */
        this._reorderMobileSlidesForSwiper();

        const hasHidden = [...this.querySelectorAll('.product__media-item:not(.swiper-slide-duplicate)')].some(
          (s) => s.classList.contains('product__media-item--color-hidden')
        );

        const needsSwiperRebuild =
          FoxTheme.config.mqlMobile || (Boolean(this.enableDesktopSlider) && hasHidden);

        if (needsSwiperRebuild) {
          this.destroySlider();
          this.setSliderOptions();
          this.initSlider();
          this._syncSwiperHeightAndImages();
          requestAnimationFrame(() => this.syncImageTooltips());
          return;
        }

        if (hasHidden) {
          this.syncGridMixLayout();
          requestAnimationFrame(() => this.syncImageTooltips());
          return;
        }

        if (this.thumbsInstance?.slider) {
          const tw = this.thumbsInstance.slider;
          tw.update();
          if (typeof tw.updateAutoHeight === 'function') {
            tw.updateAutoHeight(0);
          }
        }
        if (this.sliderInstance?.slider) {
          this._syncSwiperHeightAndImages();
        }
        requestAnimationFrame(() => this.syncImageTooltips());
      }

      /**
       * Image tooltips are cloned from <template> roots onto the Nth *visible* image slide after color filter,
       * so they stay on the correct on-screen image when the swatch changes (Liquid alone attached them to fixed slots).
       */
      syncImageTooltips() {
        const cfgEl = this.querySelector('script.js-image-tooltip-config');
        if (!cfgEl?.textContent?.trim()) return;
        let configs;
        try {
          configs = JSON.parse(cfgEl.textContent);
        } catch (e) {
          return;
        }
        if (!Array.isArray(configs) || configs.length === 0) return;

        this.querySelectorAll('.product__image-tooltip[data-js-synced]').forEach((el) => el.remove());

        const visibleImageSlides = [
          ...this.querySelectorAll(
            '.product__media-item:not(.swiper-slide-duplicate):not(.product__media-item--color-hidden)'
          ),
        ].filter((s) => s.dataset.mediaType === 'image');

        const sectionId = this.id.replace(/^MediaGallery-/, '');

        configs.forEach(({ blockId, imageIndex }) => {
          const n = parseInt(imageIndex, 10);
          if (!Number.isFinite(n) || n < 1) return;
          const slide = visibleImageSlides[n - 1];
          if (!slide) return;
          const container = slide.querySelector('.product__media-container');
          if (!container) return;
          const tpl = document.getElementById(`ImageTooltipTpl-${sectionId}-${blockId}`);
          const root = tpl?.content?.firstElementChild;
          if (!root) return;
          const node = root.cloneNode(true);
          node.setAttribute('data-js-synced', 'true');
          container.appendChild(node);
        });
      }

      clearColorFilter() {
        this.classList.remove('we-media-gallery--expanded');
        this.querySelectorAll('.product__media-item--color-hidden').forEach((el) => {
          el.classList.remove('product__media-item--color-hidden');
        });
        this.querySelectorAll('.product__thumbs-item--color-hidden').forEach((el) => {
          el.classList.remove('product__thumbs-item--color-hidden');
        });
        this.syncGridMixLayout();
        this.syncGalleryOverflowState();
        requestAnimationFrame(() => this.syncImageTooltips());
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

        this.classList.remove('we-media-gallery--expanded');

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
          const altRaw = slide.dataset.mediaAlt || '';
          const match = isGlobal || colorAltMatchesOption(altRaw, normalized);
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

        this._ensureMainSwiperNotOnHiddenSlide();
        this.refreshSwipersAfterFilter();
        this.syncGridMixLayout();
        this.syncGalleryOverflowState();
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

        /*
         * Do not window.scrollTo here. `offsetTop` is relative to offsetParent, not the document, so
         * scrollTo(wrongY) pulled the viewport upward on variant / set-line updates and felt like the
         * page was constantly trying to scroll up.
         */

        this.syncGridMixLayout();
        this.syncGalleryOverflowState();
        requestAnimationFrame(() => this.syncImageTooltips());
      }
    }
  );
}

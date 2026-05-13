/**
 * One cart drawer slider: fetches related recommendations per cart line with per-line budgets,
 * merges in round-robin order, dedupes, excludes cart products, caps at data-total-limit.
 */
if (!customElements.get('we-cart-combined-recommendations')) {
  customElements.define(
    'we-cart-combined-recommendations',
    class WeCartCombinedRecommendations extends HTMLElement {
      connectedCallback() {
        if (this.dataset.loaded === 'true' || this._loading) return;
        const run = () => this.load();
        if ('requestIdleCallback' in window) {
          requestIdleCallback(run, { timeout: 2000 });
        } else {
          setTimeout(run, 0);
        }
      }

      async load() {
        if (this.dataset.loaded === 'true' || this._loading) return;

        const seedsRaw = this.dataset.seeds;
        if (!seedsRaw) return;

        let seeds;
        try {
          seeds = JSON.parse(seedsRaw);
        } catch (e) {
          console.warn('we-cart-combined-recommendations: invalid seeds', e);
          return;
        }
        if (!Array.isArray(seeds) || seeds.length === 0) return;

        this._loading = true;

        const excludeIds = new Set();
        if (this.dataset.excludeProductIds) {
          try {
            JSON.parse(this.dataset.excludeProductIds).forEach((id) => excludeIds.add(Number(id)));
          } catch (_) {}
        }

        const totalCap = parseInt(this.dataset.totalLimit || '10', 10);
        const intent = this.dataset.intent || 'related';
        const sectionId =
          window.__CART_COMBINED_RECS_SECTION_ID__ || this.dataset.sectionIdFallback || 'cart-combined-recs-fragment';

        const recPath = this.dataset.recommendationsUrl || '/recommendations/products';
        const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
        const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
        const baseUrl = recPath.startsWith('http') ? recPath : `${normalizedRoot}${recPath.startsWith('/') ? '' : '/'}${recPath}`;

        const urls = seeds.map(({ productId, limit }) => {
          const url = new URL(baseUrl, window.location.origin);
          url.searchParams.set('section_id', sectionId);
          url.searchParams.set('product_id', String(productId));
          url.searchParams.set('limit', String(limit));
          url.searchParams.set('intent', intent);
          return url.toString();
        });

        let responses;
        try {
          responses = await Promise.all(urls.map((url) => fetch(url).then((r) => r.text())));
        } catch (e) {
          console.error(e);
          this._loading = false;
          return;
        }

        const pools = responses.map((html) => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const rootEl = doc.getElementById('cart-combined-recs-fetch-root');
          if (!rootEl) return [];
          return [...rootEl.querySelectorAll(':scope > .swiper-slide')];
        });

        const mergedSlides = this.mergeSlidesFromPools(pools, excludeIds, totalCap);
        this._loading = false;

        if (!mergedSlides.length) return;

        this.renderSlider(mergedSlides);
        this.dataset.loaded = 'true';
        this.classList.remove('hidden');
        const mount = this.querySelector('.we-main-product-related__root');
        if (mount) mount.classList.remove('hidden');
      }

      productIdFromSlide(slideEl) {
        const card = slideEl.querySelector('[data-we-product-id]');
        if (card?.dataset?.weProductId) return `p:${card.dataset.weProductId}`;
        const stamped = slideEl.querySelector('.stamped-product-reviews-badge[data-id]');
        if (stamped?.dataset?.id) return `p:${stamped.dataset.id}`;
        const link = slideEl.querySelector('a.we-product-card__media-link[href*="/products/"], .product-card__title a[href*="/products/"]');
        const href = link?.getAttribute('href');
        if (href) return `u:${href.split('?')[0]}`;
        return null;
      }

      mergeSlidesFromPools(pools, excludeIds, totalCap) {
        const indices = pools.map(() => 0);
        const seen = new Set();
        const merged = [];

        while (merged.length < totalCap) {
          let progress = false;
          for (let i = 0; i < pools.length && merged.length < totalCap; i++) {
            const pool = pools[i];
            while (indices[i] < pool.length) {
              const slide = pool[indices[i]];
              indices[i]++;
              const pid = this.productIdFromSlide(slide);
              if (!pid) continue;
              if (pid.startsWith('p:')) {
                const n = Number(pid.slice(2));
                if (!Number.isNaN(n) && excludeIds.has(n)) continue;
              }
              if (seen.has(pid)) continue;
              seen.add(pid);
              merged.push(slide);
              progress = true;
              break;
            }
          }
          if (!progress) break;
        }

        return merged.slice(0, totalCap).map((el) => el.cloneNode(true));
      }

      renderSlider(slideEls) {
        const heading = this.dataset.heading || '';
        const headingId = this.dataset.headingId || '';
        const complementaryFallback = this.dataset.complementaryAriaLabel || '';

        const aside = document.createElement('aside');
        aside.className = 'related-products-inline__aside';
        if (heading && headingId) {
          aside.setAttribute('aria-labelledby', headingId);
        } else if (complementaryFallback) {
          aside.setAttribute('aria-label', complementaryFallback);
        }

        const header = document.createElement('div');
        header.className =
          'related-products-inline__header flex items-center gap-4' +
          (heading ? ' justify-between' : ' justify-end');

        if (heading) {
          const span = document.createElement('span');
          span.id = headingId;
          span.className = 'related-products-inline__heading';
          span.textContent = heading;
          header.appendChild(span);
        }

        if (slideEls.length > 1) {
          const nav = document.createElement('div');
          nav.className = 'related-products-inline__nav slider-controls flex items-center';
          nav.innerHTML = `
            <button class="swiper-button-prev" name="previous" type="button" aria-label="">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 5L7.5 10L12.5 15" stroke="currentColor" stroke-linecap="square"/>
              </svg>
            </button>
            <button class="swiper-button-next" name="next" type="button" aria-label="">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" stroke-linecap="square"/>
              </svg>
            </button>
          `;
          const prevBtn = nav.querySelector('.swiper-button-prev');
          const nextBtn = nav.querySelector('.swiper-button-next');
          const prevLab = this.dataset.prevSlideLabel || 'Previous slide';
          const nextLab = this.dataset.nextSlideLabel || 'Next slide';
          prevBtn?.setAttribute('aria-label', prevLab);
          nextBtn?.setAttribute('aria-label', nextLab);
          header.appendChild(nav);
        }

        if (heading || slideEls.length > 1) {
          aside.appendChild(header);
        }

        const sliderWrap = document.createElement('we-related-products-slider');
        sliderWrap.className = 'related-products-inline__slider block relative';
        const swiper = document.createElement('div');
        swiper.className = 'swiper we-main-product-related__swiper';
        const wrapper = document.createElement('div');
        wrapper.className = 'swiper-wrapper';
        wrapper.setAttribute('role', 'list');

        slideEls.forEach((slide) => {
          slide.setAttribute('role', 'listitem');
          wrapper.appendChild(slide);
        });

        swiper.appendChild(wrapper);
        sliderWrap.appendChild(swiper);
        aside.appendChild(sliderWrap);

        const root = this.querySelector('.we-main-product-related__root');
        if (root) {
          root.innerHTML = '';
          root.appendChild(aside);
        }
      }
    }
  );
}

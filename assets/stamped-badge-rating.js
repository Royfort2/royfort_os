/**
 * Stamped.io collection / badge widgets render `.stamped-badge[data-rating]` after widget.min.js runs.
 * Inserts the numeric rating between the stars and the review count (caption).
 * After AJAX (e.g. collection load-more / facets), calls StampedFn.loadBadges() so new `.stamped-product-reviews-badge` nodes get filled in.
 */
(function () {
  var INJECTED = 'data-stamped-rating-injected';
  var ZERO_FALLBACK = 'data-we-stamped-zero-fallback';

  function reloadStampedProductBadges() {
    if (typeof StampedFn === 'undefined') return;
    try {
      if (typeof StampedFn.loadBadges === 'function') {
        StampedFn.loadBadges();
      }
    } catch (e) {
      /* noop */
    }
  }

  function formatRating(value, lang) {
    var n = parseFloat(value, 10);
    if (typeof n !== 'number' || n !== n) return null;
    var locale = lang && typeof lang === 'string' ? lang.replace('_', '-') : undefined;
    try {
      return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
    } catch (e) {
      return n.toFixed(1);
    }
  }

  function buildZeroBadge(lang) {
    var wrap = document.createElement('span');
    wrap.className = 'stamped-badge we-stamped-badge-zero';
    wrap.setAttribute('data-rating', '0');
    wrap.setAttribute('data-reviews', '0');
    wrap.setAttribute(ZERO_FALLBACK, 'true');

    var stars = document.createElement('span');
    stars.className = 'stamped-badge-starrating';
    stars.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 5; i++) {
      var icon = document.createElement('i');
      icon.className = 'stamped-fa stamped-fa-star-o';
      icon.setAttribute('aria-hidden', 'true');
      stars.appendChild(icon);
    }
    wrap.appendChild(stars);

    var ratingVal = document.createElement('span');
    ratingVal.className = 'stamped-badge-rating-value';
    ratingVal.setAttribute('aria-hidden', 'true');
    ratingVal.textContent = formatRating(0, lang) || '0.0';
    wrap.appendChild(ratingVal);

    var caption = document.createElement('span');
    caption.className = 'stamped-badge-caption';
    caption.setAttribute('data-reviews', '0');
    caption.setAttribute('data-label', 'reviews');
    caption.setAttribute('data-version', '2');
    var inner = document.createElement('span');
    inner.textContent = '0';
    caption.appendChild(inner);
    wrap.appendChild(caption);

    return wrap;
  }

  /** Stamped often leaves `.stamped-product-reviews-badge` empty when a product has no reviews. */
  function ensureZeroBadgeFallback(container) {
    if (!container) return;

    var realBadge = container.querySelector('.stamped-badge:not([' + ZERO_FALLBACK + '])');
    if (realBadge) {
      container.querySelectorAll('.stamped-badge[' + ZERO_FALLBACK + ']').forEach(function (el) {
        el.remove();
      });
      return;
    }

    if (container.querySelector('.stamped-badge[' + ZERO_FALLBACK + ']')) return;

    var lang = document.documentElement.lang;
    container.appendChild(buildZeroBadge(lang));
  }

  function ensureAllZeroFallbacks(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll('.stamped-product-reviews-badge').forEach(ensureZeroBadgeFallback);
  }

  function runAfterStampedReady(cb) {
    if (typeof StampedFn !== 'undefined') {
      cb();
      return;
    }
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (typeof StampedFn !== 'undefined' || attempts > 60) {
        clearInterval(timer);
        cb();
      }
    }, 100);
  }

  function syncZeroFallbacksSoon() {
    runAfterStampedReady(function () {
      reloadStampedProductBadges();
      [400, 1200, 2500].forEach(function (delay) {
        setTimeout(function () {
          ensureAllZeroFallbacks(document);
          scan(document);
        }, delay);
      });
    });
  }

  function enhanceBadge(badge) {
    if (!badge || badge.getAttribute(INJECTED) === 'true') return;
    var raw = badge.getAttribute('data-rating');
    if (!raw) return;
    var lang = badge.getAttribute('data-lang') || document.documentElement.lang;
    var text = formatRating(raw, lang);
    if (!text) return;

    var starRow = badge.querySelector('.stamped-badge-starrating');
    if (!starRow) return;
    if (badge.querySelector('.stamped-badge-rating-value')) return;

    var el = document.createElement('span');
    el.className = 'stamped-badge-rating-value';
    el.textContent = text;
    el.setAttribute('aria-hidden', 'true');

    starRow.insertAdjacentElement('afterend', el);
    badge.setAttribute(INJECTED, 'true');
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes =
      scope.querySelectorAll &&
      scope.querySelectorAll(
        '.we-product-card__stamped .stamped-badge[data-rating], .product__block--stamped_reviews .stamped-badge[data-rating]'
      );
    if (!nodes || !nodes.forEach) return;
    nodes.forEach(enhanceBadge);
  }

  var scheduled;
  function scanSoon() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      scan(document);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      ensureAllZeroFallbacks(document);
      scan(document);
      syncZeroFallbacksSoon();
    });
  } else {
    ensureAllZeroFallbacks(document);
    scan(document);
    syncZeroFallbacksSoon();
  }

  if (typeof MutationObserver !== 'undefined' && document.body) {
    var mo = new MutationObserver(function () {
      scanSoon();
      ensureAllZeroFallbacks(document);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('shopify:section:load', function (e) {
    if (e && e.target) {
      ensureAllZeroFallbacks(e.target);
      scan(e.target);
    } else {
      ensureAllZeroFallbacks(document);
      scan(document);
    }
    syncZeroFallbacksSoon();
  });

  document.addEventListener('collection:rerendered', function () {
    requestAnimationFrame(function () {
      syncZeroFallbacksSoon();
    });
  });

  /** PDP badge: scroll to #stamped-main-widget when Stamped app block / widget is on the page. */
  document.addEventListener(
    'click',
    function (e) {
      var root = e.target.closest && e.target.closest('.product__block--stamped_reviews');
      if (!root) return;
      var target = document.getElementById('stamped-main-widget');
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    true
  );
})();

/**
 * Stamped.io collection / badge widgets render `.stamped-badge[data-rating]` after widget.min.js runs.
 * Inserts the numeric rating between the stars and the review count (caption).
 * After AJAX (e.g. collection load-more / facets), calls StampedFn.loadBadges() so new `.stamped-product-reviews-badge` nodes get filled in.
 */
(function () {
  var INJECTED = 'data-stamped-rating-injected';

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
      scan(document);
    });
  } else {
    scan(document);
  }

  if (typeof MutationObserver !== 'undefined' && document.body) {
    var mo = new MutationObserver(function () {
      scanSoon();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('shopify:section:load', function (e) {
    if (e && e.target) scan(e.target);
    else scan(document);
    reloadStampedProductBadges();
  });

  document.addEventListener('collection:rerendered', function () {
    requestAnimationFrame(function () {
      reloadStampedProductBadges();
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

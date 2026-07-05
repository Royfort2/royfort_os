/**
 * Stamped.io main reviews widget: locale, pagination mode, page size, scroll on page change.
 */
(function () {
  var CONFIG_ID = 'WeStampedMainWidgetConfig';
  var DEFAULT_TAKE = 2;
  var reloadPending = false;

  function getConfig() {
    var el = document.getElementById(CONFIG_ID);
    if (!el) return {};
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return {};
    }
  }

  function stampedLanguage(iso) {
    var raw = iso || document.documentElement.lang || 'de';
    return String(raw).split('-')[0].toUpperCase();
  }

  function getWidget() {
    return document.getElementById('stamped-main-widget');
  }

  function applyWidgetAttributes(widget) {
    var cfg = getConfig();
    widget.setAttribute('data-widget-language', stampedLanguage(cfg.language));
    widget.setAttribute('data-take-reviews', String(cfg.takeReviews || DEFAULT_TAKE));
    widget.setAttribute('data-animation', 'false');
    /* "continue" = Load More; anything else = numbered pagination */
    widget.setAttribute('data-load-type', 'pagination');

    var container = widget.querySelector('.stamped-container');
    if (container) {
      container.setAttribute('data-widget-load-type', 'pagination');
    }
  }

  function scheduleReloadUGC() {
    if (reloadPending) return;
    if (typeof StampedFn === 'undefined' || typeof StampedFn.reloadUGC !== 'function') return;
    reloadPending = true;
    requestAnimationFrame(function () {
      try {
        StampedFn.reloadUGC();
      } catch (e) {
        /* noop */
      }
      reloadPending = false;
      onReviewsLoaded();
    });
  }

  function configureWidget(options) {
    options = options || {};
    var widget = getWidget();
    if (!widget) return false;

    var alreadyConfigured = widget.dataset.weConfigured === 'true';
    applyWidgetAttributes(widget);
    widget.dataset.weConfigured = 'true';

    if (!alreadyConfigured && !options.beforeInit && typeof StampedFn !== 'undefined') {
      scheduleReloadUGC();
    }

    return true;
  }

  /**
   * After review pagination Stamped re-renders `.stamped-tabs`, leaving the Q&A panel
   * tied to review page 1 (often empty). Reload questions on-demand via Stamped's own method.
   */
  function questionsPanelNeedsLoad(widget) {
    var panel = widget.querySelector('.stamped-questions');
    if (!panel) return true;
    return !panel.querySelector(
      '.stamped-review, [id^="stamped-question"], .stamped-empty-state, #stamped-pagination-question'
    );
  }

  function reloadQuestions(widget) {
    if (typeof StampedFn === 'undefined' || typeof StampedFn.pageQuestions !== 'function') return;
    if (widget.dataset.weQuestionsReloading === 'true') return;
    widget.dataset.weQuestionsReloading = 'true';
    try {
      StampedFn.pageQuestions();
    } catch (e) {
      /* noop */
    }
    window.setTimeout(function () {
      delete widget.dataset.weQuestionsReloading;
    }, 3000);
  }

  function bindQuestionsTabReload() {
    var widget = getWidget();
    if (!widget || widget.dataset.weQuestionsTabBound === 'true') return;
    widget.dataset.weQuestionsTabBound = 'true';

    widget.addEventListener('click', function (e) {
      var tab = e.target.closest('#tab-questions, .stamped-tabs [data-type="questions"]');
      if (!tab) return;
      /* Let Stamped's own tab switch (Fe) run first, then top up an empty panel. */
      window.setTimeout(function () {
        if (questionsPanelNeedsLoad(widget)) reloadQuestions(widget);
      }, 350);
    });
  }

  function scrollOffsetPx() {
    var styles = getComputedStyle(document.documentElement);
    var header = parseFloat(styles.getPropertyValue('--header-height')) || 0;
    var sticky = parseFloat(styles.getPropertyValue('--sticky-atc-bar-height')) || 0;
    return header + sticky + 24;
  }

  function scrollToReviewsTop() {
    var widget = getWidget();
    if (!widget) return;
    var target =
      widget.querySelector('#stamped-reviews-tab') ||
      widget.querySelector('.stamped-reviews') ||
      widget;
    var top = target.getBoundingClientRect().top + window.pageYOffset - scrollOffsetPx();
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function bindPaginationScroll() {
    var widget = getWidget();
    if (!widget || widget.dataset.wePaginationBound === 'true') return;
    widget.dataset.wePaginationBound = 'true';

    widget.addEventListener('click', function (e) {
      var link = e.target.closest('.stamped-pagination a');
      if (!link || link.closest('.stamped-questions')) return;

      var scrollAfterLoad = function () {
        document.removeEventListener('stamped:reviews:loaded', scrollAfterLoad);
        scrollToReviewsTop();
      };
      document.addEventListener('stamped:reviews:loaded', scrollAfterLoad);
      window.setTimeout(function () {
        document.removeEventListener('stamped:reviews:loaded', scrollAfterLoad);
      }, 10000);
    });
  }

  function onReviewsLoaded() {
    var widget = getWidget();
    if (!widget) return;
    applyWidgetAttributes(widget);
    bindPaginationScroll();
    bindQuestionsTabReload();
  }

  function addEventListenerStamped(el, eventName, handler) {
    if (el.addEventListener) el.addEventListener(eventName, handler);
    else el.attachEvent('on' + eventName, function () {
      handler.call(el);
    });
  }

  function watchForWidget() {
    if (configureWidget()) return;
    if (typeof MutationObserver === 'undefined' || !document.body) return;

    var observer = new MutationObserver(function () {
      if (configureWidget()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.weConfigureStampedMainWidget = configureWidget;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForWidget);
  } else {
    watchForWidget();
  }

  addEventListenerStamped(document, 'stamped:reviews:loaded', onReviewsLoaded);

  document.addEventListener('shopify:section:load', function (e) {
    var target = e && e.target;
    if (target && target.querySelector && target.querySelector('#stamped-main-widget')) {
      var widget = target.querySelector('#stamped-main-widget');
      if (widget) {
        delete widget.dataset.weConfigured;
        delete widget.dataset.wePaginationBound;
        delete widget.dataset.weQuestionsTabBound;
        configureWidget();
      }
    }
  });
})();

/**
 * Stamped.io main reviews widget: locale, pagination mode, Q&A interactions.
 */
(function () {
  var CONFIG_ID = 'WeStampedMainWidgetConfig';
  var DEFAULT_TAKE = 2;
  var reloadPending = false;
  var actionsBound = false;

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
      onWidgetReady();
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

  function toggleStampedForm(type) {
    if (typeof StampedFn === 'undefined' || typeof StampedFn.toggleForm !== 'function') return;
    try {
      StampedFn.toggleForm(type);
    } catch (e) {
      /* noop */
    }
  }

  function questionsPanelNeedsLoad(widget) {
    var panel = widget.querySelector('.stamped-questions');
    if (!panel) return true;
    return !panel.querySelector(
      '.stamped-review, [id^="stamped-question"], .stamped-empty-state, #stamped-pagination-question'
    );
  }

  function ensureQuestionsLoaded() {
    var widget = getWidget();
    if (!widget || !questionsPanelNeedsLoad(widget)) return;
    if (typeof StampedFn === 'undefined') return;

    try {
      if (typeof StampedFn.pageQuestions === 'function') {
        StampedFn.pageQuestions();
        return;
      }
    } catch (e) {
      /* fall through */
    }
  }

  function bindSummaryActionClicks() {
    if (actionsBound) return;
    actionsBound = true;

    document.addEventListener('click', function (e) {
      var widget = getWidget();
      if (!widget || !widget.contains(e.target)) return;

      if (e.target.closest('.stamped-summary-actions-newreview')) {
        e.preventDefault();
        toggleStampedForm('review');
        return;
      }

      if (e.target.closest('.stamped-summary-actions-newquestion')) {
        e.preventDefault();
        toggleStampedForm('question');
        return;
      }

      var questionsTab = e.target.closest('#tab-questions, .stamped-tabs [data-type="questions"]');
      if (questionsTab) {
        window.setTimeout(ensureQuestionsLoaded, 400);
      }
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

  function onWidgetReady() {
    var widget = getWidget();
    if (!widget) return;
    applyWidgetAttributes(widget);
    bindSummaryActionClicks();
    bindPaginationScroll();
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

  bindSummaryActionClicks();
  addEventListenerStamped(document, 'stamped:reviews:loaded', onWidgetReady);
  addEventListenerStamped(document, 'stamped:questions:loaded', onWidgetReady);

  document.addEventListener('shopify:section:load', function (e) {
    var target = e && e.target;
    if (target && target.querySelector && target.querySelector('#stamped-main-widget')) {
      var widget = target.querySelector('#stamped-main-widget');
      if (widget) {
        delete widget.dataset.weConfigured;
        delete widget.dataset.wePaginationBound;
        configureWidget();
      }
    }
  });
})();

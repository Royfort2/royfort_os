/**
 * Sets --we-grid-row-height on #ProductsList to the tallest .we-product-card
 * height in the grid, used as grid-auto-rows for uniform row tracks.
 */
(function () {
  const DEBOUNCE_MS = 50;

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /**
   * Largest layout height among product cards (full .we-product-card box).
   */
  function maxWeProductCardHeight(grid) {
    const cards = grid.querySelectorAll('.f-column.card .we-product-card');
    if (!cards.length) return null;
    let max = 0;
    cards.forEach((el) => {
      const h = el.offsetHeight;
      if (h > max) max = h;
    });
    return max > 0 ? max : null;
  }

  function syncGrid(grid) {
    const h = maxWeProductCardHeight(grid);
    if (h == null) {
      grid.style.removeProperty('--we-grid-row-height');
      return;
    }
    grid.style.setProperty('--we-grid-row-height', `${h}px`);
  }

  function initGrid(grid) {
    if (grid.dataset.weGridRowHeightBound === 'true') return;
    grid.dataset.weGridRowHeightBound = 'true';

    const run = () => syncGrid(grid);
    const debouncedRun = debounce(run, DEBOUNCE_MS);
    const observed = new WeakSet();

    const ro = new ResizeObserver(() => debouncedRun());
    ro.observe(grid);

    function observe(node) {
      if (!node || observed.has(node)) return;
      observed.add(node);
      ro.observe(node);
    }

    function observeTargets() {
      grid.querySelectorAll('.f-column.card .we-product-card').forEach((c) => observe(c));
      grid.querySelectorAll('.f-column.card .product-card__info').forEach((el) => observe(el));
    }
    observeTargets();

    const mo = new MutationObserver(() => {
      observeTargets();
      debouncedRun();
    });
    mo.observe(grid, { childList: true, subtree: true });

    window.addEventListener('resize', debouncedRun);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(run);
    }

    run();
  }

  function boot() {
    document.querySelectorAll('grid-list#ProductsList').forEach(initGrid);
  }

  document.addEventListener('shopify:section:load', (e) => {
    const g = e.target?.querySelector?.('grid-list#ProductsList');
    if (g) initGrid(g);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/**
 * Hides the mobile floating filter FAB when #ProductGridContainer leaves the viewport
 * (slides down + fades); shows again when the grid intersects.
 */
(function () {
  const MQ = '(max-width: 767.98px)';
  const GRID_ID = 'ProductGridContainer';
  const FAB_SELECTOR = '.we-facet-drawer--mobile-fab.facet-drawer-wrapper';
  const HIDDEN_CLASS = 'we-facet-fab--out-of-view';

  let cleanup = null;

  function mount() {
    if (cleanup) cleanup();

    const grid = document.getElementById(GRID_ID);
    const fab = document.querySelector(FAB_SELECTOR);
    if (!grid || !fab) {
      cleanup = null;
      return;
    }

    const mq = window.matchMedia(MQ);
    let io = null;

    const apply = () => {
      if (io) {
        io.disconnect();
        io = null;
      }
      fab.classList.remove(HIDDEN_CLASS);

      if (!mq.matches) return;

      io = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          fab.classList.toggle(HIDDEN_CLASS, !entry.isIntersecting);
        },
        { root: null, threshold: 0, rootMargin: '0px' }
      );
      io.observe(grid);
    };

    apply();
    mq.addEventListener('change', apply);

    cleanup = () => {
      mq.removeEventListener('change', apply);
      if (io) io.disconnect();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  document.addEventListener('shopify:section:load', () => setTimeout(mount, 0));
})();

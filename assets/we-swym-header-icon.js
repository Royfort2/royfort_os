/**
 * Keeps the Swym header wishlist icon in the right header icon group.
 * Swym defaults to `a[href="/cart"]`; localized carts (e.g. /en/cart) miss that
 * selector and the icon falls back to the first `header .header__icons` (left slot).
 */
(function () {
  const ICON_ID = 'swym-advanced-header-icon';
  const RIGHT_BUTTONS = '.header__icons--right .header__buttons';
  const CART = '.header__icons--right .cart-drawer-button';

  function isPlacedCorrectly(icon) {
    return Boolean(icon?.closest('.header__icons--right'));
  }

  function fixPlacement() {
    const icon = document.getElementById(ICON_ID);
    if (!icon || isPlacedCorrectly(icon)) return true;

    const slot = document.querySelector(RIGHT_BUTTONS);
    if (!slot) return false;

    const cart = document.querySelector(CART);
    slot.insertBefore(icon, cart || slot.firstElementChild);
    return isPlacedCorrectly(icon);
  }

  function watchUntilPlaced() {
    if (fixPlacement()) return;

    const observer = new MutationObserver(() => {
      if (fixPlacement()) observer.disconnect();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchUntilPlaced);
  } else {
    watchUntilPlaced();
  }

  window.addEventListener('load', fixPlacement);
  document.addEventListener('shopify:section:load', () => setTimeout(fixPlacement, 0));
})();

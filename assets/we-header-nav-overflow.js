/**
 * Switches to the mobile header menu when the desktop nav would wrap to a second line.
 */
(function () {
  const DESKTOP_MQ = '(min-width: 1024px)';
  const OVERFLOW_CLASS = 'header-section--nav-overflow';
  const HYSTERESIS = 32;
  const ICON_CLEARANCE = 16;

  let cleanup = null;
  let updateFrame = null;
  let cachedMenuWidth = 0;
  let lastApplied = null;
  let lastHeaderWidth = 0;

  function getListGap(list) {
    const style = getComputedStyle(list);
    return parseFloat(style.columnGap || style.gap) || 0;
  }

  function getItemsRowWidth(list) {
    const items = [...list.children];
    if (!items.length) return 0;

    const gap = getListGap(list);
    let width = 0;

    items.forEach((item, index) => {
      width += item.getBoundingClientRect().width;
      if (index > 0) width += gap;
    });

    return width;
  }

  function sanitizeClone(root) {
    root.querySelectorAll('script').forEach((node) => node.remove());
    root.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        if (attribute.name.startsWith('on')) {
          node.removeAttribute(attribute.name);
        }
      });
    });
  }

  function measureMenuWidthFromClone(list) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;top:0;left:0;height:0;overflow:hidden;';

    const clone = list.cloneNode(true);
    sanitizeClone(clone);
    clone.style.cssText = 'display:flex;flex-wrap:nowrap;width:max-content;';
    [...clone.children].forEach((item) => {
      item.style.flexShrink = '0';
    });

    wrapper.appendChild(clone);
    list.closest('.header')?.appendChild(wrapper);
    const width = clone.getBoundingClientRect().width;
    wrapper.remove();
    return width;
  }

  function measureMenuWidth(list) {
    if (!list?.children.length) return 0;

    const isVisible = list.children[0].getBoundingClientRect().width > 0;
    if (isVisible) {
      cachedMenuWidth = getItemsRowWidth(list);
      return cachedMenuWidth;
    }

    if (cachedMenuWidth > 0) return cachedMenuWidth;
    return measureMenuWidthFromClone(list);
  }

  function itemsWrappedToMultipleRows(list) {
    const items = [...list.children];
    if (items.length < 2) return false;

    const firstTop = items[0].offsetTop;
    return items.some((item) => item.offsetTop > firstTop + 1);
  }

  function itemsWrappedInternally(list) {
    const items = [...list.children];
    if (!items.length) return false;

    const baseHeight = items[0].offsetHeight;
    return items.some((item) => item.offsetHeight > baseHeight + 1);
  }

  function getVisualNavSlot(header) {
    const logo = header.querySelector('.header__logo');
    const icons = header.querySelector('.header__icons--right');
    const iconsLeft = header.querySelector('.header__icons--left');
    if (!logo || !icons) return 0;

    const columnGap = parseFloat(getComputedStyle(header).columnGap) || 0;
    const logoRect = logo.getBoundingClientRect();
    const iconsRect = icons.getBoundingClientRect();

    if (!logoRect.width || !iconsRect.width) return 0;

    let leftEdge = logoRect.right;
    if (iconsLeft && getComputedStyle(iconsLeft).display !== 'none') {
      const iconsLeftRect = iconsLeft.getBoundingClientRect();
      if (iconsLeftRect.width) {
        leftEdge = Math.max(leftEdge, iconsLeftRect.right);
      }
    }

    return Math.max(0, iconsRect.left - leftEdge - columnGap);
  }

  function menuOverlapsIcons(header, list) {
    const icons = header.querySelector('.header__icons--right');
    if (!icons || getComputedStyle(icons).display === 'none') return false;

    const iconsLeft = icons.getBoundingClientRect().left;
    if (!iconsLeft) return false;

    const lastItem = list.children[list.children.length - 1];
    if (!lastItem) return false;

    return lastItem.getBoundingClientRect().right > iconsLeft - ICON_CLEARANCE;
  }

  function getAvailableNavWidth(header, isMobileMenuActive) {
    const nav = header.querySelector('.header__navigation');
    const logo = header.querySelector('.header__logo');
    const icons = header.querySelector('.header__icons--right');
    if (!nav || !logo || !icons) return 0;

    const visualSlot = getVisualNavSlot(header);

    if (!isMobileMenuActive && getComputedStyle(nav).display !== 'none') {
      const navWidth = nav.getBoundingClientRect().width;
      if (navWidth >= 48 && visualSlot >= 48) {
        return Math.min(navWidth, visualSlot);
      }
      if (navWidth >= 48) return navWidth;
      if (visualSlot >= 48) return visualSlot;
    }

    const headerWidth = header.getBoundingClientRect().width;
    if (!headerWidth) return 0;

    return headerWidth * 0.7;
  }

  function shouldUseMobileMenu(header, isMobileMenuActive) {
    const list = header.querySelector('.header__navigation .header__menu > ul');
    if (!list?.children.length) return false;

    if (!isMobileMenuActive) {
      if (menuOverlapsIcons(header, list)) return true;
      if (itemsWrappedToMultipleRows(list)) return true;
      if (itemsWrappedInternally(list)) return true;
    }

    const availableWidth = getAvailableNavWidth(header, isMobileMenuActive);
    const menuWidth = measureMenuWidth(list);
    if (!availableWidth || !menuWidth) return isMobileMenuActive;

    if (isMobileMenuActive) {
      return menuWidth > availableWidth - HYSTERESIS;
    }

    return menuWidth > availableWidth + HYSTERESIS;
  }

  function closeDesktopMenus(header) {
    header.querySelectorAll('details[is="details-dropdown"][open], details[is="details-mega"][open]').forEach(
      (details) => {
        details.open = false;
      }
    );
  }

  function update() {
    if (updateFrame) cancelAnimationFrame(updateFrame);

    updateFrame = requestAnimationFrame(() => {
      updateFrame = null;

      const section = document.querySelector('.header-section');
      const header = section?.querySelector('.header');
      if (!section || !header) return;

      const mq = window.matchMedia(DESKTOP_MQ);
      if (!mq.matches) {
        section.classList.remove(OVERFLOW_CLASS);
        lastApplied = false;
        return;
      }

      const isMobileMenuActive = section.classList.contains(OVERFLOW_CLASS);
      const headerWidth = header.getBoundingClientRect().width;

      if (Math.abs(headerWidth - lastHeaderWidth) > 1) {
        cachedMenuWidth = 0;
        lastHeaderWidth = headerWidth;
      }

      const shouldOverflow = shouldUseMobileMenu(header, isMobileMenuActive);

      if (shouldOverflow === lastApplied) return;

      lastApplied = shouldOverflow;
      section.classList.toggle(OVERFLOW_CLASS, shouldOverflow);

      if (shouldOverflow) {
        closeDesktopMenus(header);
      }
    });
  }

  function mount() {
    if (cleanup) cleanup();

    const section = document.querySelector('.header-section');
    const header = section?.querySelector('.header');
    if (!header) {
      cleanup = null;
      return;
    }

    const mq = window.matchMedia(DESKTOP_MQ);
    const ro = new ResizeObserver(() => update());

    ro.observe(header);
    mq.addEventListener('change', update);
    window.addEventListener('load', update);
    document.fonts?.ready?.then(update);

    update();

    cleanup = () => {
      if (updateFrame) cancelAnimationFrame(updateFrame);
      ro.disconnect();
      mq.removeEventListener('change', update);
      window.removeEventListener('load', update);
      section?.classList.remove(OVERFLOW_CLASS);
      cachedMenuWidth = 0;
      lastApplied = null;
      lastHeaderWidth = 0;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  document.addEventListener('shopify:section:load', () => setTimeout(mount, 0));
})();

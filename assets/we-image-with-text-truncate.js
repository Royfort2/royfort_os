/**
 * Image with text: mobile truncate — expand/collapse (single global listener; script may load per section).
 */
(function () {
  if (window.__weImageWithTextTruncateInit) return;
  window.__weImageWithTextTruncateInit = true;

  function eventTargetElement(target) {
    if (!target) return null;
    return target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
  }

  document.addEventListener(
    'click',
    function (e) {
      const el = eventTargetElement(e.target);
      const btn = el?.closest?.('[data-we-truncate-toggle]');
      if (!btn) return;
      const root = btn.closest('[data-we-truncate]');
      if (!root) return;

      e.preventDefault();
      e.stopPropagation();

      const more = btn.getAttribute('data-label-more') || 'Mehr lesen';
      const less = btn.getAttribute('data-label-less') || 'Weniger';
      const expanded = !root.classList.contains('is-expanded');

      root.classList.toggle('is-expanded', expanded);
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      btn.textContent = expanded ? less : more;
    },
    true
  );
})();

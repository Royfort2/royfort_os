/**
 * Image with text: mobile truncate block — expand/collapse toggle.
 */
(function () {
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-we-truncate-toggle]');
    if (!btn) return;
    const root = btn.closest('[data-we-truncate]');
    if (!root) return;

    const more = btn.getAttribute('data-label-more') || 'Mehr lesen';
    const less = btn.getAttribute('data-label-less') || 'Weniger';
    const expanded = !root.classList.contains('is-expanded');

    root.classList.toggle('is-expanded', expanded);
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.textContent = expanded ? less : more;
  });
})();

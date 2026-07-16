(function () {
  function initCollectionLoadMore() {
    var buttons = document.querySelectorAll('.collection-load-more__button[data-next-url]');

    buttons.forEach(function (button) {
      if (button.dataset.loadMoreBound === 'true') return;
      button.dataset.loadMoreBound = 'true';

      button.addEventListener('click', function (event) {
        event.preventDefault();

        var nextUrl = button.getAttribute('data-next-url');
        if (!nextUrl || button.disabled) return;

        var originalLabel = button.textContent;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');

        fetch(nextUrl, { credentials: 'same-origin' })
          .then(function (response) {
            if (!response.ok) throw new Error('Failed to load more products');
            return response.text();
          })
          .then(function (html) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');
            appendProducts(doc);

            var nextButton = doc.querySelector('.collection-load-more__button[data-next-url]');
            var nextPageUrl = nextButton ? nextButton.getAttribute('data-next-url') : null;

            if (nextPageUrl) {
              button.setAttribute('data-next-url', nextPageUrl);
              button.disabled = false;
              button.removeAttribute('aria-busy');
            } else {
              var container = button.closest('[data-collection-load-more]');
              if (container) container.remove();
            }

            reinitializeCollectionProducts();
          })
          .catch(function () {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.textContent = originalLabel;
          });
      });
    });
  }

  function appendProducts(doc) {
    var loadMoreContainer = document.querySelector('.collection-load-more-container');

    doc.querySelectorAll('.collection-listing-container[data-collection-section]').forEach(function (sourceSection) {
      var sectionKey = sourceSection.getAttribute('data-collection-section');
      var targetSection = document.querySelector(
        '.collection-listing-container[data-collection-section="' + sectionKey + '"]'
      );

      if (!targetSection) {
        if (loadMoreContainer && loadMoreContainer.parentNode) {
          loadMoreContainer.parentNode.insertBefore(sourceSection.cloneNode(true), loadMoreContainer);
        }
        return;
      }

      var targetListing = targetSection.querySelector('.collection-listing');
      if (!targetListing) return;

      sourceSection.querySelectorAll('.product-listing[data-product-id]').forEach(function (productNode) {
        var productId = productNode.getAttribute('data-product-id');
        if (!productId) return;
        if (targetSection.querySelector('.product-listing[data-product-id="' + productId + '"]')) return;

        targetListing.appendChild(productNode.cloneNode(true));
      });
    });
  }

  function reinitializeCollectionProducts() {
    if (typeof productListingRatio === 'function') productListingRatio();
    if (typeof quantityControl === 'function') quantityControl();
    if (typeof mobileQuantityModal === 'function') mobileQuantityModal('.collection-listing .product-quantity-container');
    if (typeof collectionTagCount === 'function') collectionTagCount();
    if (typeof collectionShadeImages === 'function') collectionShadeImages();
    if (typeof collectionHover === 'function') collectionHover();
    if (typeof collectionProductImage === 'function') collectionProductImage();
    if (typeof productSwatchCollection === 'function') productSwatchCollection();

    if (window.jQuery) {
      window.jQuery('form[action="/cart/add"]').off('submit').on('submit', function (e) {
        e.preventDefault();
        if (typeof submitForm === 'function') submitForm(window.jQuery(this));
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCollectionLoadMore);
  } else {
    initCollectionLoadMore();
  }
})();

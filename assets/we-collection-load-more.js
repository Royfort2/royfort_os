(function () {
  var isLoading = false;
  var observer = null;

  function initCollectionLoadMore() {
    var sentinel = document.querySelector('.collection-load-more__sentinel[data-next-url]');
    if (!sentinel) return;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || isLoading) return;
          loadNextPage(sentinel);
        });
      },
      {
        root: null,
        rootMargin: '200px 0px',
        threshold: 0,
      }
    );

    observer.observe(sentinel);
  }

  function loadNextPage(sentinel) {
    var nextUrl = sentinel.getAttribute('data-next-url');
    if (!nextUrl || isLoading) return;

    isLoading = true;
    setLoadingState(true);

    fetch(nextUrl, { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('Failed to load more products');
        return response.text();
      })
      .then(function (html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        appendProducts(doc);

        var nextSentinel = doc.querySelector('.collection-load-more__sentinel[data-next-url]');
        var nextPageUrl = nextSentinel ? nextSentinel.getAttribute('data-next-url') : null;

        if (nextPageUrl) {
          sentinel.setAttribute('data-next-url', nextPageUrl);
          isLoading = false;
          setLoadingState(false);
        } else {
          if (observer) {
            observer.disconnect();
            observer = null;
          }
          var container = sentinel.closest('[data-collection-load-more]');
          if (container) container.remove();
          isLoading = false;
        }

        reinitializeCollectionProducts();
      })
      .catch(function () {
        isLoading = false;
        setLoadingState(false);
      });
  }

  function setLoadingState(loading) {
    var status = document.querySelector('.collection-load-more__status');
    if (!status) return;

    if (loading) {
      status.removeAttribute('hidden');
    } else {
      status.setAttribute('hidden', '');
    }
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

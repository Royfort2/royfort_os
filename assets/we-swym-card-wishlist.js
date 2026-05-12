/**
 * Wishlist Plus (Swym) — theme-controlled hearts on product cards.
 * @see https://developers.getswym.com/docs/collection-page-buttons
 * @see https://developers.getswym.com/docs/custom-wishlist-experience-using-js-sdk (product shape: stk must be 1|0, not boolean)
 */
(function () {
  'use strict';

  /** @type {Set<string>} */
  let wishlistedVariantKeys = new Set();

  function variantKey(empi, epi) {
    return String(empi) + ':' + String(epi);
  }

  function ingestRemoteList(payload) {
    wishlistedVariantKeys = new Set();
    var rows = payload;
    if (!rows) return;
    if (!Array.isArray(rows)) {
      if (rows.listContents && Array.isArray(rows.listContents)) {
        rows = rows.listContents;
      } else if (rows.contents && Array.isArray(rows.contents)) {
        rows = rows.contents;
      } else {
        return;
      }
    }

    rows.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var empi = item.empi != null ? item.empi : item.pid != null ? item.pid : item.productId;
      var epi = item.epi != null ? item.epi : item.vid != null ? item.vid : item.variantId;
      if (empi != null && epi != null) {
        wishlistedVariantKeys.add(variantKey(empi, epi));
      }
      if (empi != null && epi == null) {
        wishlistedVariantKeys.add(variantKey(empi, '*'));
      }
    });
  }

  function isListed(btn) {
    var empi = btn.dataset.productId;
    var epi = btn.dataset.variantId;
    if (!empi || !epi) return false;
    return (
      wishlistedVariantKeys.has(variantKey(empi, epi)) ||
      wishlistedVariantKeys.has(variantKey(empi, '*'))
    );
  }

  function applyUi(btn, listed) {
    var addL = btn.dataset.labelAdd || 'Add to wishlist';
    var remL = btn.dataset.labelRemove || 'Remove from wishlist';
    btn.setAttribute('aria-pressed', listed ? 'true' : 'false');
    btn.setAttribute('aria-label', listed ? remL : addL);
    btn.classList.toggle('we-card-wishlist-btn--active', listed);
  }

  function syncButton(btn) {
    applyUi(btn, isListed(btn));
  }

  function syncAll() {
    document.querySelectorAll('[data-we-card-wishlist]').forEach(syncButton);
  }

  /** Canonical absolute product URL (pathname only — variant is sent as `epi`). */
  function absoluteCanonicalDu(rawHref) {
    if (!rawHref) return '';
    try {
      var u = new URL(rawHref.startsWith('http') ? rawHref : window.location.origin + rawHref);
      return window.location.origin + u.pathname;
    } catch (_) {
      var path = String(rawHref).split('?')[0];
      return path.startsWith('http') ? path : window.location.origin + path;
    }
  }

  /**
   * Swym-valid product payload. `stk` MUST be numeric 1 or 0 (not boolean) or API returns 400.
   */
  function buildPayload(btn, swymProductJson) {
    var mergedDu =
      swymProductJson && swymProductJson.du ? swymProductJson.du : absoluteCanonicalDu(btn.dataset.du || '');
    var empi =
      swymProductJson && swymProductJson.empi != null
        ? swymProductJson.empi
        : swymProductJson && swymProductJson.id != null
          ? swymProductJson.id
          : Number(btn.dataset.productId);
    /* Variant always comes from the card / swatch hover — Swym expects `epi` for this SKU */
    var epi = Number(btn.dataset.variantId);

    var payload = {
      empi: empi,
      epi: epi,
      du: mergedDu,
      dt:
        (swymProductJson && (swymProductJson.dt || swymProductJson.title)) ||
        btn.dataset.productTitle ||
        '',
      pr:
        swymProductJson && swymProductJson.pr != null
          ? swymProductJson.pr
          : Number(btn.dataset.price) || 0,
      stk:
        btn.dataset.stk !== undefined && btn.dataset.stk !== ''
          ? Number(btn.dataset.stk)
          : btn.dataset.available === 'true'
            ? 1
            : 0,
      source: 'collections-grid',
    };

    var iu =
      (swymProductJson && swymProductJson.iu) ||
      (btn.dataset.imageUrl && btn.dataset.imageUrl.trim()) ||
      '';
    if (iu) payload.iu = iu;

    return payload;
  }

  function bindClicks(swat) {
    document.addEventListener(
      'click',
      function (e) {
        var btn = e.target.closest('[data-we-card-wishlist]');
        if (!btn || !document.body.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();

        var rawDu = btn.dataset.du || '';
        var pathForLookup = rawDu.split('?')[0] || rawDu;
        if (!pathForLookup.startsWith('/')) {
          try {
            pathForLookup = new URL(rawDu.startsWith('http') ? rawDu : window.location.origin + rawDu).pathname;
          } catch (_) {
            pathForLookup = '/' + pathForLookup.replace(/^\/+/, '');
          }
        }

        function logSwymErr(where, err) {
          console.warn('[Swym Wishlist]', where, err);
        }

        function toggleWithPayload(p, listedFlag) {
          var listed = listedFlag;

          function afterAdd() {
            wishlistedVariantKeys.add(variantKey(p.empi, p.epi));
            syncButton(btn);
          }
          function afterRemove() {
            wishlistedVariantKeys.delete(variantKey(p.empi, p.epi));
            syncButton(btn);
          }

          if (listed) {
            var rm = swat.removeFromWishList || swat.removeFromWishlist || swat.deleteFromWishlist;
            if (typeof rm !== 'function') {
              logSwymErr('removeFromWishList missing on swat');
              return;
            }
            rm.call(
              swat,
              p,
              afterRemove,
              function (err) {
                logSwymErr('removeFromWishList', err);
              }
            );
            return;
          }
          var add = swat.addToWishList || swat.addToWishlist;
          if (typeof add !== 'function') {
            logSwymErr('addToWishList missing on swat');
            return;
          }
          add.call(
            swat,
            p,
            afterAdd,
            function (err) {
              logSwymErr('addToWishList', err);
            }
          );
        }

        var listedFlag = isListed(btn);

        function runToggle(productJson) {
          var p = buildPayload(btn, productJson || null);
          p.epi = Number(btn.dataset.variantId);
          toggleWithPayload(p, listedFlag);
        }

        if (typeof swat.getProductDetails === 'function') {
          swat.getProductDetails({ du: pathForLookup }, function (pj) {
            if (!pj) {
              logSwymErr('getProductDetails returned empty — fallback Liquid ids', pathForLookup);
              runToggle(null);
              return;
            }
            runToggle(pj);
          });
        } else {
          runToggle(null);
        }
      },
      true
    );
  }

  function observeDom() {
    var root = document.getElementById('MainContent') || document.body;
    var scheduled = false;
    function scheduleSyncAll() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        syncAll();
      });
    }
    var mo = new MutationObserver(scheduleSyncAll);
    mo.observe(root, { childList: true, subtree: true });
  }

  function init(swat) {
    if (!swat) return;
    if (typeof swat.fetch === 'function') {
      swat.fetch(function (products) {
        ingestRemoteList(products);
        syncAll();
      });
    } else {
      syncAll();
    }
    bindClicks(swat);
    observeDom();

    window.weRoyfortSwymSyncWishlistButtons = syncAll;

    document.addEventListener('shopify:section:load', function () {
      if (typeof swat.fetch === 'function') {
        swat.fetch(function (products) {
          ingestRemoteList(products);
          syncAll();
        });
      }
    });

    if (swat.evtLayer && typeof swat.evtLayer.addEventListener === 'function') {
      swat.evtLayer.addEventListener('sw:wishlist-updated', function () {
        if (typeof swat.fetch === 'function') {
          swat.fetch(function (products) {
            ingestRemoteList(products);
            syncAll();
          });
        }
      });
    }
  }

  window.SwymCallbacks = window.SwymCallbacks || [];
  window.SwymCallbacks.push(init);
})();

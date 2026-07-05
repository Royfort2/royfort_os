/**
 * Klaviyo Client Back in Stock for set add-on line variants.
 * @see https://developers.klaviyo.com/en/docs/how_to_set_up_custom_back_in_stock
 */
(function () {
  const KLAVIYO_BIS_URL = 'https://a.klaviyo.com/client/back-in-stock-subscriptions/';
  const DEFAULT_REVISION = '2024-06-15';

  let activeVariantId = null;

  function resolveKlaviyoCompanyId() {
    const fromSettings = window.FoxTheme?.settings?.klaviyoCompanyId;
    if (fromSettings && String(fromSettings).trim()) {
      return String(fromSettings).trim();
    }

    const kl = window.klaviyo;
    if (kl?.account) return String(kl.account).trim();
    if (kl?._account) return String(kl._account).trim();

    for (const script of document.querySelectorAll('script[src*="klaviyo"]')) {
      const src = script.getAttribute('src') || '';
      const match = src.match(/company_id=([^&]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]).trim();
    }

    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      const accountMatch = text.match(/account\s*:\s*["']([^"']+)["']/);
      if (accountMatch?.[1]) return accountMatch[1].trim();
      const companyMatch = text.match(/company_id[=:]\s*["']?([A-Za-z0-9]+)/);
      if (companyMatch?.[1]) return companyMatch[1].trim();
    }

    return null;
  }

  function shopifyVariantCatalogId(variantId) {
    return `$shopify:::$default:::${variantId}`;
  }

  function getModal() {
    return document.querySelector('basic-modal.pdp-set-addon-bis-modal');
  }

  function resetModalUi(modal) {
    if (!modal) return;
    const form = modal.querySelector('[data-pdp-set-addon-bis-form]');
    const success = modal.querySelector('[data-pdp-set-addon-bis-success]');
    const error = modal.querySelector('[data-pdp-set-addon-bis-error]');
    const email = modal.querySelector('[data-pdp-set-addon-bis-email]');
    const submit = modal.querySelector('.pdp-set-addon-bis-modal__submit');

    if (form) form.hidden = false;
    if (success) success.hidden = true;
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    if (email) email.value = '';
    if (submit) {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  }

  function showError(modal, message) {
    const error = modal?.querySelector('[data-pdp-set-addon-bis-error]');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  function showSuccess(modal) {
    const form = modal?.querySelector('[data-pdp-set-addon-bis-form]');
    const success = modal?.querySelector('[data-pdp-set-addon-bis-success]');
    if (form) form.hidden = true;
    if (success) success.hidden = false;
  }

  async function subscribeBackInStock(email, variantId, companyId) {
    const revision = window.FoxTheme?.settings?.klaviyoBisRevision || DEFAULT_REVISION;
    const payload = {
      data: {
        type: 'back-in-stock-subscription',
        attributes: {
          profile: {
            data: {
              type: 'profile',
              attributes: { email },
            },
          },
          channels: ['EMAIL'],
        },
        relationships: {
          variant: {
            data: {
              type: 'catalog-variant',
              id: shopifyVariantCatalogId(variantId),
            },
          },
        },
      },
    };

    const url = `${KLAVIYO_BIS_URL}?company_id=${encodeURIComponent(companyId)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        revision,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 202) {
      return { ok: true };
    }

    let detail = '';
    try {
      const body = await response.json();
      detail = body?.errors?.[0]?.detail || body?.errors?.[0]?.title || '';
    } catch (e) {
      /* ignore */
    }

    return {
      ok: false,
      message: detail || 'Die Anmeldung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.',
    };
  }

  function openPdpSetAddonBisModal({ variant, productTitle, variantLabel }) {
    if (!variant?.id) return;

    const modal = getModal();
    if (!modal) return;

    activeVariantId = variant.id;

    const titleEl = modal.querySelector('[data-pdp-set-addon-bis-title]');
    const variantEl = modal.querySelector('[data-pdp-set-addon-bis-variant]');

    if (titleEl) {
      titleEl.textContent = productTitle || 'Benachrichtigung bei Verfügbarkeit';
    }
    if (variantEl) {
      const label =
        variantLabel ||
        (Array.isArray(variant.options) ? variant.options.filter(Boolean).join(' · ') : variant.title);
      if (label) {
        variantEl.textContent = label;
        variantEl.hidden = false;
      } else {
        variantEl.textContent = '';
        variantEl.hidden = true;
      }
    }

    resetModalUi(modal);

    if (typeof modal.show === 'function') {
      modal.show();
    } else {
      modal.setAttribute('open', '');
    }

    requestAnimationFrame(() => {
      modal.querySelector('[data-pdp-set-addon-bis-email]')?.focus();
    });
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest?.('[data-pdp-set-addon-bis-form]');
    if (!form) return;
    event.preventDefault();

    const modal = form.closest('basic-modal.pdp-set-addon-bis-modal');
    const emailInput = form.querySelector('[data-pdp-set-addon-bis-email]');
    const submit = form.querySelector('.pdp-set-addon-bis-modal__submit');
    const email = emailInput?.value?.trim();

    if (!email || !emailInput?.checkValidity?.()) {
      showError(modal, 'Bitte geben Sie eine gültige E-Mail-Adresse ein.');
      emailInput?.focus();
      return;
    }

    if (!activeVariantId) {
      showError(modal, 'Keine Variante ausgewählt. Bitte schließen Sie das Fenster und wählen Sie erneut.');
      return;
    }

    const companyId = resolveKlaviyoCompanyId();
    if (!companyId) {
      showError(
        modal,
        'Klaviyo ist nicht konfiguriert. Bitte hinterlegen Sie den Public API Key unter Theme-Einstellungen → [we] Custom.'
      );
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
    }

    try {
      const result = await subscribeBackInStock(email, activeVariantId, companyId);
      if (result.ok) {
        showSuccess(modal);
      } else {
        showError(modal, result.message);
      }
    } catch (err) {
      console.error('[pdp-set-addon-bis] subscribe failed', err);
      showError(
        modal,
        'Die Anmeldung konnte nicht gesendet werden. Bitte versuchen Sie es später erneut.'
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      }
    }
  });

  document.addEventListener('toggle', (event) => {
    const modal = event.target;
    if (!modal?.matches?.('basic-modal.pdp-set-addon-bis-modal') || modal.hasAttribute('open')) return;
    activeVariantId = null;
    resetModalUi(modal);
  });

  window.openPdpSetAddonBisModal = openPdpSetAddonBisModal;
})();

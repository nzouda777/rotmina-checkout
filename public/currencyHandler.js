/**
 * BUCKS Currency Persistence Layer
 *
 * This store has Shopify Markets multi-currency OFF (BUCKS's own config
 * reports `multiCurrencyEnabled: false`), so BUCKS runs as a client-side
 * display-only converter with no real cross-page memory: every fresh page
 * load re-derives its default currency (from language/market), ignoring
 * whatever the customer picked before — even a real manual click in the
 * widget resets on the next page. This script layers our own persistence on
 * top of BUCKS to work around that:
 *
 *   1. Remembers the customer's currency in localStorage — either because
 *      they arrive from checkout with a `?currency=` param (see
 *      withCurrencyParam()/storeUrl() in the checkout app and
 *      public/shopify-checkout-button.liquid) or because they picked one
 *      manually in the BUCKS widget on any page.
 *   2. On every page load, re-applies that remembered currency by
 *      simulating a click on the matching BUCKS option — the same widget
 *      element the customer would click themselves — so BUCKS's own
 *      conversion logic does the actual work.
 *   3. When there is nothing remembered yet (first visit, private window,
 *      a different device), falls back to the currency the storefront's
 *      language implies — Hebrew ⇒ ILS — instead of letting BUCKS pick from
 *      IP/market, which lands on USD on a Hebrew page.
 *
 * BUCKS renders <li class="converterTriggers" id="EUR" rel="EUR">...</li>
 * options. Simulating the click (rather than guessing BUCKS's internal
 * cookie/localStorage keys, which aren't publicly documented) makes BUCKS
 * run its own existing switch logic exactly as if the customer had picked it
 * manually — so it stays correct even if BUCKS changes how it stores the
 * currency internally.
 *
 * To use this script:
 * 1. In Shopify Admin, go to Online Store > Themes > Edit code.
 * 2. Under Assets, click "Add a new asset" > Upload file, and upload this
 *    file as `currencyHandler.js`.
 * 3. In theme.liquid, right before </head>, add:
 *      <script src="{{ 'currencyHandler.js' | asset_url }}" defer></script>
 */
(function () {
  var STORAGE_KEY = 'rotmina_currency';

  function getStoredCurrency() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }
  function setStoredCurrency(currency) {
    try { localStorage.setItem(STORAGE_KEY, currency); } catch (_) {}
  }

  // A `?currency=` param (from the checkout redirect) always wins over
  // whatever was previously remembered, and becomes the new remembered value.
  var params = new URLSearchParams(window.location.search);
  var urlCurrency = params.get('currency');
  if (urlCurrency) {
    urlCurrency = urlCurrency.toUpperCase();
    setStoredCurrency(urlCurrency);

    // Clean the URL immediately so the param doesn't linger or re-trigger on
    // subsequent client-side navigation within the theme.
    params.delete('currency');
    var cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
  }

  // Currency implied by the storefront language, used only as a starting
  // point when the customer has never chosen one on this device.
  //
  // Without this, a first-time visitor on a Hebrew page gets whatever BUCKS
  // derives from IP/market — which is USD. It only looked correct on desktop
  // because localStorage already held a currency from an earlier visit; a
  // fresh phone has nothing stored and falls straight through to USD.
  //
  // Deliberately NOT written to localStorage: it's a default, not a choice,
  // so switching the storefront to English still moves the price back to
  // BUCKS's own default instead of staying stuck on ILS.
  var LANGUAGE_DEFAULT_CURRENCY = { he: 'ILS' };

  function storefrontLanguage() {
    var locale = '';
    // Shopify sets window.Shopify.locale on every storefront page; the <html
    // lang> attribute is theme-controlled, so it's the fallback, not the source.
    try {
      if (window.Shopify && window.Shopify.locale) locale = String(window.Shopify.locale);
    } catch (_) {}
    if (!locale) locale = document.documentElement.getAttribute('lang') || '';
    return locale.toLowerCase().split('-')[0];
  }

  function languageDefaultCurrency() {
    return LANGUAGE_DEFAULT_CURRENCY[storefrontLanguage()] || null;
  }

  var targetCurrency = urlCurrency || getStoredCurrency() || languageDefaultCurrency();

  // No param, nothing remembered, and no default for this language — leave
  // BUCKS on its own default.
  if (targetCurrency) {
    var MAX_WAIT_MS = 8000;
    var POLL_INTERVAL_MS = 200;
    var elapsed = 0;

    // Every matching option, not just the first: themes commonly render the
    // BUCKS widget twice — once in the desktop header, once inside the mobile
    // menu/drawer — and on a phone the desktop copy is the one that comes
    // first in the DOM while being hidden, so clicking only it does nothing.
    // They all switch to the same currency, so clicking each is harmless.
    function findOptions() {
      var triggers = document.querySelectorAll('.converterTriggers');
      var matches = [];
      for (var i = 0; i < triggers.length; i++) {
        var code = (triggers[i].getAttribute('rel') || triggers[i].id || '').toUpperCase();
        if (code === targetCurrency) matches.push(triggers[i]);
      }
      return matches;
    }

    // BUCKS doesn't expose any reliable way to read back "did the click take
    // effect" (the hidden #bucksSelector <select> is never actually kept in
    // sync — its .value stays stale even after a successful switch), so unlike
    // a verified retry loop, we just click once as soon as the option exists
    // and stop. This matches how the very first working version of this
    // handler behaved (click-once-on-found), which is the one part of this
    // flow already confirmed to visibly apply the currency.
    var poll = setInterval(function () {
      elapsed += POLL_INTERVAL_MS;
      var options = findOptions();
      options.forEach(function (option) {
        // Some widgets bind the handler to a click, others to mousedown —
        // fire both so whichever BUCKS actually listens for gets triggered.
        ['mousedown', 'click'].forEach(function (type) {
          option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
      });
      if (options.length || elapsed >= MAX_WAIT_MS) {
        clearInterval(poll);
      }
    }, POLL_INTERVAL_MS);
  }

  // Keep the remembered currency in sync whenever the customer manually picks
  // one from the BUCKS widget on any page, so later pages keep following
  // their latest choice instead of drifting back to the checkout-driven one.
  document.addEventListener('click', function (e) {
    // Only a real click counts as a choice. The clicks dispatched above bubble
    // up here too, and persisting those would turn the language-derived
    // default into a remembered "manual" pick — freezing the visitor on ILS
    // even after they switch the storefront to English.
    if (!e.isTrusted) return;
    var trigger = e.target && e.target.closest && e.target.closest('.converterTriggers');
    if (!trigger) return;
    var currency = (trigger.id || trigger.getAttribute('rel') || '').toUpperCase();
    if (currency) setStoredCurrency(currency);
  }, true);
})();

/**
 * Checkout → Storefront Currency Handoff
 *
 * When the customer finishes (or exits) checkout, the checkout app redirects
 * back to the store with a `?currency=XXX` query param (see storeUrl() /
 * withCurrencyParam() in the checkout app). This script reads that param and
 * clicks the matching option in the BUCKS Currency Converter dropdown, e.g.:
 *
 *   <li class="converterTriggers" id="EUR" rel="EUR">...</li>
 *
 * Simulating the click (rather than guessing BUCKS's internal cookie/
 * localStorage key, which isn't publicly documented) makes BUCKS run its own
 * existing switch logic exactly as if the customer had picked it manually —
 * so it stays correct even if BUCKS changes how it stores the currency
 * internally.
 *
 * To use this script:
 * 1. In Shopify Admin, go to Online Store > Themes > Edit code.
 * 2. Under Assets, click "Add a new asset" > Upload file, and upload this
 *    file as `currencyHandler.js`.
 * 3. In theme.liquid, right before </head>, add:
 *      <script src="{{ 'currencyHandler.js' | asset_url }}" defer></script>
 */
(function () {
  var params = new URLSearchParams(window.location.search);
  var currency = params.get('currency');
  if (!currency) return;
  currency = currency.toUpperCase();

  // Clean the URL immediately so the param doesn't linger or re-trigger on
  // subsequent client-side navigation within the theme.
  params.delete('currency');
  var cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
  window.history.replaceState({}, '', cleanUrl);

  var MAX_WAIT_MS = 8000;
  var POLL_INTERVAL_MS = 200;
  var elapsed = 0;

  function findOption() {
    // BUCKS renders <li class="converterTriggers" id="EUR" rel="EUR">.
    return (
      document.querySelector('.converterTriggers[rel="' + currency + '"]') ||
      document.querySelector('.converterTriggers#' + currency)
    );
  }

  function tryApplyCurrency() {
    var option = findOption();
    if (!option) return false;

    // Some widgets bind the handler to a click, others to mousedown — fire
    // both so whichever BUCKS actually listens for gets triggered.
    ['mousedown', 'click'].forEach(function (type) {
      option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    return true;
  }

  var poll = setInterval(function () {
    elapsed += POLL_INTERVAL_MS;
    if (tryApplyCurrency() || elapsed >= MAX_WAIT_MS) {
      clearInterval(poll);
    }
  }, POLL_INTERVAL_MS);
})();

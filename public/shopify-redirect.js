/**
 * Shopify Custom Checkout Redirect Script
 * 
 * To use this script:
 * 1. Upload this file to your Shopify assets or a CDN.
 * 2. In your Shopify Theme code (e.g., cart.liquid or main-cart-footer.liquid),
 *    replace the default checkout button with a call to this script.
 * 
 * Example usage:
 * <button type="button" onclick="redirectToCustomCheckout()">Checkout</button>
 */

const APP_URL = 'https://rotmina-checkout.vercel.app'; // Replace with your production URL

async function redirectToCustomCheckout() {
  try {
    // 1. Get cart data from Shopify (full raw cart including discount fields)
    const cartResponse = await fetch('/cart.js');
    const cart = await cartResponse.json();

    if (!cart.items || cart.items.length === 0) {
      alert('Your cart is empty');
      return;
    }

    // 2. Send raw Shopify cart — the session API handles price conversion and
    //    discount detection automatically (total_discount, discount_codes,
    //    cart_level_discount_applications, original_total_price, etc.)
    const shopDomain = window.Shopify ? window.Shopify.shop : window.location.hostname;

    const checkoutData = {
      shop: shopDomain,
      idempotencyKey: Math.random().toString(36).substring(2) + Date.now().toString(36),
      cart: cart, // raw Shopify cart — prices in cents, includes all discount fields
    };

    // 3. Create session in our app
    const sessionResponse = await fetch(`${APP_URL}/api/checkout/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(checkoutData),
    });

    if (!sessionResponse.ok) {
      throw new Error('Failed to create checkout session');
    }

    const { sessionId } = await sessionResponse.json();

    // 4. Redirect to custom checkout
    window.location.href = `${APP_URL}/pay/${sessionId}`;

  } catch (error) {
    console.error('Checkout redirect error:', error);
    // Fallback to default Shopify checkout if something goes wrong
    window.location.href = '/checkout';
  }
}

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

const APP_URL = 'https://703e-129-0-99-85.ngrok-free.app'; // Replace with your production URL

async function redirectToCustomCheckout() {
  try {
    // 1. Get cart data from Shopify
    const cartResponse = await fetch('/cart.js');
    const cart = await cartResponse.json();

    if (!cart.items || cart.items.length === 0) {
      alert('Your cart is empty');
      return;
    }

    // 2. Format cart for our app
    const shopDomain = window.Shopify ? window.Shopify.shop : window.location.hostname;
    
    const checkoutData = {
      shop: shopDomain,
      idempotencyKey: Math.random().toString(36).substring(2) + Date.now().toString(36),
      cart: {
        items: cart.items.map(item => ({
          id: String(item.id),
          variant_id: item.variant_id,
          product_id: item.product_id,
          title: item.title,
          quantity: item.quantity,
          price: item.price / 100, // Shopify gives price in cents
          image: item.image,
          variant: item.variant_title,
          sku: item.sku
        })),
        subtotal: cart.total_price / 100,
        shipping: 0,
        tax: 0,
        total: cart.total_price / 100,
        currency: cart.currency || 'ILS'
      }
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

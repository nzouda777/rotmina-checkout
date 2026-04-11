import { createShopifyOrder } from './lib/shopify';
(async () => {
  try {
    const session = {
      cart: {
        currency: 'ILS',
        total: 100,
        items: [
          {
            title: 'Test Digital Product',
            price: 100,
            quantity: 1,
            variant_id: '123'
          }
        ]
      }
    };
    const customer = {
       firstName: "Test",
       lastName: "User",
       email: "test@test.com",
       address: "123 Test St",
       city: "Tel Aviv",
       country: "Israel",
       postalCode: "12345",
       phone: "+972501234567"
    };
    await createShopifyOrder({ session: session as any, customer: customer as any, transactionId: "12345" });
    console.log("Success");
  } catch(e) {
    console.log(e);
  }
})();

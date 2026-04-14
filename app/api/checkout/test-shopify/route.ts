import { NextResponse } from 'next/server'
import { createShopifyOrder } from '@/lib/shopify'

export async function GET() {
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
            variant_id: undefined
          }
        ]
      }
    };
    const customer = {
       firstName: "John",
       lastName: "Doe",
       email: "test@example.com",
       address: "123 Test St",
       city: "Tel Aviv",
       country: "Israel",
       postalCode: "12345",
       phone: "+972501234567"
    };

    // const order = await createShopifyOrder({ 
    //   session: session as any, 
    //   customer: customer as any, 
    //   transactionId: "123456789" 
    // });
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}

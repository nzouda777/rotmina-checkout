'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShoppingBag, CreditCard, Shield, Zap } from 'lucide-react'

export default function DemoPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const demoCart = {
    items: [
      {
        id: '1',
        title: 'Premium Wireless Headphones',
        quantity: 1,
        price: 299,
        variant: 'Black / Large',
        image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=200&h=200&fit=crop',
      },
      {
        id: '2',
        title: 'Leather Watch Strap',
        quantity: 2,
        price: 49,
        variant: 'Brown',
        image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=200&h=200&fit=crop',
      },
    ],
    subtotal: 397,
    shipping: 0,
    tax: 71.46,
    total: 468.46,
    currency: 'ILS',
  }

  const handleStartCheckout = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop: 'demo-store.myshopify.com',
          idempotencyKey: `demo-${Date.now()}`,
          cart: demoCart,
        }),
      })

      const data = await response.json()
      if (data.sessionId) {
        router.push(`/checkout/${data.sessionId}`)
      }
    } catch (error) {
      console.error('Failed to create checkout session:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-muted/50 to-background" />
        <div className="relative max-w-6xl mx-auto px-4 py-20 sm:py-32">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-muted-foreground text-sm mb-6">
              <Zap className="h-4 w-4" />
              <span>Shopify + Tranzila Payment Integration</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-6 text-balance">
              Beautiful Checkout Experience
            </h1>
            
            <p className="text-lg sm:text-xl text-muted-foreground mb-8 text-pretty">
              A modern, Shopify-inspired checkout page integrated with Tranzila payment gateway for Israeli merchants.
            </p>

            <button
              onClick={handleStartCheckout}
              disabled={loading}
              className="inline-flex items-center gap-3 py-4 px-8 rounded-lg bg-foreground text-background font-semibold text-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-background border-t-transparent" />
              ) : (
                <ShoppingBag className="h-5 w-5" />
              )}
              {loading ? 'Creating Session...' : 'Try Demo Checkout'}
            </button>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          <FeatureCard
            icon={<CreditCard className="h-6 w-6" />}
            title="Secure Payments"
            description="PCI-compliant payment processing through Tranzila with support for all major credit cards."
          />
          <FeatureCard
            icon={<Shield className="h-6 w-6" />}
            title="Shopify Integration"
            description="Seamlessly integrates with your Shopify store as an external payment gateway."
          />
          <FeatureCard
            icon={<Zap className="h-6 w-6" />}
            title="Modern UI"
            description="Clean, responsive design inspired by Shopify&apos;s checkout for a familiar experience."
          />
        </div>
      </div>

      {/* Cart Preview */}
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="bg-muted/30 rounded-2xl border border-border p-8">
          <h2 className="text-2xl font-bold text-foreground mb-6">Demo Cart Items</h2>
          <div className="space-y-4">
            {demoCart.items.map((item) => (
              <div key={item.id} className="flex items-center gap-4 p-4 bg-background rounded-lg border border-border">
                <img
                  src={item.image}
                  alt={item.title}
                  className="h-16 w-16 rounded-lg object-cover"
                />
                <div className="flex-1">
                  <p className="font-medium text-foreground">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.variant} x {item.quantity}</p>
                </div>
                <p className="font-semibold text-foreground">
                  {new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(item.price * item.quantity)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-6 border-t border-border flex justify-between items-center">
            <span className="text-lg font-medium text-foreground">Total</span>
            <span className="text-2xl font-bold text-foreground">
              {new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(demoCart.total)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      {/* <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center text-foreground mb-4">
        {icon}
      </div> */}
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  )
}

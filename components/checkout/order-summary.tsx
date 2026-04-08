'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { CartData } from '@/lib/types'

interface OrderSummaryProps {
  cartData: CartData
}

export function OrderSummary({ cartData }: OrderSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: cartData.currency,
    }).format(amount)
  }

  return (
    <div className="bg-muted/30 rounded-lg border border-border">
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full lg:hidden flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-foreground" />
          <span className="text-sm font-medium text-foreground">
            {isExpanded ? 'Hide' : 'Show'} order summary
          </span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <span className="text-lg font-semibold text-foreground">
          {formatPrice(cartData.total)}
        </span>
      </button>

      {/* Order Items */}
      <div className={`${isExpanded ? 'block' : 'hidden lg:block'} p-4 lg:p-6`}>
        <h2 className="hidden lg:block text-lg font-semibold text-foreground mb-4">
          Order summary
        </h2>

        <div className="space-y-4">
          {cartData.items.map((item) => (
            <div key={item.id} className="flex gap-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-lg border border-border bg-background overflow-hidden">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center bg-muted">
                      <Package className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </div>
                {item.quantity > 1 && (
                  <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-foreground text-background text-xs flex items-center justify-center font-medium">
                    {item.quantity}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {item.title}
                </p>
                {item.variant && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.variant}
                  </p>
                )}
              </div>
              <div className="text-sm font-medium text-foreground">
                {formatPrice(item.price * item.quantity)}
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-border my-4" />

        {/* Totals */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="text-foreground">{formatPrice(cartData.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Shipping</span>
            <span className="text-foreground">
              {cartData.shipping === 0 ? 'Free' : formatPrice(cartData.shipping)}
            </span>
          </div>
          {cartData.tax > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax</span>
              <span className="text-foreground">{formatPrice(cartData.tax)}</span>
            </div>
          )}
        </div>

        {/* Total */}
        <div className="border-t border-border mt-4 pt-4">
          <div className="flex justify-between items-center">
            <span className="text-base font-medium text-foreground">Total</span>
            <span className="text-2xl font-semibold text-foreground">
              {formatPrice(cartData.total)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ShoppingCart({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  )
}

function Package({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  )
}

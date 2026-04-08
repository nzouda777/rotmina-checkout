'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { CheckCircle } from 'lucide-react'

function SuccessContent() {
  const searchParams = useSearchParams()
  const confirmation = searchParams.get('confirmation')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-green-100 mb-6">
          <CheckCircle className="h-10 w-10 text-green-600" />
        </div>
        
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Payment Successful
        </h1>
        
        <p className="text-muted-foreground mb-6">
          Thank you for your purchase. Your order has been confirmed.
        </p>

        {confirmation && (
          <div className="bg-muted/50 rounded-lg p-4 mb-6">
            <p className="text-sm text-muted-foreground mb-1">Confirmation Code</p>
            <p className="text-lg font-mono font-semibold text-foreground">{confirmation}</p>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          A confirmation email has been sent to your email address.
        </p>
      </div>
    </div>
  )
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  )
}

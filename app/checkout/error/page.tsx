'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { XCircle } from 'lucide-react'
import Link from 'next/link'

function ErrorContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-red-100 mb-6">
          <XCircle className="h-10 w-10 text-red-600" />
        </div>
        
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Payment Failed
        </h1>
        
        <p className="text-muted-foreground mb-6">
          We were unable to process your payment. Please try again or use a different payment method.
        </p>

        {sessionId && (
          <Link
            href={`/checkout/${sessionId}`}
            className="inline-block py-3 px-6 rounded-lg bg-foreground text-background font-semibold hover:opacity-90 transition-opacity"
          >
            Try Again
          </Link>
        )}
      </div>
    </div>
  )
}

export default function ErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
      </div>
    }>
      <ErrorContent />
    </Suspense>
  )
}

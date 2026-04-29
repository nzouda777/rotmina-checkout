'use client'

import { useLanguage } from '@/lib/language-context'

export function CheckoutFooter() {
  const { t } = useLanguage()

  return (
    <footer className="border-t border-border mt-16">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-foreground transition-colors">
              {t('footer.refundPolicy')}
            </a>
            <a href="#" className="hover:text-foreground transition-colors">
              {t('footer.privacyPolicy')}
            </a>
            <a href="#" className="hover:text-foreground transition-colors">
              {t('footer.termsOfService')}
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            <span>{t('footer.secureCheckoutPowered')}</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

function Lock({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}

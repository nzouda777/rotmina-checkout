import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { LanguageProvider } from '@/lib/language-context'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Checkout - Secure Payment',
  description: 'Shopify-style checkout with Tranzila payment integration',
  icons: {
    icon: [
      {
        url: '/rotmina-logo_1.webp',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/rotmina-logo_1.webp',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/rotmina-logo_1.webp',
        type: 'image/svg+xml',
      },
    ],
    apple: '/rotmina-logo_1.webp',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <LanguageProvider>
          {children}
        </LanguageProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

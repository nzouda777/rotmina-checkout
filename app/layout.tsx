import type { Metadata } from 'next'
import { Geist, Geist_Mono, Playfair_Display } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { LanguageProvider } from '@/lib/language-context'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });
const playfair = Playfair_Display({
  subsets: ['latin'],
  style: ['italic'],
  variable: '--font-playfair',
});

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
      <body className={`font-sans antialiased ${playfair.variable}`}>
        <LanguageProvider>
          {children}
        </LanguageProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

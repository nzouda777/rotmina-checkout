import { Lock } from 'lucide-react'
import Image from 'next/image'

interface CheckoutHeaderProps {
  shopName: string
}

export function CheckoutHeader({ shopName }: CheckoutHeaderProps) {
  return (
    <header className="border-b border-border bg-background">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* <div className="h-10 w-10 rounded-lg bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-lg">
              {shopName.charAt(0).toUpperCase()}
            </span>
          </div> */}
          <span className="text-xl font-semibold text-foreground">
            {/* {formatShopName(shopName)} */}
            <Image
              src="/rotmina-logo_1.webp"
              alt="Rotmani Logo"
              width={200}
              height={100}
            />
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Lock className="h-4 w-4" />
          <span className="text-sm hidden sm:inline">Secure checkout</span>
        </div>
      </div>
    </header>
  )
}

function formatShopName(domain: string): string {
  return domain
    .replace('.myshopify.com', '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

-- Migration 012: Shopify discount codes synced into coupon_codes + idempotent usage tracking
--
-- coupon_codes.source:
--   'local'   → created in the Rotmina admin (default, existing rows)
--   'shopify' → mirrored from a Shopify discount code (Discounts in Shopify admin)
--
-- Shopify-sourced rows are refreshed from Shopify on sync / on checkout lookup.
-- current_uses counts orders paid through this checkout; when it reaches
-- max_uses the code is also deactivated in Shopify so the storefront cart
-- refuses it too.

ALTER TABLE public.coupon_codes
  ADD COLUMN IF NOT EXISTS source              TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS shopify_discount_id TEXT,
  ADD COLUMN IF NOT EXISTS shopify_title       TEXT,
  ADD COLUMN IF NOT EXISTS shopify_kind        TEXT,     -- DiscountCodeBasic / FreeShipping / Bxgy / App
  ADD COLUMN IF NOT EXISTS checkout_usable     BOOLEAN NOT NULL DEFAULT true,  -- can be typed in this checkout
  ADD COLUMN IF NOT EXISTS starts_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS synced_at           TIMESTAMPTZ;

ALTER TABLE public.coupon_codes DROP CONSTRAINT IF EXISTS coupon_codes_source_check;
ALTER TABLE public.coupon_codes
  ADD CONSTRAINT coupon_codes_source_check CHECK (source IN ('local', 'shopify'));

CREATE INDEX IF NOT EXISTS idx_coupon_codes_shopify_discount_id
  ON public.coupon_codes (shopify_discount_id)
  WHERE shopify_discount_id IS NOT NULL;

-- Several routes can reach "payment succeeded" for one session; usage of the
-- discount codes must be counted once. The first route claims this column.
ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS discounts_recorded_at TIMESTAMPTZ;

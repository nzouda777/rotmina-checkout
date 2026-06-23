-- Migration 006: Create coupons table with per-product restriction support
-- This is distinct from the coupon_codes table (005) — it powers the rotmina
-- checkout app and adds the ability to restrict a coupon to specific products.

-- ─── Coupons table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10, 2) NOT NULL CHECK (discount_value > 0),
  -- applies_to_all = true  → coupon is valid for any product in the cart
  -- applies_to_all = false → only valid if the cart contains at least one
  --                          variant whose ID is in allowed_variant_ids
  applies_to_all BOOLEAN NOT NULL DEFAULT true,
  allowed_variant_ids JSONB NOT NULL DEFAULT '[]',   -- array of numeric Shopify variant IDs
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  usage_limit INTEGER,                               -- NULL = unlimited
  usage_count INTEGER NOT NULL DEFAULT 0,
  minimum_amount DECIMAL(10, 2),                     -- NULL = no minimum
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code   ON public.coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON public.coupons(active);

-- Auto-update trigger (optional but consistent with other tables)
CREATE OR REPLACE FUNCTION public.update_coupons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.created_at = OLD.created_at; -- preserve created_at
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Extend payment_sessions ───────────────────────────────────────────────────
-- Track which coupon was applied and how much was discounted.
ALTER TABLE public.payment_sessions
  ADD COLUMN IF NOT EXISTS coupon_code     TEXT,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10, 2) DEFAULT 0;

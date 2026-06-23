-- Migration 007: Add per-product restriction to coupon_codes
-- applies_to_all = true  → coupon valid for any product (default, backward-compatible)
-- applies_to_all = false → coupon only valid if cart contains at least one
--                          variant whose numeric ID is in allowed_variant_ids

ALTER TABLE public.coupon_codes
  ADD COLUMN IF NOT EXISTS applies_to_all    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allowed_variant_ids JSONB  NOT NULL DEFAULT '[]';

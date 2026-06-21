-- Coupon Codes table for custom promotional discount codes
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS coupon_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('amount', 'percentage')),
  discount_value NUMERIC NOT NULL,     -- for amount: ILS value; for percentage: e.g. 20 = 20%
  currency TEXT DEFAULT 'ILS',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'depleted')),
  max_uses INTEGER,                    -- NULL = unlimited
  current_uses INTEGER DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_codes_code ON coupon_codes(code);
CREATE INDEX IF NOT EXISTS idx_coupon_codes_status ON coupon_codes(status);

CREATE OR REPLACE FUNCTION update_coupon_codes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_coupon_codes ON coupon_codes;
CREATE TRIGGER trigger_update_coupon_codes
  BEFORE UPDATE ON coupon_codes
  FOR EACH ROW
  EXECUTE FUNCTION update_coupon_codes_updated_at();

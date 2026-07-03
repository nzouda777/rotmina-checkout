-- 009: Add flat USD shipping fee and country-based tax rules for the English checkout.

-- Add flat USD shipping fee column to shipping_settings
ALTER TABLE shipping_settings
  ADD COLUMN IF NOT EXISTS en_shipping_fee_usd NUMERIC NOT NULL DEFAULT 50;

UPDATE shipping_settings SET en_shipping_fee_usd = 50 WHERE id = 1;

-- Create tax_rules table for per-country tax configuration
CREATE TABLE IF NOT EXISTS tax_rules (
  id         SERIAL PRIMARY KEY,
  country    TEXT NOT NULL UNIQUE,
  tax_rate   NUMERIC NOT NULL DEFAULT 0,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default rules
INSERT INTO tax_rules (country, tax_rate, enabled) VALUES
  ('United States', 20, true),
  ('United Kingdom', 20, true),
  ('Europe',         20, true),
  ('Canada',          0, true),
  ('Switzerland',     0, true),
  ('Australia',       0, true)
ON CONFLICT (country) DO NOTHING;

ALTER TABLE tax_rules ENABLE ROW LEVEL SECURITY;

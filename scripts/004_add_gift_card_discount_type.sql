-- Add discount type support to gift_cards table
-- Run this in Supabase SQL editor

ALTER TABLE gift_cards
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) DEFAULT 'amount' CHECK (discount_type IN ('amount', 'percentage')),
  ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10,2);

-- Allow balance and original_amount to be null (percentage cards have no fixed balance)
ALTER TABLE gift_cards ALTER COLUMN balance DROP NOT NULL;
ALTER TABLE gift_cards ALTER COLUMN original_amount DROP NOT NULL;

-- Backfill existing rows
UPDATE gift_cards SET discount_type = 'amount' WHERE discount_type IS NULL;

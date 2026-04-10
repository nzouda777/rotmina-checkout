-- Gift Cards table for custom gift card system
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(19) UNIQUE NOT NULL,            -- Format: ROTM-XXXX-XXXX-XXXX
  original_amount DECIMAL(10,2) NOT NULL,
  balance DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'ILS',
  status VARCHAR(20) DEFAULT 'active',         -- active, depleted, disabled
  purchased_session_id UUID,                   -- references payment_sessions(id)
  purchased_order_id VARCHAR(255),
  buyer_email VARCHAR(255),
  recipient_name VARCHAR(255),
  recipient_email VARCHAR(255),
  sender_name VARCHAR(255),
  sender_email VARCHAR(255),
  personal_message TEXT,
  email_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);
CREATE INDEX IF NOT EXISTS idx_gift_cards_buyer_email ON gift_cards(buyer_email);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_gift_cards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_gift_cards ON gift_cards;
CREATE TRIGGER trigger_update_gift_cards
  BEFORE UPDATE ON gift_cards
  FOR EACH ROW
  EXECUTE FUNCTION update_gift_cards_updated_at();

-- Run this section if you already created the table previously:
/*
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(255);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS sender_email VARCHAR(255);
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS personal_message TEXT;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT false;
*/

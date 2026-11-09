-- Track the outcome of the Morning (Green Invoice) receipt for each paid session,
-- so failed receipts can be listed and re-sent from the admin panel
-- (/admin/invoices) and the same session is never invoiced twice.
--
-- morning_status:
--   NULL      → no attempt recorded (sessions paid before this migration)
--   'sending' → an attempt is in flight (claimed); stale after 10 min = failed
--   'sent'    → Morning document created
--   'failed'  → last attempt failed, see morning_error
ALTER TABLE payment_sessions
  ADD COLUMN IF NOT EXISTS morning_status          TEXT,
  ADD COLUMN IF NOT EXISTS morning_document_id     TEXT,
  ADD COLUMN IF NOT EXISTS morning_document_url    TEXT,
  ADD COLUMN IF NOT EXISTS morning_error           TEXT,
  ADD COLUMN IF NOT EXISTS morning_attempts        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS morning_last_attempt_at TIMESTAMPTZ;

ALTER TABLE payment_sessions
  DROP CONSTRAINT IF EXISTS payment_sessions_morning_status_check;

ALTER TABLE payment_sessions
  ADD CONSTRAINT payment_sessions_morning_status_check
  CHECK (morning_status IS NULL OR morning_status IN ('sending', 'sent', 'failed'));

CREATE INDEX IF NOT EXISTS idx_payment_sessions_morning_status
  ON payment_sessions (morning_status)
  WHERE morning_status IS DISTINCT FROM 'sent';

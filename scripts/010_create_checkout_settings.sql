-- Global checkout feature toggles, editable from the admin panel.
CREATE TABLE IF NOT EXISTS checkout_settings (
  id                                   INTEGER PRIMARY KEY DEFAULT 1,
  returning_customer_autofill_enabled  BOOLEAN NOT NULL DEFAULT false,
  updated_at                           TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO checkout_settings (id, returning_customer_autofill_enabled)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE checkout_settings ENABLE ROW LEVEL SECURITY;

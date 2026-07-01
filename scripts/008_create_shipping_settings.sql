-- Shipping settings table — single-row config editable from admin panel.
-- free_shipping_threshold_ils: cart subtotal (₪) above which shipping is free (ILS orders)
-- domestic_shipping_fee_ils:   flat shipping fee (₪) when below threshold (ILS orders)
-- international_shipping_pct:  shipping charged as a % of subtotal (USD orders), stored as 20 = 20%

CREATE TABLE IF NOT EXISTS shipping_settings (
  id                          INTEGER PRIMARY KEY DEFAULT 1,
  free_shipping_threshold_ils NUMERIC NOT NULL DEFAULT 499,
  domestic_shipping_fee_ils   NUMERIC NOT NULL DEFAULT 30,
  international_shipping_pct  NUMERIC NOT NULL DEFAULT 20,
  updated_at                  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO shipping_settings (id, free_shipping_threshold_ils, domestic_shipping_fee_ils, international_shipping_pct)
VALUES (1, 499, 30, 20)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE shipping_settings ENABLE ROW LEVEL SECURITY;

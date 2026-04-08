-- Create payment_sessions table for tracking checkout sessions
CREATE TABLE IF NOT EXISTS public.payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  draft_order_id TEXT,
  order_id TEXT,
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  cart JSONB NOT NULL,
  customer JSONB,
  tranzila_transaction_id TEXT,
  raw_response JSONB,
  idempotency_key TEXT UNIQUE NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON public.payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_draft_order_id ON public.payment_sessions(draft_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_tranzila_transaction_id ON public.payment_sessions(tranzila_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_idempotency_key ON public.payment_sessions(idempotency_key);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_payment_sessions_updated_at ON public.payment_sessions;
CREATE TRIGGER update_payment_sessions_updated_at
  BEFORE UPDATE ON public.payment_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS (optional - disable if using service role key only)
ALTER TABLE public.payment_sessions ENABLE ROW LEVEL SECURITY;

-- Policy for service role to have full access
CREATE POLICY "Service role full access" ON public.payment_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

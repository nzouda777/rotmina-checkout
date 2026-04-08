-- Update payment_sessions table to allow NULL for customer information during initial session creation
-- and ensure all statuses are supported.

-- 1. Modify customer column to allow NULL
ALTER TABLE public.payment_sessions ALTER COLUMN customer DROP NOT NULL;

-- 2. Update status check constraint to include 'processing' and handle potential re-runs
ALTER TABLE public.payment_sessions DROP CONSTRAINT IF EXISTS payment_sessions_status_check;
ALTER TABLE public.payment_sessions ADD CONSTRAINT payment_sessions_status_check 
  CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'expired'));

-- 3. Ensure indexing for common fields
CREATE INDEX IF NOT EXISTS idx_payment_sessions_shop ON public.payment_sessions(shop);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_idempotency_key ON public.payment_sessions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_order_id ON public.payment_sessions(order_id);

-- 4. Enable RLS and add policies if not already present
ALTER TABLE public.payment_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'payment_sessions' AND policyname = 'Service role full access'
    ) THEN
        CREATE POLICY "Service role full access" ON public.payment_sessions
            FOR ALL
            USING (true)
            WITH CHECK (true);
    END IF;
END
$$;

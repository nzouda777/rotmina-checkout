-- Migration 003: Add all required status values to the payment_sessions constraint.
-- This migration is idempotent — safe to run even if 002 has already been applied.
-- Missing statuses ('pending_bit', 'pending_3ds') caused the combined
-- UPDATE { status: 'processing', customer: ... } to fail silently, leaving
-- session.customer as NULL and preventing Shopify order creation.

ALTER TABLE public.payment_sessions DROP CONSTRAINT IF EXISTS payment_sessions_status_check;
ALTER TABLE public.payment_sessions ADD CONSTRAINT payment_sessions_status_check
  CHECK (status IN ('pending', 'processing', 'pending_bit', 'pending_3ds', 'paid', 'failed', 'expired'));

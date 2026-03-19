-- Add subscription payment support to programs
-- Allows programs to be free, one-time purchase, or recurring subscription

-- A. Extend programs table with payment/billing fields
ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'one_time'
    CHECK (payment_type IN ('free', 'one_time', 'subscription'));

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS billing_interval text
    CHECK (billing_interval IS NULL OR billing_interval IN ('week', 'month'));

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS stripe_product_id text;

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS stripe_price_id text;

-- Backfill: programs without a price are free, programs with a price are one-time
UPDATE public.programs SET payment_type = 'free' WHERE price_cents IS NULL;
UPDATE public.programs SET payment_type = 'one_time' WHERE price_cents IS NOT NULL;

-- B. Add stripe_customer_id to users for reuse across purchases
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- C. Create subscriptions table to track recurring billing state
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.program_assignments(id) ON DELETE SET NULL,
  stripe_subscription_id text UNIQUE NOT NULL,
  stripe_customer_id text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'trialing', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages subscriptions"
  ON public.subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_program_id ON public.subscriptions(program_id);

-- D. Extend assignment payment_status to include subscription_active
ALTER TABLE public.program_assignments
  DROP CONSTRAINT IF EXISTS program_assignments_payment_status_check;

ALTER TABLE public.program_assignments
  ADD CONSTRAINT program_assignments_payment_status_check
  CHECK (payment_status IN ('not_required', 'pending', 'paid', 'subscription_active'));

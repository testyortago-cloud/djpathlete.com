-- 00298_programs_payment_type_default_free.sql
--
-- 00055 added programs.payment_type with DEFAULT 'one_time' and set every row with no price to 'free'.
-- The default kept going: any insert that leaves payment_type out (the AI generator, the Excel import)
-- stored 'one_time' with a null price. The admin card shows such a program as "Free", but the Edit
-- Program dialog refuses to save it ("Price is required for paid programs"). On prod 2026-11-01: 30
-- rows, none with a Stripe price, none public.
--
-- Readers: components/admin/ProgramFormDialog.tsx and PricingAccessSheet.tsx (send payment_type back
-- through programFormSchema); app/api/stripe/checkout refuses both 'free' and a null price, so no
-- client's access changes.

ALTER TABLE public.programs ALTER COLUMN payment_type SET DEFAULT 'free';

UPDATE public.programs
   SET payment_type = 'free', billing_interval = NULL
 WHERE price_cents IS NULL
   AND payment_type <> 'free';

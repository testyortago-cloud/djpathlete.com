-- supabase/migrations/00280_lead_inquiries_business_id.sql
-- G45: an inquiry belongs to the business that received it.
--
-- `lead_inquiries` (00182) had no tenant. The public inquiry route resolves the
-- Host's business and then wrote here without it, so the admin
-- regenerate-analysis route read (and returned) any business's applicant by id.
-- The reader it needs is `getLeadInquiryById(businessId, id)`, and the writer
-- is the inquiry route, which already holds the business it resolved.
--
-- NULLABLE, WITH NO DEFAULT, deliberately. Every other lead-engine table was
-- given the platform's id as a DEFAULT (00213-00259), and ledger row G44 is the
-- work of taking those defaults away again. This one is not added to that list.
-- The one writer stamps the column explicitly.
--
-- THE BACKFILL IS THE PLATFORM BUSINESS, AND THAT IS A FACT, NOT A FALLBACK.
-- The inquiry route's tenant comes from lib/tenancy/public.ts, which reads
-- `business_domains` by Host and serves the platform business for any host it
-- does not know. The only rows `business_domains` has ever held are 00251's two
-- platform hosts, and nothing in the app writes it (a test enforces that,
-- G48). Read on production 2026-09-27: exactly those two rows
-- (www.darrenjpaul.com, darrenjpaul.com), both the platform business's. So
-- every inquiry recorded before this migration was received by the platform
-- business.
--
-- AFTER THE CODE DEPLOYS, RUN THE UPDATE BELOW ONCE MORE. Rows the old bundle
-- wrote between this migration and the code push are NULL until it is.
--
-- SHIP THIS AHEAD OF THE CODE, in its own push (the 00278 rule). The code
-- stamps `business_id` on insert and filters on it when reading. Against a
-- schema without the column the insert would fail and the lead's inquiry row
-- would be lost (the route logs it and carries on; the contact, email and bell
-- still happen), and the admin read would answer 42703. With the column in
-- place first, the still-serving old bundle simply inserts NULL. The new reader
-- treats a NULL row as nobody's (fail closed: "Regenerate" answers 404 for it).
-- Rows written in that window stay NULL until the UPDATE below is run again,
-- which is safe: it is re-runnable.
--
-- Re-runnable: the ADD is IF NOT EXISTS and the backfill touches only NULLs.
-- No index: the one reader goes by (id, business_id) and `id` is the key.

alter table public.lead_inquiries
  add column if not exists business_id uuid references public.businesses(id);

update public.lead_inquiries
   set business_id = '00000000-0000-0000-0000-000000000001'
 where business_id is null;

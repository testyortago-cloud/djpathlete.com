-- supabase/migrations/00248_bookings_contact_id_backfill.sql
-- Calendly per coach, Task 13 review round 1: backfill bookings.contact_id
-- for rows that predate 00241, which added the column with NO backfill.
--
-- WHY THIS MATTERS NOW. Task 13 switched the contact detail screen's
-- bookings read from an in-memory email/phone comparison to
-- .eq("business_id", ...).eq("contact_id", ...). A booking with a null
-- contact_id drops off that screen entirely -- correct for a genuinely
-- unmatched booking, but every booking written before 00241 has a null
-- contact_id BY CONSTRUCTION, not because it was unmatched. On the dev
-- clone that was 6 of 9 rows, and 2 of them are a real contact's actual
-- booked calls -- a visible history loss for anyone who had booked before
-- this column existed, on the whole historical list in production.
--
-- EMAIL ONLY, NEVER PHONE. bookings.contact_phone is stored in US national
-- format ("(617) 650-4548") while contacts.phone_e164 holds E.164 -- the
-- trap lib/db/contact-detail.ts's own header already documents at length.
-- A phone join here would either match nothing or require repeating that
-- same normalisation in raw SQL, which this migration does not attempt.
--
-- SAME BUSINESS ONLY. The join requires contacts.business_id =
-- bookings.business_id -- a booking can never be backfilled onto another
-- business's contact, even when the emails happen to match (a shared lead).
--
-- ONLY FILLS NULLS, NEVER OVERWRITES. Both the candidate join and the final
-- UPDATE require contact_id IS NULL -- a booking phase 0 or a later
-- delivery already matched keeps whatever value it has.
--
-- AMBIGUOUS MATCHES ARE LEFT NULL, NOT GUESSED. Where one normalised email
-- matches more than one contact in the same business, `having
-- count(distinct contact_id) = 1` excludes that booking entirely --
-- guessing which of two contacts a historical booking belonged to risks
-- attaching it to the WRONG person, the exact failure mode Task 13 closed
-- on the read side. On the dev clone this affected zero rows.
--
-- IDEMPOTENT. Re-running finds no candidates for rows this already filled
-- (contact_id IS NULL is false for them), so a second run is a no-op.

with matches as (
  select b.id as booking_id,
         c.id as contact_id
    from public.bookings b
    join public.contacts c
      on c.business_id = b.business_id
     and c.email is not null
     and b.contact_email is not null
     and lower(trim(c.email)) = lower(trim(b.contact_email))
   where b.contact_id is null
),
unambiguous as (
  -- min()/max() have no uuid overload; array_agg(...)[1] is safe here
  -- specifically because the HAVING clause already guarantees every row in
  -- the group shares the same contact_id.
  select booking_id, (array_agg(contact_id))[1] as contact_id
    from matches
   group by booking_id
  having count(distinct contact_id) = 1
)
update public.bookings b
   set contact_id = u.contact_id
  from unambiguous u
 where b.id = u.booking_id
   and b.contact_id is null;

-- 00264_backfill_contacts_user_id.sql
--
-- WHY. `contacts.user_id` (00213) had no writer until G04 (ledger
-- 2026-09-19): every entry point wrote email/phone/name only, and only the
-- `merge_contacts` RPC ever copied the column between two contacts. On
-- production, re-measured 2026-09-20: 170 contacts, 0 linked, 54 sharing an
-- email with a `users` row. (Count CONTACTS, not join rows — one address
-- matches two `users` rows differing only by case, so the obvious join
-- reports 55.) So `has_user` ("already a client"), the branch every quiz
-- sequence takes first, was permanently false — a registered account that
-- took the quiz on 19 Sept got the "book an intro call" arm.
--
-- The code half (same branch) links fill-only on create/update/merge, at
-- registration, and from Stripe's completed checkout. This file is the
-- one-time catch-up for the rows that already exist.
--
-- READERS of the column this fills:
--   - lib/automation/sequence-tick.ts `evaluateBranch`, `has_user`
--     (`DecisionContext.contact.user_id`, built by the tick runner from the
--     contact row).
--   - lib/db/contacts.ts `findContactByIdentifiers` (first key) and
--     `getContactUserId` → `findAttributionForContact` (ads attribution).
--   - lib/db/contact-detail.ts (the contact page shows the link).
--
-- RULES, each one deliberate:
--   - Keyed on the EMAIL VALUE, lower-cased on both sides, never on an id
--     read from a clone: `users` stores the address as typed and two legacy
--     rows are mixed-case; `contacts.email` is always normalised.
--   - `status <> 'lead'` — a `status: "lead"` users row is a placeholder
--     minted by the contact form / inquiry / funnel checkout for someone
--     with no password. It is not an account the person can use, and
--     linking to it would make `has_user` true for a stranger (11 of the 54
--     matching contacts have no non-lead account; there are 12 lead rows in
--     `users`, but one of them matches nobody unlinked). Registration
--     upgrades that row in place and
--     the register route links the contact at that moment.
--   - Exactly ONE candidate per contact (`n = 1`), or no link. Production
--     has one email that matches two users rows differing only by case; the
--     lead exclusion resolves it today, the count guard makes sure a future
--     collision is skipped rather than guessed.
--   - Fill-only: `WHERE c.user_id IS NULL`. Nothing already linked is
--     touched, and `updated_at` is left alone — a link is bookkeeping, not
--     activity, and the contacts list orders by activity.
--
-- READ BACK after apply (production is applied by the owner, not by hand):
--   select count(*) filter (where user_id is not null) as linked,
--          count(*) as total from public.contacts;
--   -- expected on production as of 2026-09-20: linked = 43 (the 54
--   -- matching contacts minus the 11 that match only a lead placeholder),
--   -- total = 170. Measured read-only the same day: the n = 1 guard drops
--   -- nothing further, so both the non-lead match count and the would-link
--   -- count are 43. A data migration can succeed and match nothing; if
--   -- `linked` is still 0 the join above is what to look at.

WITH candidates AS (
  SELECT
    c.id AS contact_id,
    u.id AS user_id,
    count(*) OVER (PARTITION BY c.id) AS n
  FROM public.contacts c
  JOIN public.users u ON lower(u.email) = lower(c.email)
  WHERE c.user_id IS NULL
    AND c.email IS NOT NULL
    AND u.status <> 'lead'
)
UPDATE public.contacts c
SET user_id = m.user_id
FROM candidates m
WHERE c.id = m.contact_id
  AND m.n = 1
  AND c.user_id IS NULL;

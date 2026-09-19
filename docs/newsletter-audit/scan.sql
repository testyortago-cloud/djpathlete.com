-- Newsletter list hygiene scan — regenerates the full flagged list ON DEMAND.
--
-- WHY THIS IS A SCRIPT AND NOT A COMMITTED CSV: the output is ~100 real
-- people's email addresses. That is personal data and it does not belong in
-- git history, where it cannot be deleted. Run this when you need the list,
-- act on it, and let the result stay out of the repo.
--
-- Run against PRODUCTION (read-only — this file performs no writes):
--   psql "$PROD_DATABASE_URL" -f docs/newsletter-audit/scan.sql
-- or paste into the Supabase SQL editor.
--
-- The domain lists below were produced on 2026-09-12 by resolving MX/A records
-- for all 726 distinct domains in newsletter_subscribers. RE-RESOLVE BEFORE
-- ACTING ON A LATER DATE: a dead domain can be re-registered, and a live one
-- can lapse. See README.md §"Reproducing the DNS classification".

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Domain classifications, from DNS resolution on 2026-09-12.
-- ---------------------------------------------------------------------------
WITH dead_domain AS (
  -- Cannot receive mail. Either no MX AND no A record, or an RFC 7505 null MX
  -- (a single MX whose exchange is ".", which means "this domain refuses mail").
  -- A null MX is invisible to a naive `dig +short MX | grep -c .` check, which
  -- counts the "0 ." line as a valid record. Mail to any of these hard-bounces.
  SELECT unnest(ARRAY[
    'anaphora.team','carnana.art','ces-easi.com','chilgoza.buzz',
    'entrepreneurialbroker.com','forms-checker.online','gmail.con','gmal.com',
    'growthalix.com','immenseignite.info','instiegroup.org','kerfuffle.asia','lcnoh.com',
    'mail4u.lt','mail5u.info','maxeza.click','obmen.us',
    'pacificcoastgroup.com',  -- RFC 7505 null MX: has an A record, refuses mail outright
    'rightbliss.beauty','rottack.autos','silesia.life','simplechecksmartform.com',
    'slatehomecleaning.com','spectrail.world','spinapp.bar','telebroker.ch','tivejo.com',
    'tonetics.biz','uccl.com.hk','wheelry.boats','xyz.com','zetetic.sbs'
  ]) AS d
), unresolvable AS (
  -- SERVFAIL from every public resolver, and NO NS records at all: the zone's
  -- delegation is broken or expired. Almost certainly dead, but unlike the list
  -- above that is an inference, not an authoritative NXDOMAIN — so these are
  -- reported separately and should NOT be deleted on this evidence alone.
  -- Re-check before acting; a lapsed domain can be re-registered.
  SELECT unnest(ARRAY[
    'madisonsofallon.net','exp-sys.com','edberg-online.com'
  ]) AS d
), no_mx AS (
  -- Has a website (A record) but publishes no MX. Almost always undeliverable;
  -- RFC 5321 lets a sender fall back to the A record, so a few may still land.
  SELECT unnest(ARRAY[
    'client.com','hotmal.com','lvcss.org','mbksearch.com','myputter.ch',
    'sportclub.com','teamomega.com','treehss.com','university.edu'
  ]) AS d
), typosquat AS (
  -- Misspellings of a major provider that DO have live MX. These do not bounce
  -- — a third party receives the mail. Worse than a bounce, not better.
  SELECT unnest(ARRAY['gamil.com','iclould.com']) AS d
), disposable AS (
  -- Throwaway/temporary mailbox services.
  SELECT unnest(ARRAY['muell.io','sudomail.com','superrito.com']) AS d
), placeholder_email AS (
  SELECT unnest(ARRAY[
    'john@example.com','jane.smith@example.com','test@dev.com',
    'test9@client.com','athlete@university.edu'
  ]) AS e
), role_prefix AS (
  SELECT unnest(ARRAY[
    'info','admin','sales','support','contact','office','hello','team','marketing','help',
    'noreply','no-reply','postmaster','webmaster','service','enquiries','accounts','billing',
    'hr','careers','jobs','orders','mail','general','reception','inquiries','customerservice'
  ]) AS p
), s AS (
  SELECT id, email, source, subscribed_at, unsubscribed_at,
         lower(split_part(email, '@', 1)) AS local_part,
         lower(split_part(email, '@', 2)) AS domain
  FROM newsletter_subscribers
)

-- ---------------------------------------------------------------------------
-- The flagged list.
-- ---------------------------------------------------------------------------
SELECT
  CASE
    WHEN domain IN (SELECT d FROM dead_domain) THEN '1_undeliverable'
    WHEN domain IN (SELECT d FROM unresolvable) THEN '1b_unresolvable_do_not_delete'
    WHEN domain IN (SELECT d FROM typosquat)   THEN '2_typosquat_live'
    WHEN domain IN (SELECT d FROM no_mx)       THEN '3_no_mx'
    WHEN domain IN (SELECT d FROM disposable)  THEN '4_disposable'
    WHEN lower(email) IN (SELECT e FROM placeholder_email) THEN '5_placeholder'
    ELSE '6_role_address'
  END AS bucket,
  email, domain, source,
  to_char(subscribed_at, 'YYYY-MM-DD') AS subscribed,
  (unsubscribed_at IS NULL) AS still_active,
  id
FROM s
WHERE domain IN (SELECT d FROM dead_domain)
   OR domain IN (SELECT d FROM unresolvable)
   OR domain IN (SELECT d FROM typosquat)
   OR domain IN (SELECT d FROM no_mx)
   OR domain IN (SELECT d FROM disposable)
   OR lower(email) IN (SELECT e FROM placeholder_email)
   OR local_part IN (SELECT p FROM role_prefix)
ORDER BY bucket, domain, email;


-- ---------------------------------------------------------------------------
-- Gmail alias duplicates: rows that are DIFFERENT strings but the SAME inbox.
--
-- Gmail ignores dots in the local part and everything after a '+', so
-- jamaica.island@gmail.com and jamaicaisland@gmail.com deliver to one person.
-- This matters beyond a wasted send: unsubscribe matches on an exact string
-- (lib/db/newsletter.ts removeSubscriber -> .eq("email", ...)), so opting out
-- of one row leaves its twin sending to the same inbox.
--
-- Only apply the dot rule to Gmail. Every other provider treats dots as
-- significant, so collapsing them elsewhere would merge two real strangers.
-- ---------------------------------------------------------------------------
WITH canon AS (
  SELECT id, email, source, subscribed_at, unsubscribed_at,
         CASE
           WHEN lower(split_part(email, '@', 2)) IN ('gmail.com', 'googlemail.com')
             THEN replace(split_part(split_part(email, '@', 1), '+', 1), '.', '') || '@gmail.com'
           ELSE split_part(split_part(email, '@', 1), '+', 1)
                || '@' || lower(split_part(email, '@', 2))
         END AS canonical_inbox
  FROM newsletter_subscribers
)
SELECT canonical_inbox,
       count(*) AS rows_for_this_inbox,
       array_agg(email ORDER BY subscribed_at, id) AS addresses,
       array_agg(id    ORDER BY subscribed_at, id) AS ids,
       count(*) FILTER (WHERE unsubscribed_at IS NOT NULL) AS already_unsubscribed
FROM canon
GROUP BY canonical_inbox
HAVING count(*) > 1
ORDER BY rows_for_this_inbox DESC, canonical_inbox;

-- supabase/migrations/00237_contact_tags.sql
-- Lead Engine: tags on a contact.
--
-- A JOIN TABLE, not a `text[]` column on contacts. Three reasons, and the third
-- is the one that decides it:
--
--   1. UNIQUE (contact_id, tag) makes double-tagging a no-op at the database
--      level rather than something every caller has to remember.
--   2. contact_tags_tag_idx makes "everyone tagged X" an index scan. An array
--      needs a GIN index and `@>` to get the same, which is more machinery for
--      less clarity.
--   3. MERGING. A merge absorbs one contact into another. With a join table,
--      carrying the tags over is one UPDATE re-pointing contact_id at the
--      survivor. With an array it is a read-modify-write, which is a lost
--      update the first time two merges run at once.
--
--      TWO CORRECTIONS to the design note this table was built from, both
--      found by trying to write the SQL. First, the merge is NOT performed by
--      decideMerge -- that function only DECIDES (it returns
--      {kind:"merge",survivorId,mergedId} and writes nothing). Every merge
--      write lives in the plpgsql function public.merge_contacts, so the
--      tag-carrying step belongs there; see 00238. Second, the note called for
--      "UPDATE ... ON CONFLICT DO NOTHING", which does not compile: Postgres
--      has ON CONFLICT on INSERT only, never on UPDATE. Against the unique
--      constraint below a bare UPDATE raises 23505 and rolls back the whole
--      merge transaction -- and therefore the lead capture that triggered it.
--      00238 uses a NOT EXISTS guard on the target instead.
--
--      The unique constraint is still what makes the overlap case safe; it is
--      the guard around it that had to change, not the constraint.
--
-- NOT BACKFILLED. The GoHighLevel export carried 104 tags and migration 00223
-- records why none of them came across: it gave no way to tell what any of them
-- meant. There is nothing to backfill from, so this table starts empty and
-- fills from the contact detail screen.
--
-- created_by is ON DELETE SET NULL, not CASCADE: removing a staff account must
-- not silently untag the contacts they organised.

CREATE TABLE IF NOT EXISTS public.contact_tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                 REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag          text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT contact_tags_unique UNIQUE (contact_id, tag)
);

-- "Everyone tagged X", scoped to the business. The unique constraint above
-- already covers the (contact_id, tag) direction, so this is the other one.
CREATE INDEX IF NOT EXISTS contact_tags_tag_idx
  ON public.contact_tags (business_id, tag);

-- RLS ON WITH A SERVICE-ROLE POLICY ONLY, copied from 00214. Migration 00231
-- exists solely because 00219 created four tables without this and served the
-- whole deal spine to anyone holding the anon key -- which ships in the browser
-- bundle by design -- for two weeks. Every read and write of this table is
-- server-side and holds the SERVICE-ROLE client: lib/db/contact-tags.ts for the
-- writes and the per-contact list, plus one direct read in
-- lib/db/contact-detail.ts, where getContactDetail batches it into the same
-- Promise.all as the timeline and consent reads. Both reach it through
-- createServiceRoleClient, so no anon or authenticated policy is needed and
-- adding one "just in case" would reopen exactly that hole.
--
-- Note what this means for a mistake: a browser or SSR-cookie client does not
-- ERROR against this table, it returns ZERO ROWS -- which renders as "this
-- contact has no tags" and is indistinguishable from the truth.
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;

-- NOTE: CREATE POLICY has no IF NOT EXISTS in Postgres, so this statement is
-- NOT re-runnable. Any local applier that replays migrations must carry its own
-- DROP POLICY guard -- do not add one to this file, or a replay would silently
-- drop and recreate a live policy.
CREATE POLICY "Service role full access on contact_tags"
  ON public.contact_tags FOR ALL TO service_role USING (true) WITH CHECK (true);

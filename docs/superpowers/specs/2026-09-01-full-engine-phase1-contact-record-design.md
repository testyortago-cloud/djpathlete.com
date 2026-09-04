# Full Engine Phase 1 — the contact record becomes readable

**Status:** design, not yet approved
**Date:** 2026-09-01
**Branch:** `feat/contact-record` (not created)
**Parent:** [docs/full-engine-scope-vs-built.md](../../full-engine-scope-vs-built.md) §2
**Closes scope lines:** "A full timeline per contact", "plus tags"

---

## 1. What this is

Two of the proposal's promises are half-built in the same way: the data is being
written correctly and there is nowhere to look at it.

`contact_timeline_events` (migration 00214) has been collecting rows from eleven
entry points, four SMS keyword paths and the chat escalation since Stage 1. It
is indexed `(contact_id, occurred_at DESC)` — an index that exists for exactly
one query, and **nothing in the app has ever run it**.
[app/(admin)/admin/contacts/](../../../app/(admin)/admin/contacts/) contains one
file, `page.tsx`, and it is a list built for bulk sequence enrolment.

Tags are the other half: not a screen problem, a schema problem. There is no
column, no table, and no code. Migration 00223 explains why nothing was
migrated — the GoHighLevel export gave no way to tell what any of its **104
tags** meant.

They belong in one phase because tags need somewhere to live, and that somewhere
is the detail page.

---

## 2. What is true today

### 2.1 The timeline is written from more places than you would guess

| Writer | Kind / source |
|---|---|
| Eleven capture routes | `funnel_form`, `contact_form`, `newsletter`, `lead_magnet`, `event_signup`, `questionnaire`, `step_up`, `inquiry`, `purchase`, `quiz`, `ai_chat` |
| `app/api/webhooks/twilio/inbound` | `sms_inbound`, `sms_stop_received`, `sms_start_received`, `sms_help_received` |
| `lib/lead-engine/chat/escalate.ts` | `chat_escalated` |

Shape (00214): `kind text`, `source text`, `occurred_at timestamptz`,
`metadata jsonb`, append-only, RLS on with a service-role policy.

### 2.2 The timeline is NOT the whole history

Migration 00214's own header is the thing to read before designing this screen:

> *"Reads across both identity spines — contact-native events here, plus the
> payments and bookings that still hang off users."*

**Payments and bookings are not in this table.** They hang off `users`, and a
contact only reaches a user through `contacts.user_id`, which is nullable and
null for most leads. A screen that selects from `contact_timeline_events` alone
will show a person's forms and texts and silently omit the money — which is the
part the proposal sells ("payments made, calls booked").

So the read is a **union of three sources**, merged on `occurred_at`:

1. `contact_timeline_events` where `contact_id = $1`
2. `payments` joined through `contacts.user_id` (when non-null)
3. `bookings` matched on `contact_email` / `contact_phone` (there is no
   `contact_id` on `bookings` — migration 00050 predates the spine)

`getBookingsForPipelineReconcile` in [lib/db/bookings.ts](../../../lib/db/bookings.ts)
already does the identifier match for the reconciler; reuse its predicate rather
than inventing a second definition of "this person's bookings".

### 2.3 Sequence membership is a fourth source

The proposal says "sequences they're in". That is `sequence_runs` +
`sequence_messages`, not the timeline. Both are already read by
[lib/db/sequences.ts](../../../lib/db/sequences.ts). A run is not an event — it
is a *state* — so it belongs in a panel beside the timeline, not interleaved
into it.

### 2.4 Consent is a fifth, and it is the one with legal weight

`contact_consents` holds the dated per-channel rows and **the wording that was
shown at the time**. `contact_suppressions` holds STOP. The screen must show
both, and must not merge them into a single "subscribed: yes/no" — the whole
point of the two tables is that they answer different questions.

---

## 3. What to build

### 3.1 Schema — tags

```sql
-- 002xx_contact_tags.sql
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
CREATE INDEX IF NOT EXISTS contact_tags_tag_idx
  ON public.contact_tags (business_id, tag);
```

**A join table, not a `text[]` column on `contacts`.** Three reasons, and the
third is the one that decides it:

1. `UNIQUE (contact_id, tag)` makes double-tagging a no-op at the database
   level rather than a thing the application has to remember.
2. `contact_tags_tag_idx` makes "everyone tagged X" an index scan. A `text[]`
   needs a GIN index and `@>` to get the same, which is more machinery for less
   clarity.
3. **Merging.** `decideMerge` absorbs one contact into another and snapshots the
   loser into `contact_merges.merged_snapshot`. With a join table, merging tags
   is one `UPDATE … SET contact_id = survivor` plus `ON CONFLICT DO NOTHING`.
   With an array it is a read-modify-write, which is a lost update waiting to
   happen the first time two things merge at once.

**RLS on, service-role policy only** — copy 00214's policy verbatim. Migration
00231 exists because 00219 forgot this and exposed the deal spine to the anon
key for two weeks. Do not repeat it.

### 3.2 Routes

| Route | Method | Purpose |
|---|---|---|
| `/admin/contacts/[id]` | page | The detail screen |
| `/api/admin/contacts/[id]/tags` | POST | Add a tag |
| `/api/admin/contacts/[id]/tags` | DELETE | Remove a tag |

Both API routes go through `withAudit()`
([lib/audit/with-audit.ts](../../../lib/audit/with-audit.ts)). Two new slugs in
[lib/audit/actions.ts](../../../lib/audit/actions.ts):

```ts
{ slug: "contact.tag_added",   category: "admin_write", description: "Tag added to a contact" },
{ slug: "contact.tag_removed", category: "admin_write", description: "Tag removed from a contact" },
```

**The page itself needs an audit slug too**, and it is not `admin_write`:

```ts
{ slug: "contact.viewed", category: "admin_read_sensitive", description: "Contact record opened" },
```

Opening one person's full history — every form, every text, every payment — is
exactly what the `admin_read_sensitive` category was added for. It is already in
the taxonomy; use it.

### 3.3 The screen

House table chrome, per CLAUDE.md: compose `DataTableCard` → `DataTable` →
`DataTableRow` / `DataTableCell`, `DataTableBadge` for the pills. Do not
hand-roll a `<table>`.

```
┌─ Jane Smith ─────────────────────── [ Add to a sequence ] ─┐
│ jane@example.com · +1 813 555 0142 · added 12 Aug          │
│ [coaching-lead ×] [camp-2026 ×] [ + tag ]                  │
├────────────────────────────────────────────────────────────┤
│ Consent                                                     │
│   Email    ✓ 12 Aug — "Subscribed via the newsletter form"  │
│   SMS      ✗ STOP received 28 Aug                           │
├────────────────────────────────────────────────────────────┤
│ Sequences                                                   │
│   sms_repermission · failed · 31 Aug                        │
├────────────────────────────────────────────────────────────┤
│ History                                                     │
│   28 Aug  Texted STOP                                       │
│   22 Aug  Newsletter signup                                 │
│   19 Aug  Paid $180 — Rotational Reboot                     │
│   19 Aug  Consult booked — 21 Aug 14:00                     │
└────────────────────────────────────────────────────────────┘
```

Admin UI is **light-only** — `.dark` is a class variant these components were
never built against, and forcing it breaks existing pages.

### 3.4 Make the list link to it

`ContactsTable` currently renders 100 rows and no link. Each row's name becomes
a link to `/admin/contacts/[id]`. The existing select-all-and-enrol behaviour
must keep working — the checkbox and the link are two targets in one cell, and
Playwright's `name` matcher is a **substring** match, so give the link an
accessible name that the checkbox's does not contain.

---

## 4. Traps

- **`null` and `[]` are different answers.** A failed read of the timeline must
  not render as "no history". `page.tsx` already refuses to wrap its reads in
  try/catch for exactly this reason, and says so in a comment — follow it: let
  the error reach `app/(admin)/admin/error.tsx`, which is visibly not an empty
  page.
- **An absence assertion needs a presence control.** "The timeline shows no
  payments for a lead with none" passes just as well when the payment join is
  broken and returns nothing for everyone. Every test asserting something is
  *missing* needs a sibling asserting it is *present* for a contact who has one.
- **A fixture proves render, not origination.** Building a `contact_tags` row in
  a test proves the screen draws it. It does not prove the POST route can create
  one. Test the route separately, through the route.
- **Assert which value, not that a value came back.** `expect(rows.length > 0)`
  is green whether the timeline renders the right person's history or everyone's.
  Pin the actual contact id.
- **Merging is the case that breaks.** Write the test where two contacts with
  overlapping tags merge *before* writing the merge code. `ON CONFLICT DO
  NOTHING` on the unique index is the whole fix, but only if the index is there.

---

## 5. Tasks

1. Migration `002xx_contact_tags.sql` + RLS. Apply to the dev clone via MCP and
   read the constraint back.
2. `lib/db/contact-tags.ts` — `listTags`, `addTag`, `removeTag`, `tagsForContacts`.
3. Teach `decideMerge` / the merge writer to carry tags to the survivor. Test
   the overlap case first.
4. `lib/db/contact-detail.ts` — the three-source union. Pure merge function
   separated from the reads so it is testable without a database.
5. `/api/admin/contacts/[id]/tags` POST + DELETE, `withAudit`, three new slugs.
6. `/admin/contacts/[id]` page + `ContactDetail` component.
7. Link the list rows; keep bulk enrolment working.
8. Screenshot the real page, annotated, both a rich contact and a bare one.

**Verification:** targeted vitest for the DAL and routes, plus `tsc --noEmit`
compared against the 251-error baseline. New suites pin
`// @vitest-environment node` — every jsdom suite in this repo currently cannot
start (`ERR_REQUIRE_ESM` from `html-encoding-sniffer`), and reports "no tests"
rather than failing.

---

## 6. Out of scope

- Editing a contact's name, email or phone. Identity is the spine's job and
  changing it by hand invites duplicates the merger cannot see.
- Deleting a contact. GDPR erasure is its own design with a consent-record
  problem attached.
- Backfilling the 104 GoHighLevel tags. There is nothing to backfill from.
- A tag *management* screen (rename across all contacts, merge two tags). Add it
  when there are enough tags to need it.

# Sequence reporting — design

**Date:** 2026-09-07
**Parent:** [docs/full-engine-scope-vs-built.md](../../full-engine-scope-vs-built.md) §4 item 4
**Branch:** `feat/sequence-reporting`, cut from `main` @ `9c366ab2`
**Status:** approved by the owner 2026-09-07 (design presented in chat, "LGTM")

---

## 1. Why

`exit_reason` is recorded faithfully and read in exactly one place — the contact
detail page, one contact at a time. There is no view that answers *"is this
sequence working?"*. Every other item on the Lead Engine gap list is guesswork
until this exists, and it is promised in all three quoted packages.

The screen answers three questions, in this order:

1. How many people entered this sequence?
2. How many are still in it?
3. Of the ones who left, why did they leave — and did any of them buy?

---

## 2. The outcome axis

**This is the one real modelling decision and it is not a presentation detail.**

The gap list asks for exits broken down as *bought / booked / unsubscribed / ran
to the end*. The schema does not have that shape, and four things have to be
reconciled before a single number can be rendered:

| Fact | Evidence |
|---|---|
| `sequence_runs.status` is `active \| completed \| exited \| failed` | [00216:73](../../../supabase/migrations/00216_lead_engine_sequences.sql#L73) |
| `exit_reason` is only ever populated when `status='exited'` | [`exitRun`](../../../lib/db/sequences.ts#L436) is the only writer |
| **"Ran to the end" is a status, not a reason** | [`completeRun`](../../../lib/db/sequences.ts#L453) writes no `exit_reason` at all |
| **"Unsubscribed" is two different reasons** | `unsubscribed` (email link) and `sms_stop` (texted STOP) |

And a fifth fact that tsc cannot see:

> **`SequenceExitReason` is incomplete.** It declares four values
> ([sequences.ts:491](../../../lib/db/sequences.ts#L491)) but `exitRun` takes a
> plain `string`, and [sequence-tick.ts:113](../../../lib/automation/sequence-tick.ts#L113)
> writes a fifth — `"suppressed"` — straight past the union. A screen that
> switched on the declared type would drop those runs into no bucket at all,
> and the totals would silently not add up.

### The buckets

One **Outcome** axis, six mutually exclusive buckets, derived from both columns:

| Bucket | `status` | `exit_reason` |
|---|---|---|
| **In progress** | `active` | — |
| **Bought** | `exited` | `payment` |
| **Booked a call** | `exited` | `booking` |
| **Opted out** | `exited` | `unsubscribed` ∣ `sms_stop` ∣ `suppressed` |
| **Finished** | `completed` | — |
| **Failed** | `failed` | — |

Plus **Other**, which catches any `exited` run whose reason matches none of the
above. Other is not defensive padding — it is the thing that makes a future
sixth reason *visible on the screen* instead of quietly missing from the totals.
The seven reasons that exist today are enumerated in §2.1 — two of which are
written by SQL and were missed by the first, TypeScript-only grep. An eighth
added later lands in Other until somebody names it. **Other is a column on the
list**, not just a concept: two of the seven reasons live in it today, so a list
without that column would visibly stop adding up.

**The invariant, which is a test:** the six buckets plus Other sum exactly to
Entered, for every sequence, always. If they ever do not, the screen is lying
and the test says so.

### 2.1 Every exit reason that can reach the database

Found by grepping the helper that performs the verb, not the function expected
to call it — the exits live in the event handlers, not in `decideStep`.

**There are seven, not five.** The first version of this list had five, because
the grep was TypeScript-only. Two of the writers are SQL: `merge_contacts` in
migration 00238 sets an exit reason directly, and that function is called
automatically from [`lib/db/contacts.ts`](../../../lib/db/contacts.ts) during
identity resolution — not from a button — so those two reasons can appear on the
screen without anybody having done anything that looks like a merge. **When you
look for the writer of a reason, grep the migrations as well as the source.**

| Reason | Written by | Bucket |
|---|---|---|
| `payment` | [stripe/webhook:223](<../../../app/api/stripe/webhook/route.ts#L223>) | Bought |
| `booking` | [bookings/ingest.ts:309](../../../lib/bookings/ingest.ts#L309) | Booked a call |
| `unsubscribed` | [unsubscribe.ts:95](../../../lib/lead-engine/unsubscribe.ts#L95) | Opted out |
| `sms_stop` | [twilio/inbound:278](<../../../app/api/webhooks/twilio/inbound/route.ts#L278>) | Opted out |
| `suppressed` | [sequence-tick.ts:113](../../../lib/automation/sequence-tick.ts#L113) — **not in the union** | Opted out |
| `merged_into_survivor` | [00238_merge_contacts_carries_tags.sql](../../../supabase/migrations/00238_merge_contacts_carries_tags.sql) — **SQL, not TypeScript** | Other |
| `superseded_by_merged_run` | [00238_merge_contacts_carries_tags.sql](../../../supabase/migrations/00238_merge_contacts_carries_tags.sql) — **SQL, not TypeScript** | Other |

The two merge reasons stay in **Other** rather than earning a bucket: they are
bookkeeping about which record a person ended up in, not an outcome the
follow-up produced. Other therefore has to be a COLUMN on the list, not just a
concept — otherwise the row's numbers visibly stop adding up to Entered. The
detail page names both in plain words.

### 2.2 Where the split is shown

The **list** shows all seven buckets, Other included. The **detail** splits
*Opted out* into its three, because they are three different things an operator would act on
differently:

- *unsubscribed* — they clicked the link in an email.
- *texted STOP* — they replied STOP to a text.
- *already on the do-not-contact list* — they were suppressed before the tick
  reached them, which is not a decision they made about **this** sequence.

---

## 3. Surfaces

Three new files, one nav line, two registry lines. **No migration** — this is
pure read, so this item claims no migration number and cannot collide with a
peer branch.

```
app/(admin)/admin/sequences/page.tsx          list — one row per sequence
app/(admin)/admin/sequences/[key]/page.tsx    detail — one sequence
lib/db/sequence-reporting.ts                  the aggregation
```

Routed by `key`, not `id`: `/admin/sequences/new_lead_nurture` is readable and
linkable, and `key` is already the stable identifier every script uses.

### Conventions this follows, deliberately

Copied from [the contacts page](<../../../app/(admin)/admin/contacts/page.tsx>),
which is the closest existing screen in the same subsystem:

- **`resolveAdminTenant()`** for the tenant. No new `SINGLETON_BUSINESS_ID`
  reference; every read carries a `business_id` predicate.
- **`requirePermission` + `canAccessPath`** from the permissions guard.
- **`export const dynamic = "force-dynamic"`.**
- **Reads are NOT wrapped in try/catch.** A failed read must reach
  `app/(admin)/admin/error.tsx`, not render as a sequence with no runs in it.
  Those two states are otherwise pixel-identical, and this screen's whole job is
  to be believed. Same reasoning the contacts and pipeline pages already record.

### Permissions

`lib/permissions/registry.ts` gains exactly one line:

```ts
{ prefix: "/admin/sequences", permission: "contacts" },
```

Same permission as Pipeline and Contacts, because it is the same subsystem: the
people in a sequence are the people on the board.

**This is not optional.** The registry is default-deny, so a new admin surface
that is not registered fails closed — a teammate would see the nav link and get
bounced by it, which reads as a broken app rather than as a boundary.

**And no `/api/admin/sequences` entry, deliberately.** Both pages are server
components that read through the DAL directly, the way the contacts page does;
this item adds no route handler, so there is nothing to register. Adding the API
prefix anyway would have reached a route that already exists and does not want
it: [`/api/admin/sequences/enrol`](<../../../app/api/admin/sequences/enrol/route.ts>)
is currently unmapped — so `canAccessPath` denies staff at the proxy — **and**
self-guards with `session.user.role !== "admin"`. Registering the prefix would
let staff past the proxy into a route that 403s them anyway, leaving two guards
that mask each other and a registry entry the route contradicts. The enrol
route's permissions are not this item's to change.

### Navigation

`components/admin/admin-nav.ts`, Coaching group, immediately after Contacts —
Pipeline, Contacts, **Sequences**, Clients. The three Lead Engine surfaces sit
together, and Sequences is the one that explains what the other two are doing.

### Tables

`DataTableCard → DataTableToolbar → DataTable → DataTableHeader/Head/Row/Cell`,
with `DataTableBadge` for the sequence status pill. `DataTableEmpty` renders its
own `<tr>` and is therefore **not** wrapped in a `DataTableRow` — wrapping it
makes its `colSpan` span nothing.

Admin UI is light-only. No `.dark` variants.

---

## 4. The aggregation

```ts
export type OutcomeBucket =
  | "in_progress" | "bought" | "booked" | "opted_out" | "finished" | "failed" | "other"

/** Pure. The whole modelling decision from §2, in one testable function. */
export function bucketForRun(status: string, exitReason: string | null): OutcomeBucket

export interface SequenceReportRow {
  id: string
  key: string
  name: string
  status: string                 // draft | active | paused | archived
  trigger_source: string | null  // NULL means manual enrolment only
  entered: number
  buckets: Record<OutcomeBucket, number>
  contactsWithoutEmailConsent: number   // people in THIS sequence
}

export interface SequenceReport {
  rows: SequenceReportRow[]
  // DISTINCT across the tenant, not the sum of the rows: somebody in two
  // sequences is one person, and the sentence under the table says "people".
  contactsWithoutEmailConsent: number
}

export interface SequenceRunRowForReport {
  id: string
  contactId: string
  contactName: string | null
  contactEmail: string | null
  enteredAt: string
  completedAt: string | null
  bucket: OutcomeBucket
  exitReason: string | null   // raw, so the detail page can split "opted out"
  lastError: string | null    // why nothing was sent, on a run that failed
}

export interface SequenceDetail extends SequenceReportRow {
  description: string | null
  stepCount: number
  runs: SequenceRunRowForReport[]
  totalRuns: number           // for the pager; may exceed runs.length
}

export async function sequenceReport(businessId: string): Promise<SequenceReport>
export async function sequenceDetail(
  businessId: string,
  key: string,
  opts?: { limit?: number; offset?: number },
): Promise<SequenceDetail | null>
```

`sequenceDetail` returns `null` for a key that does not exist under this tenant,
and the page renders a 404 — **not** an empty report, which would tell an
operator that a sequence they can name has no runs, when in fact it belongs to
somebody else.

### How the counts are computed

PostgREST cannot `GROUP BY`, and this item takes no migration, so there is no
RPC to call. The aggregation selects the three columns it needs
(`sequence_id, status, exit_reason`) for the tenant and buckets them in
TypeScript.

**Every growth-table read is paged** through `lib/db/paginate.ts`'s
`fetchAllRows`. PostgREST silently caps a plain `.select()` at about 1000 rows —
no error — so the first cut of this read would simply have shown wrong numbers
past 1000 runs in a tenant, and wrong in an especially confusing way: the detail
page reads runs for ONE sequence and would have stayed right while the list
under-counted. A sequence could read "Nobody has entered this one yet" on the
list and "Entered 600" one click later. The paged reads carry an `id` order,
because a `.range()` walk over an unordered result set can repeat and skip rows.

The `.in("contact_id", …)` on the consent read is **chunked at 200**, for the
reason [gsc-query-daily](../../../lib/db/gsc-query-daily.ts) records: PostgREST
puts the list in the query string, and past roughly 450 uuids the request clears
16 KB and fails, taking the whole screen to the error boundary.

**The honest ceiling** is therefore memory, not row count: one row per run of
every sequence, held at once. At today's 73 runs it is free; it stays
comfortable into the low tens of thousands. Past that this wants a database-side
`GROUP BY` behind an RPC. Recorded here so the next person meets a documented
threshold rather than a mystery.

`sequenceDetail` additionally returns the individual runs — contact name, email,
when they entered, their outcome, and the raw `exit_reason` — paged at 100, the
same page size the contacts list uses.

### The consent count

Per the owner's decision on gap #15, email sending stays **ungated**. The screen
shows the consent picture rather than enforcing it, so that the next time the
question comes up it is a number and not an estimate.

**Consent is the most recent row per `(contact, channel)` with `granted = true`**
— not "a row exists". [`hasConsent`](../../../lib/db/contact-consents.ts#L38)
orders by `occurred_at desc, created_at desc` and reads `granted` off the first
row. A count that asked only whether a row existed would report a *revoked*
consent as a granted one, which is exactly backwards and the more dangerous of
the two errors.

`hasConsent` is per-contact and issues one query each, so the report uses a bulk
equivalent in the same module: one ordered select, first row per `contact_id`
wins. That dedup is deliberate and load-bearing — it must walk in
`occurred_at desc` order and keep the **first** row seen per contact, never the
last.

A read failure throws. `null` and `[]` are different answers here: "could not
read the consent table" must not render as "nobody has consented".

---

## 5. Empty is not broken, and neither is failed

Measured on production 2026-09-07: **every bucket is zero except
`sms_repermission` → Failed 73.** Eight of the nine sequences have never run.
`exit_reason` is NULL on all 73 rows, because `failed` is not an exit.

Nine rows of zeros reads as a broken screen. So the states are made explicit and
distinguishable:

- **A sequence with no runs** says *"Nobody has entered this sequence yet"* and
  names the trigger that would put them there — the funnel form, the quiz, or
  **manual enrolment only** when `trigger_source` is NULL. That last one is
  [what NULL means](../../../lib/db/sequences.ts#L540) and is genuinely the
  answer to "why is this empty".
- **A `paused` or `draft` sequence** says so in the same sentence, because for
  `newsletter_welcome` and `lead_magnet_delivery` that *is* why the count is
  zero, and it is fixable in thirty seconds.
- **The 73 failed runs** carry a plain-language explanation rather than a bare
  red 73 that looks like a bug in the screen. The explanation is the reason the
  database actually recorded (`sequence_runs.last_error`), shown as written and
  not prettified: it is the only answer there is, and a coach can act on "the
  darrenjpaul.com domain is not verified" and cannot act on silence. The LIST
  says *"Nothing was sent to 73 of these people. Open the sequence to see why."*
  beside the sequence name; the DETAIL page prints the recorded reason under
  each person's badge, or says plainly that no reason was recorded.

Written for a non-programmer. No jargon: not "enrolled", not "terminal state",
not "trigger source". "Nobody has entered this sequence yet." "This sequence is
paused, so nobody new is being added."

---

## 6. Out of scope, deliberately

- **No date-range filter.** 73 runs all-time. A window filter is machinery for a
  problem that does not exist yet.
- **No CSV export.** Nobody has asked.
- **No message-level stats** (sent / delivered / opened / clicked). The columns
  exist on `sequence_messages` and this is the obvious next item, but the owner
  chose runs-only for v1 — it ships the thing that stops the flying blind, and
  open-tracking needs its own caveats on the page (Apple Mail Privacy inflates
  opens) that deserve more than a footnote.
- **No editing.** On/off toggles and a step editor are gap #11 and land on this
  same screen next. This item builds the surface they will attach to; it does
  not build them.

---

## 7. Testing

- **`bucketForRun` is pure and gets the most tests:** every one of the five
  reasons that exist, the `suppressed` one the union omits, an unknown reason
  landing in `other`, `completed` with a stray non-null `exit_reason`, and
  `active`.
- **The sum invariant:** buckets + other === entered, property-checked over a
  generated mix of runs.
- **Tenant predicate:** mutated by changing the `business_id` **value**, not the
  arity — an argument-blind mock passes a wrong-tenant `.eq()` happily, and has
  done so 91/91 in this repo before.
- **Consent bulk read:** two rows for one contact where the newer one is
  `granted=false` must count as *no consent*. This is the mutation that catches
  a naive `exists` implementation.
- **Failed read throws** rather than rendering empty — asserted, with a
  presence control so the assertion cannot pass because nothing rendered.
- **Any test that passes on the first run gets mutated** before it is believed.

Verification is targeted suites plus `tsc --noEmit` diffed as a per-file error
**set** against the branch point, not a count — a falling count still hides new
errors.

Screenshots are driven through the real app on the real routes with Playwright,
annotations burned into the PNG, in `screenshots/sequence-reporting/`. The dev
clone has the four quiz sequences active and at least one real run from the
2026-09-06 end-to-end test, so both a populated sequence and the honest empty
state can be shown. Additional outcomes are produced by driving the real quiz
flow — never by writing rows.

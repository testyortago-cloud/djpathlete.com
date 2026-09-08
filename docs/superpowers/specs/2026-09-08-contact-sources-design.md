# The three declared-but-never-written contact sources (gap #14)

**Date:** 2026-09-08
**Gap:** #14 of `docs/full-engine-scope-vs-built.md`
**Branch:** `feat/contact-sources`, cut from `main` @ `ce6f2aba`

`ContactEventSource` (`lib/db/contacts.ts`) declares fifteen values. Three —
`shop`, `assessment`, `funnel_checkout` — have no writer anywhere, so everybody
is filed under `purchase` / `inquiry` / `funnel_form` and the contact list cannot
be sliced by them.

---

## 1. What I measured first, and what it changed

**No migration is needed.** `contact_timeline_events.source` is plain
`text NOT NULL` with **no CHECK constraint** (confirmed against production with
`pg_constraint`, not `information_schema`). The union in TypeScript is the only
place the set is enforced — which the file's own comment already says.

**The seam already exists, and that makes two thirds of this trivial.**
`tryCaptureLeadFromCheckout(session, businessId, source: ContactEventSource)` in
`app/api/stripe/webhook/route.ts:153` already takes the source as a parameter.
The `checkout.session.completed` handler calls it at line 262 with a hardcoded
`"purchase"`, and the expired handler already passes `"checkout_abandoned"` at
line 407. The webhook ALSO already discriminates checkout kinds by
`session.metadata?.type` — `shop_order`, `funnel_purchase`, `event_signup`,
`save_card`, `session_pack`, `week_access`, `session_membership`. So the whole of
`shop` and `funnel_checkout` is choosing the source at one call site.

**The real consumer is `SOURCE_LABELS`, and it is FOUR missing, not three.**
`lib/db/contact-detail.ts:165` is typed `Record<string, string>`, so a missing
entry compiles clean. Missing today: `funnel_checkout`, `shop`, `assessment`
**and `questionnaire`** — and `questionnaire` already HAS a writer
(`app/api/questionnaire/route.ts:116,149`). So that gap is live right now, not
hypothetical.

The failure is milder than the gap list implies, and worth stating accurately:
the lookup is
`SOURCE_LABELS[row.source] ?? \`Came in through ${humanise(row.source)}\``,
so a missing entry renders **"Came in through Shop"**, not a raw slug. Generic,
not broken. Still worth fixing — that sentence is not written for a coach.

**`ghl_import` is a live source the union does not declare.** Production holds
**256** `contact_timeline_events` rows with `source = 'ghl_import'`. It has a
`SOURCE_LABELS` entry but is absent from `ContactEventSource`. So the union is
already not the full set of live values.

---

## 2. Decisions

### 2.1 `shop` — write it, at completion, not at checkout creation

Written from the Stripe webhook's `checkout.session.completed` branch when
`session.metadata?.type === "shop_order"`.

**Not** from `app/api/shop/checkout/route.ts`. That route only creates a Stripe
Checkout session; it has `address.email`, so it *could* write, but a created
session is not a sale. This mirrors the rule §2.3 states for `funnel_checkout`,
and the repo already applies it: `checkout_abandoned` exists precisely so an
unfinished checkout is a different fact from a finished one.

### 2.2 `funnel_checkout` — write it, and it means a checkout that SUCCEEDED

Written from the same branch when `session.metadata?.type === "funnel_purchase"`.

This is the constraint that has been protected on purpose. The abandoned-checkout
work in `00255` introduced a NEW source, `checkout_abandoned`, rather than
spending `funnel_checkout` on an abandonment, specifically so this gap stayed
closable in its own terms. `funnel_checkout` must never come to mean anything but
a completed funnel purchase.

### 2.3 `assessment` — write it, but ONLY onto a contact that already exists

**This is a ruling made without the owner and it should be reviewed.**

The only assessment surface is `app/api/assessment/submit/route.ts`, and it
**401s without a session**. Everyone who submits is already a registered client,
not a lead. So the gap list's framing for this one — "everyone is captured, you
just cannot slice by these three" — is not true here: an assessment is not a
lead-capture moment at all.

Two wrong answers, and the one taken:

- *Write it like the others.* `recordContactEvent` creates or merges
  unconditionally, so every client who does an assessment would get a contact row
  minted for them. That changes what the contacts list contains — a product
  decision, not a labelling fix, and not mine to take while nobody is awake.
- *Leave it unwritten.* Honest, but it leaves a real moment off the person's
  timeline for no better reason than caution.
- **Taken: record the event only when a contact already exists for that user.**
  `findContactByIdentifiers({ userId, businessId })` already returns
  `string | null` and is the existing lookup. If it returns a contact, write the
  `assessment` event onto it; if it returns null, do nothing at all. A paying
  client already has a contact row (their Stripe checkout wrote a `purchase`
  event), so this captures the common case, adds the timeline entry that is
  genuinely useful, and **mints nothing**. The contacts list means exactly what it
  meant before.

If the owner wants an assessment to create a contact, that is a one-line change
and a deliberate one. Recorded here so it is a decision, not a default.

### 2.4 Labels for all four, plus `ghl_import` left alone

Add `SOURCE_LABELS` entries for `funnel_checkout`, `shop`, `assessment` and
`questionnaire`, each written for a non-programmer:

| Source | Label |
|---|---|
| `funnel_checkout` | Bought through a funnel |
| `shop` | Bought something from the shop |
| `assessment` | Finished a movement assessment |
| `questionnaire` | Filled in a questionnaire |

`questionnaire` is included because it already has a live writer and is already
falling through to the generic sentence — it is the only one of the four that is
a defect today rather than a latent one.

`ghl_import` is **not** added to `ContactEventSource`. It is written by the
one-off import path, not by `recordContactEvent`, and adding it to the union
would invite a future caller to file live traffic under it. Its `SOURCE_LABELS`
entry already exists and stays. Recorded here so the omission is visible as a
choice.

---

## 3. Why a test has to pin each label

`SOURCE_LABELS` is `Record<string, string>`. Adding a member to
`ContactEventSource` and forgetting the label **compiles clean** and ships a
generic sentence to a coach. tsc cannot see it. So:

- A test asserts a label exists for **every** member of `ContactEventSource`,
  driven off a literal list of the union's members, so adding a source without a
  label fails.
- A test asserts **which** sentence each new source renders — not merely that
  something came back. "Assert which value, not that a value came back" is a rule
  here, and a test that only checks non-empty is green for the column name and the
  human label alike.
- A test asserts the fallback still works for an unknown source, so the default
  arm stays load-bearing.

---

## 4. Non-goals

- **No migration.** The column has no constraint; there is nothing to alter.
- **No change to `purchase`.** Every checkout that is not `shop_order` or
  `funnel_purchase` keeps writing `purchase`, unchanged. This is a narrowing of
  what `purchase` covers, not a redefinition — nothing that currently reads
  `purchase` (including `hasPurchaseSince`) may change meaning. **A test must pin
  that a plain coaching checkout still writes `purchase`.**
- **`step_up`, `ai_chat`, `inquiry`, `event_signup`** already have writers and are
  not touched.
- **No backfill.** The 5 existing `purchase` rows stay as they are; re-labelling
  historical rows would rewrite what was true when they were written.

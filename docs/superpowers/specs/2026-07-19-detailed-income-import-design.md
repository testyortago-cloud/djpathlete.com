# Detailed Platform-Income Import + Editable Imported Rows — Design

**Date:** 2026-07-19
**Status:** Approved (owner: "yes built it i want it to be detailed as much as possible" + "just do it until the end now" — full autonomy; push HELD for owner go-ahead)
**Extends:** AI Bookkeeper Phase 1 income adapter (`lib/bookkeeping/income-adapter.ts`), Phase 6 ledger UI.

## 1. Context and goal

Three findings from the 2026-07-19 dev reseed drive this feature:

1. **Thin drafts.** `buildIncomeDrafts` emits generic memos ("Platform payment") and email-or-null counterparties, even though the DB knows the program, the pack product, and the athlete. The import dialog already auto-matches category by `service_line` (`ImportPlatformDialog.tsx:82`) — the missing piece is detail, not categorization plumbing.
2. **Orphaned-mirror undercount (real $340 bug).** The adapter skips pack/event mirror `payments` rows, trusting the source table to carry the sale — but 4 real May-2026 event-signup payments ($85 × 4) have NO surviving `event_signups` rows (deleted post-camp), so revenue silently undercounts. Mirrors carry no packageId/signupId, so precise pairing is impossible.
3. **Imported rows are uneditable.** `LedgerTable.tsx:171` renders the Edit action only for `source === "manual"`; the PATCH route has no source restriction. Coach cannot fix a category or memo on an imported row from the UI.

**Goal:** imports arrive maximally detailed (program + athlete + product + auto category), never undercount deleted-source sales, and imported rows are editable where editing is safe.

## 2. Non-goals

- No retro-enrichment job for already-posted entries (prod ledger has no imported entries yet; dev was enriched by script).
- No editing of amount/date/direction on imported rows (import integrity; delete-and-manual is the escape hatch — and Delete stays manual-only).
- No membership-invoice ingestion (stays the adapter's documented honesty warning).
- No migrations, no flags, no `functions/` changes. Vercel-only deploy.

## 3. Feature 1 — Adapter enrichment ("as detailed as possible")

### 3.1 Data loading (`lib/db/bookkeeping.ts` — `listPlatformIncome`)
After the existing five paginated reads, two explicit batch lookups (no reliance on FK embeds; `metadata->>'programId'` cannot embed anyway):
- **Users:** collect distinct `payments[].user_id` + `clientPackages[].client_user_id`; one `.in("id", ids)` read of `users(id, first_name, last_name, email)` (chunked ≤200 ids/call).
- **Programs:** collect distinct `payments[].metadata.programId` (string uuids only); one `.in("id", ids)` read of `programs(id, name)` (chunked ≤200).

Stamp onto rows: payments gain `payer_name` (trimmed `first_name + " " + last_name`, null when blank), `payer_email`, `program_name`; clientPackages gain `client_name`. Widen `IncomeSourceRows` accordingly (optional-nullable fields, like the existing `product_name` pattern). Lookup failures degrade gracefully (fields null, import still works) via the existing `safeAll`-style catch.

### 3.2 Draft composition (`lib/bookkeeping/income-adapter.ts` — pure)
Memo formats (pinned):
| Source | Memo |
| --- | --- |
| Payment w/ `program_name` + `metadata.weekNumber` | `<program_name> — week <n> access` |
| Payment w/ `program_name` | `<program_name> — program purchase` |
| Payment `metadata.type === "session_fee"` | `Session fee` |
| Other payment | `description ?? "Platform payment"` |
| Client package | `<product_name ?? session_type ?? "Session pack"> (<credits_total> sessions)` |
| Event signup | `<event_title ?? "Event"> — signup` |
| Shop order | `Shop order <order_number>` (unchanged) |
| Orphaned mirror `session_pack` | `Session pack (record deleted)` |
| Orphaned mirror `event_signup` | `Camp/event signup (record deleted)` |

Counterparty (pinned fallback chains): payments → `payer_name ?? metadata.customerEmail ?? payer_email ?? description ?? null`; packages → `client_name ?? null`; signups → `parent_name ?? null`; shop → `customer_name` (unchanged). Service lines unchanged, **except** (F3.2, final review 2026-07-20): the non-mirror payments draft's `service_line` is now `p.program_name ? "performance_training" : paymentServiceLine(p.description, meta)` — a program-linked payment (e.g. description "Subscription renewal", which matches neither `program` nor `week`) always prefills Performance Training instead of falling through to Other.

### 3.3 Deterministic category tie-break
New pure helper `matchAccountForServiceLine(direction, serviceLine, accounts)` in `lib/bookkeeping/account-match.ts`: filter `account_type === direction && service_line === serviceLine && !archived`; when multiple match, prefer name containing `stripe` (case-insensitive), then alphabetical; return first or null. `ImportPlatformDialog.tsx:82` swaps its inline `find` for this helper (fixes the two-Performance-Training-accounts array-order lottery). StatementImportDialog untouched.

## 4. Feature 2 — Orphaned-mirror fallback + id-first pairing

**Rewritten 2026-07-20 (final-review whole-branch escalation).** §1 finding #2 above ("Mirrors carry no packageId/signupId, so precise pairing is impossible") was **false** — every mirror payment has carried the exact source id in `metadata` (`client_package_id` for pack mirrors, `event_signup_id` for event mirrors) since the mirrors' introducing commits. The amount±7day heuristic below was built on that false premise; it is now a **legacy fallback only**, for mirrors that (for whatever reason) carry no id. Credit: caught in the whole-branch final review, not the original build.

In `buildIncomeDrafts`, process source tables FIRST (packages, signups), building per-type candidate lists `{sourceId, amount_cents, occurred_on, consumed, heuristicEligible}` — every paid pack/signup is a candidate (keyed by its own row id), `heuristicEligible` stays Stripe-only for packs (`stripe_session_id` or `stripe_payment_id` present — cash/offline packs never write a mirror payment, so letting them absorb an id-less orphaned mirror via the heuristic would silently drop that mirror's revenue) and always-true for signups (the webhook is the only writer). Then, for a succeeded mirror payment (`metadata.type` `session_pack`/`event_signup`):

1. **id present, candidate with that `sourceId` exists** → pair. id-based pairing ignores amount and date entirely (a promo-code/price-edit divergence still pairs) — mark the candidate consumed, stamp `alt_ref: payments:<mirror id>` back onto the already-emitted source-table draft, mirror skipped.
2. **id present, no candidate with that `sourceId`** → orphan-with-id: the mirror becomes an income draft itself — `source_ref: payments:<id>` (never double-posts on re-import), `alt_ref: client_packages:<id>` / `event_signups:<id>` (the deleted source ref — see §6a dedupe), `service_line` `session_packs`/`camps`, memo per §3.2, counterparty from the payment's payer chain. Counts toward the per-type warning.
3. **id absent (legacy)** → the amount±7day heuristic over unconsumed, `heuristicEligible` candidates only: equal `amount_cents` and |date diff| ≤ 7 days (smallest diff wins; tie → earliest candidate). Paired → mirror skipped, candidate consumed. Unpaired → orphan fallback draft as in (2) but with `alt_ref: null` (no id to point at).
- Per-type warning when fallbacks occurred (paths 2+3 combined): `"<n> event-signup payment(s) counted directly — the signup records no longer exist."` / same for packs. Dialog already renders `warnings[]`.

Edge semantics (pinned): two id-less mirrors + one candidate at equal amount in-window → one pairs, one falls back (total correct). An id-based pairing at a DIFFERENT amount and a 20-day gap still pairs (ignores both). Refunded/non-succeeded payments unchanged. Non-mirror payments unchanged.

### 4a. `alt_ref` cross-run dedupe

`alt_ref` on a draft names the OTHER `source_ref` form this exact sale could have posted under. `insertImportedEntries` (`lib/db/bookkeeping.ts`) pre-checks every draft's `alt_ref` against already-posted `(book_id, source='platform_import', source_ref)` rows before the upsert; a match drops that draft (`skipped_alt_ref` count) instead of letting it ride the ordinary same-ref `ignoreDuplicates` upsert — which would miss it, since the two refs differ. This closes the double-post hole where a source row existed on one import, then got deleted before a re-import flipped its draft's `source_ref` from `client_packages:<id>` to `payments:<mirror id>` (or the reverse, if the mirror's row somehow vanished and the source row reappeared).

## 5. Feature 3 — Editable imported rows

- **`LedgerTable.tsx`:** Edit button renders for ALL sources; Delete stays `manual`-only. (Deleting an imported row would just resurrect on next import — the source_ref uniqueness row is gone.)
- **`ManualEntryDialog.tsx`:** edit mode gains a locked variant when `entry.source !== "manual"`: direction / amount / date / adjusts-period rendered disabled; category, memo, counterparty, business purpose stay editable. On submit in locked mode the PATCH body contains ONLY `{account_id, memo, counterparty, business_purpose}` (no locked keys at all). Dialog title: "Edit imported entry" for every locked source.

  Caption is source-aware (F3.1, final review 2026-07-20):

  | `entry.source` | Caption |
  | --- | --- |
  | `platform_import` | "Amount, date and direction are locked — imported from platform records." |
  | `statement_import` | "Amount, date and direction are locked — imported from a bank statement." |
  | `receipt` | "Amount, date and direction are locked — from a posted receipt." |

  The client-side amount/date validation (`Enter a valid amount` / `Pick a date`) is skipped entirely when `locked` — those fields are disabled and never sent, and a legitimately $0 imported row (e.g. a fully-discounted pack) must still be saveable.
- **PATCH `/api/admin/bookkeeping/entries/[id]`:** always `getEntry` first (404 when missing — currently fetched only when `account_id` present). When `entry.source !== "manual"` and the parsed body CONTAINS any of `direction`, `amount_cents`, `occurred_on`, `adjusts_period` (presence, not value-change) → **422** `{"error":"amount, date and direction are locked on imported entries"}`. Manual entries unchanged. Closed-period 409 and account-scope checks unchanged (account check now reuses the already-fetched entry).

## 6. Files touched

| File | Change |
| --- | --- |
| `lib/bookkeeping/types.ts` | Widen `IncomeSourceRows` (payer/program/client fields) |
| `lib/db/bookkeeping.ts` | `listPlatformIncome` batch lookups + stamping |
| `lib/bookkeeping/income-adapter.ts` | Memo/counterparty enrichment + orphan pairing |
| `lib/bookkeeping/account-match.ts` (new) | `matchAccountForServiceLine` tie-break helper |
| `components/admin/bookkeeping/ImportPlatformDialog.tsx` | Use the helper at line ~82 |
| `components/admin/bookkeeping/LedgerTable.tsx` | Edit for all sources; Delete manual-only |
| `components/admin/bookkeeping/ManualEntryDialog.tsx` | Locked edit variant for imported entries |
| `app/api/admin/bookkeeping/entries/[id]/route.ts` | Always-fetch + locked-field 422 |

No migrations, no flags, no functions/, no new deps.

## 7. Testing

- **Adapter fixtures:** every memo/counterparty shape in §3.2; orphan pairing — the real 4×$85 case (no signups at all), partial deletion (2 mirrors / 1 candidate), ±7-day boundary (7 = pair, 8 = fallback), equal-amount one-to-one consumption, warnings text; mirrors still skipped when sources exist (regression pin on the $1,842 double-count rule).
- **`account-match` tests:** single match, stripe-name preference, alphabetical fallback, archived exclusion, no match → null.
- **DAL:** `listPlatformIncome` stamping test with mocked supabase (ids chunking + graceful lookup failure → null fields).
- **PATCH route tests:** 422 per locked field on imported; allowed-fields succeed on imported; manual full-edit unchanged; account-scope + closed-period behavior preserved.
- **Component tests:** LedgerTable — Edit visible on `platform_import` rows, Delete absent; ManualEntryDialog locked mode — disabled fields + submitted body contains only the four editable keys.
- Gate: scoped suite + full suite (baseline 3162/3162 green) + `npm run build`.

## 8. Open items

None.

## 9. Fix pass (Stripe-only pairing candidates)

**Date:** 2026-07-19 (post-review amendment)

**What changed:** In `buildIncomeDrafts` (lib/bookkeeping/income-adapter.ts), the clientPackages loop now gates the orphan-pairing-candidate push on Stripe payment presence: only packages with `stripe_session_id != null || stripe_payment_id != null` join packCandidates. The pack DRAFT itself still emits for every paid pack (regardless of payment method); only the candidate slot for pairing is gated.

**Rationale:** Cash/offline packs never write a mirror payment row, so allowing them to absorb an orphaned mirror would silently drop that mirror's revenue (test case: a $200 cash pack + a $200 orphaned session-pack mirror both emit drafts, but the mirror is not consumed by the cash pack, so both count correctly).

**Test added:** `"cash packs never absorb an orphan mirror's pairing slot"` in the orphaned-mirror fallback describe block:
```ts
it("cash packs never absorb an orphan mirror's pairing slot", () => {
  const { drafts, warnings } = buildIncomeDrafts(src({
    payments: [mirror({ id: P1, amount_cents: 20000, created_at: "2026-07-06T10:00:00Z", mtype: "session_pack" })],
    clientPackages: [
      pack({ id: C1, price_cents: 20000, purchased_at: "2026-07-05T10:00:00Z", credits_total: 5, stripe_session_id: null, stripe_payment_id: null }),
    ],
  }))
  expect(drafts).toHaveLength(2)
  expect(drafts.map((d) => d.source_ref).sort()).toEqual([`client_packages:${C1}`, `payments:${P1}`].sort())
  expect(warnings).toContain("1 session-pack payment(s) counted directly — the pack records no longer exist.")
})
```

**Fixture update:** The `pack()` helper now defaults `stripe_session_id: "cs_test_1", stripe_payment_id: "pi_test_1"` so existing pairing tests preserve their Stripe-paired semantics; the new cash-pack test overrides both to null explicitly.

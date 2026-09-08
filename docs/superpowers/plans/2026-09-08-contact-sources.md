# Contact Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `shop`, `funnel_checkout` and `assessment` real writers so the contact list can be sliced by them, and give every declared source a label a coach can read.

**Architecture:** Two touches. The Stripe webhook already has the seam — `tryCaptureLeadFromCheckout` takes the source as a parameter and the handler already discriminates by `session.metadata.type` — so `shop` and `funnel_checkout` are a source-selection function at one call site. `assessment` is written from the assessment route, but only onto a contact that already exists. Then labels, pinned by a test that fails if any union member lacks one.

**Tech Stack:** Next.js 16 App Router, TypeScript, Stripe webhooks, Supabase, vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-contact-sources-design.md` — read it. Section 2.3 records a ruling I made without the owner and flags it for review.

## Global Constraints

- **Node 24.** `source ~/.nvm/nvm.sh && nvm use` before any vitest or tsc. **Route suites need `--environment node` pinned** or they report "no tests" — a known trap here, not a missing file.
- **`tsc --noEmit` baseline is EXACTLY 238 errors across 54 files.** Per-file baseline at the ABSOLUTE path `/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/baselines/tsc-ce6f2aba-perfile.txt`. Diff the per-file SET, never the count.
- **Pre-existing red, not yours:** `__tests__/migrations/00062.test.ts` 3/6 and `__tests__/api/spine/purchase-spine.test.ts` 1/11 fail on a clean checkout.
- **Targeted tests only.** Never the full suite.
- **Do NOT `prettier --write` a file you did not create.** ~78 files repo-wide are unformatted. A deletion in a pre-existing file is the tell.
- **NO migration.** `contact_timeline_events.source` is plain `text` with no CHECK. If you find yourself writing SQL, stop — you have misread the spec.
- **Never add a `SINGLETON_BUSINESS_ID` reference.** `platformBusinessId()` is the existing seam and is already used at both webhook call sites.
- **No brand names under `lib/lead-engine/`.**
- **Copy is for a non-programmer.** These labels render on the contact timeline.
- **No AI attribution in commits.** After EVERY commit: `git log ce6f2aba..HEAD --format=%B | grep -ci "co-authored-by\|claude\|generated with"` must print 0.
- **Plan-authored code is a sketch.** Where it disagrees with the real types, the real types win — say so rather than casting the error away.

---

### Task 1: Labels for every source, pinned so one can never go missing again

Do this FIRST. It is the consumer, and doing it first means the new sources in Task 2 land into a screen that already reads properly.

**Files:**
- Modify: `lib/db/contact-detail.ts`
- Test: `__tests__/lib/db/contact-detail.test.ts` (create if absent)

**The trap this closes:** `SOURCE_LABELS` is typed `Record<string, string>`, so adding a member to `ContactEventSource` and forgetting the label **compiles clean**. tsc cannot see it. The lookup falls back to `` `Came in through ${humanise(row.source)}` ``, which renders "Came in through Shop" — generic, not broken, and not written for a coach.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest"

// The union has no runtime representation, so this list is written by hand and
// the test below is what keeps it honest. Adding a source to
// ContactEventSource without adding it here AND to SOURCE_LABELS is exactly the
// gap this pins.
const DECLARED_SOURCES = [
  "funnel_form", "funnel_checkout", "contact_form", "newsletter", "lead_magnet",
  "event_signup", "shop", "assessment", "questionnaire", "step_up", "ai_chat",
  "inquiry", "purchase", "checkout_abandoned", "quiz",
] as const

describe("every declared contact source has a label written for a coach", () => {
  it.each(DECLARED_SOURCES)("%s has its own label, not the generic fallback", (source) => {
    const line = describeTimelineRow({ kind: "entry_point", source, metadata: {} })
    expect(line.title).not.toMatch(/^Came in through /)
  })

  it("says which sentence each new source renders", () => {
    // Assert WHICH value, not that a value came back: a non-empty check is green
    // for the slug and the human label alike.
    expect(titleFor("shop")).toBe("Bought something from the shop")
    expect(titleFor("funnel_checkout")).toBe("Bought through a funnel")
    expect(titleFor("assessment")).toBe("Finished a movement assessment")
    expect(titleFor("questionnaire")).toBe("Filled in a questionnaire")
  })

  it("still falls back readably for a source nobody declared", () => {
    // The default arm is load-bearing: `source` is plain text with no CHECK, so
    // a value this union has never heard of can arrive from an import.
    expect(titleFor("carrier_pigeon")).toBe("Came in through Carrier pigeon")
  })
})
```

Read `lib/db/contact-detail.ts` first and adapt `describeTimelineRow` / `titleFor` to whatever the real exported function is called and whatever row shape it takes. **The real signature wins over this sketch.** If the function is not exported, export it rather than testing through the page.

- [ ] **Step 2: Run, watch fail.** `npx vitest run __tests__/lib/db/contact-detail.test.ts`
- [ ] **Step 3: Add the four labels** to `SOURCE_LABELS`: `funnel_checkout` → "Bought through a funnel", `shop` → "Bought something from the shop", `assessment` → "Finished a movement assessment", `questionnaire` → "Filled in a questionnaire". Hand-format; the file is pre-existing.
- [ ] **Step 4: Run, watch pass.**
- [ ] **Step 5: Mutate.** Remove one label (the every-source test must fail, naming it). Change one label's wording (the which-sentence test must fail). Delete the `??` fallback (the unknown-source test must fail). Report ACTUAL per-test output; strip ANSI with `sed 's/\x1b\[[0-9;]*m//g'`; do not chain an assertion and a test run with `&&`.
- [ ] **Step 6: Commit** as `feat(contacts): a readable label for every contact source`.

---

### Task 2: Real writers for shop, funnel_checkout and assessment

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`, `app/api/assessment/submit/route.ts`
- Test: `__tests__/api/stripe/webhook-contact-source.test.ts` (or extend the existing webhook suite), `__tests__/api/assessment/submit-route.test.ts`

**Interfaces consumed:** `tryCaptureLeadFromCheckout(session, businessId, source)` at `app/api/stripe/webhook/route.ts:153`; `findContactByIdentifiers({ email, phone, userId, businessId }): Promise<string | null>` at `lib/db/contacts.ts:360`; `recordContactEvent` from `lib/db/contacts.ts`.

- [ ] **Step 1: Write the failing tests**

Cover, with `--environment node`:
- `metadata.type === "shop_order"` → the capture is called with `"shop"`.
- `metadata.type === "funnel_purchase"` → called with `"funnel_checkout"`.
- **A plain coaching checkout (no `metadata.type`) still writes `"purchase"`.** This is the regression that matters: `purchase` is narrowing, and `hasPurchaseSince` reads it. Assert it explicitly.
- `metadata.type === "event_signup"`, `"save_card"`, `"session_pack"` → still `"purchase"`.
- The expired-checkout branch still writes `"checkout_abandoned"` (untouched).
- Assessment submit, when `findContactByIdentifiers` returns a contact id → an `assessment` event is recorded.
- Assessment submit, when it returns `null` → **nothing is written at all**, and the route still returns its normal success response. Pair this absence assertion with a presence control, or it passes just as well when the route threw.

- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement**

In the webhook, a small pure helper beside `tryCaptureLeadFromCheckout`:

```ts
/**
 * Which kind of contact event a completed checkout is.
 *
 * The webhook already discriminates these types for the pipeline and the
 * fulfilment branches; this reuses the same discriminator so one checkout
 * cannot be a shop order to one reader and a coaching sale to another.
 *
 * Everything not named here stays `purchase`, unchanged. `purchase` is being
 * NARROWED, not redefined -- `hasPurchaseSince` reads it, so a coaching sale
 * must keep writing it.
 */
function checkoutContactSource(session: Stripe.Checkout.Session): ContactEventSource {
  switch (session.metadata?.type) {
    case "shop_order":
      return "shop"
    case "funnel_purchase":
      return "funnel_checkout"
    default:
      return "purchase"
  }
}
```

Then line 262 becomes `await tryCaptureLeadFromCheckout(session, payerBusinessId ?? platformBusinessId(), checkoutContactSource(session))`. **Do not touch line 407** — the expired branch keeps `"checkout_abandoned"`.

In the assessment route, after the result is created and inside its own try/catch (a contact write must never fail an assessment submission), look the contact up by `userId` and record the event ONLY if one came back. Follow the webhook's `tryCaptureLeadFromCheckout` wrapper for the shape: catch, log, keep going.

- [ ] **Step 4: Run, watch pass.**
- [ ] **Step 5: Mutate**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | `case "shop_order"` returns `"purchase"` | the shop test |
| M2 | `default` returns `"shop"` | the plain-coaching-checkout test |
| M3 | swap the two case labels | both source tests |
| M4 | delete the `metadata?.type` optional chain (`metadata.type`) | should throw on a session with no metadata — if no test covers that, add one |
| M5 | assessment: record the event even when the lookup returns null | the nothing-is-written test |
| M6 | assessment: remove the try/catch | a test where the contact write throws and the route must still succeed |

- [ ] **Step 6: Commit** as `feat(contacts): write shop, funnel checkout and assessment sources`.

---

### Task 3: Close the ledger row

- [ ] Mark gap #14 **BUILT** in `docs/full-engine-scope-vs-built.md` §4, in the struck-through style rows #4, #5, #6, #7 and #12 use. **State plainly that `assessment` writes only onto an existing contact and never mints one**, and that this was my ruling, not the owner's — spec §2.3 has the argument.
- [ ] Commit as `docs(contacts): close gap #14 in the scope ledger`.

---

## Verification before the branch is called done

1. `npx vitest run __tests__/lib/db/contact-detail.test.ts __tests__/api/stripe/ __tests__/api/assessment/ --environment node` (component/DAL suites without the pin as appropriate).
2. Also run `__tests__/api/spine/purchase-spine.test.ts` — it covers the `purchase` source and its 1/11 failure is the pre-existing baseline. Confirm it is still 1/11 and not worse.
3. `npx tsc --noEmit` — diff the per-file SET against the baseline.
4. `npm run build` — exit 0.
5. `git log ce6f2aba..HEAD --format=%B | grep -ci "co-authored-by\|claude\|generated with"` prints 0.
6. `git diff --stat` shows no deletions in files you did not create.

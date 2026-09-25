# G35 — Readers with no tenant predicate: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every reader the G35 sweep found where the tenant is already in hand, make the platform's untenanted content invisible to other businesses, route the agents' alerts to the business's owners, name every remaining no-column seam on a test-enforced shelf, and record the large gaps as ledger rows G36-G45.

**Architecture:** Tenant arguments become REQUIRED and go first in DAL signatures. Readers of tables with no `business_id` either consult `platformBusinessId()` to decide whether their tenant is the one the rows describe (the NARROWER VARIANT shelf), or are named on a new UNTENANTED BY SCHEMA shelf in `lib/tenancy/platform.ts` whose test fails when a reader is converted or its table gains a column. Functions (Firebase) get a twin helper because `functions/` cannot import `lib/`.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgREST via supabase-js), Vitest (Node 24), Zod 4, Firebase Functions (functions/, own vitest).

**Spec:** `docs/superpowers/specs/2026-09-25-g35-untenanted-readers-design.md` (approved 2026-09-25, `4f3fa23b`).

## Global Constraints

- Tenant parameters are REQUIRED in every changed DAL signature, never optional (an optional tenant is how `getConversation` shipped `if (businessId)`). Their POSITION is the one the spec names for each function, which follows that module's existing siblings: first for `getBookingById`, `updateBookingStatus`, `getBookingsInRange`, `readContactIdentity`, `getQuizDefinition`; last for `hasConsent(contactId, channel, businessId)` (like `isSuppressed`/`suppress`) and `getConversation(id, businessId)` (which keeps every un-updated one-argument call a type error).
- Never add a `SINGLETON_BUSINESS_ID` reference. Go through `platformBusinessId()` (`lib/tenancy/platform.ts`). The non-test count stays **5** (command in CLAUDE.md).
- Every new `platformBusinessId()` reference is named in `lib/tenancy/platform.ts`'s doc comment on its honest shelf IN THE SAME COMMIT (`__tests__/lib/tenancy/platform-inventory.test.ts` fails otherwise). Every new `resolvePublicTenant()` caller is named in `lib/tenancy/public.ts`'s inventory (`__tests__/lib/tenancy/public-inventory.test.ts`).
- A business that is not the platform business gets NOTHING from the platform's untenanted content tables (`faqs`, `programs`, `testimonials`): never the platform's rows as a fallback. Inline FAQs and authored quotes are the business's own and are untouched.
- Contact and inquiry bell alerts go to `business_members` of the resolved business with `role in ('owner','coach')`. Agent alerts go to `role = 'owner'` only.
- Agent jobs carry `businessId: platformBusinessId()` from the enqueue route (the PLATFORM id, never the admin's selected tenant). A job without `businessId` skips its alert; it never defaults.
- Supabase errors come back in `{ error }`; check them. A failed read is not an absent row.
- Tests: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run <files>`; functions: `PATH=… npm --prefix functions test -- <files>`. Run targeted files only, never the whole suite.
- Worktree sandbox: one plain command per Bash call (no heredocs, `$(...)`, `cd`, loops). Multi-line edits with the Edit/Write tools.
- Commits: conventional prefix, a body that says why, **no `Co-Authored-By` or any AI attribution line**. Never push, never merge.
- `tsc --noEmit` must stay at 238 errors in 54 files with a per-file set identical to `.claude/baselines/tsc-ce6f2aba-perfile.txt` in the MAIN checkout (`/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/baselines/tsc-ce6f2aba-perfile.txt`).
- `npm run test:integration:selects` must pass before the branch is offered for merge (CLAUDE.md), and `KNOWN_REFUSED`/`KNOWN_UNRESOLVED` are two-way ratchets: never add an entry to silence a new refusal.

## Review Focus

Inputs and conditions the spec implies but no happy-path test exercises, most likely to bite first. Each has a test in the owning task.

1. **A request carrying a conversation id from ANOTHER business** (the widget keeps the id only in React state, so in practice a crafted request): expect the route's existing "that conversation is not available" 404, exactly as for an unknown id — no 500, no new conversation created silently (an existing test pins that), and nothing of A's in the answer. → Task 3.
2. **A booking PATCH for an id that does not exist at all**, not only another business's: expect 404, not the 500 a PGRST116 from `.single()` gives today. → Task 2.
3. **A platform admin previewing ANOTHER business's funnel** (`/preview`, `/funnel-preview`, where the Host is the admin's own): expect the live FAQ and testimonial sections to show nothing, exactly as `/go` on that business's host does. → Task 7.
4. **A business with no owner or coach member** (a freshly created tenant before anyone accepts an invite): the contact/inquiry route still answers 200 and inserts no notifications; the SEO flag returns `executed: false` with a reason instead of throwing. → Tasks 5 and 10.
5. **An agent job enqueued by the OLD route** (no `businessId`) and run by the NEW functions, which is what happens during the deploy window: the alert is skipped and logged, the job still completes, the memo is still written. → Task 10.

## Cross-task rulings (made while assembling the plan; each is carried into the named task's dispatch)

- **Execution order is the task order, 1 → 14.** Task 7 depends on Task 4; Task 8 anchors on Task 7's `platform.ts` text; Tasks 11 and 12 depend on Task 8.
- **`FunnelRenderContext.businessId` is added by Task 4** (the quiz island needs the route's tenant for the same preview reason). Task 7 CONSUMES it: it does not re-add the field, the three route edits or the two test-literal fixes; it passes the context to `FaqIsland`/`TestimonialsIsland`, gates them, extends the field's doc comment to name them, and adds its tests and inventory entries.
- **The NARROWER VARIANT shelf header is reworded once, by Task 11** (it owns the shelf text): it says the seam is reached "only … as the fallback when that lookup comes back empty", which no longer describes the chat facts, the islands, the catalogue, the build route or the existing booking-offer entry, all of which consult the seam as a comparison.
- **No platform brand literal in coach-facing copy.** Task 8's blocker wording and Block B line say the live feeds are not available for this business, without naming "DJP Athlete" (a white-label coach should not see the platform owner's brand in their own builder).
- **`functions/node_modules` is installed in the worktree by Task 10** with `npm ci --prefix functions` (a real install, never a symlink), and removed from consideration by `git status` before any commit.
- **The `UNTENANTED_BY_SCHEMA` list lives in `__tests__/helpers/untenanted-by-schema.ts`** (Task 11), not in the inventory test, because the live select contract imports the same table list; check (d) is enforced shelf-as-a-block, which also keeps the caller checks seeing a file that is on both a caller shelf and this one.

---

### Task 1: `hasConsent` reads under the business that asks (§A1)

**Files:**
- Modify: `lib/db/contact-consents.ts:33-52`
- Modify: `lib/db/sequences.ts:103-107`
- Modify: `lib/lead-engine/sms.ts:418-425`
- Modify: `lib/lead-engine/sms-consent.ts:189`
- Modify: `lib/db/sequence-reporting.ts:215-219` (doc comment only)
- Test: `__tests__/db/contact-consents.test.ts:104,150-231`
- Test: `__tests__/db/sequences.test.ts:840`
- Test: `__tests__/lib/lead-engine/send-manual-sms.test.ts:551,565-566`
- Test: `__tests__/app/sms-consent-page.test.ts:598-606`

**Interfaces:**
- Consumes: none
- Produces: `hasConsent(contactId: string, channel: ConsentChannel, businessId: string): Promise<boolean>`. The spec fixes this signature: the tenant goes last, like `isSuppressed`, `suppress` and `unsuppress` in the same module. The three callers are `loadRunContext(run, now, businessId)`, `sendManualSms({ …, businessId })` and `readSmsConsentState(token)`, which takes the business from the token.

- [ ] **Step 1: Write the failing test**

`__tests__/db/contact-consents.test.ts`. The suite's existing fake narrows rows on every `.eq()`, so the tests below exercise the real predicate. Make these edits in this order.

Edit A, adding a second tenant:
```ts
// old_string
const BUSINESS_ID = "biz-1"

beforeEach(() => {
// new_string
const BUSINESS_ID = "biz-1"
// A second tenant, for the G35 cases that file a row under one business and
// read under the other. Neither id is the platform constant, deliberately.
const OTHER_BUSINESS_ID = "biz-2"

beforeEach(() => {
```
Edit B makes three exact-string replacements (use `replace_all` on the first):
- `hasConsent("c1", "email")` → `hasConsent("c1", "email", BUSINESS_ID)`. This covers 4 sites: lines 150, 178, 214 and 231.
- `hasConsent("c-unknown", "sms")` → `hasConsent("c-unknown", "sms", BUSINESS_ID)`
- `hasConsent("c2", "email")` → `hasConsent("c2", "email", BUSINESS_ID)`

Edit C runs after Edit B. It fixes the tiebreak test, which would pass vacuously once the read filters on business, and then adds the two G35 tests:
```ts
// old_string
    // consulted, not by insertion-order coincidence.
    const tiedOccurredAt = "2026-01-01T00:00:00.000Z"
    store.consents.push(
      {
        contact_id: "c1",
        channel: "email",
        granted: false,
        occurred_at: tiedOccurredAt,
        created_at: "2026-01-01T00:00:00.002Z",
        _seq: 0,
      },
      {
        contact_id: "c1",
        channel: "email",
        granted: true,
        occurred_at: tiedOccurredAt,
        created_at: "2026-01-01T00:00:00.001Z",
        _seq: 1,
      },
    )

    expect(await hasConsent("c1", "email", BUSINESS_ID)).toBe(false)
  })
// new_string
    // consulted, not by insertion-order coincidence.
    //
    // G35: both rows carry `business_id`. Before `hasConsent` took a tenant
    // these fixtures had none, and once the read filters on it a row with no
    // business matches nothing — so `false` would come back because the read
    // found NO row, and this test would pass whatever the tiebreak did.
    const tiedOccurredAt = "2026-01-01T00:00:00.000Z"
    store.consents.push(
      {
        business_id: BUSINESS_ID,
        contact_id: "c1",
        channel: "email",
        granted: false,
        occurred_at: tiedOccurredAt,
        created_at: "2026-01-01T00:00:00.002Z",
        _seq: 0,
      },
      {
        business_id: BUSINESS_ID,
        contact_id: "c1",
        channel: "email",
        granted: true,
        occurred_at: tiedOccurredAt,
        created_at: "2026-01-01T00:00:00.001Z",
        _seq: 1,
      },
    )

    expect(await hasConsent("c1", "email", BUSINESS_ID)).toBe(false)

    // Presence control: with the revoke gone, the grant alone reads true. So
    // the `false` above was the revoke winning the tiebreak, not a predicate
    // that matched neither row.
    store.consents.splice(0, 1)
    expect(await hasConsent("c1", "email", BUSINESS_ID)).toBe(true)
  })

  // G35. `contact_consents` has two SEPARATE foreign keys (business_id ->
  // businesses, contact_id -> contacts), no composite, and business_id
  // defaults to the platform's id: nothing in the schema makes a consent
  // row's business equal its contact's. The read has to ask.
  it("does NOT honour a grant filed under another business (MUTANT: drop the business_id .eq)", async () => {
    await recordConsent({
      contactId: "c1",
      channel: "sms",
      granted: true,
      source: "form",
      wordingShown: "w",
      businessId: OTHER_BUSINESS_ID,
    })

    expect(await hasConsent("c1", "sms", BUSINESS_ID)).toBe(false)
    // Presence control on the SAME row: asked under the business it was filed
    // under, it is honoured. So the `false` above is the predicate, not a
    // store that finds nothing.
    expect(await hasConsent("c1", "sms", OTHER_BUSINESS_ID)).toBe(true)
  })

  it("does NOT let another business's NEWER revoke cancel this business's grant (MUTANT: compare business_id after .limit(1))", async () => {
    // "The most recent record" is the most recent in THIS business. An
    // implementation that read the newest row for the contact and only then
    // compared its business_id would pick the other business's revoke, see a
    // mismatch, and answer false. The predicate has to be in the query.
    store.consents.push(
      {
        business_id: BUSINESS_ID,
        contact_id: "c1",
        channel: "email",
        granted: true,
        occurred_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        _seq: 0,
      },
      {
        business_id: OTHER_BUSINESS_ID,
        contact_id: "c1",
        channel: "email",
        granted: false,
        occurred_at: "2026-02-01T00:00:00.000Z",
        created_at: "2026-02-01T00:00:00.000Z",
        _seq: 1,
      },
    )

    // A positive answer, so it cannot pass on a store that finds nothing.
    expect(await hasConsent("c1", "email", BUSINESS_ID)).toBe(true)
  })
```

`__tests__/db/sequences.test.ts` tests the caller, `loadRunContext`, with the file's row-narrowing fake:
```ts
// old_string
  it("does NOT swallow a hasConsent read failure", async () => {
// new_string
  // G35. The consent read is scoped to the run's business, like every other
  // read in loadRunContext. Every other fixture in this file is filed under
  // the platform id, so only a run in a business that is NOT the platform's
  // can tell "passed the tenant" from "ignored it" or "hard-coded it".
  // MUTANT: loadRunContext calls hasConsent without `businessId`.
  it("reads consent under the run's business, not another business's (G35)", async () => {
    const RUN_BUSINESS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    const OTHER_BUSINESS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    seedBusinessSettings({ business_id: RUN_BUSINESS })
    seedContact("c-1", { business_id: RUN_BUSINESS, email: "lead@example.com" })
    seedSequence("seq-1", { business_id: RUN_BUSINESS })
    const run = seedRun("run-1", "c-1", "seq-1", { business_id: RUN_BUSINESS }) as SequenceRunRow
    // Another business's GRANTS for the same contact id, on both channels.
    store.contact_consents.push(
      {
        id: "k-other-email",
        business_id: OTHER_BUSINESS,
        contact_id: "c-1",
        channel: "email",
        granted: true,
        occurred_at: "2026-08-18T00:00:00Z",
        created_at: "2026-08-18T00:00:00Z",
      },
      {
        id: "k-other-sms",
        business_id: OTHER_BUSINESS,
        contact_id: "c-1",
        channel: "sms",
        granted: true,
        occurred_at: "2026-08-18T00:00:00Z",
        created_at: "2026-08-18T00:00:00Z",
      },
    )

    const ctx = await loadRunContext(run, now, RUN_BUSINESS)
    expect(ctx.hasEmailConsent).toBe(false)
    expect(ctx.hasSmsConsent).toBe(false)

    // Presence control: the same grant, filed under the run's own business,
    // counts — and only on its own channel.
    store.contact_consents.push({
      id: "k-own-sms",
      business_id: RUN_BUSINESS,
      contact_id: "c-1",
      channel: "sms",
      granted: true,
      occurred_at: "2026-08-18T00:00:00Z",
      created_at: "2026-08-18T00:00:00Z",
    })
    const withOwn = await loadRunContext(run, now, RUN_BUSINESS)
    expect(withOwn.hasSmsConsent).toBe(true)
    expect(withOwn.hasEmailConsent).toBe(false)
  })

  it("does NOT swallow a hasConsent read failure", async () => {
```

`__tests__/lib/lead-engine/send-manual-sms.test.ts`. This suite mocks `hasConsent`, so the assertions are about which arguments it receives:
```ts
// old_string
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(hasConsent).toHaveBeenCalledWith(CONTACT, "sms")
  })

  it("asks about the SMS channel, not email", async () => {
// new_string
    expect(global.fetch).toHaveBeenCalledTimes(1)
    // G35: asked under THIS business. MUTANT: sendManualSms drops the third
    // argument — hasConsent would then read every business's consent rows.
    expect(hasConsent).toHaveBeenCalledWith(CONTACT, "sms", BIZ)
  })

  it("asks about the SMS channel, not email", async () => {
```
```ts
// old_string
    expect(hasConsent).toHaveBeenCalledWith(CONTACT, "sms")
    expect(hasConsent).not.toHaveBeenCalledWith(CONTACT, "email")
  })
// new_string
    expect(hasConsent).toHaveBeenCalledWith(CONTACT, "sms", BIZ)
    // `expect.anything()` for the tenant, not BIZ: an email ask under ANY
    // business is the bug. The line above is this line's presence control.
    expect(hasConsent).not.toHaveBeenCalledWith(CONTACT, "email", expect.anything())
  })
```

`__tests__/app/sms-consent-page.test.ts`. Only `@/lib/supabase` is mocked here, and its fake narrows on `.eq()`, so the real `hasConsent` runs. Add a test at the end of the last `describe`:
```ts
// old_string
    store.contacts = [{ id: CONTACT, business_id: BUSINESS, email: EMAIL, phone_e164: null }]
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(await readSmsConsentState(token)).toMatchObject({ state: "ask" })
  })
})
// new_string
    store.contacts = [{ id: CONTACT, business_id: BUSINESS, email: EMAIL, phone_e164: null }]
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(await readSmsConsentState(token)).toMatchObject({ state: "ask" })
  })

  // G35. `contact_consents` has no composite key tying a row's business to its
  // contact's, so a grant for this contact id can exist under ANOTHER
  // business. It is not an answer to this business's ask: the page must still
  // ask, and a press must still file this business's own row.
  // MUTANT: readSmsConsentState calls hasConsent without the token's business.
  it("asks again when the only grant on file belongs to another business", async () => {
    store.consents = [
      {
        business_id: "99999999-9999-4999-8999-999999999999",
        contact_id: CONTACT,
        channel: "sms",
        granted: true,
        occurred_at: "2026-01-01T00:00:00Z",
      },
    ]
    const token = signSmsConsentToken(CONTACT, BUSINESS)
    expect(await readSmsConsentState(token)).toMatchObject({ state: "ask" })

    // Presence control: the same grant under the token's own business is
    // "already said yes".
    store.consents.push({
      business_id: BUSINESS,
      contact_id: CONTACT,
      channel: "sms",
      granted: true,
      occurred_at: "2026-01-02T00:00:00Z",
    })
    expect(await readSmsConsentState(token)).toMatchObject({ state: "already_consented" })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/db/contact-consents.test.ts __tests__/db/sequences.test.ts __tests__/lib/lead-engine/send-manual-sms.test.ts __tests__/app/sms-consent-page.test.ts
```
Expected: `6 failed | 122 passed (128)`. This was checked with a probe against the current tree.
- contact-consents: "does NOT honour a grant filed under another business" (`expected true to be false`) and "does NOT let another business's NEWER revoke…" (`expected false to be true`)
- sequences: "reads consent under the run's business…" (`expected true to be false`)
- send-manual-sms: "SENDS when the contact has granted SMS consent…" and "asks about the SMS channel, not email" (`to be called with arguments: [ …(3) ]`)
- sms-consent-page: "asks again when the only grant on file belongs to another business" (`{ state: 'already_consented' } to match object { state: 'ask' }`)

The rewritten tiebreak test passes on both sides, which is expected: it guards against vacuity.

- [ ] **Step 3: Implement**

`lib/db/contact-consents.ts`:
```ts
// old_string
/**
 * The most recent record wins. A read failure throws rather than returning
 * false: "could not read" and "they said no" are different answers, and only
 * one of them is safe to act on.
 */
export async function hasConsent(contactId: string, channel: ConsentChannel): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_consents")
    .select("granted")
    .eq("contact_id", contactId)
// new_string
/**
 * The most recent record wins. A read failure throws rather than returning
 * false: "could not read" and "they said no" are different answers, and only
 * one of them is safe to act on.
 *
 * `businessId` is REQUIRED, and it is not redundant with `contactId` (G35).
 * `contact_consents` has two SEPARATE foreign keys, `business_id ->
 * businesses` and `contact_id -> contacts`, no composite one, and
 * `business_id` DEFAULTS to the platform's id. Nothing in the schema makes a
 * consent row's business equal its contact's, so without this predicate a row
 * filed under another business, or defaulted to the platform's by a writer
 * that forgot the column, would answer for this one. The dev clone had 0
 * mismatched rows of 59 when the predicate was added: the answer was correct
 * by data, and this makes it correct by construction instead.
 *
 * The predicate is IN THE QUERY, before `.limit(1)`, not a check on the row
 * that comes back. "The most recent record" means the most recent record in
 * THIS business: another business's newer revoke must not cancel this
 * business's grant, and a comparison made after the limit would let it.
 *
 * It comes after `channel` rather than first, like every other tenant
 * parameter in this module (`isSuppressed`, `suppress`, `unsuppress`). Both
 * ids are strings, so the compiler cannot catch a swap; the suite seeds a row
 * under one business and asks under another to catch it instead.
 *
 * `contactsWithEmailConsent` (lib/db/sequence-reporting.ts) applies the same
 * predicate in bulk, which is what lets that report claim it cannot disagree
 * with this function about one person.
 */
export async function hasConsent(contactId: string, channel: ConsentChannel, businessId: string): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_consents")
    .select("granted")
    .eq("business_id", businessId)
    .eq("contact_id", contactId)
```

`lib/db/sequences.ts`:
```ts
// old_string
  // Do not wrap these in try/catch. See the doc comment above.
  const [hasEmailConsent, hasSmsConsent] = await Promise.all([
    hasConsent(run.contact_id, "email"),
    hasConsent(run.contact_id, "sms"),
  ])
// new_string
  // Do not wrap these in try/catch. See the doc comment above.
  //
  // Under THIS run's business (G35), the same tenant every read above is
  // scoped to. `contact_consents` has no composite key tying a consent row's
  // business to its contact's, so the contact read above belonging to
  // `businessId` proves nothing about which business a consent row for that
  // contact id was filed under.
  const [hasEmailConsent, hasSmsConsent] = await Promise.all([
    hasConsent(run.contact_id, "email", businessId),
    hasConsent(run.contact_id, "sms", businessId),
  ])
```

`lib/lead-engine/sms.ts` (`businessId` is already destructured from `args` at the top of `sendManualSms`):
```ts
// old_string
    // route maps it to the generic 502 "try again", which is the honest
    // answer for an unreadable row.
    if (!(await hasConsent(args.contactId, "sms"))) {
// new_string
    // route maps it to the generic 502 "try again", which is the honest
    // answer for an unreadable row.
    //
    // Asked under THIS business (G35): a consent row filed under another
    // business for the same contact id is not this coach's permission to
    // text, and nothing in the schema stops one existing.
    if (!(await hasConsent(args.contactId, "sms", businessId))) {
```

`lib/lead-engine/sms-consent.ts` (`businessId` comes from `verified`, a few lines above):
```ts
// old_string
  if (await hasConsent(contactId, "sms")) {
// new_string
  // Under the token's business (G35), the one the token was signed for and
  // the one `confirmSmsConsent` files the grant under. Another business's
  // grant for the same contact id is not an answer to this business's ask.
  if (await hasConsent(contactId, "sms", businessId)) {
```

`lib/db/sequence-reporting.ts` (comment only; the spec asks for it):
```ts
// old_string
 * The tiebreak matches `hasConsent` in lib/db/contact-consents.ts exactly —
 * `occurred_at desc, created_at desc` — so the report and the engine cannot
 * disagree about one person. `id desc` is appended only as a paging tiebreaker
 * (see below); it never changes which row wins for a contact whose rows carry
 * distinct timestamps.
// new_string
 * The tiebreak matches `hasConsent` in lib/db/contact-consents.ts exactly —
 * `occurred_at desc, created_at desc` — and so, since G35, does the tenant
 * predicate: both read only rows filed under `businessId`. That pair is what
 * makes it impossible for the report and the engine to disagree about one
 * person BY CONSTRUCTION. Before G35 `hasConsent` had no business predicate
 * while this read did, so the two agreed only because no consent row's
 * business differed from its contact's (0 of 59 on the dev clone):
 * `contact_consents` has no composite key that makes it so. `id desc` is
 * appended only as a paging tiebreaker (see below); it never changes which
 * row wins for a contact whose rows carry distinct timestamps.
```

- [ ] **Step 4: Run it and watch it pass**

```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/db/contact-consents.test.ts __tests__/db/sequences.test.ts __tests__/lib/lead-engine/send-manual-sms.test.ts __tests__/app/sms-consent-page.test.ts
```
Expected: `128 passed (128)`.

Mutation check. Revert each mutant after watching it fail.
- Delete `.eq("business_id", businessId)` from `hasConsent`. The two G35 tests in contact-consents, the sequences G35 test and the sms-consent-page G35 test turn red. send-manual-sms mocks `hasConsent`, so it stays green.
- Move the predicate after the limit: `.select("granted, business_id")`, no `.eq("business_id")`, and `if (!data || data.business_id !== businessId) return false`. Only "does NOT let another business's NEWER revoke…" turns red. The probe confirmed exactly that one test fails.

Other suites that import or mock a changed module (`contact-consents`, `sequences`, `lead-engine/sms`, `lead-engine/sms-consent`, `sequence-reporting`) need no edits. None of them calls `hasConsent` directly or asserts its arguments. All 40 pass unchanged against this implementation (checked with a probe):
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/api/ask-capture.test.ts __tests__/api/funnels/submit-lead-name.test.ts __tests__/api/funnels/submit-sms-consent.test.ts __tests__/api/newsletter/tenant.test.ts __tests__/api/quiz-submit-funnel-lead.test.ts __tests__/api/quiz-submit.test.ts __tests__/api/spine/event-signup-spine.test.ts __tests__/api/spine/inquiry-pipeline.test.ts __tests__/api/spine/inquiry-spine.test.ts __tests__/api/webhooks/resend-events.test.ts __tests__/app/admin/sms-thread-page-tenancy.test.tsx __tests__/lib/lead-engine/chat-refusals.test.ts __tests__/api/admin/internal/sequence-tick.test.ts __tests__/api/spine/purchase-spine.test.ts __tests__/api/stripe/webhook-abandoned-checkout-purchase-guard.test.ts __tests__/api/stripe/webhook-capture-tenant.test.ts __tests__/api/stripe/webhook-contact-source.test.ts __tests__/api/stripe/webhook-funnel-purchase.test.ts __tests__/api/webhooks/pipeline-hooks.test.ts __tests__/api/webhooks/sequence-exit-hooks.test.ts __tests__/app/admin/contacts-page-tenancy.test.tsx __tests__/app/admin/detail-page-tenancy.test.tsx __tests__/components/admin/contacts-table.test.tsx __tests__/db/sequences-tenancy.test.ts __tests__/lib/automation/sequence-tick-email-env.test.ts __tests__/lib/automation/sequence-tick-send-faults.test.ts __tests__/lib/automation/sequence-tick-side-effects.test.ts __tests__/lib/automation/sequence-tick-sms.test.ts __tests__/lib/bookings/ingest-tenancy.test.ts __tests__/lib/bookings/ingest.test.ts __tests__/lib/db/sequences-list.test.ts __tests__/app/api/admin/sms-send-route.test.ts __tests__/lib/lead-engine/sequence-sms-copy.test.ts __tests__/lib/lead-engine/sms-manual-render.test.ts __tests__/lib/lead-engine/sms.test.ts __tests__/components/admin/contacts/ContactDetail.test.tsx __tests__/components/admin/sequences/SequenceReportTable.test.tsx __tests__/components/admin/sequences/SequenceRunsTable.test.tsx __tests__/lib/db/sequence-reporting.test.ts
```
Expected: `40 passed`, `691 passed`.

Compile check. There are no other TypeScript callers of `hasConsent`; `scripts/enrol-repermission.ts` and `agree-button.tsx` only mention it in comments. The check below should print nothing:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit 2>&1 | grep -E "contact-consents|lib/db/sequences\.ts|lead-engine/sms(-consent)?\.ts|sequence-reporting|__tests__/db/sequences\.test|send-manual-sms|sms-consent-page"
```

- [ ] **Step 5: Commit**

```
git add lib/db/contact-consents.ts lib/db/sequences.ts lib/lead-engine/sms.ts lib/lead-engine/sms-consent.ts lib/db/sequence-reporting.ts __tests__/db/contact-consents.test.ts __tests__/db/sequences.test.ts __tests__/lib/lead-engine/send-manual-sms.test.ts __tests__/app/sms-consent-page.test.ts
```
```
git commit -m "fix(consent): read consent under the business that asks (G35)" -m "hasConsent filtered on contact and channel only. contact_consents has two separate foreign keys and no composite, and business_id defaults to the platform's id, so nothing in the schema makes a consent row's business equal its contact's: a grant filed under another business answered for this one. It now takes businessId and filters in the query, before the limit, so another business's newer revoke cannot cancel this business's grant either." -m "All three callers already held the tenant: loadRunContext, sendManualSms and readSmsConsentState. contactsWithEmailConsent's claim that the report and the engine cannot disagree is now true by construction, not by data (0 of 59 dev-clone rows mismatched). The tiebreak test's fixtures gain a business, since a predicate-filtered read of rows with none would pass it vacuously."
```

---

### Task 2: Bookings: scope the status edit, the Daily Brief read, and delete the unscoped dead reader (§A2)

**Files:**
- Modify: `lib/db/bookings.ts:31-64` (delete `getUpcomingBookings`; `getBookingById`, `updateBookingStatus`), `lib/db/bookings.ts:106-116` (`getBookingsInRange`)
- Modify: `app/api/admin/bookings/route.ts:1-6,30-36`
- Modify: `lib/analytics/sections/bookings.ts:36-44`
- Test: `__tests__/lib/db/bookings.test.ts:32-66,157`
- Test: `__tests__/lib/analytics/sections/bookings.test.ts:53-55`
- Create: `__tests__/app/api/admin/bookings-route.test.ts`

**Interfaces:**
- Consumes: `resolveAdminTenantForRequest(req: Request): Promise<ResolvedTenant>` and `NoAccessibleBusinessError` from `lib/tenancy/resolve.ts`. Both already exist.
- Produces:
  - `getBookingById(businessId: string, id: string): Promise<Booking | null>`
  - `updateBookingStatus(businessId: string, id: string, status: BookingStatus, notes?: string): Promise<Booking | null>`
  - `getBookingsInRange(businessId: string, from: Date, to: Date): Promise<Booking[]>`
  - `getUpcomingBookings` no longer exists.
  - `PATCH /api/admin/bookings` answers 403 when no business is accessible, 404 for a booking outside the resolved business, and 500 when a read fails. It no longer swallows that failure.

- [ ] **Step 1: Write the failing test**

`__tests__/lib/db/bookings.test.ts`. The existing fake only records `.eq()` calls. It gains a row-narrowing path, because "another business's booking reads as ABSENT" is a claim about which row comes back.

Edit A:
```ts
// old_string
let bookingsResult: Record<string, unknown>

vi.mock("@/lib/supabase", () => ({
// new_string
let bookingsResult: Record<string, unknown>

// G35. The describes above assert which `.eq()` calls were made, which is
// enough for a list read. The by-id read, the update and the range read need
// more: "a booking of another business reads as ABSENT" is a claim about
// which ROW comes back, and only a store that genuinely narrows can make it.
// When `bookingsRows` is non-null the `bookings` builder narrows it by every
// `.eq()`, `.gte()` and `.lt()` applied — so dropping a predicate returns the
// foreign row instead of recording one call fewer. `null` keeps the canned
// `bookingsResult` path the older describes rely on.
type BookingRow = Record<string, unknown>
let bookingsRows: BookingRow[] | null = null
let bookingsReadError: { code: string; message: string } | null = null

vi.mock("@/lib/supabase", () => ({
```
Edit B:
```ts
// old_string
      if (table === "bookings") {
        const builder: Record<string, unknown> = {}
        builder.eq = (...args: unknown[]) => {
          bookingsEqCalls.push(args as [string, unknown])
          return builder
        }
        builder.order = () => builder
        builder.then = (resolve: (value: unknown) => void) => resolve(bookingsResult)
        return { select: () => builder }
      }
// new_string
      if (table === "bookings") {
        const eqs: Array<[string, unknown]> = []
        const ranges: Array<[">=" | "<", string, string]> = []
        let patch: BookingRow | null = null
        const narrowed = (): BookingRow[] =>
          (bookingsRows ?? []).filter(
            (row) =>
              eqs.every(([col, val]) => row[col] === val) &&
              ranges.every(([op, col, val]) => (op === ">=" ? String(row[col]) >= val : String(row[col]) < val)),
          )
        const builder: Record<string, unknown> = {}
        builder.eq = (...args: unknown[]) => {
          bookingsEqCalls.push(args as [string, unknown])
          eqs.push(args as [string, unknown])
          return builder
        }
        builder.gte = (col: string, val: string) => {
          ranges.push([">=", col, val])
          return builder
        }
        builder.lt = (col: string, val: string) => {
          ranges.push(["<", col, val])
          return builder
        }
        builder.order = () => builder
        builder.select = () => builder
        builder.maybeSingle = async () => {
          if (bookingsReadError) return { data: null, error: bookingsReadError }
          const rows = narrowed()
          // An UPDATE touches only the rows its predicates matched — the
          // foreign row keeps its status, which the tests below check.
          if (patch) for (const row of rows) Object.assign(row, patch)
          return { data: rows[0] ?? null, error: null }
        }
        // What the old by-id read and update used. Real PostgREST answers
        // zero rows under `.single()` with PGRST116, not with `data: null` —
        // modelled so that a revert to `.single()` fails the "answers null"
        // test for the real reason instead of on a missing method.
        builder.single = async () => {
          if (bookingsReadError) return { data: null, error: bookingsReadError }
          const rows = narrowed()
          if (patch) for (const row of rows) Object.assign(row, patch)
          if (rows.length !== 1) {
            return {
              data: null,
              error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
            }
          }
          return { data: rows[0], error: null }
        }
        builder.then = (resolve: (value: unknown) => void) =>
          resolve(bookingsRows ? { data: narrowed(), error: bookingsReadError } : bookingsResult)
        return {
          select: () => builder,
          update: (p: BookingRow) => {
            patch = p
            return builder
          },
        }
      }
```
Edit C:
```ts
// old_string
import { getBookings, getBookingStats } from "@/lib/db/bookings"
import { platformHostId } from "@/lib/tenancy/platform"
// new_string
import {
  getBookings,
  getBookingStats,
  getBookingById,
  updateBookingStatus,
  getBookingsInRange,
} from "@/lib/db/bookings"
import { platformHostId } from "@/lib/tenancy/platform"

// File-level, so it runs before every describe's own beforeEach: the older
// describes get the canned `bookingsResult` path whatever order they run in.
beforeEach(() => {
  bookingsRows = null
  bookingsReadError = null
})
```
Edit D, appended after the last `describe`:
```ts
// old_string
    const statuses = bookingsEqCalls.filter(([column]) => column === "status").map(([, value]) => value)
    expect(statuses.sort()).toEqual(["cancelled", "completed", "no_show", "scheduled"])
  })
})
// new_string
    const statuses = bookingsEqCalls.filter(([column]) => column === "status").map(([, value]) => value)
    expect(statuses.sort()).toEqual(["cancelled", "completed", "no_show", "scheduled"])
  })
})

// G35. Two businesses, one booking each. Every id below is distinct from the
// platform constant, so a DAL that hard-coded its tenant would fail too.
const OWN = "bbb"
const OTHER = "ccc"
function seedTwoBusinesses() {
  bookingsRows = [
    {
      id: "bk-own",
      business_id: OWN,
      contact_name: "Own Booker",
      booking_date: "2026-09-25T15:00:00.000Z",
      status: "scheduled",
    },
    {
      id: "bk-other",
      business_id: OTHER,
      contact_name: "Other Booker",
      booking_date: "2026-09-25T16:00:00.000Z",
      status: "scheduled",
    },
  ]
}

describe("getBookingById (G35)", () => {
  beforeEach(() => {
    bookingsEqCalls = []
    seedTwoBusinesses()
  })

  it("reads another business's booking as ABSENT, not as the row (MUTANT: drop the business_id .eq)", async () => {
    expect(await getBookingById(OWN, "bk-other")).toBeNull()
  })

  it("control: returns this business's own booking", async () => {
    expect(await getBookingById(OWN, "bk-own")).toMatchObject({ id: "bk-own", contact_name: "Own Booker" })
  })

  it("answers null for an id that does not exist, instead of throwing PGRST116 (MUTANT: .single())", async () => {
    // `.single()` turned "no such booking" into an error the route could only
    // answer with a 500. A missing row is an answer, not a failure.
    expect(await getBookingById(OWN, "bk-nope")).toBeNull()
  })

  it("still throws a real read failure rather than reporting 'no booking'", async () => {
    bookingsReadError = { code: "42P01", message: 'relation "bookings" does not exist' }
    await expect(getBookingById(OWN, "bk-own")).rejects.toMatchObject({ code: "42P01" })
  })
})

describe("updateBookingStatus (G35)", () => {
  beforeEach(() => {
    bookingsEqCalls = []
    seedTwoBusinesses()
  })

  it("does NOT change another business's booking, and answers null (MUTANT: drop the business_id .eq on the UPDATE)", async () => {
    expect(await updateBookingStatus(OWN, "bk-other", "cancelled")).toBeNull()
    const other = bookingsRows!.find((r) => r.id === "bk-other")!
    expect(other.status).toBe("scheduled")
  })

  it("control: changes this business's own booking and returns the updated row", async () => {
    const updated = await updateBookingStatus(OWN, "bk-own", "completed", "showed up early")
    expect(updated).toMatchObject({ id: "bk-own", status: "completed", notes: "showed up early" })
    expect(bookingsRows!.find((r) => r.id === "bk-own")!.status).toBe("completed")
  })

  it("leaves notes alone when none are given", async () => {
    const updated = await updateBookingStatus(OWN, "bk-own", "no_show")
    expect(updated).not.toHaveProperty("notes")
  })

  it("throws a real write failure rather than reporting 'no booking'", async () => {
    bookingsReadError = { code: "42501", message: "permission denied for table bookings" }
    await expect(updateBookingStatus(OWN, "bk-own", "completed")).rejects.toMatchObject({ code: "42501" })
  })
})

describe("getBookingsInRange (G35)", () => {
  beforeEach(() => {
    bookingsEqCalls = []
    seedTwoBusinesses()
  })

  const from = new Date("2026-09-25T00:00:00.000Z")
  const to = new Date("2026-09-26T00:00:00.000Z")

  it("returns this business's bookings and NOT another business's in the same range (MUTANT: drop the business_id .eq)", async () => {
    const rows = await getBookingsInRange(OWN, from, to)
    // Presence and absence on one read: the own booking is there, the other
    // business's booking — same day, same range — is not.
    expect(rows.map((r) => r.id)).toEqual(["bk-own"])
  })

  it("still applies the date range alongside the business scope (MUTANT: drop .gte/.lt)", async () => {
    const rows = await getBookingsInRange(
      OWN,
      new Date("2026-09-26T00:00:00.000Z"),
      new Date("2026-09-27T00:00:00.000Z"),
    )
    expect(rows).toEqual([])
  })
})

describe("getUpcomingBookings (G35)", () => {
  it("is gone: it had no caller, and any new one would read every business's bookings (MUTANT: the export is restored)", async () => {
    const dal = await import("@/lib/db/bookings")
    expect("getUpcomingBookings" in dal).toBe(false)
    // Presence control on the same module object: an `in` check against
    // something that is not the module would pass the line above vacuously.
    expect("getBookingsInRange" in dal).toBe(true)
  })
})
```

`__tests__/lib/analytics/sections/bookings.test.ts`:
```ts
// old_string
    // MUTANT: passing the wrong argument (or none) to listSignupsCreatedSince.
    expect(listSignupsCreatedSinceMock).toHaveBeenCalledWith(businessId, expect.any(Date))
  })
// new_string
    // MUTANT: passing the wrong argument (or none) to listSignupsCreatedSince.
    expect(listSignupsCreatedSinceMock).toHaveBeenCalledWith(businessId, expect.any(Date))
  })

  it("reads today's bookings under the same business as the signups (G35)", async () => {
    // MUTANT: `getBookingsInRange(dayStart, dayEnd)` — the booking arm read
    // every business's calls while the signup arm beside it was scoped.
    // `businessId` here is not the platform id, so a DAL call that hard-coded
    // the platform would fail this too. Whether the DAL then narrows by it is
    // __tests__/lib/db/bookings.test.ts's job; this pins the threading.
    await buildDailyBookings({ referenceDate, businessId })

    expect(getBookingsInRangeMock).toHaveBeenCalledTimes(1)
    const [passedBusiness, from, to] = getBookingsInRangeMock.mock.calls[0]
    expect(passedBusiness).toBe(businessId)
    // The window is still the reference day, start before end.
    expect(from).toBeInstanceOf(Date)
    expect(to).toBeInstanceOf(Date)
    expect((from as Date).getTime()).toBeLessThan((to as Date).getTime())
    expect(listSignupsCreatedSinceMock).toHaveBeenCalledWith(businessId, expect.any(Date))
  })
```

Create `__tests__/app/api/admin/bookings-route.test.ts`. The route has no suite today. The mock shape follows `__tests__/app/api/admin/contacts/contacts-route.test.ts`:
```ts
// @vitest-environment node
//
// PATCH /api/admin/bookings — the status change behind the row menu on
// /admin/bookings (components/admin/BookingList.tsx).
//
// G35. This route resolved NO tenant, and both DAL calls under it filtered on
// `id` alone. `schedule` is a grantable permission (the Coach preset carries
// it), and the route answers with the updated row, contact name, email and
// phone included — so any holder could change, and read back, any business's
// booking by id. Three things this file holds:
//
//  1. THE TENANT IS RESOLVED, NEVER TAKEN FROM THE CALLER. A `businessId` in
//     the body changes nothing; both DAL calls get the RESOLVED one, first.
//  2. A BOOKING OF ANOTHER BUSINESS IS A 404, and nothing is written or
//     audited. The DAL answers `null` for it (its own suite proves that with
//     a row-narrowing fake); this file proves the route turns `null` into a
//     404 before the write, instead of the 500 a PGRST116 used to produce.
//  3. NO ACCESSIBLE BUSINESS IS A 403, before any read.
//
// Node environment pinned: see __tests__/app/api/admin/contacts/contacts-route.test.ts
// for why a suite under this folder that inherits jsdom can report "no tests".
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const canAccessMock = vi.fn()
const resolveTenantMock = vi.fn()
const getBookingByIdMock = vi.fn()
const updateBookingStatusMock = vi.fn()
const recordAuditMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/permissions/guard", () => ({
  canAccessAdminPath: (...a: unknown[]) => canAccessMock(...a),
}))
vi.mock("@/lib/db/bookings", () => ({
  getBookingById: (...a: unknown[]) => getBookingByIdMock(...a),
  updateBookingStatus: (...a: unknown[]) => updateBookingStatusMock(...a),
}))
vi.mock("@/lib/audit/record", () => ({
  recordAudit: (...a: unknown[]) => recordAuditMock(...a),
}))
// Declared INSIDE the factory and imported back below — vi.mock is hoisted, so
// a top-level class referenced from the factory would still be in its temporal
// dead zone when the factory runs.
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return {
    resolveAdminTenantForRequest: (...a: unknown[]) => resolveTenantMock(...a),
    NoAccessibleBusinessError,
  }
})

import { PATCH } from "@/app/api/admin/bookings/route"
import { NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

/** The coach's own tenant — deliberately NOT a platform-looking id. */
const BUSINESS_ID = "22222222-2222-2222-2222-222222222222"
/** Somebody else's. Only ever sent by a caller trying it on. */
const OTHER_BUSINESS_ID = "33333333-3333-3333-3333-333333333333"
const BOOKING_ID = "44444444-4444-4444-8444-444444444444"

const BOOKING = {
  id: BOOKING_ID,
  business_id: BUSINESS_ID,
  contact_name: "Dana Reyes",
  contact_email: "dana@example.com",
  contact_phone: "+12025550123",
  booking_date: "2026-09-26T15:00:00.000Z",
  status: "scheduled",
}

function patch(body: unknown) {
  return PATCH(
    new Request("https://www.darrenjpaul.com/api/admin/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: a queued `*Once` implementation left
  // behind by a previous test leaks otherwise.
  vi.resetAllMocks()
  authMock.mockResolvedValue({ user: { id: "staff-1", role: "staff", permissions: {} } })
  canAccessMock.mockResolvedValue(true)
  resolveTenantMock.mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
  getBookingByIdMock.mockResolvedValue(BOOKING)
  updateBookingStatusMock.mockResolvedValue({ ...BOOKING, status: "completed" })
  recordAuditMock.mockResolvedValue(undefined)
})

describe("PATCH /api/admin/bookings — tenant scope (G35)", () => {
  it("reads and writes under the RESOLVED business, not one from the body (MUTANT: route skips resolveAdminTenantForRequest)", async () => {
    const res = await patch({ id: BOOKING_ID, status: "completed", businessId: OTHER_BUSINESS_ID })

    expect(res.status).toBe(200)
    expect(getBookingByIdMock).toHaveBeenCalledWith(BUSINESS_ID, BOOKING_ID)
    expect(updateBookingStatusMock).toHaveBeenCalledWith(BUSINESS_ID, BOOKING_ID, "completed", undefined)
    // The id in the body reached neither call.
    expect(JSON.stringify(getBookingByIdMock.mock.calls)).not.toContain(OTHER_BUSINESS_ID)
    expect(JSON.stringify(updateBookingStatusMock.mock.calls)).not.toContain(OTHER_BUSINESS_ID)
  })

  it("404s a booking of another business, writes nothing and audits nothing (MUTANT: no null check before the write)", async () => {
    // What the scoped DAL answers for an id filed under another business.
    getBookingByIdMock.mockResolvedValue(null)

    const res = await patch({ id: BOOKING_ID, status: "cancelled" })

    expect(res.status).toBe(404)
    expect(updateBookingStatusMock).not.toHaveBeenCalled()
    expect(recordAuditMock).not.toHaveBeenCalled()
    // Nothing of the booking leaks in the refusal.
    const text = await res.text()
    expect(text).not.toContain("dana@example.com")
  })

  it("control: the same request for this business's booking succeeds, returns it, and audits the transition", async () => {
    // The presence half of the 404 above: without it, a route that refused
    // everything would pass that test too.
    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; booking: { id: string; status: string } }
    expect(json.success).toBe(true)
    expect(json.booking).toMatchObject({ id: BOOKING_ID, status: "completed" })
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "booking.completed",
        target: expect.objectContaining({ type: "booking", id: BOOKING_ID }),
        metadata: { from_status: "scheduled", to_status: "completed" },
      }),
    )
  })

  it("404s, and audits nothing, when the scoped write matches no row", async () => {
    // The row stopped matching between the read and the write. The write
    // carries the predicate too, and its `null` must not become a 200 with no
    // booking in it — nor an audit row for a change that never happened.
    updateBookingStatusMock.mockResolvedValue(null)

    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(404)
    expect(recordAuditMock).not.toHaveBeenCalled()
  })

  it("403s when no business can be resolved for this user, before any read", async () => {
    resolveTenantMock.mockRejectedValue(new NoAccessibleBusinessError())

    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(403)
    expect(getBookingByIdMock).not.toHaveBeenCalled()
    expect(updateBookingStatusMock).not.toHaveBeenCalled()
  })

  it("500s, and writes nothing, when the snapshot read fails (it used to be swallowed)", async () => {
    // `.catch(() => null)` on this read turned a failed read into "no
    // snapshot" and went on to write. A 404 would be a lie here too: the
    // booking may well exist.
    getBookingByIdMock.mockRejectedValue(new Error("connection reset"))

    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(500)
    expect(updateBookingStatusMock).not.toHaveBeenCalled()
  })

  it("401s without a session, before resolving a tenant", async () => {
    authMock.mockResolvedValue(null)

    const res = await patch({ id: BOOKING_ID, status: "completed" })

    expect(res.status).toBe(401)
    expect(resolveTenantMock).not.toHaveBeenCalled()
    expect(getBookingByIdMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/db/bookings.test.ts __tests__/lib/analytics/sections/bookings.test.ts __tests__/app/api/admin/bookings-route.test.ts
```
Expected: `15 failed | 15 passed (30)`. This was checked with a probe against the current tree.
- bookings.test.ts has 9 failures:
  - The 6 by-id and update cases fail with `JSON object requested, multiple (or no) rows returned`. The old signature treats `OWN` as the id and uses `.single()`.
  - Both range cases fail with `from.toISOString is not a function`.
  - The deletion test fails with `expected true to be false`.
  - The two "real read/write failure" guards already pass.
- sections: "reads today's bookings under the same business…" fails with `expected 2026-05-06T… to be 'biz-1'`.
- route: 5 failures:
  - RESOLVED business: `to be called with arguments: [ …(2) ]`
  - foreign 404: `expected 200 to be 404`
  - write-null 404: `expected 200 to be 404`
  - 403: `expected 200 to be 403`
  - read-failure 500: `expected 200 to be 500`
  
  The control and the 401 test pass.

- [ ] **Step 3: Implement**

`lib/db/bookings.ts`, Edit 1. This deletes `getUpcomingBookings` and scopes the by-id read and the update:
```ts
// old_string
export async function getUpcomingBookings() {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("status", "scheduled")
    .gte("booking_date", new Date().toISOString())
    .order("booking_date", { ascending: true })

  if (error) throw error
  return data as Booking[]
}

export async function getBookingById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("bookings").select("*").eq("id", id).single()

  if (error) throw error
  return data as Booking
}

export async function updateBookingStatus(id: string, status: BookingStatus, notes?: string) {
  const supabase = getClient()
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (notes !== undefined) updates.notes = notes

  const { data, error } = await supabase.from("bookings").update(updates).eq("id", id).select().single()

  if (error) throw error
  return data as Booking
}
// new_string
/**
 * One booking, IN THIS BUSINESS, or `null` (G35).
 *
 * `businessId` is REQUIRED and comes first. This read used to filter on `id`
 * alone, and its only caller is `PATCH /api/admin/bookings`, which the
 * grantable `schedule` permission reaches and which answers with the row's
 * contact name, email and phone. A booking id from another business must
 * read as absent, the same as an id that does not exist.
 *
 * `maybeSingle`, not `single`: "no such booking here" is an answer the route
 * turns into a 404, not an error. `.single()` reported it as PGRST116, which
 * the route could only answer with a 500. A real read failure still throws.
 */
export async function getBookingById(businessId: string, id: string): Promise<Booking | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle()

  if (error) throw error
  return (data as Booking | null) ?? null
}

/**
 * Sets one booking's status (and optionally its notes), IN THIS BUSINESS.
 * Returns the updated row, or `null` when no booking with this id exists in
 * this business (G35).
 *
 * The predicate is on the UPDATE itself, not only on the read the route makes
 * before it: a read-then-write where only the read is scoped is a check, and
 * the write is where the damage happens. `.select().maybeSingle()` because
 * PostgREST reports no error for an UPDATE that matches zero rows (the same
 * reasoning as `updatePipelineBoard` in lib/db/pipeline.ts): `data` null with
 * no `error` is exactly the foreign-or-missing case, and the caller must be
 * able to tell it from a success.
 */
export async function updateBookingStatus(
  businessId: string,
  id: string,
  status: BookingStatus,
  notes?: string,
): Promise<Booking | null> {
  const supabase = getClient()
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (notes !== undefined) updates.notes = notes

  const { data, error } = await supabase
    .from("bookings")
    .update(updates)
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .maybeSingle()

  if (error) throw error
  return (data as Booking | null) ?? null
}
```
`lib/db/bookings.ts`, Edit 2:
```ts
// old_string
export async function getBookingsInRange(from: Date, to: Date): Promise<Booking[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .gte("booking_date", from.toISOString())
// new_string
/**
 * Bookings whose `booking_date` falls in `[from, to)`, IN THIS BUSINESS.
 *
 * `businessId` is REQUIRED and comes first (G35). This read had no business
 * predicate, so the Daily Brief's "calls today" listed every business's
 * calls, by the booker's name, in an email sent to the platform's coach —
 * while the signup count beside it in the same section was already scoped.
 */
export async function getBookingsInRange(businessId: string, from: Date, to: Date): Promise<Booking[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("business_id", businessId)
    .gte("booking_date", from.toISOString())
```

`lib/analytics/sections/bookings.ts`:
```ts
// old_string
  // HALF-SCOPED, deliberately not fully. `signups` is scoped to opts.businessId
  // below; `getBookingsInRange` beside it is NOT, even though `bookings` DOES
  // carry a business_id column (unlike bookkeeping's unscoped arms, which have
  // no column to scope by at all). This builder's own signup arm is this
  // phase's; the sibling booking read is not -- scoping it is a separate task.
  const [bookings, signups] = await Promise.all([
    getBookingsInRange(dayStart, dayEnd),
// new_string
  // BOTH arms read under opts.businessId (G35). The booking arm used to read
  // every business's rows while the signup arm beside it was scoped, so this
  // section listed every business's calls, by the booker's name, next to the
  // platform's own signup count. The caller (lib/analytics/daily-pulse.ts)
  // passes the platform's own business: the Daily Brief is the platform
  // coach's digest, not a per-business email.
  const [bookings, signups] = await Promise.all([
    getBookingsInRange(opts.businessId, dayStart, dayEnd),
```

`app/api/admin/bookings/route.ts`, Edit 1:
```ts
// old_string
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { z } from "zod"
// new_string
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { z } from "zod"
```
Edit 2:
```ts
// old_string
    // Snapshot previous state for transition dispatch.
    const existing = await getBookingById(id).catch(() => null)

    const booking = await updateBookingStatus(id, status, notes)

    // Dispatch audit slug on status transition only (note-only updates aren't audit-worthy).
    if (existing && existing.status !== status) {
// new_string
    // SCOPED BY BUSINESS (G35). `schedule` is a grantable permission (the
    // Coach preset carries it), and this route answers with the booking's
    // contact name, email and phone. It used to resolve no tenant at all, so
    // any holder could change, and read back, any business's booking by id.
    // The tenant comes from the session and the business cookie, never from
    // the body.
    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }

    // Snapshot previous state for transition dispatch. A booking of another
    // business reads as absent, the same as one that does not exist, and
    // both answer 404 before anything is written. This read used to be
    // `.catch(() => null)`, which also turned a failed read into "no
    // snapshot" and went on to write anyway; a read failure now reaches the
    // 500 below instead.
    const existing = await getBookingById(businessId, id)
    if (!existing) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    // The write carries the same predicate as the read. `null` here means the
    // row stopped matching between the two (deleted in between): still a 404,
    // never a success with no booking in it.
    const booking = await updateBookingStatus(businessId, id, status, notes)
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    // Dispatch audit slug on status transition only (note-only updates aren't audit-worthy).
    if (existing.status !== status) {
```

- [ ] **Step 4: Run it and watch it pass**

```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/db/bookings.test.ts __tests__/lib/analytics/sections/bookings.test.ts __tests__/app/api/admin/bookings-route.test.ts
```
Expected: `30 passed (30)`.

Mutation check. A probe confirmed each mutant; revert each after watching it fail.
- Delete `.eq("business_id", businessId)` from `getBookingById`, `updateBookingStatus` and `getBookingsInRange`. Exactly the three MUTANT-named tests turn red. The controls stay green.
- Change `.maybeSingle()` back to `.single()` in `getBookingById`. Two tests turn red: "answers null for an id that does not exist" and the foreign-id test.
- Delete the route's `if (!existing)` guard. Only the "404s a booking of another business" test turns red.

Other suites:
- No other suite imports or mocks `@/lib/db/bookings`, `@/lib/analytics/sections/bookings` or the route.
- These transitive dependents pass unchanged: the other `lib/db/bookings` importer (pipeline-reconcile), `buildDailyBookings`' only caller (daily-pulse), and the inventory test that names `lib/db/bookings.ts`. No edits are needed:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/automation/pipeline-reconcile.test.ts __tests__/api/admin/internal/pipeline-reconcile.test.ts __tests__/api/admin/internal/send-daily-pulse.test.ts __tests__/lib/analytics/daily-pulse-scheduled.test.ts __tests__/lib/tenancy/platform-inventory.test.ts
```
Expected: `5 passed`, `60 passed`.

Compile check. The check below should print nothing:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit 2>&1 | grep -E "lib/db/bookings|analytics/sections/bookings|api/admin/bookings/route|bookings-route\.test|lib/db/bookings\.test"
```

- [ ] **Step 5: Commit**

```
git add lib/db/bookings.ts app/api/admin/bookings/route.ts lib/analytics/sections/bookings.ts __tests__/lib/db/bookings.test.ts __tests__/lib/analytics/sections/bookings.test.ts __tests__/app/api/admin/bookings-route.test.ts
```
```
git commit -m "fix(bookings): scope the booking status edit and the Daily Brief read (G35)" -m "PATCH /api/admin/bookings resolved no tenant and its DAL filtered on id alone, so any holder of the grantable schedule permission could change, and read back with contact details, any business's booking. The route now resolves the admin tenant (403 when there is none), getBookingById and updateBookingStatus take businessId first and filter on it (the UPDATE too, not only the read before it), and a booking of another business answers 404 before anything is written; a missing row used to surface as PGRST116 and a 500. The snapshot read no longer swallows its own failure and writes anyway." -m "getBookingsInRange takes businessId too, so the Daily Brief lists the platform's own calls, like the signup count beside them. getUpcomingBookings had no caller and read every business's bookings; it is deleted so nothing can start calling it."
```

---


### Task 3: Chat conversations are read under the Host's tenant (§A3)

**Files:**
- Modify: `lib/db/chat.ts:36-44` (stale `CreateConversationInput.businessId` doc), `lib/db/chat.ts:70-104` (`getConversation`)
- Modify: `lib/db/pipeline.ts:2060-2077` (`readContactIdentity`)
- Modify: `lib/lead-engine/chat/escalate.ts:95-104`, `:170-178` (`RunEscalationInput`, `runEscalation`)
- Modify: `app/api/ask/route.ts:253-257` (`handOver`), `:317-329`, `:373-380`, `:574`, `:647-649`
- Modify: `app/api/ask/capture/route.ts:78-79` (import), `:234-240`
- Modify: `app/api/admin/pipeline/grant/route.ts:119` (a second `readContactIdentity` caller the spec missed)
- Modify: `app/(marketing)/ask/page.tsx:51-57` (stale comment)
- Modify: `lib/tenancy/public.ts:80-90` (inventory: `ask/route.ts` entry, new `ask/capture/route.ts` entry, ask-page paragraph). Anchored on lines 80-90 only. Task 4 edits line 79.
- Test: `__tests__/lib/db/coach-scoped-reads.test.ts`, `__tests__/api/ask.test.ts`, `__tests__/api/ask-capture.test.ts`, `__tests__/lib/lead-engine/chat-escalate.test.ts`, `__tests__/app/api/admin/pipeline/grant-route.test.ts`

**Interfaces:**
- Consumes: none. It uses the existing `resolvePublicTenant(): Promise<string>` (`lib/tenancy/public.ts`).
- Produces:
  - `getConversation(id: string, businessId: string): Promise<ChatConversation | null>`. The tenant is required and always applied. The argument order stays as the spec gives it (see Notes).
  - `readContactIdentity(businessId: string, contactId: string): Promise<{ email: string | null; name: string | null } | null>`
  - `RunEscalationInput.businessId: string` (required). `runEscalation({ conversationId, summary, businessId })`.
  - `app/api/ask/capture/route.ts` is a new `resolvePublicTenant()` caller, named in `lib/tenancy/public.ts`.

- [ ] **Step 1: Write the failing test**

`__tests__/lib/db/coach-scoped-reads.test.ts`. Header, before:
```ts
// The two reads that had NO business predicate at all until 2026-09-04, and
// were safe only because nothing could reach them.
//
//   lib/db/chat.ts          getConversation(id)
//   lib/db/pipeline.ts      readOpportunityForGrant(opportunityId)
```
after:
```ts
// The two reads that had NO business predicate at all until 2026-09-04, and
// were safe only because nothing could reach them, plus a third (G35) that
// inherited the first one's hole through the public chat route:
//
//   lib/db/chat.ts          getConversation(id)
//   lib/db/pipeline.ts      readOpportunityForGrant(opportunityId)
//   lib/db/pipeline.ts      readContactIdentity(contactId)          (G35)
```
Import, before: `import { readOpportunityForGrant } from "@/lib/db/pipeline"`
after: `import { readContactIdentity, readOpportunityForGrant } from "@/lib/db/pipeline"`

Retarget the old "stays UNSCOPED" test instead of deleting it. Before:
```ts
  it("stays UNSCOPED when no business is given, for the public /api/ask paths", () => {
    // Not an oversight and not a loophole to close. A website visitor resolves
    // their own conversation by the id in their session before anyone knows
    // which business it belongs to — the row is what CARRIES that answer, so
    // requiring it as an argument would be circular. app/api/ask/route.ts,
    // app/api/ask/capture/route.ts and lib/lead-engine/chat/escalate.ts rely on
    // this. If this ever becomes required, those three break at runtime, not at
    // compile time, because the argument is optional.
    return getConversation(SUBJECT_ID).then(() => {
      const record = calls.find((c) => c.table === "chat_conversations")!
      expect(eqOps(record).map(([, col]) => col)).toEqual(["id"])
    })
  })
```
after:
```ts
  it("applies the predicate UNCONDITIONALLY — an empty tenant matches nothing, never everything (G35)", () => {
    // RETARGETED, not deleted. This used to pin the opposite: that omitting
    // the business left the read unscoped for the public /api/ask paths, which
    // then had no tenant to give. Since the Host boundary (phase 4) they do,
    // and G35 made the argument required. What is worth pinning now is the
    // SHAPE that made it optional. MUTANT: `if (businessId) query =
    // query.eq("business_id", businessId)`. The type system stops `undefined`.
    // It does not stop an empty string from a caller whose own resolution came
    // back blank, and under the mutant that reads EVERY business's
    // conversation. Here it is filtered like any other value.
    return getConversation(SUBJECT_ID, "").then(() => {
      const record = calls.find((c) => c.table === "chat_conversations")!
      expect(eqOps(record).map(([, col]) => col)).toEqual(["id", "business_id"])
      expect(eqValue(record, "business_id")).toBe("")
    })
  })
```
Append at the end of the file. Before:
```ts
    result = { data: null, error: { code: "PGRST301", message: "boom" } }
    return expect(readOpportunityForGrant(SUBJECT_ID, BUSINESS)).rejects.toBeTruthy()
  })
})
```
after:
```ts
    result = { data: null, error: { code: "PGRST301", message: "boom" } }
    return expect(readOpportunityForGrant(SUBJECT_ID, BUSINESS)).rejects.toBeTruthy()
  })
})

describe("readContactIdentity (G35)", () => {
  it("fences the read to the business it was given", () => {
    // MUTANT: dropping `.eq("business_id", businessId)`. Both callers hold a
    // contact id taken off another row (a chat conversation, a won
    // opportunity). The chat's conversation read had no predicate until G35,
    // and this read inherited that hole silently. The predicate makes "this
    // contact is that business's" true here, not only in the caller.
    return readContactIdentity(BUSINESS, SUBJECT_ID).then(() => {
      const record = calls.find((c) => c.table === "contacts")
      expect(record).toBeDefined()
      expect(eqValue(record!, "business_id")).toBe(BUSINESS)
      expect(eqValue(record!, "id")).toBe(SUBJECT_ID)
    })
  })

  it("does not silently scope to the singleton instead", () => {
    return readContactIdentity(BUSINESS, SUBJECT_ID).then(() => {
      const record = calls.find((c) => c.table === "contacts")!
      expect(eqValue(record, "business_id")).not.toBe(SINGLETON_BUSINESS_ID)
    })
  })

  it("returns the name and email it found — the presence control", async () => {
    result = { data: { email: "athlete@example.test", name: "Sam" }, error: null }
    await expect(readContactIdentity(BUSINESS, SUBJECT_ID)).resolves.toEqual({
      email: "athlete@example.test",
      name: "Sam",
    })
  })

  it("answers null for no row, and throws on a failed read rather than reading as 'no contact'", async () => {
    await expect(readContactIdentity(BUSINESS, SUBJECT_ID)).resolves.toBeNull()
    result = { data: null, error: { code: "PGRST301", message: "boom" } }
    await expect(readContactIdentity(BUSINESS, SUBJECT_ID)).rejects.toThrow(/contacts read failed/)
  })
})
```

`__tests__/api/ask.test.ts`. Hoisted spies, before:
```ts
  runEscalation: vi.fn(),
  recordAudit: vi.fn(),
  outcome: {
```
after:
```ts
  runEscalation: vi.fn(),
  recordAudit: vi.fn(),
  // G35: a spy, so "resolved once, before the read" is countable.
  resolvePublicTenant: vi.fn(),
  // G35: the booking-prefill read, so its tenant argument is observable.
  readContactIdentity: vi.fn(),
  outcome: {
```
Mock. Before:
```ts
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))
```
after:
```ts
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: h.resolvePublicTenant }))
// Mocked since G35: the route's prefill read was reaching the real pipeline DAL
// whenever a fixture carried a contact_id.
vi.mock("@/lib/db/pipeline", () => ({ readContactIdentity: h.readContactIdentity }))
```
Helpers. Before:
```ts
function appended(role: "user" | "assistant") {
  return h.appendMessage.mock.calls.map((c) => c[0]).filter((a) => a.role === role)
}
```
after:
```ts
function appended(role: "user" | "assistant") {
  return h.appendMessage.mock.calls.map((c) => c[0]).filter((a) => a.role === role)
}

/** What `resolvePublicTenant()` answers in every test unless one says otherwise. */
const HOST_BUSINESS = "host-biz"

/**
 * The DAL's contract, modelled rather than canned: a conversation comes back
 * only under ITS OWN business. `undefined` is modelled as the pre-G35 optional
 * signature ("any tenant"), so a route that stops passing the Host's tenant
 * gets the foreign row back and goes red. An argument-blind mock would let it
 * pass.
 */
function storedUnder(row: ChatConversation) {
  return async (id: string, businessId?: string) =>
    id === row.id && (businessId === undefined || businessId === row.business_id) ? row : null
}
```
`beforeEach`. Before:
```ts
  h.recordAudit.mockResolvedValue(undefined)

  h.outcome = { facts: [], cards: [], wantsCapture: false, wantsEscalate: false }
```
after:
```ts
  h.recordAudit.mockResolvedValue(undefined)
  h.resolvePublicTenant.mockResolvedValue(HOST_BUSINESS)
  h.readContactIdentity.mockResolvedValue(null)

  h.outcome = { facts: [], cards: [], wantsCapture: false, wantsEscalate: false }
```
The existing test at `:629` stays. Its comment gains a paragraph. Before:
```ts
  // is the presence control: if the route re-derived resolvePublicTenant()
  // for appendMessage instead of reading it off the conversation it already
  // has, this business id would never show up in any appendMessage call.
```
after:
```ts
  // is the presence control: if the route re-derived resolvePublicTenant()
  // for appendMessage instead of reading it off the conversation it already
  // has, this business id would never show up in any appendMessage call.
  //
  // Since G35 the real read is fenced to the Host, so a conversation whose
  // business differs from the Host's can no longer come back from it. The
  // mock here is argument-blind ON PURPOSE: that is the only way to make the
  // two values differ, and the difference is what this test reads.
```
Append at the end of the file. Before:
```ts
  it("does not add one to an injury refusal, which never reaches the model", async () => {
    // MUTANT KILLED: adding it on the short-circuit path. That reply already
    // says a person will pick it up; a booking link beside it reads as a way
    // to pay for the answer they were just refused.
    const res = await POST(req({ message: "my shoulder hurts when I throw, what should I do?" }))
    const body = await res.json()

    expect(body.reply).toBe(REFUSAL_INJURY)
    expect(body.cards).toEqual([])
  })
})
```
after: the same block unchanged, followed by:
```ts

describe("POST /api/ask — an existing conversation is read under the Host's tenant (G35)", () => {
  const OTHER_BUSINESS = "44444444-4444-4444-8444-444444444444"

  it("reads the conversation under the tenant the Host resolves to", async () => {
    // MUTANT: `getConversation(requestedId)`, the id-only read this route
    // shipped with. Another business's conversation id would then continue
    // that business's conversation from this host, under its settings and
    // facts.
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: HOST_BUSINESS })))

    await POST(req({ conversationId: CONVERSATION_ID, message: "hi" }))

    expect(h.getConversation).toHaveBeenCalledWith(CONVERSATION_ID, HOST_BUSINESS)
  })

  it("treats another business's conversation id as unknown: the same 404, no model, nothing written", async () => {
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: OTHER_BUSINESS })))

    const res = await POST(req({ conversationId: CONVERSATION_ID, message: "hi" }))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: "That conversation has expired. Start a new one and I'll pick it up from there.",
    })
    expect(h.listMessages).not.toHaveBeenCalled()
    expect(h.appendMessage).not.toHaveBeenCalled()
    // Not silently replaced with a fresh conversation either. The visitor starts one.
    expect(h.createConversation).not.toHaveBeenCalled()
    expect(h.runWithTools).not.toHaveBeenCalled()
  })

  it("answers the same conversation when it IS this Host's — the presence control for the test above", async () => {
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: HOST_BUSINESS })))

    const res = await POST(req({ conversationId: CONVERSATION_ID, message: "hi" }))

    expect(res.status).toBe(200)
    expect(h.listMessages).toHaveBeenCalledWith(CONVERSATION_ID)
    expect(h.runWithTools).toHaveBeenCalled()
  })

  it("resolves the Host for an EXISTING conversation too — once", async () => {
    // MUTANT: resolving only on the create path, as before G35. The read
    // above would then have no tenant to be fenced to.
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: HOST_BUSINESS })))

    await POST(req({ conversationId: CONVERSATION_ID, message: "hi" }))

    expect(h.resolvePublicTenant).toHaveBeenCalledTimes(1)
  })

  it("stamps a new conversation with the SAME answer — one resolution per request, not two", async () => {
    // MUTANT: a second `resolvePublicTenant()` left at the createConversation
    // site. Two lookups in one request are two answers that can disagree.
    h.resolvePublicTenant.mockResolvedValueOnce(HOST_BUSINESS).mockResolvedValueOnce("a-second-answer")

    await POST(req({ message: "hi" }))

    expect(h.resolvePublicTenant).toHaveBeenCalledTimes(1)
    expect(h.createConversation).toHaveBeenCalledWith(expect.objectContaining({ businessId: HOST_BUSINESS }))
  })

  it("does not resolve the Host for a request the per-origin limit already refused", async () => {
    // MUTANT: resolving above the message count. A flood the database count
    // refuses must not also buy a business_domains read per request.
    h.countRecentMessagesByIp.mockResolvedValue(MAX_MESSAGES_PER_IP_PER_HOUR)

    const res = await POST(req({ message: "hi" }))

    expect(res.status).toBe(429)
    expect(h.resolvePublicTenant).not.toHaveBeenCalled()
  })

  it("hands the escalation the conversation's own business", async () => {
    // MUTANT: `runEscalation({ conversationId, summary })` with no business,
    // the shape this route had. runEscalation then read the row by id alone.
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: HOST_BUSINESS })))
    h.outcome = { facts: [], cards: [], wantsCapture: false, wantsEscalate: true, escalateSummary: "Wants a person" }

    await POST(req({ conversationId: CONVERSATION_ID, message: "can someone call me?" }))

    expect(h.runEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION_ID, businessId: HOST_BUSINESS }),
    )
  })

  it("reads the visitor's contact for the booking prefill under the conversation's business", async () => {
    // MUTANT: `readContactIdentity(conversation.contact_id)`, the one-argument
    // id-only read this had before G35.
    h.getConversation.mockImplementation(
      storedUnder(conversation({ business_id: HOST_BUSINESS, contact_id: "contact-7" })),
    )
    h.readContactIdentity.mockResolvedValue({ email: "visitor@example.com", name: "Visitor" })

    await POST(req({ conversationId: CONVERSATION_ID, message: "what do you offer?" }))

    expect(h.readContactIdentity).toHaveBeenCalledWith(HOST_BUSINESS, "contact-7")
    expect(h.createToolExecutor.mock.calls[0][0].visitor).toEqual({ email: "visitor@example.com", name: "Visitor" })
  })

  it("reads no contact for a conversation nobody was captured on — the absence beside the presence above", async () => {
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: HOST_BUSINESS })))

    await POST(req({ conversationId: CONVERSATION_ID, message: "what do you offer?" }))

    expect(h.readContactIdentity).not.toHaveBeenCalled()
  })
})
```

`__tests__/api/ask-capture.test.ts`. Hoisted spies, before:
```ts
const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getConversation: vi.fn(),
```
after:
```ts
const h = vi.hoisted(() => ({
  getSetting: vi.fn(),
  // G35: the route resolves the Host before it reads the conversation.
  resolvePublicTenant: vi.fn(),
  getConversation: vi.fn(),
```
Mock. Before:
```ts
vi.mock("@/lib/audit/record", () => ({ recordAudit: h.recordAudit }))

import { createHash } from "crypto"
```
after:
```ts
vi.mock("@/lib/audit/record", () => ({ recordAudit: h.recordAudit }))
// The ONE Host boundary. Required since G35: the real one calls `headers()`,
// which throws outside a request scope.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: h.resolvePublicTenant }))

import { createHash } from "crypto"
```
`beforeEach`. Before:
```ts
  h.getBusinessSettings.mockResolvedValue(SETTINGS)
  h.recordAudit.mockResolvedValue(undefined)
})
```
after:
```ts
  h.getBusinessSettings.mockResolvedValue(SETTINGS)
  h.recordAudit.mockResolvedValue(undefined)
  h.resolvePublicTenant.mockResolvedValue("host-biz")
})
```
Append at the end of the file. Before:
```ts
    expect(smsRows()[0]).toEqual(expect.objectContaining({ businessId: OTHER_BUSINESS_ID, source: "ai_chat" }))
  })
})
```
after: the same, followed by:
```ts

// ---------------------------------------------------------------------------
// G35: the conversation is read under the Host's tenant.
//
// Before G35 this route read the conversation by id alone. A conversation id
// from ANOTHER business's site therefore filed a contact, and consent rows,
// under that business from this one's host, and the only thing in the way was
// that the id is an unguessable UUID.
// ---------------------------------------------------------------------------
describe("POST /api/ask/capture — the conversation is read under the Host's tenant (G35)", () => {
  const HOST = "host-biz"
  const OTHER = "33333333-3333-4333-8333-333333333333"

  /** A row answers only under its own business; `undefined` is the pre-G35 "any tenant" read. */
  function storedUnder(row: ChatConversation) {
    return async (id: string, businessId?: string) =>
      id === row.id && (businessId === undefined || businessId === row.business_id) ? row : null
  }

  it("reads the conversation under the tenant the Host resolves to", async () => {
    // MUTANT: `getConversation(conversationId)`, the id-only read.
    await POST(req(submission()))

    expect(h.resolvePublicTenant).toHaveBeenCalledTimes(1)
    expect(h.getConversation).toHaveBeenCalledWith(CONVERSATION_ID, HOST)
  })

  it("answers another business's conversation id with the same 404 as an unknown one, and writes nothing", async () => {
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: OTHER })))

    const res = await POST(req(submission({ marketingConsent: true, smsConsent: true })))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: "That conversation has expired. Start a new one and I'll pick it up from there.",
    })
    expect(h.captureLead).not.toHaveBeenCalled()
    expect(h.markCaptured).not.toHaveBeenCalled()
    expect(h.recordConsent).not.toHaveBeenCalled()
  })

  it("captures the same conversation when it IS the Host's — the presence control, filed under that business", async () => {
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: HOST })))

    const res = await POST(req(submission()))

    expect(res.status).toBe(200)
    expect(h.captureLead).toHaveBeenCalledWith(expect.objectContaining({ businessId: HOST }))
  })

  it("does not resolve the Host for a request the limiter already refused", async () => {
    // MUTANT: resolving at the top of the handler. The pre-filter and the
    // count exist so a flood costs no database read, and the Host lookup IS
    // one (business_domains).
    h.countRecentConversationsByIp.mockResolvedValue(MAX_CONVERSATIONS_PER_IP_PER_HOUR)

    const res = await POST(req(submission()))

    expect(res.status).toBe(429)
    expect(h.resolvePublicTenant).not.toHaveBeenCalled()
  })
})
```

`__tests__/lib/lead-engine/chat-escalate.test.ts`. Add a constant. Before:
```ts
  brand_color: null,
  accent_color: null,
}

function conversation(over: Partial<ChatConversation> = {}): ChatConversation {
```
after:
```ts
  brand_color: null,
  accent_color: null,
}

/** The business every call below is handed: the fixture conversation's own, so the default read finds it. */
const BUSINESS = SETTINGS.business_id

function conversation(over: Partial<ChatConversation> = {}): ChatConversation {
```
Then two exact-string edits:
- `replace_all: true`: `runEscalation({ conversationId: "c1", summary:` becomes `runEscalation({ conversationId: "c1", businessId: BUSINESS, summary:`. This covers the 16 "c1" calls.
- `runEscalation({ conversationId: "nope", summary: "s" })` becomes `runEscalation({ conversationId: "nope", businessId: BUSINESS, summary: "s" })`.

Append at the end. Before:
```ts
    expect(logged).toContain("23514")
    expect(logged).toContain("new row violates check constraint")
  })
})
```
after: the same, followed by:
```ts

describe("runEscalation — the conversation is read in the caller's business (G35)", () => {
  const OTHER = "55555555-5555-4555-8555-555555555555"

  /** A row answers only under its own business; `undefined` is the pre-G35 "any tenant" read. */
  function storedUnder(row: ChatConversation) {
    return async (id: string, businessId?: string) =>
      id === row.id && (businessId === undefined || businessId === row.business_id) ? row : null
  }

  it("reads the conversation under the business it was handed", async () => {
    // MUTANT: `getConversation(conversationId)`, the id-only read this
    // function shipped with. It fell back to the row's own business after.
    await runEscalation({ conversationId: "c1", businessId: BUSINESS, summary: "s" })

    expect(h.getConversation).toHaveBeenCalledWith("c1", BUSINESS)
  })

  it("does not hand over another business's conversation: not found, nothing written, nobody emailed", async () => {
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: OTHER, contact_id: "contact-7" })))

    const out = await runEscalation({ conversationId: "c1", businessId: BUSINESS, summary: "s" })

    expect(out).toEqual({ ok: false, reason: "conversation_not_found" })
    expect(h.markEscalated).not.toHaveBeenCalled()
    expect(h.sendChatEscalationEmail).not.toHaveBeenCalled()
    expect(h.inserts).toHaveLength(0)
    expect(h.recordAudit).not.toHaveBeenCalled()
  })

  it("hands it over when it IS the caller's — the presence control, filed under that business", async () => {
    h.getConversation.mockImplementation(storedUnder(conversation({ business_id: OTHER, contact_id: "contact-7" })))

    const out = await runEscalation({ conversationId: "c1", businessId: OTHER, summary: "s" })

    expect(out).toMatchObject({ ok: true })
    expect(h.sendChatEscalationEmail.mock.calls[0][0].businessId).toBe(OTHER)
    expect(h.inserts.find((i) => i.table === "contact_timeline_events")!.row.business_id).toBe(OTHER)
  })
})
```

`__tests__/app/api/admin/pipeline/grant-route.test.ts`. Before:
```ts
const listGrantableProgramsMock = vi.fn()
```
after:
```ts
const listGrantableProgramsMock = vi.fn()
const readContactIdentityMock = vi.fn()
```
Before: `  readContactIdentity: vi.fn(),`
After: `  readContactIdentity: (...a: unknown[]) => readContactIdentityMock(...a),`

Insert after the existing "reads the opportunity in the CALLER'S business" test. Before:
```ts
    expect(readOpportunityForGrantMock).toHaveBeenCalledWith(OPPORTUNITY_ID, BUSINESS_ID)
    const [, passed] = readOpportunityForGrantMock.mock.calls[0]
    expect(passed).not.toBe(SINGLETON)
    expect(passed).not.toBeUndefined()
  })
```
after: the same, followed by:
```ts

  it("reads the athlete's identity in the CALLER'S business too (G35)", async () => {
    // MUTANT: `getContactIdentity: readContactIdentity`, the direct port wiring
    // this route had before G35. With the business now first, that hands the
    // contact id in AS the business. It is a tsc error, but vitest does not
    // run tsc.
    authMock.mockResolvedValue(COACH_SESSION)
    await POST(req(validBody) as never, NO_PARAMS)

    const deps = grantWonOpportunityMock.mock.calls[0][1] as {
      getContactIdentity: (id: string) => Promise<unknown>
    }
    await deps.getContactIdentity("contact-1")

    expect(readContactIdentityMock).toHaveBeenCalledWith(BUSINESS_ID, "contact-1")
  })
```

- [ ] **Step 2: Run it and watch it fail**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/db/coach-scoped-reads.test.ts __tests__/api/ask.test.ts __tests__/api/ask-capture.test.ts __tests__/lib/lead-engine/chat-escalate.test.ts __tests__/app/api/admin/pipeline/grant-route.test.ts`

These should fail:
- coach-scoped-reads:
  - "applies the predicate UNCONDITIONALLY": the columns are `["id"]`, not `["id","business_id"]`.
  - readContactIdentity "fences the read" and "does not silently scope": `business_id` is undefined, and `id` equals BUSINESS.
- ask.test:
  - "reads the conversation under…": called with `(CONVERSATION_ID)` only.
  - "treats another business's…": the unscoped read returns the row, so the status is 200.
  - "resolves the Host for an EXISTING conversation too": 0 calls.
  - "hands the escalation…": no `businessId`.
  - "reads the visitor's contact…": called with `("contact-7")`.
- ask-capture:
  - "reads the conversation under…": 0 resolves, one-argument read.
  - "answers another business's…": status 200.
- chat-escalate: "reads the conversation under…" and "does not hand over another business's…" (`ok: true`).
- grant-route: "reads the athlete's identity…": called with `("contact-1")`.

These pass already and guard ordering or act as controls, which is expected:
- ask.test: "stamps a new conversation with the SAME answer", "does not resolve the Host for a request the per-origin limit already refused", and the two presence controls.
- ask-capture: "does not resolve the Host for a request the limiter already refused" and its presence control.
- chat-escalate: the presence control.
- coach-scoped-reads: "returns the name and email…" and "answers null… throws…".

- [ ] **Step 3: Implement**

`lib/db/chat.ts`. Stale doc, before:
```ts
   * whole feature. The public route has no session and no Host resolution yet
   * (phase 4), so it passes `platformBusinessId()` (lib/tenancy/platform.ts)
   * rather than deciding a tenant it cannot actually resolve.
   */
  businessId: string
```
after:
```ts
   * whole feature. The public route resolves it from the request's Host
   * (lib/tenancy/public.ts), and reads an EXISTING conversation under the same
   * answer. See `getConversation`.
   */
  businessId: string
```
Before (both stacked doc comments, the signature and the first body lines):
```ts
/**
 * `null` means the row is not there. A failed READ throws, because "the
 * database was unreachable" and "no such conversation" are different answers
 * and a caller that conflates them turns an outage into a silent new session.
 */
/**
 * One conversation by id.
 *
 * `businessId` is OPTIONAL and omitting it means "any tenant", which is correct
 * for exactly three callers and wrong for every future one:
 *   - app/api/ask/route.ts and app/api/ask/capture/route.ts are PUBLIC. A
 *     website visitor resolves their own conversation by the id in their
 *     session before anyone knows which business it belongs to -- the row is
 *     what CARRIES that answer, so requiring it as an argument is circular.
 *   - lib/lead-engine/chat/escalate.ts already holds a conversation the caller
 *     located by other means.
 *
 * EVERY ADMIN CALLER MUST PASS IT. Until 2026-09-04 this function had no
 * business predicate at all and app/(admin)/admin/chat/[id]/page.tsx called it
 * with a UUID straight from the URL bar. That was safe only because
 * `/admin/chat` was unmapped in PATH_PERMISSIONS and the proxy default-denied
 * staff; the moment that page became reachable it would have been one coach
 * reading another coach's website-visitor conversations by guessing an id.
 *
 * Optional rather than required for the same reason `getBusinessSettings` keeps
 * its default: the public callers legitimately have no tenant to give.
 */
export async function getConversation(id: string, businessId?: string): Promise<ChatConversation | null> {
  let query = getClient().from("chat_conversations").select("*").eq("id", id)
  if (businessId) query = query.eq("business_id", businessId)
  const { data, error } = await query.maybeSingle()
```
after:
```ts
/**
 * One conversation by id, IN ONE BUSINESS. `null` means the row is not there,
 * or is another business's. That is the same answer on purpose: telling a
 * caller the id exists elsewhere is a disclosure.
 *
 * A failed READ throws, because "the database was unreachable" and "no such
 * conversation" are different answers, and a caller that conflates them turns
 * an outage into a silent new session.
 *
 * `businessId` is REQUIRED and ALWAYS applied (G35). It used to be optional,
 * behind `if (businessId)`, because the public callers had no tenant to give:
 * the row was what CARRIED the answer. That predated the Host boundary
 * (lib/tenancy/public.ts, phase 4), and every caller has one now:
 *   - app/api/ask/route.ts and app/api/ask/capture/route.ts resolve the
 *     request's Host first and read under it, so a conversation id from
 *     another business's site reads as unknown.
 *   - lib/lead-engine/chat/escalate.ts is handed `conversation.business_id` by
 *     its one caller.
 *   - app/(admin)/admin/chat/[id]/page.tsx passes the admin tenant. It has done
 *     so since 2026-09-04, when a UUID from the URL bar reached this with no
 *     predicate at all, safe only because the proxy default-denied staff.
 * An optional tenant is how a public caller came to pass none. A blank tenant
 * is not "any tenant" either: an empty string is filtered like any other value
 * and matches nothing.
 */
export async function getConversation(id: string, businessId: string): Promise<ChatConversation | null> {
  const { data, error } = await getClient()
    .from("chat_conversations")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle()
```

`lib/db/pipeline.ts`. Before:
```ts
/**
 * Where to send the invite. Null email is a refusal upstream, never a guess —
 * an account nobody can be told about helps no one.
 */
export async function readContactIdentity(
  contactId: string,
): Promise<{ email: string | null; name: string | null } | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contacts")
    .select("email, name")
    .eq("id", contactId)
    .maybeSingle()
```
after:
```ts
/**
 * Where to send the invite, or whom the chat's booking link is prefilled for.
 * Null email is a refusal upstream, never a guess: an account nobody can be
 * told about helps no one.
 *
 * `businessId` FIRST and REQUIRED (G35). Both callers hold a contact id they
 * took off another row that was scoped to this business: the won opportunity
 * (app/api/admin/pipeline/grant/route.ts) and the chat conversation
 * (app/api/ask/route.ts, read under the Host). On correct data the predicate
 * changes nothing. It is here anyway because "the caller's row was scoped" is
 * a property of the caller. The chat's conversation read was not scoped at
 * all until G35, and this read inherited that hole silently. `contacts`
 * carries its own business_id, so the answer can be true locally.
 */
export async function readContactIdentity(
  businessId: string,
  contactId: string,
): Promise<{ email: string | null; name: string | null } | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contacts")
    .select("email, name")
    .eq("business_id", businessId)
    .eq("id", contactId)
    .maybeSingle()
```

`lib/lead-engine/chat/escalate.ts`. Before:
```ts
  summary: string
  businessId?: string
}
```
after:
```ts
  summary: string
  /**
   * The business the conversation belongs to. REQUIRED since G35, and the
   * conversation is READ under it, so an id alone is never enough to hand a
   * conversation to a person. The one caller (app/api/ask/route.ts) passes
   * `conversation.business_id` off the row it read under the request's Host.
   *
   * It used to be optional, falling back to the row's own column after an
   * id-only read. That is how the caller came to pass nothing at all.
   */
  businessId: string
}
```
Before:
```ts
  const { conversationId, summary } = input

  const conversation = await getConversation(conversationId)
  if (!conversation) return { ok: false, reason: "conversation_not_found" }
  if (conversation.escalated_at !== null) return { ok: false, reason: "already_escalated" }

  const businessId = input.businessId ?? conversation.business_id
  const contactId = conversation.contact_id
```
after:
```ts
  const { businessId, conversationId, summary } = input

  // Another business's conversation is `conversation_not_found`, the same
  // answer as one that does not exist (G35).
  const conversation = await getConversation(conversationId, businessId)
  if (!conversation) return { ok: false, reason: "conversation_not_found" }
  if (conversation.escalated_at !== null) return { ok: false, reason: "already_escalated" }

  const contactId = conversation.contact_id
```

`app/api/ask/route.ts`. Before:
```ts
async function handOver(conversationId: string, summary: string | undefined, message: string): Promise<string | null> {
  const written = summary?.trim()
  try {
    const result = await runEscalation({
      conversationId,
```
after:
```ts
async function handOver(
  businessId: string,
  conversationId: string,
  summary: string | undefined,
  message: string,
): Promise<string | null> {
  const written = summary?.trim()
  try {
    const result = await runEscalation({
      // `conversation.business_id`, threaded rather than re-resolved: the row
      // was read under the Host, and `runEscalation` reads it again under
      // this, so an id alone never hands a conversation to a person (G35).
      businessId,
      conversationId,
```
Before:
```ts
  let conversation: ChatConversation | null = null
  try {
    if ((await countRecentMessagesByIp(ipHash, sinceIso)) >= MAX_MESSAGES_PER_IP_PER_HOUR) {
      return NextResponse.json({ error: COPY.tooFast }, { status: 429 })
    }

    if (requestedId) {
      // A failed READ is not an absent row: `getConversation` throws on error
      // and returns null only for "no such row". Telling a visitor their
      // conversation expired during an outage sends them straight back into it.
      conversation = await getConversation(requestedId)
```
after:
```ts
  let conversation: ChatConversation | null = null
  // THE HOST'S TENANT, RESOLVED ONCE, BEFORE ANY CONVERSATION IS READ (G35).
  // It used to be resolved only when a conversation was CREATED, and an
  // existing one was read by its id alone. A conversation id from another
  // business's site therefore continued that business's conversation from this
  // host, under that business's settings and facts. Now the read is fenced to
  // this Host, and a new conversation is stamped with the same answer. It runs
  // after the per-origin message count, so a request that count refuses costs
  // no lookup.
  let hostBusinessId: string
  try {
    if ((await countRecentMessagesByIp(ipHash, sinceIso)) >= MAX_MESSAGES_PER_IP_PER_HOUR) {
      return NextResponse.json({ error: COPY.tooFast }, { status: 429 })
    }

    hostBusinessId = await resolvePublicTenant()

    if (requestedId) {
      // A failed READ is not an absent row: `getConversation` throws on error
      // and returns null only for "no such row". Telling a visitor their
      // conversation expired during an outage sends them straight back into it.
      //
      // Another business's conversation is ALSO null, and gets the same "that
      // conversation has expired": saying it exists elsewhere would be a
      // disclosure. It is not silently swapped for a new conversation either.
      // The visitor starts one.
      conversation = await getConversation(requestedId, hostBusinessId)
```
Before:
```ts
    if (!conversation) {
      // PUBLIC ROUTE, NO SESSION. This is the one place a conversation's
      // tenant is DECIDED; it is resolved from the request's Host by
      // lib/tenancy/public.ts (business_domains). Once the row exists, every
      // later call in this route threads `conversation.business_id` instead.
      const businessId = await resolvePublicTenant()
      conversation = await createConversation({
        businessId,
```
after:
```ts
    if (!conversation) {
      // PUBLIC ROUTE, NO SESSION. This is the one place a conversation's
      // tenant is DECIDED: the Host's, resolved above through
      // lib/tenancy/public.ts (business_domains) and NOT resolved a second
      // time here, because two lookups in one request are two answers that
      // could disagree. Once the row exists, every later call in this route
      // threads `conversation.business_id` instead.
      conversation = await createConversation({
        businessId: hostBusinessId,
```
Before: `    const note = await handOver(conversationId, outcome.escalateSummary, message)`
After: `    const note = await handOver(conversation.business_id, conversationId, outcome.escalateSummary, message)`

Before:
```ts
  if (conversation.contact_id) {
    try {
      visitor = await readContactIdentity(conversation.contact_id)
```
after:
```ts
  if (conversation.contact_id) {
    try {
      // Under the conversation's business (G35). The contact id came off that
      // row, and this read is fenced to it too.
      visitor = await readContactIdentity(conversation.business_id, conversation.contact_id)
```

`app/api/ask/capture/route.ts`. Before:
```ts
import { rateLimit } from "@/lib/shop/rate-limit"
import { askCaptureSchema } from "@/lib/validators/chat"
```
after:
```ts
import { rateLimit } from "@/lib/shop/rate-limit"
import { resolvePublicTenant } from "@/lib/tenancy/public"
import { askCaptureSchema } from "@/lib/validators/chat"
```
Before:
```ts
  // 5. The conversation. A FAILED READ IS NOT AN ABSENT ROW: `getConversation`
  //    throws on a read error and returns null only for "no such row", so the
  //    two answers stay apart. Reporting an outage as "that conversation has
  //    expired" would tell the visitor to start again into the same outage.
  let conversation
  try {
    conversation = await getConversation(conversationId)
  } catch (err) {
```
after:
```ts
  // 5. The conversation, READ UNDER THE HOST'S TENANT (G35). Until G35 it was
  //    read by id alone, so a conversation id from another business's site
  //    filed a contact, and consent rows, under that business from this one's
  //    host. The Host is resolved HERE, after the limits, so a refused request
  //    costs no lookup. Another business's conversation answers the same 404
  //    as one that does not exist. The `conversation.business_id` every write
  //    below files under is therefore the Host's by construction.
  //
  //    A FAILED READ IS NOT AN ABSENT ROW: `getConversation` throws on a read
  //    error and returns null only for "no such row", so the two answers stay
  //    apart. Reporting an outage as "that conversation has expired" would
  //    tell the visitor to start again into the same outage.
  let conversation
  try {
    const hostBusinessId = await resolvePublicTenant()
    conversation = await getConversation(conversationId, hostBusinessId)
  } catch (err) {
```

`app/api/admin/pipeline/grant/route.ts`. Before: `        getContactIdentity: readContactIdentity,`
after:
```ts
        // Fenced to the same tenant as the opportunity it came off (G35).
        // Passing the DAL function straight through no longer type-checks,
        // because it takes the business first.
        getContactIdentity: (contactId: string) => readContactIdentity(businessId, contactId),
```

`app/(marketing)/ask/page.tsx`. Before:
```tsx
  // PUBLIC, NO SESSION. The tenant is resolved from the request's Host by
  // lib/tenancy/public.ts: this page shows the Host's business. POST
  // /api/ask/capture does not read the Host at all — it files under the
  // conversation's business_id, decided once when POST /api/ask created the
  // conversation from this same origin. The two agree TRANSITIVELY, not
  // because they share one resolution: the name shown here and the wording
  // filed there both trace back to the same Host, one hop apart.
```
after:
```tsx
  // PUBLIC, NO SESSION. The tenant is resolved from the request's Host by
  // lib/tenancy/public.ts: this page shows the Host's business. Since G35
  // POST /api/ask/capture reads the conversation UNDER that same Host before
  // it files anything, so a conversation from another business's site is
  // refused there, and the business_id it files under is the Host's by
  // construction. The name shown here and the wording filed there now come
  // from the same resolution. Before G35 they agreed only transitively,
  // through the origin POST /api/ask created the conversation from.
```

`lib/tenancy/public.ts`. Before (lines 80-90):
```ts
 *     app/api/ask/route.ts             (createConversation; the rest of that
 *                                       route threads conversation.business_id)
 *   The pages and server components that render the consent wording those
 *   routes file, which must name the SAME business the route files under.
 *   For camps/clinics and the two form/quiz islands that holds because both
 *   sides read the Host directly. app/(marketing)/ask/page.tsx is the one
 *   exception: it resolves the Host's business itself, but POST
 *   /api/ask/capture never reads the Host — it inherits
 *   conversation.business_id, set once when POST /api/ask created the
 *   conversation from the same origin. The two still agree, TRANSITIVELY
 *   through that shared origin, not because they share one resolution:
```
after:
```ts
 *     app/api/ask/route.ts             (createConversation; the rest of that
 *                                       route threads conversation.business_id.
 *                                       Since G35 it resolves BEFORE reading
 *                                       an existing conversation too, and
 *                                       reads it under the Host, so another
 *                                       business's conversation id is unknown)
 *   One route that resolves only to FENCE a read, never to decide a tenant
 *   (G35). It reads the visitor's conversation under the Host, so a
 *   conversation id from another business's site answers the same 404 as an
 *   unknown one. It then files under conversation.business_id, which that
 *   fenced read makes the Host's tenant by construction:
 *     app/api/ask/capture/route.ts
 *   The pages and server components that render the consent wording those
 *   routes file, which must name the SAME business the route files under.
 *   For camps/clinics and the two form/quiz islands that holds because both
 *   sides read the Host directly. Since G35 app/(marketing)/ask/page.tsx holds
 *   for the same reason: POST /api/ask/capture now reads the Host too (above).
 *   Before G35 it did not, and the page and the route agreed only
 *   TRANSITIVELY, through the origin POST /api/ask created the conversation
 *   from:
```

- [ ] **Step 4: Run it and watch it pass**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/db/coach-scoped-reads.test.ts __tests__/api/ask.test.ts __tests__/api/ask-capture.test.ts __tests__/lib/lead-engine/chat-escalate.test.ts __tests__/app/api/admin/pipeline/grant-route.test.ts __tests__/lib/tenancy/public-inventory.test.ts __tests__/lib/tenancy/platform-inventory.test.ts __tests__/lib/lead-engine/no-brand-literals.test.ts __tests__/lib/lead-engine/chat-refusals.test.ts __tests__/lib/lead-engine/chat-writes.test.ts __tests__/lib/lead-engine/chat-admin-list.test.ts __tests__/app/admin/chat-page-tenancy.test.tsx __tests__/app/admin/detail-page-tenancy.test.tsx __tests__/components/admin/ChatTranscript.test.tsx __tests__/components/admin/ChatTable.test.tsx __tests__/app/ask-page.test.tsx __tests__/api/admin/internal/sequence-tick.test.ts __tests__/api/admin/pipeline-move.test.ts __tests__/api/quiz-submit-funnel-lead.test.ts __tests__/api/quiz-submit.test.ts __tests__/api/spine/inquiry-pipeline.test.ts __tests__/api/spine/purchase-spine.test.ts __tests__/api/stripe/webhook-abandoned-checkout-purchase-guard.test.ts __tests__/api/stripe/webhook-capture-tenant.test.ts __tests__/api/stripe/webhook-contact-source.test.ts __tests__/api/stripe/webhook-funnel-purchase.test.ts __tests__/api/webhooks/pipeline-hooks.test.ts __tests__/app/admin/pipeline-page-tenancy.test.tsx __tests__/app/api/admin/pipeline/boards-route.test.ts __tests__/app/api/admin/pipeline/stages-route.test.ts __tests__/components/admin/new-card-dialog.test.tsx __tests__/components/admin/pipeline-board.test.tsx __tests__/components/admin/pipeline-settings.test.tsx __tests__/db/pipeline-boards.test.ts __tests__/db/pipeline.test.ts __tests__/lib/automation/pipeline-reconcile.test.ts __tests__/lib/automation/sequence-tick-side-effects.test.ts __tests__/lib/bookings/ingest-tenancy.test.ts __tests__/lib/bookings/ingest.test.ts`

Other suites that import or mock a changed module, and what they need:
- `chat-refusals.test.ts`: mocks `@/lib/db/chat` and `@/lib/tenancy/public` with argument-blind fakes, and its conversations are always new. No edit.
- `detail-page-tenancy.test.tsx` and `ChatTranscript.test.tsx`: already assert `getConversation(id, businessId)`. No edit.
- `chat-page-tenancy.test.tsx`, `chat-writes.test.ts`, `chat-admin-list.test.ts`, `ChatTable.test.tsx`: use other exports of `lib/db/chat`. No edit.
- `ask-page.test.tsx`: the page change is a comment only. No edit.
- `public-inventory.test.ts`: the forward check now needs `app/api/ask/capture/route.ts` in the inventory, which Step 3 adds. The reverse check stays green because every path in the new prose calls the boundary. No edit.
- `no-brand-literals.test.ts`: sweeps `lib/db/pipeline.ts`, `lib/lead-engine`, `app/api/ask` and `app/(marketing)/ask`. The new comments name no brand. No edit.
- The 23 `@/lib/db/pipeline` importers/mockers (sequence-tick through ingest.test above): none calls or mocks `readContactIdentity`. No edit.
- The `ask-capture.test.ts` tests with `OTHER_BUSINESS_ID` at `:292-319` and `:710-726`: argument-blind, still pass, no edit.

Mutation checks. Apply each one alone, run the named suite, watch the named test go red, then restore:
- (a) `lib/db/chat.ts`: put the predicate back behind `if (businessId)`. `coach-scoped-reads` "applies the predicate UNCONDITIONALLY" goes red.
- (b) `lib/db/pipeline.ts`: delete `.eq("business_id", businessId)`. `coach-scoped-reads` readContactIdentity "fences the read" goes red.
- (c) `app/api/ask/route.ts`: `getConversation(requestedId, undefined as never)`. `ask.test` "reads the conversation under…" and "treats another business's…" go red.
- (d) `app/api/ask/capture/route.ts`: `getConversation(conversationId, undefined as never)`. The capture "answers another business's…" test goes red.
- (e) `escalate.ts`: `getConversation(conversationId, undefined as never)`. The escalate "does not hand over another business's…" test goes red.
- (f) Grant route: `getContactIdentity: readContactIdentity as never`. The grant "reads the athlete's identity…" test goes red.

Build gate: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit -p . > <scratchpad>/tsc-task3.txt`, then `grep -E "lib/db/chat|lib/db/pipeline|chat/escalate|app/api/ask|pipeline/grant|marketing\)/ask|tenancy/public|coach-scoped-reads|ask\.test|ask-capture|chat-escalate|grant-route" <scratchpad>/tsc-task3.txt`. Expect no output. None of these files is in `.claude/baselines/tsc-ce6f2aba-perfile.txt` (main checkout), so any line is ours.

- [ ] **Step 5: Commit**

`git add lib/db/chat.ts lib/db/pipeline.ts lib/lead-engine/chat/escalate.ts app/api/ask/route.ts app/api/ask/capture/route.ts app/api/admin/pipeline/grant/route.ts "app/(marketing)/ask/page.tsx" lib/tenancy/public.ts __tests__/lib/db/coach-scoped-reads.test.ts __tests__/api/ask.test.ts __tests__/api/ask-capture.test.ts __tests__/lib/lead-engine/chat-escalate.test.ts __tests__/app/api/admin/pipeline/grant-route.test.ts`

`git commit -m "fix(chat): read conversations under the Host's tenant (G35 A3)" -m "getConversation took an optional businessId and both public chat routes passed none, so a conversation id from another business's site was continued, escalated and captured from this host, under that business. The tenant is now required and always applied: /api/ask and /api/ask/capture resolve the Host before reading, runEscalation is handed the conversation's business and reads under it, and readContactIdentity (the chat's booking prefill and the pipeline grant) is fenced to the business as well. A foreign id answers the same 404 as an unknown one." -m "Also corrects the comments in lib/tenancy/public.ts and the ask page that said the capture route never reads the Host, and adds that route to the Host boundary's inventory."`

---

### Task 4: Quizzes are read under a tenant (§A4)

**Files:**
- Modify: `lib/db/quizzes.ts:164-170` (`getQuizDefinition`), `:204-207` (`getQuizDefinitionForEditor` doc), `:559-568` (`assertQuizInBusiness` doc), `:924-926` (`getAttempt` doc)
- Modify: `app/api/quiz/progress/route.ts:73-75`, `:86-102`
- Modify: `app/api/quiz/submit/route.ts:133-152`
- Modify: `app/api/quiz/preview-submit/route.ts:27-28`, `:43-47`, `:57-58`
- Modify: `app/api/admin/quizzes/[id]/route.ts:217`, `:252-255`, `:260`
- Modify: `app/api/admin/quizzes/[id]/add-to-step/route.ts:73-78`, `:98`
- Modify: `app/api/admin/funnels/route.ts:123`, `:134-141`
- Modify: `lib/funnels/sections/resolve.ts:540`
- Modify: `components/funnels/islands/index.tsx:18-24` (`FunnelRenderContext.businessId`), `components/funnels/islands/QuizIsland.tsx:21`. QuizIsland is a caller the spec missed.
- Modify: `app/(funnel)/go/[slug]/[[...step]]/page.tsx:181-187`, `app/(funnel)/preview/[slug]/[[...step]]/page.tsx:206-207`, `app/(funnel)/funnel-preview/[stepId]/page.tsx:232-233`
- Modify: `scripts/wire-rotational-reboot-funnel.ts:60`, `:123`. A caller the spec missed; tsc covers `scripts/`.
- Modify: `lib/tenancy/public.ts:79` (the `quiz/progress` inventory line only)
- Test: `__tests__/lib/quizzes/quiz-dal.test.ts`, `__tests__/lib/quizzes/quiz-create.test.ts`, `__tests__/api/quiz-progress.test.ts`, `__tests__/api/quiz-submit.test.ts`, `__tests__/app/api/quiz/preview-submit.test.ts`, `__tests__/api/admin-quiz-save.test.ts`, `__tests__/app/api/admin/quizzes/add-to-step-tenancy.test.ts`, `__tests__/api/funnels/create-quiz-funnel.test.ts`, `__tests__/lib/funnels/load-catalogues-tenancy.test.ts`, `__tests__/lib/funnels/sections/resolve.test.ts`, `__tests__/components/funnels/quiz-island-context.test.tsx`, `__tests__/components/funnels/form-island-sms-consent.test.tsx`, `__tests__/app/funnel-go-tenancy.test.tsx`, `__tests__/app/draft-preview-route.test.tsx`, `__tests__/app/funnel-draft-preview-page.test.tsx`

**Interfaces:**
- Consumes: none. It uses the existing `resolvePublicTenant()`, `resolveAdminTenantForRequest(req): Promise<ResolvedTenant>` and `NoAccessibleBusinessError`.
- Produces:
  - `getQuizDefinition(businessId: string, quizId: string): Promise<QuizDefinition | null>`
  - `FunnelRenderContext.businessId: string` (REQUIRED). `/go` sets the Host's tenant. `/preview` and `/funnel-preview` set the admin tenant. The §B2 task must consume this field, not add it (see Notes).
  - Invariant: `/api/quiz/progress` resolves the Host first on every request. It refuses (404) an existing attempt whose `businessId` is not the Host's, before the status check. `/api/quiz/submit` still calls neither `resolvePublicTenant` nor `platformBusinessId`.

- [ ] **Step 1: Write the failing test**

`__tests__/lib/quizzes/quiz-dal.test.ts`:
- Exact-string edits, each `replace_all: true`: `getQuizDefinition("q1")` becomes `getQuizDefinition("b1", "q1")` (4 sites), and `getQuizDefinition("nope")` becomes `getQuizDefinition("b1", "nope")`.

Then, before:
```ts
  it("returns null for a quiz that does not exist, not a half-built object", async () => {
    expect(await getQuizDefinition("b1", "nope")).toBeNull()
  })
})
```
after:
```ts
  it("returns null for a quiz that does not exist, not a half-built object", async () => {
    expect(await getQuizDefinition("b1", "nope")).toBeNull()
  })

  it("answers null for another business's quiz — the id alone is not enough (G35)", async () => {
    // MUTANT: dropping `.eq("business_id", businessId)`. q1 is b1's. This mock
    // applies every `.eq` it is given, so under the mutant b2 gets b1's whole
    // definition back.
    expect(await getQuizDefinition("b2", "q1")).toBeNull()
  })

  it("filters on the business it was GIVEN — the presence control for the test above", async () => {
    const def = await getQuizDefinition("b1", "q1")
    expect(def?.id).toBe("q1")
    expect(eqCalls).toContainEqual(["business_id", "b1"])
  })
})
```

`__tests__/lib/quizzes/quiz-create.test.ts`: `replace_all: true`, `getQuizDefinition("q1")` becomes `getQuizDefinition(BUSINESS_ID, "q1")`. That is 13 sites. The string does not occur inside `getQuizDefinitionForEditor(...)`.

`__tests__/api/quiz-progress.test.ts`. Before:
```ts
const BRANCH_B = "44444444-4444-4444-8444-444444444442"
```
after:
```ts
const BRANCH_B = "44444444-4444-4444-8444-444444444442"
/** What the Host resolves to. The attempts below are stamped with it unless a test says otherwise. */
const HOST_BUSINESS = "host-biz"
```
Before:
```ts
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "host-biz" }))
```
after:
```ts
// A spy rather than a fixed arrow since G35, so "resolved once" is countable.
const resolvePublicTenant = vi.fn()
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: (...a: unknown[]) => resolvePublicTenant(...a) }))
```
Before:
```ts
  getQuizDefinition.mockResolvedValue(definition())
  createAttempt.mockResolvedValue(ATTEMPT_ID)
  saveAttemptProgress.mockResolvedValue(undefined)
  getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: QUIZ_ID, branchId: null, status: "in_progress", answers: [] })
})
```
after:
```ts
  resolvePublicTenant.mockResolvedValue(HOST_BUSINESS)
  getQuizDefinition.mockResolvedValue(definition())
  createAttempt.mockResolvedValue(ATTEMPT_ID)
  saveAttemptProgress.mockResolvedValue(undefined)
  // Stamped with the Host's business: since G35 the route refuses an attempt
  // carrying any other (see the G35 block at the end).
  getAttempt.mockResolvedValue({
    id: ATTEMPT_ID,
    quizId: QUIZ_ID,
    branchId: null,
    status: "in_progress",
    answers: [],
    businessId: HOST_BUSINESS,
  })
})
```
Before:
```ts
    getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: QUIZ_ID, branchId: null, status: "completed", answers: [] })
```
after:
```ts
    getAttempt.mockResolvedValue({
      id: ATTEMPT_ID,
      quizId: QUIZ_ID,
      branchId: null,
      status: "completed",
      answers: [],
      businessId: HOST_BUSINESS,
    })
```
Before (the last test and the file's closing `})`):
```ts
  it("refuses an attemptId belonging to a different quiz", async () => {
    getAttempt.mockResolvedValue({ id: ATTEMPT_ID, quizId: "other", branchId: null, status: "in_progress", answers: [] })
    const res = await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [] }, freshIp())
    expect(res.status).toBe(404)
    expect(saveAttemptProgress).not.toHaveBeenCalled()
  })
})
```
after:
```ts
  it("refuses an attemptId belonging to a different quiz", async () => {
    // The Host's own business, so the QUIZ mismatch alone is what refuses it.
    getAttempt.mockResolvedValue({
      id: ATTEMPT_ID,
      quizId: "other",
      branchId: null,
      status: "in_progress",
      answers: [],
      businessId: HOST_BUSINESS,
    })
    const res = await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [] }, freshIp())
    expect(res.status).toBe(404)
    expect(saveAttemptProgress).not.toHaveBeenCalled()
  })
})

/**
 * The DAL's contract, modelled rather than canned: the quiz answers only under
 * ITS OWN business. A ONE-argument call is the pre-G35 signature
 * (`getQuizDefinition(quizId)`, read by id alone) and answers for anyone. A
 * route that drops the tenant therefore gets the foreign quiz back and goes
 * red. An argument-blind mock would let it pass.
 */
function ownedBy(owner: string, def: QuizDefinition) {
  return async (...args: unknown[]) => (args.length < 2 || args[0] === owner ? def : null)
}

describe("POST /api/quiz/progress — the Host's tenant fences the quiz and the attempt (G35)", () => {
  const OTHER_BUSINESS = "other-biz"

  it("reads the quiz under the Host's tenant", async () => {
    // MUTANT: `getQuizDefinition(body.quizId)`, the id-only read. Business B's
    // host could then open an attempt (stamped B) on business A's quiz, and
    // /api/quiz/submit would file B's contact against A's quiz.
    await post({ quizId: QUIZ_ID, answers: [] }, freshIp())
    expect(getQuizDefinition).toHaveBeenCalledWith(HOST_BUSINESS, QUIZ_ID)
  })

  it("404s another business's quiz, and opens no attempt on it", async () => {
    getQuizDefinition.mockImplementation(ownedBy(OTHER_BUSINESS, definition()))
    const res = await post({ quizId: QUIZ_ID, answers: [{ questionId: Q_ROUTER, optionId: O_TO_A }] }, freshIp())
    expect(res.status).toBe(404)
    expect(createAttempt).not.toHaveBeenCalled()
    expect(saveAttemptProgress).not.toHaveBeenCalled()
  })

  it("opens the attempt when the quiz IS the Host's — the presence control for the test above", async () => {
    getQuizDefinition.mockImplementation(ownedBy(HOST_BUSINESS, definition()))
    const res = await post({ quizId: QUIZ_ID, answers: [{ questionId: Q_ROUTER, optionId: O_TO_A }] }, freshIp())
    expect(res.status).toBe(200)
    expect(createAttempt).toHaveBeenCalledWith(HOST_BUSINESS, expect.objectContaining({ quizId: QUIZ_ID }))
  })

  it("refuses to continue an attempt stamped with another business, even on a quiz this Host owns", async () => {
    // MUTANT: dropping `existing.businessId !== businessId`. The attempt id is
    // a bearer token (see `getAttempt`). The quiz check alone passes for the
    // exact row the pre-G35 hole produced: an attempt stamped B on A's quiz.
    getAttempt.mockResolvedValue({
      id: ATTEMPT_ID,
      quizId: QUIZ_ID,
      branchId: null,
      status: "in_progress",
      answers: [],
      businessId: OTHER_BUSINESS,
    })
    const res = await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [] }, freshIp())
    expect(res.status).toBe(404)
    expect(saveAttemptProgress).not.toHaveBeenCalled()
  })

  it("refuses it with the 404 even when it is finished — a foreign attempt's status is not disclosed", async () => {
    // MUTANT: checking the status before the business. A 409 "already
    // completed" for another business's attempt confirms the id is real.
    getAttempt.mockResolvedValue({
      id: ATTEMPT_ID,
      quizId: QUIZ_ID,
      branchId: null,
      status: "completed",
      answers: [],
      businessId: OTHER_BUSINESS,
    })
    const res = await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [] }, freshIp())
    expect(res.status).toBe(404)
  })

  it("continues the Host's own attempt — the presence control for the two tests above", async () => {
    const res = await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [] }, freshIp())
    expect(res.status).toBe(200)
    expect(saveAttemptProgress).toHaveBeenCalledWith(expect.objectContaining({ attemptId: ATTEMPT_ID }))
  })

  it("resolves the Host for an EXISTING attempt too — once", async () => {
    // MUTANT: resolving only on the create branch, as before G35. The quiz
    // read and the attempt comparison above would then have no tenant.
    await post({ quizId: QUIZ_ID, attemptId: ATTEMPT_ID, answers: [] }, freshIp())
    expect(resolvePublicTenant).toHaveBeenCalledTimes(1)
  })

  it("stamps a new attempt with the SAME answer the quiz was read under — one resolution, not two", async () => {
    // MUTANT: a second `resolvePublicTenant()` left at the createAttempt site.
    // Two lookups in one request are two answers that can disagree, and then
    // the attempt lands on a business whose quiz was never checked.
    resolvePublicTenant.mockResolvedValueOnce(HOST_BUSINESS).mockResolvedValueOnce("a-second-answer")
    await post({ quizId: QUIZ_ID, answers: [] }, freshIp())
    expect(resolvePublicTenant).toHaveBeenCalledTimes(1)
    expect(createAttempt).toHaveBeenCalledWith(HOST_BUSINESS, expect.anything())
  })
})
```

`__tests__/api/quiz-submit.test.ts`. Append at the end. Before:
```ts
  it("drops a forged option before it is scored or stored", async () => {
    await post({ answers: [{ questionId: Q_ROUTER, optionId: O_BEST }] })
    // O_BEST belongs to Q_A1, not the router: nothing is stored and no branch
    // is derived, so the walk is the router alone.
    expect(completeAttempt).toHaveBeenCalledWith(expect.objectContaining({ answers: [], branchId: null }))
  })
})
```
after: the same, followed by:
```ts

/** One argument is the pre-G35 id-only read and answers for anyone; see quiz-progress.test.ts. */
function ownedBy(owner: string, def: QuizDefinition) {
  return async (...args: unknown[]) => (args.length < 2 || args[0] === owner ? def : null)
}

describe("POST /api/quiz/submit — the quiz is read under the ATTEMPT's business (G35)", () => {
  it("reads the quiz under the attempt's business", async () => {
    // MUTANT: `getQuizDefinition(body.quizId)`, the id-only read. An attempt
    // opened on another business's quiz would be scored here, and its
    // contact, card and consent row filed against that quiz.
    await post()
    expect(getQuizDefinition).toHaveBeenCalledWith(ATTEMPT_BUSINESS_ID, QUIZ_ID)
  })

  it("404s when the quiz is not the attempt's business's, and completes and files nothing", async () => {
    getQuizDefinition.mockImplementation(ownedBy("another-business", definition()))
    const res = await post({ phone: "5551234567", smsConsent: true })
    expect(res.status).toBe(404)
    expect(completeAttempt).not.toHaveBeenCalled()
    expect(recordContactEvent).not.toHaveBeenCalled()
    expect(recordConsent).not.toHaveBeenCalled()
    expect(applyPipelineEvent).not.toHaveBeenCalled()
  })

  it("scores and files normally when the quiz IS the attempt's business's — the presence control", async () => {
    getQuizDefinition.mockImplementation(ownedBy(ATTEMPT_BUSINESS_ID, definition()))
    const res = await post({ phone: "5551234567", smsConsent: true })
    expect(res.status).toBe(200)
    expect(completeAttempt).toHaveBeenCalled()
    expect(recordContactEvent).toHaveBeenCalled()
  })
})
```

`__tests__/app/api/quiz/preview-submit.test.ts`. Before:
```ts
vi.mock("@/lib/db/quizzes", () => ({ getQuizDefinition: vi.fn() }))

import { POST } from "@/app/api/quiz/preview-submit/route"
import { auth } from "@/lib/auth"
import { getQuizDefinition } from "@/lib/db/quizzes"
```
after:
```ts
vi.mock("@/lib/db/quizzes", () => ({ getQuizDefinition: vi.fn() }))
// Since G35 the route resolves the ADMIN tenant. The class is declared INSIDE
// the factory: `vi.mock` is hoisted above every top-level statement, and a
// top-level class referenced from here is still in its temporal dead zone.
vi.mock("@/lib/tenancy/resolve", () => {
  class NoAccessibleBusinessError extends Error {}
  return { resolveAdminTenantForRequest: vi.fn(), NoAccessibleBusinessError }
})

import { POST } from "@/app/api/quiz/preview-submit/route"
import { auth } from "@/lib/auth"
import { getQuizDefinition } from "@/lib/db/quizzes"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
```
Before: `const BRANCH_A = "44444444-4444-4444-8444-444444444441"`
after:
```ts
const BRANCH_A = "44444444-4444-4444-8444-444444444441"
/** The caller's own business, as the admin boundary resolves it. */
const BUSINESS_ID = "bbbbbbbb-2222-4333-8444-555555555555"
```
Before:
```ts
  vi.mocked(getQuizDefinition).mockResolvedValue(draftDefinition())
})
```
after:
```ts
  vi.mocked(getQuizDefinition).mockResolvedValue(draftDefinition())
  vi.mocked(resolveAdminTenantForRequest).mockResolvedValue({ businessId: BUSINESS_ID, choices: [], isOperator: false })
})
```
Before:
```ts
  it("404s for a quiz that does not exist", async () => {
    vi.mocked(getQuizDefinition).mockResolvedValue(null)
    expect((await post({ quizId: QUIZ_ID, answers: [] })).status).toBe(404)
  })
})
```
after: the same, followed by:
```ts

/** One argument is the pre-G35 id-only read and answers for anyone; see quiz-progress.test.ts. */
function ownedBy(owner: string, def: QuizDefinition) {
  return async (...args: unknown[]) => (args.length < 2 || args[0] === owner ? def : null)
}

describe("POST /api/quiz/preview-submit — scored under the caller's own business (G35)", () => {
  it("reads the quiz under the admin tenant", async () => {
    // MUTANT: `getQuizDefinition(body.quizId)`, the id-only read. It scored
    // ANY business's draft quiz for any signed-in staff member.
    await post({ quizId: QUIZ_ID, answers: [] })
    expect(getQuizDefinition).toHaveBeenCalledWith(BUSINESS_ID, QUIZ_ID)
  })

  it("404s another business's quiz", async () => {
    vi.mocked(getQuizDefinition).mockImplementation(ownedBy("another-business", draftDefinition()))
    expect((await post({ quizId: QUIZ_ID, answers: [] })).status).toBe(404)
  })

  it("scores the caller's own quiz under the same fake — the presence control", async () => {
    vi.mocked(getQuizDefinition).mockImplementation(ownedBy(BUSINESS_ID, draftDefinition()))
    expect((await post({ quizId: QUIZ_ID, answers: [] })).status).toBe(200)
  })

  it("404s a caller with no reachable business, and reads nothing", async () => {
    // MUTANT: letting NoAccessibleBusinessError escape as a 500. A coach whose
    // membership was revoked mid-session gets the same 404 the preview page
    // they posted from gives them.
    vi.mocked(resolveAdminTenantForRequest).mockRejectedValue(new NoAccessibleBusinessError())
    expect((await post({ quizId: QUIZ_ID, answers: [] })).status).toBe(404)
    expect(getQuizDefinition).not.toHaveBeenCalled()
  })
})
```

`__tests__/api/admin-quiz-save.test.ts`. Before:
```ts
  it("returns the gate result on a successful save, so the editor can show blockers", async () => {
    getQuizDefinition.mockResolvedValue(broken())
    const res = await patch({ questions: [{ id: Q_A1, position: 60 }] })
    expect(res.status).toBe(200)
    expect((await res.json()).gate.ok).toBe(false)
  })
})
```
after: the same, followed by:
```ts

/** One argument is the pre-G35 id-only read and answers for anyone; see quiz-progress.test.ts. */
function ownedBy(owner: string, def: QuizDefinition) {
  return async (...args: unknown[]) => (args.length < 2 || args[0] === owner ? def : null)
}

describe("PATCH /api/admin/quizzes/[id] — read in the caller's own business (G35)", () => {
  it("reads the quiz under the admin tenant, before AND after the save", async () => {
    // MUTANT: `getQuizDefinition(id)` at either read. The first now refuses
    // another business's quiz. The second is the one the gate runs on.
    await patch({ quiz: { name: "Renamed" } })
    expect(getQuizDefinition.mock.calls).toEqual([
      [BUSINESS_ID, QUIZ_ID],
      [BUSINESS_ID, QUIZ_ID],
    ])
  })

  it("404s another business's quiz before anything is written", async () => {
    getQuizDefinition.mockImplementation(ownedBy("another-business", healthy()))
    const res = await patch({ quiz: { name: "Renamed" } })
    expect(res.status).toBe(404)
    expect(saveQuizDefinition).not.toHaveBeenCalled()
  })

  it("saves the caller's own quiz under the same fake — the presence control", async () => {
    getQuizDefinition.mockImplementation(ownedBy(BUSINESS_ID, healthy()))
    const res = await patch({ quiz: { name: "Renamed" } })
    expect(res.status).toBe(200)
    expect(saveQuizDefinition).toHaveBeenCalled()
  })
})
```

`__tests__/app/api/admin/quizzes/add-to-step-tenancy.test.ts`. Header, before:
```ts
// closed, except this route already holds a real, resolved businessId with
// no architectural reason to skip the check.
```
after:
```ts
// closed, except this route already holds a real, resolved businessId with
// no architectural reason to skip the check.
//
// Since G35 `getQuizDefinition` takes the business too, so the read itself
// refuses another business's quiz. The ownership check stays and still runs
// first. Both are pinned below.
```
Before:
```ts
    expect(assertQuizInBusinessMock).toHaveBeenCalledWith(BUSINESS_ID, QUIZ_ID)
  })
```
after:
```ts
    expect(assertQuizInBusinessMock).toHaveBeenCalledWith(BUSINESS_ID, QUIZ_ID)
  })

  it("reads the quiz definition under the same business (G35)", async () => {
    // MUTANT: `getQuizDefinition(quizId)`, the id-only read the ownership check
    // above used to have to stand in front of.
    const { POST } = await import("@/app/api/admin/quizzes/[id]/add-to-step/route")
    await POST(post({ stepId: STEP_ID }), ctx)
    expect(getQuizDefinitionMock).toHaveBeenCalledWith(BUSINESS_ID, QUIZ_ID)
  })
```

`__tests__/api/funnels/create-quiz-funnel.test.ts`. Before:
```ts
    expect(getQuizDefinitionMock).toHaveBeenCalledWith(EXISTING_QUIZ_ID)
  })
```
after:
```ts
    // MUTANT: `getQuizDefinition(quizIntake.copyFrom)`, the id-only read (G35).
    expect(getQuizDefinitionMock).toHaveBeenCalledWith(BUSINESS_ID, EXISTING_QUIZ_ID)
  })

  it("refuses another business's copyFrom at the READ, with the same 400, before creating anything (G35)", async () => {
    // One argument is the pre-G35 id-only read and answers for anyone. Under
    // the mutant the source comes back, the (mocked) ownership check passes,
    // and a clone is created.
    getQuizDefinitionMock.mockImplementation(async (...args: unknown[]) =>
      args.length < 2 || args[0] === "another-business"
        ? { id: EXISTING_QUIZ_ID, questions: [], branches: [], tiers: [], profiles: [] }
        : null,
    )
    const { POST } = await import("@/app/api/admin/funnels/route")
    const res = await POST(post({ ...quizBody, quiz: { copyFrom: EXISTING_QUIZ_ID } }), NO_PARAMS)
    expect(res.status).toBe(400)
    expect(createQuizFromMock).not.toHaveBeenCalled()
    expect(createFunnelMock).not.toHaveBeenCalled()
  })
```
Before:
```ts
    // THE CROSS-TENANT CLONE HOLE. `getQuizDefinition` above is scoped by id
    // alone, so without this guard an admin could name another business's
    // quiz id and clone its full content into their own.
```
after:
```ts
    // THE CROSS-TENANT CLONE HOLE. Since G35 the read itself is scoped (the
    // test above). This pins the SECOND line, the ownership check, against a
    // read that answers regardless, the way the pre-G35 one did.
```

`__tests__/lib/funnels/load-catalogues-tenancy.test.ts`. Before:
```ts
async function stubTenantedDal() {
  const getEventsCalls: string[] = []
  const getPublishedEventsCalls: string[] = []
  const listQuizzesCalls: string[] = []
```
after:
```ts
async function stubTenantedDal(
  quizzesByBusiness: Record<string, { id: string; status: string }[]> = QUIZZES_BY_BUSINESS,
) {
  const getEventsCalls: string[] = []
  const getPublishedEventsCalls: string[] = []
  const listQuizzesCalls: string[] = []
  const getQuizDefinitionCalls: unknown[][] = []
```
Before:
```ts
    listQuizzes: async (businessId: string) => {
      listQuizzesCalls.push(businessId)
      return QUIZZES_BY_BUSINESS[businessId] ?? []
    },
    // Both fixtures above are `status: "draft"`, so `loadCatalogues` never
    // calls this -- it only assembles a definition for an ACTIVE quiz. Wired
    // anyway so a future fixture change does not throw for an unrelated reason.
    getQuizDefinition: async () => null,
  }))

  const { loadCatalogues } = await import("@/lib/funnels/sections/resolve")
  return { loadCatalogues, getEventsCalls, getPublishedEventsCalls, listQuizzesCalls }
}
```
after:
```ts
    listQuizzes: async (businessId: string) => {
      listQuizzesCalls.push(businessId)
      return quizzesByBusiness[businessId] ?? []
    },
    // The default fixtures are all `status: "draft"`, so `loadCatalogues`
    // never calls this for them. It only assembles a definition for an ACTIVE
    // quiz. The G35 test below passes an active one. Every call is recorded
    // WHOLE, so the tenant argument is visible as a call shape.
    getQuizDefinition: async (...args: unknown[]) => {
      getQuizDefinitionCalls.push(args)
      return null
    },
  }))

  const { loadCatalogues } = await import("@/lib/funnels/sections/resolve")
  return { loadCatalogues, getEventsCalls, getPublishedEventsCalls, listQuizzesCalls, getQuizDefinitionCalls }
}
```
Before:
```ts
    expect(listQuizzesCalls).toEqual([BUSINESS_A])
  })
})
```
after:
```ts
    expect(listQuizzesCalls).toEqual([BUSINESS_A])
  })

  it("assembles an ACTIVE quiz's definition under the asking tenant, not by id alone (G35)", async () => {
    // MUTANT: `getQuizDefinition(row.id)`, the id-only read this seam had
    // before G35.
    const { loadCatalogues, getQuizDefinitionCalls } = await stubTenantedDal({
      [BUSINESS_A]: [{ id: "quiz-a", status: "active" }],
    })

    await loadCatalogues(BUSINESS_A)

    expect(getQuizDefinitionCalls).toEqual([[BUSINESS_A, "quiz-a"]])
  })
})
```

`__tests__/lib/funnels/sections/resolve.test.ts`. The stub now takes the tenant first. Before:
```ts
    getQuizDefinition: async (id: string) => {
      quizDefinitionCalls.push(id)
```
after:
```ts
    // (businessId, quizId) since G35. The tenant is asserted by
    // load-catalogues-tenancy.test.ts; this block keeps asserting WHICH quiz.
    getQuizDefinition: async (_businessId: string, id: string) => {
      quizDefinitionCalls.push(id)
```

`__tests__/components/funnels/quiz-island-context.test.tsx`. Before:
```ts
const CONTEXT: FunnelRenderContext = {
  funnelId: FUNNEL_ID,
  funnelSlug: "athlete-quiz",
  stepId: STEP_ID,
  stepSlug: "quiz",
  isPreview: false,
}
```
after:
```ts
/**
 * The tenant the ROUTE resolved (G35). It is deliberately NOT the Host's
 * "host-biz" above, so a quiz read under the Host cannot pass for one read
 * under the route's tenant.
 */
const ROUTE_BUSINESS = "route-biz"

const CONTEXT: FunnelRenderContext = {
  funnelId: FUNNEL_ID,
  funnelSlug: "athlete-quiz",
  stepId: STEP_ID,
  stepSlug: "quiz",
  isPreview: false,
  businessId: ROUTE_BUSINESS,
}

/** One argument is the pre-G35 id-only read and answers for anyone; see quiz-progress.test.ts. */
function ownedBy(owner: string, def: QuizDefinition) {
  return async (...args: unknown[]) => (args.length < 2 || args[0] === owner ? def : null)
}
```
Before:
```ts
  it("reads the business settings for the Host-resolved tenant, not the platform's", async () => {
    await QuizIsland({ props: { quizId: QUIZ_ID }, context: CONTEXT })
    expect(getBusinessSettings).toHaveBeenCalledWith("host-biz")
  })
})
```
after:
```ts
  it("reads the business settings for the Host-resolved tenant, not the platform's", async () => {
    await QuizIsland({ props: { quizId: QUIZ_ID }, context: CONTEXT })
    expect(getBusinessSettings).toHaveBeenCalledWith("host-biz")
  })

  it("reads the quiz under the ROUTE's tenant, not the Host's (G35)", async () => {
    // MUTANT: `getQuizDefinition(await resolvePublicTenant(), quizId)`. On /go
    // the two are the same business. On /preview and /funnel-preview the Host
    // is the admin screen's (the platform's), so a coach's own quiz would
    // vanish from their builder canvas while /go still showed it.
    await QuizIsland({ props: { quizId: QUIZ_ID }, context: CONTEXT })
    expect(getQuizDefinition).toHaveBeenCalledWith(ROUTE_BUSINESS, QUIZ_ID)
  })

  it("renders nothing for a quiz the route's business does not own", async () => {
    getQuizDefinition.mockImplementation(ownedBy("another-business", DEFINITION))
    expect(await QuizIsland({ props: { quizId: QUIZ_ID }, context: CONTEXT })).toBeNull()
  })

  it("renders the runner for the route's own quiz under the same fake — the presence control", async () => {
    getQuizDefinition.mockImplementation(ownedBy(ROUTE_BUSINESS, DEFINITION))
    const element = (await QuizIsland({ props: { quizId: QUIZ_ID }, context: CONTEXT })) as ReactElement
    expect(element).not.toBeNull()
    expect((element.props as { definition?: { id?: string } }).definition?.id).toBe(QUIZ_ID)
  })
})
```

`__tests__/components/funnels/form-island-sms-consent.test.tsx`. Before:
```ts
const CONTEXT = {
  funnelId: "ffffffff-1111-4222-8333-444444444444",
  funnelSlug: "test",
```
after:
```ts
const CONTEXT = {
  // Required on FunnelRenderContext since G35. Distinct from the Host's
  // "host-biz", so the form's Host-resolved reads cannot pass for it.
  businessId: "route-biz",
  funnelId: "ffffffff-1111-4222-8333-444444444444",
  funnelSlug: "test",
```

`__tests__/app/funnel-go-tenancy.test.tsx`. Before:
```ts
function paramsFor(slug: string, step: string[] = []) {
  return Promise.resolve({ slug, step })
}
```
after:
```ts
function paramsFor(slug: string, step: string[] = []) {
  return Promise.resolve({ slug, step })
}

/** The context handed to NodeRenderer, found by walking the returned element tree. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findContext(element: any): Record<string, unknown> | null {
  if (!element || typeof element !== "object") return null
  if (element.props && element.props.context) return element.props.context as Record<string, unknown>
  const children = element.props?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    const found = findContext(child)
    if (found) return found
  }
  return null
}
```
Before:
```ts
    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })
```
Take the first occurrence, in "serves tenant A's funnel on tenant A's host". If it is not unique, include that test's `it(` line in the anchor. After:
```ts
    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })

  it("hands the islands the Host's tenant, the same one the page was read under (G35)", async () => {
    // MUTANT: leaving `businessId` out of the NodeRenderer context, or filling
    // it with anything but the resolved tenant. The quiz island reads its quiz
    // under it, and on /go that must be the Host's business.
    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    mocks.getPublishedStep.mockResolvedValue(PUBLISHED)

    const element = await Page({ params: paramsFor("free-guide"), searchParams: noSearchParams })

    expect(findContext(element)).toMatchObject({ businessId: "tenant-a", funnelId: "f1", stepId: "s1" })
  })
```

`__tests__/app/draft-preview-route.test.tsx`. Before:
```ts
const html = async (slug: string, step?: string[]) =>
  renderToStaticMarkup((await render(slug, step)) as ReactElement)
```
after: the same, followed by the `findContext` helper, copied verbatim from the funnel-go-tenancy edit above. Before:
```ts
    expect(getFunnelBySlug).toHaveBeenCalledWith(BUSINESS_ID, "summer-camp")
    expect(listSteps).toHaveBeenCalledWith(BUSINESS_ID, FUNNEL.id)
  })
```
after:
```ts
    expect(getFunnelBySlug).toHaveBeenCalledWith(BUSINESS_ID, "summer-camp")
    expect(listSteps).toHaveBeenCalledWith(BUSINESS_ID, FUNNEL.id)
  })

  it("hands the islands the ADMIN tenant, not the Host's (G35)", async () => {
    // MUTANT: leaving `businessId` out of the NodeRenderer context. The quiz
    // island reads its quiz under it, and this screen is served from the
    // admin's host whichever coach is looking, so the Host is the wrong one.
    expect(findContext(await render("summer-camp"))).toMatchObject({ businessId: BUSINESS_ID, testRun: true })
  })
```

`__tests__/app/funnel-draft-preview-page.test.tsx`. The file already has `findContext`. Before:
```ts
    expect(getStep).toHaveBeenCalledWith(BUSINESS_ID, STEP_ID)
    expect(getFunnelById).toHaveBeenCalledWith(BUSINESS_ID, STEP.funnel_id)
  })
```
after:
```ts
    expect(getStep).toHaveBeenCalledWith(BUSINESS_ID, STEP_ID)
    expect(getFunnelById).toHaveBeenCalledWith(BUSINESS_ID, STEP.funnel_id)
  })

  it("hands the islands the ADMIN tenant the page resolved, not the Host's (G35)", async () => {
    // MUTANT: leaving `businessId` out of the island context. The builder's
    // canvas is served from the admin's host whichever coach is editing, so an
    // island reading under the Host would show another business's rows, or none.
    expect(findContext(await render())).toMatchObject({ businessId: BUSINESS_ID, isPreview: true })
  })
```

- [ ] **Step 2: Run it and watch it fail**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/quizzes/quiz-dal.test.ts __tests__/lib/quizzes/quiz-create.test.ts __tests__/api/quiz-progress.test.ts __tests__/api/quiz-submit.test.ts __tests__/app/api/quiz/preview-submit.test.ts __tests__/api/admin-quiz-save.test.ts __tests__/app/api/admin/quizzes/add-to-step-tenancy.test.ts __tests__/api/funnels/create-quiz-funnel.test.ts __tests__/lib/funnels/load-catalogues-tenancy.test.ts __tests__/lib/funnels/sections/resolve.test.ts __tests__/components/funnels/quiz-island-context.test.tsx __tests__/components/funnels/form-island-sms-consent.test.tsx __tests__/app/funnel-go-tenancy.test.tsx __tests__/app/draft-preview-route.test.tsx __tests__/app/funnel-draft-preview-page.test.tsx`

These should fail:
- quiz-dal: the five retargeted `("b1", …)` reads return null (the old signature reads quiz id "b1"), and so does "filters on the business it was GIVEN".
- quiz-create: most tests fail, because `getQuizDefinition(BUSINESS_ID, "q1")` reads quiz id BUSINESS_ID, returns null, and `source!` crashes.
- quiz-progress:
  - "reads the quiz under…": called with one argument.
  - "404s another business's quiz": the one-argument read gets the quiz, status 200.
  - "refuses to continue an attempt stamped with another business": status 200.
  - "refuses it with the 404 even when finished": status 409.
  - "resolves the Host for an EXISTING attempt too": 0 calls.
- quiz-submit: "reads the quiz under the attempt's business" and "404s when the quiz is not…" (status 200).
- preview-submit: "reads the quiz under the admin tenant", "404s another business's quiz" and "404s a caller with no reachable business" (the resolver is never called, status 200).
- admin-quiz-save: "reads the quiz under the admin tenant…" and "404s another business's quiz…".
- add-to-step: "reads the quiz definition under the same business".
- create-quiz-funnel: "reads an existing quiz when one is named" and "refuses another business's copyFrom at the READ".
- load-catalogues-tenancy: the G35 test gets `[["quiz-a"]]`.
- resolve.test: "puts each DAL's rows under the right catalogue key…" records `[undefined]`, not `["quiz-active"]`.
- quiz-island-context: "reads the quiz under the ROUTE's tenant" and "renders nothing for a quiz the route's business does not own".
- funnel-go-tenancy, draft-preview-route, funnel-draft-preview-page: each G35 context test finds no `businessId`.

These pass already, which is expected:
- quiz-dal "answers null for another business's quiz" passes vacuously: the old signature reads quiz id "b2". The Step 4 mutation check is what proves it.
- quiz-progress "stamps a new attempt with the SAME answer…" is an ordering guard.
- The presence controls pass.

`form-island-sms-consent` stays green at runtime. Its edit is a tsc requirement.

- [ ] **Step 3: Implement**

`lib/db/quizzes.ts`. Before:
```ts
/** Returns null — never a half-built object — when the quiz does not exist. */
export async function getQuizDefinition(quizId: string): Promise<QuizDefinition | null> {
  const { data, error } = await getClient().from("quizzes").select("*").eq("id", quizId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return assemble(data as Row)
}
```
after:
```ts
/**
 * One quiz, assembled, IN ONE BUSINESS. Returns null (never a half-built
 * object) when the quiz does not exist, and the same null when it exists
 * under another business.
 *
 * `businessId` FIRST and REQUIRED (G35). Until G35 this read took the id
 * alone, and nothing compared the quiz's business with the attempt's. Business
 * B's host could open an attempt (stamped B) on business A's quiz, and
 * /api/quiz/submit would file B's contact, pipeline card and consent row
 * against A's quiz. Each caller now passes the tenant it already holds:
 *   - /api/quiz/progress: the Host's
 *   - /api/quiz/submit: the attempt's
 *   - the quiz island: the route's (`FunnelRenderContext.businessId`)
 *   - the admin routes and `loadCatalogues`: the admin tenant
 */
export async function getQuizDefinition(businessId: string, quizId: string): Promise<QuizDefinition | null> {
  const { data, error } = await getClient()
    .from("quizzes")
    .select("*")
    .eq("id", quizId)
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return assemble(data as Row)
}
```
Before:
```ts
 * SCOPED BY businessId. Both its callers are admin-only (the quiz editor
 * page and its save route) -- unlike `getQuizDefinition`, which several
 * public, unauthenticated quiz-taking routes also call and cannot yet supply
 * a real tenant for. Without this, a staff coach holding the `funnels`
```
after:
```ts
 * SCOPED BY businessId, like `getQuizDefinition` since G35. Both its callers
 * are admin-only (the quiz editor page and its save route). Without this, a
 * staff coach holding the `funnels`
```
Before:
```ts
 * EXPORTED, NOT PRIVATE TO `saveQuizDefinition` -- it is also the guard
 * `getQuizDefinition`'s own callers need. `getQuizDefinition` is scoped by id
 * alone (several of its callers are public, unauthenticated quiz-taking
 * routes with no tenant to check against yet), so any admin-side caller that
 * turns its result into a WRITE -- cloning it (`createQuizFrom`) or
 * composing it onto another record (`add-to-step`'s draft doc) -- must run
 * this first, or the read alone is a cross-tenant hole one step removed from
 * the write the read was scoped to protect.
 */
```
after:
```ts
 * EXPORTED, NOT PRIVATE TO `saveQuizDefinition`. While `getQuizDefinition`
 * took the id alone, this was the guard its admin callers needed: any caller
 * that turned the result into a WRITE had to run it first. That meant cloning
 * it (`createQuizFrom`) or composing it onto another record (`add-to-step`'s
 * draft doc). Since G35 `getQuizDefinition` is scoped by business itself, so
 * on those two paths this is a second check that gives the same answer. They
 * keep it rather than lean on the read alone: it is one indexed lookup, and
 * both routes' tests pin it by name.
 */
```
Before:
```ts
  businessId: string
}

export async function getAttempt(attemptId: string): Promise<QuizAttemptRow | null> {
```
after:
```ts
  businessId: string
}

/**
 * One attempt by id, and ONLY by id, with no business predicate on purpose.
 *
 * THE ID IS A BEARER TOKEN. It is an unguessable UUID that /api/quiz/progress
 * issued to the visitor who started the attempt, the same standing
 * `getInviteByToken`'s token has: holding it is the permission. Its public
 * callers cannot pass a tenant here without going in a circle, because
 * /api/quiz/submit reads its tenant OFF this row.
 *
 * What stops the id crossing businesses is the comparison each caller makes
 * AFTER the read (G35). Progress refuses an attempt whose `businessId` is not
 * the Host's tenant. Submit reads the quiz under `attempt.businessId`, so a
 * quiz of another business reads as absent.
 */
export async function getAttempt(attemptId: string): Promise<QuizAttemptRow | null> {
```

`app/api/quiz/progress/route.ts`. Before:
```ts
  const definition = await getQuizDefinition(body.quizId)
  // 404, not 403: a draft quiz is not a permissions problem, it is a quiz that
  // is not open. Same answer for "no such quiz", so probing tells you nothing.
```
after:
```ts
  // THE HOST'S TENANT, RESOLVED FIRST, ON EVERY REQUEST (G35). This route
  // DECIDES an attempt's business. Until G35 it asked the Host only when
  // creating one, after reading the quiz by id alone, and nothing compared the
  // quiz's business with the attempt's. Business B's host could open an
  // attempt (stamped B) on business A's quiz, and /api/quiz/submit, which
  // inherits the attempt's business, then filed B's contact, card and consent
  // row against A's quiz. Now the quiz is read under the Host, and an existing
  // attempt must carry the same business. This runs after the throttle, so a
  // flood costs no business_domains read.
  const businessId = await resolvePublicTenant()

  const definition = await getQuizDefinition(businessId, body.quizId)
  // 404, not 403: a draft quiz is not a permissions problem, it is a quiz that
  // is not open. It is the same answer for "no such quiz" and for another
  // business's quiz, so probing tells you nothing.
```
Before:
```ts
    const existing = await getAttempt(attemptId)
    // Silently ignoring a foreign or finished attempt would let one visitor
    // overwrite another's row, so both are refused outright.
    if (!existing || existing.quizId !== body.quizId) {
```
after:
```ts
    const existing = await getAttempt(attemptId)
    // Silently ignoring a foreign or finished attempt would let one visitor
    // overwrite another's row, so both are refused outright. "Foreign" means
    // another quiz or, since G35, another business. The attempt id is a bearer
    // token (see `getAttempt`), and the Host says which business this request
    // is for. It is checked BEFORE the status, so another business's finished
    // attempt gets the same 404 rather than a 409 that confirms the id is real.
    if (!existing || existing.quizId !== body.quizId || existing.businessId !== businessId) {
```
Before:
```ts
    // PUBLIC ROUTE, NO SESSION. The attempt's tenant is DECIDED here, from the
    // request's Host via lib/tenancy/public.ts; /api/quiz/submit then inherits
    // it from the attempt row rather than resolving again.
    const businessId = await resolvePublicTenant()
    attemptId = await createAttempt(businessId, {
```
after:
```ts
    // PUBLIC ROUTE, NO SESSION. The attempt's tenant is DECIDED here: the
    // Host's, resolved at the top of this handler and already used to read the
    // quiz. It is NOT resolved a second time, because two lookups are two
    // answers that could disagree. /api/quiz/submit then inherits it from the
    // attempt row rather than resolving again.
    attemptId = await createAttempt(businessId, {
```

`app/api/quiz/submit/route.ts`. Before (lines 133-152, exact text as in the file):
```ts
  const definition = await getQuizDefinition(body.quizId)
  if (!definition || definition.status !== "active") {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const attempt = await getAttempt(body.attemptId)
  if (!attempt || attempt.quizId !== body.quizId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  // THE TENANT IS THE ATTEMPT'S. `quiz_attempts.business_id` was stamped when
  // /api/quiz/progress created the attempt, so every write below — the step
  // and funnel reads just below, the contact, the pipeline card, the settings
  // read, the consent row — lands on the business the attempt belongs to, by
  // construction rather than by several defaults happening to agree. A public
  // route, but NOT a caller of platformBusinessId(): it has a row to inherit
  // from. Resolved here, ahead of the funnel-link check below, rather than
  // where it used to sit (just before `handoff`) — that check reads
  // `lib/db/funnels` too and needs the same value.
  const businessId = attempt.businessId
```
after:
```ts
  // THE ATTEMPT FIRST, because the quiz is read under its business (G35).
  const attempt = await getAttempt(body.attemptId)
  if (!attempt || attempt.quizId !== body.quizId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  // THE TENANT IS THE ATTEMPT'S. `quiz_attempts.business_id` was stamped when
  // /api/quiz/progress created the attempt. So every read and write below
  // lands on the business the attempt belongs to, by construction rather than
  // by several defaults happening to agree: the quiz read just below, the step
  // and funnel reads, the contact, the pipeline card, the settings read and
  // the consent row. A public route, but NOT a caller of platformBusinessId()
  // or of resolvePublicTenant(): it has a row to inherit from, and resolving
  // the Host again here would be a second answer that could disagree with the
  // one progress stamped. Resolved ahead of the funnel-link check below,
  // which reads `lib/db/funnels` and needs the same value.
  const businessId = attempt.businessId

  // UNDER THE ATTEMPT'S BUSINESS (G35). Until G35 the quiz was read by id
  // alone, and nothing compared its business with the attempt's, so an
  // attempt opened on another business's quiz was scored and filed here. A
  // quiz that is not this attempt's business's now reads as absent. That is
  // the same 404 as a quiz that does not exist or is not active.
  const definition = await getQuizDefinition(businessId, body.quizId)
  if (!definition || definition.status !== "active") {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }
```

`app/api/quiz/preview-submit/route.ts`. Before:
```ts
import { auth } from "@/lib/auth"
import { getQuizDefinition } from "@/lib/db/quizzes"
```
after:
```ts
import { auth } from "@/lib/auth"
import { getQuizDefinition } from "@/lib/db/quizzes"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
```
Before:
```ts
  if (role !== "admin" && role !== "staff") return notFound()

  let body: z.infer<typeof bodySchema>
```
after:
```ts
  if (role !== "admin" && role !== "staff") return notFound()

  // THE ADMIN BOUNDARY, NOT THE HOST (G35). This is the same tenant the
  // preview page this is posted from resolved, and the one the quiz island
  // read the quiz under to draw it. Another business's quiz reads as absent.
  // A caller with no reachable business gets 404, the answer that page gives
  // it, not the 403 of the /api/admin routes: this route answers a stranger
  // with nothing, and so does the page.
  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (error) {
    if (error instanceof NoAccessibleBusinessError) return notFound()
    throw error
  }

  let body: z.infer<typeof bodySchema>
```
Before:
```ts
  // WHATEVER ITS STATUS. A draft is the normal case here.
  const definition = await getQuizDefinition(body.quizId)
```
after:
```ts
  // WHATEVER ITS STATUS. A draft is the normal case here. But only this
  // business's (G35).
  const definition = await getQuizDefinition(businessId, body.quizId)
```

`app/api/admin/quizzes/[id]/route.ts`. Before:
```ts
  const existing = await getQuizDefinition(id)
  if (!existing) return notFound()
```
after:
```ts
  // UNDER THE CALLER'S BUSINESS (G35). Another business's quiz reads as
  // absent and gets the same 404 as one that does not exist, before anything
  // is written.
  const existing = await getQuizDefinition(businessId, id)
  if (!existing) return notFound()
```
Before:
```ts
    // Same 404-not-a-stranger posture as the rest of this route: `existing`
    // above is read by id alone (see the sweep note on `getQuizDefinition`),
    // so a quiz belonging to another business still passes that check. This
    // is the point that actually refuses it.
```
after:
```ts
    // Same 404-not-a-stranger posture as the rest of this route. Since G35
    // `existing` above is read under this business, so a foreign quiz has
    // already been refused by the time the save runs. This stays because it
    // is the save's OWN guard: every caller of saveQuizDefinition gets it,
    // whether or not that caller read the quiz first.
```
Before:
```ts
  const after = await getQuizDefinition(id)
```
after:
```ts
  const after = await getQuizDefinition(businessId, id)
```

`app/api/admin/quizzes/[id]/add-to-step/route.ts`. Before:
```ts
    // CROSS-TENANT COMPOSITION GUARD. `getQuizDefinition` below is scoped by
    // id alone (several of its other callers are public, unauthenticated
    // quiz-taking routes with no tenant to check against yet), so without
    // this an admin could compose another business's quiz onto their own
    // funnel page -- same shape as the saveQuizDefinition hole this task
    // already closed, except this route already holds a real businessId.
```
after:
```ts
    // CROSS-TENANT COMPOSITION GUARD. Without it an admin could compose
    // another business's quiz onto their own funnel page. Since G35
    // `getQuizDefinition` below is scoped by business too, so this is the
    // first of two checks giving the same answer. It stays first because it
    // runs before the body is parsed or any other row is read.
```
Before:
```ts
    const quiz = await getQuizDefinition(quizId)
```
after:
```ts
    const quiz = await getQuizDefinition(businessId, quizId)
```

`app/api/admin/funnels/route.ts`. Before:
```ts
      const source = isBuiltin ? toDefinition(RPI_ATHLETE_QUIZ) : await getQuizDefinition(quizIntake.copyFrom)
```
after (prettier breaks the line at 120):
```ts
      // Under THIS business (G35): another business's quiz reads as absent,
      // and gets the same "no longer exists" 400 as an invented id.
      const source = isBuiltin
        ? toDefinition(RPI_ATHLETE_QUIZ)
        : await getQuizDefinition(businessId, quizIntake.copyFrom)
```
Before:
```ts
      // CROSS-TENANT CLONE GUARD, skipped for the built-in sentinel (not a
      // database row at all). `getQuizDefinition` above is scoped by id
      // alone -- several of its other callers are public, unauthenticated
      // quiz-taking routes with no tenant to check against yet -- so without
      // this an admin could clone another business's full quiz content into
      // their own by naming its id as `copyFrom`. Same message and status as
      // "does not exist": telling the two apart would confirm the id names a
      // real quiz somewhere, just not one this caller may see.
```
after:
```ts
      // CROSS-TENANT CLONE GUARD, skipped for the built-in sentinel (not a
      // database row at all). Without it an admin could clone another
      // business's full quiz content into their own by naming its id as
      // `copyFrom`. Since G35 the read above refuses that too, so this is the
      // second of two checks giving the same answer. Same message and status
      // as "does not exist": telling the two apart would confirm the id names
      // a real quiz somewhere, just not one this caller may see.
```

`lib/funnels/sections/resolve.ts`. Before:
```ts
      const definition = await getQuizDefinition(row.id)
```
after:
```ts
      // Under the asking tenant (G35). The row came from `listQuizzes`, which
      // is already scoped, so this agrees by construction.
      const definition = await getQuizDefinition(businessId, row.id)
```

`components/funnels/islands/index.tsx`. Before:
```ts
export interface FunnelRenderContext {
  funnelId: string
  funnelSlug: string
  stepId: string
  stepSlug: string
```
after:
```ts
export interface FunnelRenderContext {
  /**
   * The business this page belongs to, as the ROUTE resolved it. On `/go` that
   * is the Host's tenant (lib/tenancy/public.ts). On `/preview` and
   * `/funnel-preview` it is the admin tenant (lib/tenancy/resolve.ts).
   * REQUIRED, so a route that forgets it is a compile error rather than an
   * island that quietly reads someone else's rows.
   *
   * An island reads its OWN rows under this, never under
   * `resolvePublicTenant()`. On the two preview routes the Host is the admin
   * screen's (the platform's), not the funnel's, so a Host read would make
   * preview and `/go` disagree about the same document. Added by G35 for the
   * quiz island. See QuizIsland.tsx.
   */
  businessId: string
  funnelId: string
  funnelSlug: string
  stepId: string
  stepSlug: string
```

`components/funnels/islands/QuizIsland.tsx`. Before:
```tsx
  const definition = await getQuizDefinition(quizId).catch(() => null)
```
after:
```tsx
  // UNDER THE ROUTE'S TENANT, NOT THE HOST'S (G35). `context.businessId` is
  // the tenant the page's own route resolved. On /go that is the Host's
  // business, the same one /api/quiz/progress will read this quiz under. On
  // /preview and /funnel-preview it is the admin tenant: those screens are
  // served from the platform's host whichever coach is looking, so a Host read
  // here would make a coach's own quiz vanish from their builder canvas while
  // /go on their host still showed it. That is preview and live disagreeing
  // about one page. A quiz id that is not this business's reads as absent and
  // renders nothing below. (The consent wording further down still reads the
  // Host. That is what /api/quiz/submit files under on the live page, and a
  // preview files nothing.)
  const definition = await getQuizDefinition(context.businessId, quizId).catch(() => null)
```

`app/(funnel)/go/[slug]/[[...step]]/page.tsx`. Before:
```tsx
          stepId: stepRow.id,
          stepSlug: stepRow.slug,
          isPreview,
        }}
```
after:
```tsx
          stepId: stepRow.id,
          stepSlug: stepRow.slug,
          isPreview,
          // The Host's tenant, the one `getPublishedStep` above was read
          // under. Islands read their own rows under it (G35).
          businessId,
        }}
```
`app/(funnel)/preview/[slug]/[[...step]]/page.tsx`. Before:
```tsx
            stepId: target.id,
            stepSlug: target.slug,
```
after:
```tsx
            stepId: target.id,
            stepSlug: target.slug,
            // THE ADMIN TENANT, not the Host's. This screen is served from the
            // admin's host whichever coach is looking. Islands read their own
            // rows under it, so the draft shows what /go on the funnel's own
            // host will (G35).
            businessId,
```
`app/(funnel)/funnel-preview/[stepId]/page.tsx`. Before:
```tsx
          stepId: step.id,
          stepSlug: step.slug,
```
after:
```tsx
          stepId: step.id,
          stepSlug: step.slug,
          // THE ADMIN TENANT, not the Host's: see the full-screen preview's
          // identical line. Islands read their own rows under it (G35).
          businessId,
```

`scripts/wire-rotational-reboot-funnel.ts`. Before: `    .select("id, key, name, status")`
After: `    .select("id, business_id, key, name, status")`

Before:
```ts
  const definition = await getQuizDefinition(quiz.id)
```
after:
```ts
  // Under the quiz's OWN business, read off its row. getQuizDefinition takes
  // the tenant first since G35, and this script has no session to resolve
  // one from.
  const definition = await getQuizDefinition(quiz.business_id, quiz.id)
```

`lib/tenancy/public.ts`, line 79 only. Before:
```ts
 *     app/api/quiz/progress/route.ts   (createAttempt; quiz/submit inherits)
```
after:
```ts
 *     app/api/quiz/progress/route.ts   (createAttempt; quiz/submit inherits.
 *                                       Since G35 it resolves FIRST, on every
 *                                       request: the quiz is read under the
 *                                       Host, and an existing attempt stamped
 *                                       with another business is refused)
```

- [ ] **Step 4: Run it and watch it pass**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/quizzes/quiz-dal.test.ts __tests__/lib/quizzes/quiz-create.test.ts __tests__/lib/quizzes/quiz-structural-save.test.ts __tests__/lib/quizzes/get-attempt-business.test.ts __tests__/api/quiz-progress.test.ts __tests__/api/quiz-submit.test.ts __tests__/api/quiz-submit-funnel-lead.test.ts __tests__/app/api/quiz/preview-submit.test.ts __tests__/api/admin-quiz-save.test.ts __tests__/api/admin-quiz-structural.test.ts __tests__/app/api/admin/quizzes/add-to-step-tenancy.test.ts __tests__/app/api/admin/quizzes/no-accessible-business.test.ts __tests__/api/funnels/create-quiz-funnel.test.ts __tests__/app/api/admin/funnels/create-route-audit.test.ts __tests__/app/api/admin/funnels/create-route-slug-conflict.test.ts __tests__/app/api/admin/funnels/delete-route-quiz.test.ts __tests__/app/api/admin/funnels/funnel-publish-route.test.ts __tests__/api/funnels/ai-plan-route.test.ts __tests__/api/funnels/offers-route.test.ts __tests__/lib/funnels/load-catalogues-tenancy.test.ts __tests__/lib/funnels/sections/resolve.test.ts __tests__/components/funnels/quiz-island-context.test.tsx __tests__/components/funnels/form-island-sms-consent.test.tsx __tests__/app/funnel-go-tenancy.test.tsx __tests__/app/draft-preview-route.test.tsx __tests__/app/funnel-draft-preview-page.test.tsx __tests__/lib/tenancy/public-inventory.test.ts __tests__/lib/tenancy/platform-inventory.test.ts`

Other suites that import or mock a changed module, and what they need:
- `quiz-submit-funnel-lead.test.ts`: argument-blind `getQuizDefinition`, and its `getAttempt` fixture already carries `businessId`. No edit.
- `admin-quiz-structural.test.ts`: argument-blind. The two reads per PATCH still consume its `mockResolvedValueOnce` pairs in order. No edit.
- `no-accessible-business.test.ts`: `getQuizDefinition` is `unreachable` and still is. No edit.
- `get-attempt-business.test.ts`: `getAttempt` is unchanged apart from its doc. No edit.
- `quiz-structural-save.test.ts`, `delete-route-quiz.test.ts`, `create-route-audit.test.ts`, `create-route-slug-conflict.test.ts`: they do not reach the changed read. No edit.
- `funnel-publish-route.test.ts`, `ai-plan-route.test.ts`, `offers-route.test.ts`: they import or mock `loadCatalogues` whole. No edit.
- `public-inventory.test.ts`: `quiz/progress` and `QuizIsland.tsx` still call the boundary, and `quiz/submit` still does not. No edit.
- `platform-inventory.test.ts`: no new `platformBusinessId()` reference. No edit.

Mutation checks. Apply each one alone, watch the named test go red, then restore:
- (a) `lib/db/quizzes.ts`: delete `.eq("business_id", businessId)`. quiz-dal "answers null for another business's quiz" goes red. This is the test that passed vacuously in Step 2.
- (b) Progress: drop `|| existing.businessId !== businessId`. "refuses to continue an attempt stamped with another business" goes red.
- (c) Progress: move the status check above the business check. "refuses it with the 404 even when finished" goes red.
- (d) Progress: `getQuizDefinition(body.quizId as never)`. "404s another business's quiz" goes red.
- (e) Submit: `getQuizDefinition(body.quizId as never)`. "404s when the quiz is not the attempt's business's" goes red.
- (f) QuizIsland: `getQuizDefinition(await resolvePublicTenant(), quizId)`. "reads the quiz under the ROUTE's tenant" goes red.
- (g) Preview-submit: `getQuizDefinition(body.quizId as never)`. "404s another business's quiz" goes red.

Build gate: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit -p . > <scratchpad>/tsc-task4.txt`, then `grep -E "lib/db/quizzes|app/api/quiz/|admin/quizzes|admin/funnels/route|sections/resolve|funnels/islands|funnel\)/|wire-rotational|tenancy/public|quiz-dal|quiz-create|quiz-progress|quiz-submit|preview-submit|admin-quiz-save|add-to-step|create-quiz-funnel|load-catalogues|resolve\.test|quiz-island|form-island-sms|funnel-go-tenancy|draft-preview|funnel-draft-preview" <scratchpad>/tsc-task4.txt`. Expect no output. None of these files is in `.claude/baselines/tsc-ce6f2aba-perfile.txt`.

- [ ] **Step 5: Commit**

`git add lib/db/quizzes.ts app/api/quiz/progress/route.ts app/api/quiz/submit/route.ts app/api/quiz/preview-submit/route.ts "app/api/admin/quizzes/[id]/route.ts" "app/api/admin/quizzes/[id]/add-to-step/route.ts" app/api/admin/funnels/route.ts lib/funnels/sections/resolve.ts components/funnels/islands/index.tsx components/funnels/islands/QuizIsland.tsx "app/(funnel)/go/[slug]/[[...step]]/page.tsx" "app/(funnel)/preview/[slug]/[[...step]]/page.tsx" "app/(funnel)/funnel-preview/[stepId]/page.tsx" scripts/wire-rotational-reboot-funnel.ts lib/tenancy/public.ts __tests__/lib/quizzes/quiz-dal.test.ts __tests__/lib/quizzes/quiz-create.test.ts __tests__/api/quiz-progress.test.ts __tests__/api/quiz-submit.test.ts __tests__/app/api/quiz/preview-submit.test.ts __tests__/api/admin-quiz-save.test.ts __tests__/app/api/admin/quizzes/add-to-step-tenancy.test.ts __tests__/api/funnels/create-quiz-funnel.test.ts __tests__/lib/funnels/load-catalogues-tenancy.test.ts __tests__/lib/funnels/sections/resolve.test.ts __tests__/components/funnels/quiz-island-context.test.tsx __tests__/components/funnels/form-island-sms-consent.test.tsx __tests__/app/funnel-go-tenancy.test.tsx __tests__/app/draft-preview-route.test.tsx __tests__/app/funnel-draft-preview-page.test.tsx`

`git commit -m "fix(quizzes): read a quiz under a tenant, and fence attempts to the Host (G35 A4)" -m "getQuizDefinition read by id alone and nothing compared a quiz's business with an attempt's, so business B's host could open an attempt (stamped B) on business A's quiz and /api/quiz/submit filed B's contact, card and consent row against it. The tenant is now required: progress resolves the Host first and reads the quiz under it, refusing an existing attempt stamped with another business (404, before the status check). Submit reads the quiz under the attempt's business and still resolves nothing. Preview-submit and the admin routes pass the admin tenant, and loadCatalogues passes its own." -m "The quiz island reads under the route's tenant through a new required FunnelRenderContext.businessId, set by /go (Host) and both preview routes (admin), because on the previews the Host is the admin screen's and a Host read would hide a coach's own quiz from their canvas. getAttempt stays keyed on its bearer-token id, and its doc comment says why."`

---


### Task 5: Contact and inquiry bell alerts go to the site business's owners and coaches

**Files:**
- Modify: `lib/db/business-members.ts:63-65` (insert `LEAD_ALERT_ROLES` and `listBusinessMemberUserIds` between `listBusinessMembers` and `addBusinessMember`)
- Modify: `app/api/contact/route.ts:9`, `:82-99`
- Modify: `app/api/inquiry/route.ts:21`, `:228-229`, `:259-261`, `:268`, `:331`, `:349`, `:356-357`, `:375-376`
- Test: `__tests__/db/business-members.test.ts` (extend; note the directory is `__tests__/db/`, not `__tests__/lib/db/`)
- Test: `__tests__/api/spine/contact-spine.test.ts` (extend)
- Test: `__tests__/api/spine/inquiry-spine.test.ts` (extend)
- Modify (test fixture): `__tests__/api/spine/inquiry-pipeline.test.ts:70-72`, `__tests__/api/inquiry/attribution-capture.test.ts:48-51`, `:102-103`

**Interfaces:**
- Consumes: none
- Produces:
  - `export const LEAD_ALERT_ROLES = ["owner", "coach"] as const satisfies readonly BusinessMemberRole[]` (from `@/lib/db/business-members`)
  - `export async function listBusinessMemberUserIds(businessId: string, roles: readonly [BusinessMemberRole, ...BusinessMemberRole[]]): Promise<string[]>`. It returns the members' ids ordered by `created_at` asc, then `user_id` asc. It **throws** `Error("listBusinessMemberUserIds failed (<code>): <message>")` when the read fails.

- [ ] **Step 1: Write the failing test**

`__tests__/db/business-members.test.ts`: six exact-string edits, then append.

Edit 1. Before:
```ts
const eqCalls: Array<[string, unknown]> = []
const inserts: unknown[] = []
```
After:
```ts
const eqCalls: Array<[string, unknown]> = []
const inCalls: Array<[string, unknown]> = []
const orderCalls: Array<[string, unknown]> = []
const fromCalls: string[] = []
const inserts: unknown[] = []
// Rows a LIST read resolves with. Null falls back to the single-row fixture.
let listRows: unknown[] | null = null
```
Edit 2. Before:
```ts
    from: () => {
      const chain: Record<string, unknown> = {}
```
After:
```ts
    from: (table: string) => {
      fromCalls.push(table)
      const chain: Record<string, unknown> = {}
```
Edit 3. Before:
```ts
      chain.order = self
```
After (the one-liner style matches the rest of this mock):
```ts
      chain.order = (c: string, o: unknown) => { orderCalls.push([c, o]); return chain }
      chain.in = (c: string, v: unknown) => { inCalls.push([c, v]); return chain }
```
Edit 4. Before:
```ts
Promise.resolve({ data: existingRow ? [existingRow] : [], error: existingError })
```
After:
```ts
Promise.resolve({ data: listRows ?? (existingRow ? [existingRow] : []), error: existingError })
```
Edit 5. Before:
```ts
import { addBusinessMember, isBusinessMember } from "@/lib/db/business-members"
```
After:
```ts
import {
  addBusinessMember,
  isBusinessMember,
  LEAD_ALERT_ROLES,
  listBusinessMemberUserIds,
} from "@/lib/db/business-members"
```
Edit 6. Before:
```ts
  eqCalls.length = 0
  inserts.length = 0
```
After:
```ts
  eqCalls.length = 0
  inCalls.length = 0
  orderCalls.length = 0
  fromCalls.length = 0
  inserts.length = 0
  listRows = null
```
Append at the end of the file:
```ts

// G35. The contact and inquiry routes bell these people instead of every
// `users.role = 'admin'` row. The mock records the filters the reader asks
// for; it does not apply them, so each filter is asserted by name.
describe("listBusinessMemberUserIds", () => {
  it("reads only THIS business's members, only in the roles asked for, oldest first", async () => {
    // MUTANT: drop `.eq("business_id", …)` — every business's owners and
    // coaches get this business's lead alerts. MUTANT: drop `.in("role", …)` —
    // staff get them too. MUTANT: drop either `.order` — the inquiry route's
    // analysis requester becomes whichever row Postgres returned first.
    listRows = [{ user_id: "u-owner" }, { user_id: "u-coach" }]

    const ids = await listBusinessMemberUserIds("bbb", ["owner", "coach"])

    expect(ids).toEqual(["u-owner", "u-coach"])
    expect(fromCalls).toEqual(["business_members"])
    expect(eqCalls).toEqual([["business_id", "bbb"]])
    expect(inCalls).toEqual([["role", ["owner", "coach"]]])
    expect(orderCalls).toEqual([
      ["created_at", { ascending: true }],
      ["user_id", { ascending: true }],
    ])
  })

  it("passes the roles it was given, not a fixed set (the control for the role filter)", async () => {
    listRows = []
    await listBusinessMemberUserIds("bbb", ["owner"])
    expect(inCalls).toEqual([["role", ["owner"]]])
  })

  it("answers [] for a business with nobody in those roles — an empty result, not an error", async () => {
    listRows = []
    expect(await listBusinessMemberUserIds("bbb", ["owner", "coach"])).toEqual([])
  })

  it("throws when the read fails — a failed read is not 'nobody to tell'", async () => {
    // MUTANT: `return []` on error. The routes could then not tell a business
    // with no owner from a read that never happened, and the log line that is
    // the only trace of a lost alert would never be written.
    existingError = { code: "42P01", message: "no such table" }
    await expect(listBusinessMemberUserIds("bbb", ["owner", "coach"])).rejects.toThrow(/42P01/)
  })
})

describe("LEAD_ALERT_ROLES", () => {
  it("is exactly owners and coaches — the owner's ruling for contact and inquiry bells (G35)", () => {
    // Exact, so `staff` joining the list fails here as well as in the routes'
    // own call assertions.
    expect([...LEAD_ALERT_ROLES]).toEqual(["owner", "coach"])
  })
})
```

`__tests__/api/spine/contact-spine.test.ts`: three edits, then append.

Edit 1. Before:
```ts
  sendContactAutoReply: vi.fn(),
}))
```
After:
```ts
  sendContactAutoReply: vi.fn(),
  listBusinessMemberUserIds: vi.fn(),
}))
```
Edit 2. Before:
```ts
vi.mock("@/lib/email", () => ({
  sendContactFormEmail: mocks.sendContactFormEmail,
  sendContactAutoReply: mocks.sendContactAutoReply,
}))
```
After:
```ts
vi.mock("@/lib/email", () => ({
  sendContactFormEmail: mocks.sendContactFormEmail,
  sendContactAutoReply: mocks.sendContactAutoReply,
}))
// The bell's recipients (G35). Only the reader is replaced: LEAD_ALERT_ROLES
// stays the real constant, so the call assertions below check what the route
// actually passes.
vi.mock("@/lib/db/business-members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/business-members")>()),
  listBusinessMemberUserIds: mocks.listBusinessMemberUserIds,
}))
```
Edit 3. Before:
```ts
  mocks.sendContactAutoReply.mockResolvedValue(undefined)
})
```
After:
```ts
  mocks.sendContactAutoReply.mockResolvedValue(undefined)
  // Nobody to bell unless a test says otherwise: the state every older test
  // here was written against (no admin in `state.users`).
  mocks.listBusinessMemberUserIds.mockResolvedValue([])
})
```
Append at the end of the file:
```ts

// G35. The bell used to go to `users where role = 'admin'` — every platform
// operator, whichever business's site the message came from. It now goes to
// the site business's owners and coaches, read through business_members.
// PLATFORM_ADMIN is what the old read would have found; every test seeds it,
// so a route that still made that read would bell it.
describe("POST /api/contact — who gets the bell (G35)", () => {
  const PLATFORM_ADMIN = { id: "platform-admin", email: "ops@example.com", role: "admin" }

  it("bells the site business's owners and coaches, not every platform admin", async () => {
    // MUTANT: the old `users where role = 'admin'` read — it bells
    // platform-admin and neither owner-1 nor coach-1. MUTANT: the platform's
    // id, or `staff` among the roles — the call assertion fails.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue(["owner-1", "coach-1"])

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(mocks.listBusinessMemberUserIds).toHaveBeenCalledWith("host-biz", ["owner", "coach"])
    expect(state.notifications.map((n) => n.user_id)).toEqual(["owner-1", "coach-1"])
  })

  it("files no bell when the business has no owner or coach — it never falls back to the platform's admins", async () => {
    // MUTANT: an empty recipient list falling back to the `users` admin read.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue([])

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(state.notifications).toEqual([])
    // Presence control: the rest of the route ran, so the absence above is
    // not the route having stopped early.
    expect(mocks.sendContactFormEmail).toHaveBeenCalledTimes(1)
  })

  it("logs a failed recipients read and still sends the email, the auto-reply and the CRM sync", async () => {
    // MUTANT: the old early `return` on a failed read, which also skipped both
    // emails and the CRM sync. MUTANT: a catch that swallows without logging,
    // so the lost alert leaves no trace.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockRejectedValue(
      new Error("listBusinessMemberUserIds failed (42P01): no such table"),
    )

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(state.notifications).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("no bell alert"),
      expect.objectContaining({ message: expect.stringContaining("42P01") }),
    )
    expect(mocks.sendContactFormEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendContactAutoReply).toHaveBeenCalledTimes(1)
    expect(mocks.ghlCreateContact).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
```

`__tests__/api/spine/inquiry-spine.test.ts`: seven edits, then append.

Edit 1. Before:
```ts
const state: { users: Row[] } = { users: [] }
```
After:
```ts
const state: { users: Row[]; notifications: Row[] } = { users: [], notifications: [] }
```
Edit 2. Before:
```ts
  getBusinessSettings: vi.fn(),
}))
```
After:
```ts
  getBusinessSettings: vi.fn(),
  listBusinessMemberUserIds: vi.fn(),
}))
```
Edit 3. Before:
```ts
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: mocks.getBusinessSettings,
}))
```
After:
```ts
vi.mock("@/lib/db/businesses", () => ({
  getBusinessSettings: mocks.getBusinessSettings,
}))
// The bell's recipients (G35). Only the reader is replaced: LEAD_ALERT_ROLES
// stays the real constant, so the call assertions below check what the route
// actually passes.
vi.mock("@/lib/db/business-members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/business-members")>()),
  listBusinessMemberUserIds: mocks.listBusinessMemberUserIds,
}))
```
Edit 4. Before:
```ts
              // admins lookup: `await supabase.from("users").select("id").eq("role","admin")`
```
After:
```ts
              // The pre-G35 admin read (`.eq("role", "admin")`) resolved through
              // here. Kept so the bell tests below can seed a platform admin that
              // a route still making that read would find.
```
Edit 5. Before:
```ts
      return {
        insert: async () => ({ error: null }),
        select: () => ({ eq: async () => ({ data: [] }) }),
      }
```
After:
```ts
      return {
        // `notifications` rows are kept so the bell tests can say who was told;
        // every other table's insert is accepted and forgotten.
        insert: async (payload: Row | Row[]) => {
          if (table === "notifications") state.notifications.push(...(Array.isArray(payload) ? payload : [payload]))
          return { error: null }
        },
        select: () => ({ eq: async () => ({ data: [] }) }),
      }
```
Edit 6. Before:
```ts
  state.users = []
  vi.clearAllMocks()
```
After:
```ts
  state.users = []
  state.notifications = []
  vi.clearAllMocks()
```
Edit 7. Before:
```ts
  mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "Acme Fitness" })
})
```
After:
```ts
  mocks.getBusinessSettings.mockResolvedValue({ business_id: "biz-1", display_name: "Acme Fitness" })
  // Nobody to bell unless a test says otherwise: the state every older test
  // here was written against (no admin in `state.users`), which also keeps the
  // lead analysis off, as it was.
  mocks.listBusinessMemberUserIds.mockResolvedValue([])
})
```
Append at the end of the file:
```ts

// G35. Same change as POST /api/contact: the bell goes to the site business's
// owners and coaches, not to every `users.role = 'admin'` row. This route also
// named its FIRST admin as the requester of the lead analysis, so that moves
// with it. PLATFORM_ADMIN is what the old read would have found.
describe("POST /api/inquiry — who gets the bell (G35)", () => {
  const PLATFORM_ADMIN = { id: "platform-admin", email: "ops@example.com", role: "admin" }

  beforeEach(() => {
    // With a recipient present the lead analysis runs, so its collaborators
    // answer the way the real ones do. A bare vi.fn() returns undefined, and the
    // route's failure path calls `recordAudit(...).catch`, which would throw
    // into the outer catch and turn every test here into a 500.
    mocks.createGenerationLog.mockResolvedValue({ id: "log-1" })
    mocks.updateGenerationLog.mockResolvedValue(undefined)
    mocks.updateLeadInquiryAiFields.mockResolvedValue(undefined)
    mocks.recordAudit.mockResolvedValue(undefined)
    mocks.generateLeadAnalysis.mockResolvedValue({
      content: { priority: "high", priority_reason: "Ready now", summary: "Sprinter", draft_reply: "Hi Ada" },
      tokens_used: 10,
    })
  })

  it("bells the site business's owners and coaches, not every platform admin", async () => {
    // MUTANT: the old `users where role = 'admin'` read — it bells
    // platform-admin and neither owner-1 nor coach-1. MUTANT: the platform's
    // id, or `staff` among the roles — the call assertion fails.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue(["owner-1", "coach-1"])

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(mocks.listBusinessMemberUserIds).toHaveBeenCalledWith("host-biz", ["owner", "coach"])
    expect(state.notifications.map((n) => n.user_id)).toEqual(["owner-1", "coach-1"])
  })

  it("names the business's first owner or coach as the analysis requester, not a platform admin", async () => {
    // MUTANT: the requester still taken from the `users` admin read — the log
    // row and the audit actor would both name platform-admin.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue(["owner-1", "coach-1"])

    await post(VALID_BODY)

    expect(mocks.createGenerationLog).toHaveBeenCalledWith(expect.objectContaining({ requested_by: "owner-1" }))
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "lead.ai_analysis_generated", actor: { id: "owner-1", role: "system" } }),
    )
  })

  it("files no bell and runs no analysis for a business with no owner or coach — never the platform's admins", async () => {
    // MUTANT: an empty recipient list falling back to the `users` admin read.
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockResolvedValue([])

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(state.notifications).toEqual([])
    expect(mocks.createGenerationLog).not.toHaveBeenCalled()
    // Presence control: the rest of the route ran, so the absences above are
    // not the route having stopped early.
    expect(mocks.createLeadInquiry).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryEmail).toHaveBeenCalledTimes(1)
  })

  it("logs a failed recipients read and still captures the inquiry and sends both emails", async () => {
    // MUTANT: a catch that swallows without logging, so the lost alert leaves
    // no trace. MUTANT: no catch at all — the throw reaches the route's outer
    // catch, and an applicant who already submitted is told it went wrong.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    state.users = [PLATFORM_ADMIN]
    mocks.listBusinessMemberUserIds.mockRejectedValue(
      new Error("listBusinessMemberUserIds failed (42P01): no such table"),
    )

    const res = await post(VALID_BODY)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(state.notifications).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("no bell alert"),
      expect.objectContaining({ message: expect.stringContaining("42P01") }),
    )
    expect(mocks.createLeadInquiry).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInquiryAutoReply).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

From the worktree root:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/db/business-members.test.ts __tests__/api/spine/contact-spine.test.ts __tests__/api/spine/inquiry-spine.test.ts
```
Expected: `Tests 12 failed | 28 passed (40)`. Every test that already existed stays green.
  - DAL suite: 4 × `TypeError: __vi_import_0__.listBusinessMemberUserIds is not a function` and 1 × `TypeError: __vi_import_0__.LEAD_ALERT_ROLES is not iterable`.
  - Route suites: 2 × `expected "vi.fn()" to be called with arguments: [ 'host-biz', [ 'owner', 'coach' ] ]`.
  - Route suites: 4 × `expected [ { user_id: 'platform-admin', …(5) } ] to deeply equal []`. These are the old admin read belling the seeded platform admin.
  - Inquiry suite: 1 × `expected "vi.fn()" to be called with arguments: [ ObjectContaining{…} ]`. This is the analysis requester, which is still `platform-admin`.

- [ ] **Step 3: Implement**

`lib/db/business-members.ts`. Before:
```ts
    last_name: r.users.last_name,
  }))
}

/**
 * Idempotent by construction. business_members is
```
After:
```ts
    last_name: r.users.last_name,
  }))
}

/**
 * WHO IS TOLD, IN THE ADMIN BELL, THAT A LEAD ARRIVED ON THIS BUSINESS'S SITE:
 * its owners and coaches. The owner's ruling (G35, 2026-09-25), shared by the
 * contact form and the inquiry form so the two cannot drift apart.
 *
 * Staff are left out by that ruling, not by oversight. 00246 made every
 * platform teammate a `staff` member of the platform business, so adding
 * `staff` here would start belling all of them about every contact form.
 *
 * Before G35 both routes belled `users where role = 'admin'`: every platform
 * operator, whichever business's site the lead came from. That is the same
 * cross-tenant broadcast the "New Call Booked" fan-out in
 * lib/bookings/ingest.ts already stopped being.
 */
export const LEAD_ALERT_ROLES = ["owner", "coach"] as const satisfies readonly BusinessMemberRole[]

/**
 * The user ids of `businessId`'s members holding one of `roles`, oldest
 * membership first, then by user id, so two rows sharing a `created_at` still
 * come back in one order. The inquiry route names the FIRST of them as the
 * requester of its lead analysis, which is why the order is fixed rather than
 * whatever Postgres happens to return.
 *
 * THROWS on a failed read, like every reader in this file. A failed read is
 * not "nobody to tell": answering [] would make "this business has no owner"
 * and "the alert was lost to an error" the same silence. The caller decides
 * what a lost alert costs (both lead routes log it and carry on, because the
 * visitor's submission has already succeeded).
 *
 * `roles` is non-empty by type. `.in("role", [])` asks PostgREST for
 * `role=in.()`, and a caller that built its list wrong should fail to compile,
 * not quietly bell nobody.
 */
export async function listBusinessMemberUserIds(
  businessId: string,
  roles: readonly [BusinessMemberRole, ...BusinessMemberRole[]],
): Promise<string[]> {
  const { data, error } = await getClient()
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .in("role", roles)
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true })
  if (error) throw new Error(`listBusinessMemberUserIds failed (${error.code}): ${error.message}`)
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
}

/**
 * Idempotent by construction. business_members is
```

`app/api/contact/route.ts`, import. Before:
```ts
import { resolvePublicTenant } from "@/lib/tenancy/public"
```
After:
```ts
import { resolvePublicTenant } from "@/lib/tenancy/public"
import { LEAD_ALERT_ROLES, listBusinessMemberUserIds } from "@/lib/db/business-members"
```
`app/api/contact/route.ts`, recipients. Before:
```ts
    // Find all admin users to notify
    const { data: admins, error: adminsError } = await supabase.from("users").select("id").eq("role", "admin")

    if (adminsError) {
      console.error("Failed to fetch admin users:", adminsError)
      // Still return success to the client — we don't want to expose internal errors
      return NextResponse.json({ success: true })
    }

    if (admins && admins.length > 0) {
      const notifications = admins.map((admin) => ({
        user_id: admin.id,
```
After:
```ts
    // WHO GETS THE BELL: this business's owners and coaches (LEAD_ALERT_ROLES,
    // the owner's ruling in G35), not `users where role = 'admin'`. That read
    // belled every platform operator about every business's contact form — a
    // cross-tenant broadcast the moment a second business's site takes a
    // message. `businessId` is the Host tenant resolved above.
    //
    // A FAILED READ IS LOGGED AND THE ROUTE CARRIES ON. It used to `return`
    // here, so a failed recipients read also skipped the email below, the
    // visitor's auto-reply and the CRM sync — none of which depends on who
    // gets a bell. The DAL throws rather than answering [] precisely so that
    // this line exists: an empty list would read as "this business has nobody
    // to tell" and leave no trace of the lost alert.
    let alertRecipients: string[] = []
    try {
      alertRecipients = await listBusinessMemberUserIds(businessId, LEAD_ALERT_ROLES)
    } catch (err) {
      console.error("[contact] could not read this business's owners and coaches; no bell alert was filed:", err)
    }

    if (alertRecipients.length > 0) {
      const notifications = alertRecipients.map((userId) => ({
        user_id: userId,
```

`app/api/inquiry/route.ts`, import. Before:
```ts
import { resolvePublicTenant } from "@/lib/tenancy/public"
```
After:
```ts
import { resolvePublicTenant } from "@/lib/tenancy/public"
import { LEAD_ALERT_ROLES, listBusinessMemberUserIds } from "@/lib/db/business-members"
```
`app/api/inquiry/route.ts`, recipients. Before:
```ts
    // Notify all admins
    const { data: admins } = await supabase.from("users").select("id").eq("role", "admin")
```
After:
```ts
    // WHO GETS THE BELL: this business's owners and coaches (LEAD_ALERT_ROLES,
    // the owner's ruling in G35), not every `users.role = 'admin'` row in the
    // deployment. That read belled every platform operator about every
    // business's applications. G30 moved the EMAIL half of this alert to the
    // business's own `reply_to`; this moves the bell half. Read here, before
    // the inquiry row, because the lead analysis below names its first entry.
    //
    // A FAILED READ IS LOGGED AND THE ROUTE CARRIES ON: the applicant's
    // submission is already captured, and neither the coach's email nor the
    // auto-reply depends on who gets a bell. The DAL throws rather than
    // answering [] so that a lost alert leaves this line behind.
    let alertRecipients: string[] = []
    try {
      alertRecipients = await listBusinessMemberUserIds(businessId, LEAD_ALERT_ROLES)
    } catch (err) {
      console.error("[inquiry] could not read this business's owners and coaches; no bell alert was filed:", err)
    }
```
`app/api/inquiry/route.ts`, analysis requester. Before:
```ts
    let aiAnalysis: LeadAnalysisResult | null = null
    const firstAdminId = admins?.[0]?.id ?? null
    if (leadInquiryId && firstAdminId) {
```
After:
```ts
    let aiAnalysis: LeadAnalysisResult | null = null
    // Logged as requested by this business's longest-standing owner or coach —
    // the first recipient, in the DAL's fixed order — rather than by whichever
    // platform admin a `users` read happened to return first. Both
    // `ai_generation_log.requested_by` and the audit actor name a person, and
    // for a coach's lead that person is theirs. No recipient (a business with
    // no owner or coach, or a failed read) skips the analysis exactly as "no
    // admin" always did; the inquiry row and both emails are unaffected.
    const analysisRequesterId = alertRecipients[0] ?? null
    if (leadInquiryId && analysisRequesterId) {
```
`app/api/inquiry/route.ts`. Before: `          requested_by: firstAdminId,` After: `          requested_by: analysisRequesterId,`

`app/api/inquiry/route.ts`, **replace_all, 2 occurrences** (`:331`, `:349`). Before: `          actor: { id: firstAdminId, role: "system" },` After: `          actor: { id: analysisRequesterId, role: "system" },`

`app/api/inquiry/route.ts`. Before:
```ts
    if (admins && admins.length > 0) {
      const details = [
```
After:
```ts
    if (alertRecipients.length > 0) {
      const details = [
```
`app/api/inquiry/route.ts`. Before:
```ts
      const notifications = admins.map((admin) => ({
        user_id: admin.id,
```
After:
```ts
      const notifications = alertRecipients.map((userId) => ({
        user_id: userId,
```

- [ ] **Step 4: Run it and watch it pass**

Two more suites import the inquiry route without mocking the new module. Apply these fixture edits first. Without them each run takes a TypeError into the route's new catch: the stubs have no `.in`, and the error lands in the log.

`__tests__/api/spine/inquiry-pipeline.test.ts`. Before:
```ts
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: mocks.applyPipelineEvent,
}))
```
After:
```ts
vi.mock("@/lib/db/pipeline", () => ({
  applyPipelineEvent: mocks.applyPipelineEvent,
}))
// G35: the bell's recipients come from business_members. Nothing here is about
// who is told, so the read answers nobody — what the old `users` admin read
// answered against this suite's empty `state.users`.
vi.mock("@/lib/db/business-members", () => ({
  LEAD_ALERT_ROLES: ["owner", "coach"],
  listBusinessMemberUserIds: vi.fn().mockResolvedValue([]),
}))
```
`__tests__/api/inquiry/attribution-capture.test.ts`. Before:
```ts
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: vi.fn(),
  updateGenerationLog: vi.fn(),
}))
```
After:
```ts
vi.mock("@/lib/db/ai-generation-log", () => ({
  createGenerationLog: vi.fn(),
  updateGenerationLog: vi.fn(),
}))
// G35: the bell's recipients come from business_members. Nothing here is about
// who is told, so the read answers nobody — what the old `users` admin read
// answered against this suite's stub.
vi.mock("@/lib/db/business-members", () => ({
  LEAD_ALERT_ROLES: ["owner", "coach"],
  listBusinessMemberUserIds: vi.fn().mockResolvedValue([]),
}))
```
The same file also has a stale comment. Before:
```ts
// The route's `admins` lookup uses `.select().eq()` which our stub resolves to
// `{ data: [] }`; no admin notifications are asserted here.
```
After:
```ts
// The bell's recipients come from the business-members mock above, which
// answers nobody; no notifications are asserted here.
```
Three suites mock `@/lib/db/business-members` with their own factories. They need **no edit**, because none of them imports either route: `__tests__/api/admin/business-members-route.test.ts`, `__tests__/api/public/invite-claim.test.ts` and `__tests__/app/funnel-go-tenancy.test.tsx`.

Run:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/db/business-members.test.ts __tests__/api/spine/contact-spine.test.ts __tests__/api/spine/inquiry-spine.test.ts __tests__/api/spine/inquiry-pipeline.test.ts __tests__/api/inquiry/attribution-capture.test.ts __tests__/api/admin/business-members-route.test.ts __tests__/api/public/invite-claim.test.ts __tests__/app/funnel-go-tenancy.test.tsx
```
Expected: 8 files and 91 tests, all passing (12 + 6 + 22 + 5 + 11 + 11 + 14 + 10). The log line `[inquiry] pipeline hook failed … .eq is not a function` in the inquiry suites comes from the unmocked pipeline DAL and is not new.

Prove each guard can fail. Apply one mutant, run the named suite, check that it goes red, then revert:
  - drop `.eq("business_id", businessId)` in `listBusinessMemberUserIds` → `business-members.test.ts` "reads only THIS business's members…" fails;
  - drop `.in("role", roles)` → that test and "passes the roles it was given…" both fail;
  - put `if (error) return []` before the throw → "throws when the read fails…" fails;
  - contact route: put `return NextResponse.json({ success: true })` inside the catch → contact "logs a failed recipients read…" fails;
  - contact or inquiry: remove the `console.error` from the catch → that suite's "logs a failed recipients read…" fails;
  - inquiry: remove the try/catch around the read → "logs a failed recipients read…" fails with a 500.

Then run `npm run test:integration:selects` (read-only, dev clone). The new `business_members.select("user_id")` with orders `created_at` and `user_id` is collected as resolved, and all of those columns exist.

- [ ] **Step 5: Commit**
```
git -C "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/g35-untenanted-readers" add lib/db/business-members.ts app/api/contact/route.ts app/api/inquiry/route.ts __tests__/db/business-members.test.ts __tests__/api/spine/contact-spine.test.ts __tests__/api/spine/inquiry-spine.test.ts __tests__/api/spine/inquiry-pipeline.test.ts __tests__/api/inquiry/attribution-capture.test.ts
```
```
git -C "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/g35-untenanted-readers" commit -m "fix(tenancy): bell a lead's own business, not every platform admin (G35)" -m "The contact and inquiry routes belled users where role = 'admin': every platform operator, whichever business's site the lead came from. Both routes already hold the Host tenant, so they now bell that business's owners and coaches (the owner's ruling) through one DAL reader, listBusinessMemberUserIds, and one shared LEAD_ALERT_ROLES." -m "A failed recipients read is logged and the route carries on. The contact route used to return early on that failure, which also skipped the coach's email, the visitor's auto-reply and the CRM sync." -m "The inquiry route's lead analysis is now requested by the business's first owner or coach (fixed created_at, user_id order) instead of the first admin row, so ai_generation_log and the audit actor name that business's own person."
```

---

### Task 6: Chat facts answer only the platform business

**Files:**
- Modify: `lib/lead-engine/chat/facts.ts:26-28` (header), `:32-33` (import), `:401-402` (new gate before the FAQ reader), `:410-414` (`searchPublicFaqs`), `:467-470` (`listPublicProgrammes`), `:552-553` (`listPublicTestimonials`)
- Modify: `lib/lead-engine/chat/tools.ts:216-219` (ExecutorContext doc), `:441` (new `tenantFor`), `:586-601`, `:609`
- Modify: `lib/tenancy/platform.ts:150-152` (a new NARROWER VARIANT entry directly after the chat booking-offer entry)
- Test: `__tests__/lib/lead-engine/chat-facts-tenancy.test.ts` (extend)
- Test: `__tests__/lib/lead-engine/chat-tools.test.ts` (extend; also retarget `:177-178` and `:191-192`)
- Modify (callers of the new signature): `__tests__/lib/lead-engine/chat-facts.test.ts:17`, `:100`, `:127`, `:138`, `:171`, `:228`, `:332`, `:355`, `:381`, `:395`, `:406`

**Interfaces:**
- Consumes: `platformBusinessId(): string` from `@/lib/tenancy/platform` (existing)
- Produces:
  - `searchPublicFaqs(businessId: string, query: string, pageKey?: string): Promise<Fact[]>`
  - `listPublicProgrammes(businessId: string): Promise<Fact[]>`
  - `listPublicTestimonials(businessId: string): Promise<Fact[]>`
  - All three return `[]` before any query when `businessId !== platformBusinessId()`.
  - In `createToolExecutor`: `search_faqs`, `list_programmes`, `list_testimonials` and `list_camps_and_clinics` all throw `[chat-tools] <tool> called without ctx.businessId` when `ctx.businessId` is missing.

- [ ] **Step 1: Write the failing test**

`__tests__/lib/lead-engine/chat-facts-tenancy.test.ts`: four edits, then append.

Edit 1. Before:
```ts
const applied: Array<Record<string, unknown>> = []
let rows: Record<string, unknown>[] = []
```
After:
```ts
const applied: Array<Record<string, unknown>> = []
// Every table a reader opened a client on — the proof, for the G35 tests
// below, that another business's lookup never reached the database at all.
const opened: string[] = []
let rows: Record<string, unknown>[] = []
```
Edit 2. Before:
```ts
    from(table: string) {
      const filters: Record<string, unknown> = { __table: table }
```
After:
```ts
    from(table: string) {
      opened.push(table)
      const filters: Record<string, unknown> = { __table: table }
```
Edit 3. Before:
```ts
const HOST_BIZ = "host-biz"
```
After:
```ts
// The seam, mocked to a sentinel that is NOT the singleton's literal, so a
// reader comparing against a hard-coded id instead of asking the seam fails the
// platform controls below. listPublicEvents never consults it.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))

const HOST_BIZ = "host-biz"
```
Edit 4. Before:
```ts
beforeEach(() => {
  applied.length = 0
  rows = []
})
```
After:
```ts
beforeEach(() => {
  applied.length = 0
  opened.length = 0
  rows = []
})
```
Append at the end of the file:
```ts

// ---------------------------------------------------------------------------
// G35. `faqs`, `programs` and `testimonials` have NO business_id column, so no
// predicate can scope them: every row is the platform business's own. The
// owner's ruling is that another business's conversation gets NOTHING from
// them, never the platform's rows under that coach's name, and gets it before
// any query is made.
// ---------------------------------------------------------------------------

const PLATFORM_BIZ = "platform-biz"
const COACH_BIZ = "coach-biz"

const FAQ = { question: "How much is the camp?", answer: "Camp pricing", status: "published", page_key: "faq" }
const PROGRAMME = {
  name: "Rotational Reboot",
  is_active: true,
  is_public: true,
  price_cents: 7900,
  duration_weeks: 6,
  sessions_per_week: 3,
  payment_type: "one_time",
}
const TESTIMONIAL = { quote: "Best coaching around.", name: "Sam R.", is_active: true, display_order: 0 }

// Each "nothing" test kills two mutants: the gate deleted (the platform's row
// comes back), and the gate moved AFTER the read, filtering what came back
// (`opened` is no longer empty). Each control beside it proves the reader
// still answers the platform business, so the "nothing" is not a broken reader.
describe("the platform's own FAQs, programmes and testimonials (G35)", () => {
  it("gives another business's conversation no FAQs, and opens no client", async () => {
    const { searchPublicFaqs } = await import("@/lib/lead-engine/chat/facts")
    rows = [FAQ]
    expect(await searchPublicFaqs(COACH_BIZ, "camp pricing")).toEqual([])
    expect(opened).toEqual([])
  })

  it("still answers the platform business's conversation from its FAQs (control)", async () => {
    const { searchPublicFaqs } = await import("@/lib/lead-engine/chat/facts")
    rows = [FAQ]
    const facts = (await searchPublicFaqs(PLATFORM_BIZ, "camp pricing")) as Array<{ question: string }>
    expect(facts.map((f) => f.question)).toEqual(["How much is the camp?"])
    expect(opened).toEqual(["faqs"])
  })

  it("gives another business's conversation no programmes, and opens no client", async () => {
    const { listPublicProgrammes } = await import("@/lib/lead-engine/chat/facts")
    rows = [PROGRAMME]
    expect(await listPublicProgrammes(COACH_BIZ)).toEqual([])
    expect(opened).toEqual([])
  })

  it("still lists the platform business's public programmes (control)", async () => {
    const { listPublicProgrammes } = await import("@/lib/lead-engine/chat/facts")
    rows = [PROGRAMME]
    const facts = (await listPublicProgrammes(PLATFORM_BIZ)) as Array<{ name: string }>
    expect(facts.map((f) => f.name)).toEqual(["Rotational Reboot"])
    expect(opened).toEqual(["programs"])
  })

  it("gives another business's conversation no testimonials, and opens no client", async () => {
    const { listPublicTestimonials } = await import("@/lib/lead-engine/chat/facts")
    rows = [TESTIMONIAL]
    expect(await listPublicTestimonials(COACH_BIZ)).toEqual([])
    expect(opened).toEqual([])
  })

  it("still reads the platform business's testimonials (control)", async () => {
    const { listPublicTestimonials } = await import("@/lib/lead-engine/chat/facts")
    rows = [TESTIMONIAL]
    const facts = (await listPublicTestimonials(PLATFORM_BIZ)) as Array<{ author: string }>
    expect(facts.map((f) => f.author)).toEqual(["Sam R."])
    expect(opened).toEqual(["testimonials"])
  })
})
```

`__tests__/lib/lead-engine/chat-tools.test.ts`: two edits, then append.

Edit 1. Before:
```ts
import type { BusinessSettings } from "@/lib/db/businesses"
```
After:
```ts
import type { BusinessSettings } from "@/lib/db/businesses"
import { platformBusinessId } from "@/lib/tenancy/platform"
```
Edit 2, **replace_all, 2 occurrences**. These are the two existing `list_programmes` tests, which call with no tenant and would throw from Step 3 on. Before:
```ts
    rowsByTable = { programs: [PUBLIC_PROGRAMME] }
    const ex = createToolExecutor()
```
After:
```ts
    rowsByTable = { programs: [PUBLIC_PROGRAMME] }
    const ex = createToolExecutor({ businessId: platformBusinessId() })
```
Append at the end of the file:
```ts

// G35. `search_faqs`, `list_programmes` and `list_testimonials` read tables with
// no business_id column — every row is the platform business's own. The
// executor must hand each lookup the conversation's tenant, so the facts layer
// can answer another business with nothing (that gate is pinned in
// chat-facts-tenancy.test.ts; this pins that the executor passes the tenant at
// all). The mock above hands back every row regardless, so anything a coach's
// turn receives here got there because the tenant did not.
describe("the untenanted lookups follow the conversation's tenant (G35)", () => {
  const ROWS = {
    faqs: [{ question: "How much is the camp?", answer: "Camp pricing", status: "published", page_key: "faq" }],
    programs: [PUBLIC_PROGRAMME],
    testimonials: [{ quote: "Best coaching around.", name: "Sam R.", is_active: true, display_order: 0 }],
  }
  const LOOKUPS: Array<[string, Record<string, unknown>]> = [
    ["search_faqs", { query: "camp pricing" }],
    ["list_programmes", {}],
    ["list_testimonials", {}],
  ]

  // MUTANT: the lookup called without the tenant, or with a fixed one — the
  // platform's rows come back as this coach's facts and cards.
  it.each(LOOKUPS)("%s gives another business's conversation nothing", async (name, input) => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    rowsByTable = ROWS
    const ex = createToolExecutor({ businessId: "coach-biz" })
    const out = await ex.execute(name, input)
    expect(out).not.toContain('"results"')
    expect(ex.outcome().facts).toEqual([])
    expect(ex.outcome().cards).toEqual([])
  })

  it.each(LOOKUPS)("%s still answers the platform business's conversation (control)", async (name, input) => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    rowsByTable = ROWS
    const ex = createToolExecutor({ businessId: platformBusinessId() })
    const out = await ex.execute(name, input)
    expect(out).toContain('"results"')
    expect(ex.outcome().facts).toHaveLength(1)
  })

  // MUTANT: the guard dropped, so a turn with no tenant reads as "nothing is
  // published" instead of failing as the wiring bug it is — the rule
  // list_camps_and_clinics already follows.
  it.each(LOOKUPS)("%s throws when the turn carries no businessId", async (name, input) => {
    const { createToolExecutor } = await import("@/lib/lead-engine/chat/tools")
    rowsByTable = ROWS
    const ex = createToolExecutor()
    await expect(ex.execute(name, input)).rejects.toThrow(/businessId/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/lead-engine/chat-facts-tenancy.test.ts __tests__/lib/lead-engine/chat-tools.test.ts
```
Expected: `Tests 9 failed | 30 passed (39)`.
  - chat-facts-tenancy, 3 failures:
    - the FAQ control: `expected [] to deeply equal [ 'How much is the camp?' ]`;
    - programmes "nothing": `expected [ { kind: 'programme', …(5) } ] to deeply equal []`;
    - testimonials "nothing": `expected [ { kind: 'testimonial', …(2) } ] to deeply equal []`.
  - chat-tools, 3 failures of the form `expected '{"results":[…' not to contain '"results"'`.
  - chat-tools, 3 failures of the form `promise resolved "'{"results":[…'" instead of rejecting`.

**Known false pass:** the FAQ "nothing" test PASSES here for the wrong reason. Under the old signature the coach id lands in `query` and `"camp pricing"` lands in `pageKey`, which the existing public-page-key short-circuit refuses. The mutation checks in Step 4 are what prove that guard.

- [ ] **Step 3: Implement**

`lib/lead-engine/chat/facts.ts` (a swept directory, so no brand names anywhere, comments included).

Header. Before:
```ts
// `faqs.status = 'published'`, `events.status = 'published'` (and not yet
// ended), `testimonials.is_active = true`.
//
```
After:
```ts
// `faqs.status = 'published'`, `events.status = 'published'` (and not yet
// ended), `testimonials.is_active = true`.
//
// And "whose" is a third question. `events` carries `business_id` and is
// filtered on it. `faqs`, `programs` and `testimonials` carry no such column,
// so their readers answer only the platform business's conversations, and
// nothing for any other — see `servesPlatformRows`.
//
```
Import. Before:
```ts
import { createServiceRoleClient } from "@/lib/supabase"

```
After:
```ts
import { createServiceRoleClient } from "@/lib/supabase"

// The tenancy seam, consulted for ONE question only: is this conversation's
// business the one the untenanted tables describe? See `servesPlatformRows`.
import { platformBusinessId } from "@/lib/tenancy/platform"

```
Gate. Before:
```ts
/**
 * Published FAQs only, ranked in JS by plain term overlap and capped.
```
After:
```ts
/**
 * WHOSE ROWS THESE ARE. `faqs`, `programs` and `testimonials` have no
 * `business_id` column: every row in them is the platform business's own,
 * written through its own admin screens. A coach's `/ask` chat that read them
 * would quote the platform's prices as that coach's, and read the platform's
 * clients' testimonials out under that coach's name.
 *
 * So each of those three readers takes the conversation's tenant
 * (`chat_conversations.business_id`, stamped from the request's Host when the
 * conversation was created) and answers NOTHING, before any query, when it is
 * not the platform business. Nothing is the honest answer: the tool results
 * then say nothing is published, and the assistant says it does not know
 * instead of presenting someone else's facts as this coach's. It never falls
 * back to the platform's rows. That is the owner's ruling (G35), and the rule
 * the chat's booking offer already follows for the platform's calendar.
 *
 * BEFORE THE READ, NOT AFTER IT. Dropping rows that came back would still pull
 * the platform's rows into a turn that must never see them, one careless log
 * line away from a leak. `chat-facts-tenancy.test.ts` asserts that another
 * business's lookup does not even open a client.
 *
 * The seam is consulted for this comparison and nothing else, which puts this
 * file on the NARROWER VARIANT shelf of lib/tenancy/platform.ts. When these
 * tables gain a tenant column, this becomes an `.eq("business_id", …)` like
 * `listPublicEvents`, and leaves that shelf.
 */
function servesPlatformRows(businessId: string): boolean {
  return businessId === platformBusinessId()
}

/**
 * Published FAQs only, ranked in JS by plain term overlap and capped.
```
`searchPublicFaqs`. Before:
```ts
 * keys, which is why retrieval is page-key aware at all.
 */
export async function searchPublicFaqs(query: string, pageKey?: string): Promise<Fact[]> {
```
After:
```ts
 * keys, which is why retrieval is page-key aware at all.
 *
 * `businessId` is the conversation's own tenant. `faqs` has no `business_id`
 * column, so another business's conversation gets nothing — see
 * `servesPlatformRows`.
 */
export async function searchPublicFaqs(businessId: string, query: string, pageKey?: string): Promise<Fact[]> {
  if (!servesPlatformRows(businessId)) return []

```
`listPublicProgrammes`. Before:
```ts
 * 39 named clients' personal plans and their prices.
 */
export async function listPublicProgrammes(): Promise<Fact[]> {
```
After:
```ts
 * 39 named clients' personal plans and their prices.
 *
 * `businessId` is the conversation's own tenant. `programs` has no
 * `business_id` column, so another business's conversation gets nothing —
 * never the platform's programmes and prices as if they were that coach's.
 * See `servesPlatformRows`.
 */
export async function listPublicProgrammes(businessId: string): Promise<Fact[]> {
  if (!servesPlatformRows(businessId)) return []

```
`listPublicTestimonials`. Before:
```ts
/** Active testimonials only — the same gate the public site renders behind. */
export async function listPublicTestimonials(): Promise<Fact[]> {
```
After:
```ts
/**
 * Active testimonials only — the same gate the public site renders behind.
 *
 * `businessId` is the conversation's own tenant. `testimonials` has no
 * `business_id` column, so another business's conversation gets nothing: the
 * platform's clients' words must never be read out under another coach's
 * name. See `servesPlatformRows`.
 */
export async function listPublicTestimonials(businessId: string): Promise<Fact[]> {
  if (!servesPlatformRows(businessId)) return []

```

`lib/lead-engine/chat/tools.ts` (swept for brand names, and also for the strings `suppress`, `stripe`, `createServiceRoleClient` and `.insert(`; none appears below).

ExecutorContext doc. Before:
```ts
 * `businessId` is the conversation's own tenant, threaded into
 * `list_camps_and_clinics` so events never cross a tenant boundary — see
 * `listPublicEvents` in `facts.ts`. `availability` and `now` are injection
 * points for tests.
```
After:
```ts
 * `businessId` is the conversation's own tenant, threaded into all four
 * retrieval tools: `list_camps_and_clinics` filters events on it, and
 * `search_faqs`, `list_programmes` and `list_testimonials` hand it to readers
 * whose tables have no tenant column, so they answer only the platform
 * business — see `listPublicEvents` and `servesPlatformRows` in `facts.ts`.
 * `availability` and `now` are injection points for tests.
```
`tenantFor`. Before:
```ts
  const executorBusinessId = ctx.businessId
```
After:
```ts
  const executorBusinessId = ctx.businessId

  /**
   * The conversation's tenant, for a lookup that must not run without one.
   *
   * Thrown, not silently substituted with the platform's own tenant: a turn
   * with no resolved businessId is a wiring bug in the caller, and answering
   * with someone else's camps, FAQs, programmes or testimonials would be the
   * exact leak this parameter exists to close. `book_consult` is the one tool
   * that degrades instead, because it has a safe answer to fall back to: the
   * plain consult page.
   */
  function tenantFor(tool: string): string {
    if (!executorBusinessId) throw new Error(`[chat-tools] ${tool} called without ctx.businessId`)
    return executorBusinessId
  }
```
Tool cases. The events throw moves into `tenantFor` with the same message. Before:
```ts
        const facts = absorb(await searchPublicFaqs(query, pageKey ?? undefined))
        return facts.length === 0 ? NO_FAQ_MATCH : results(facts)
      }

      case "list_programmes": {
        const facts = absorb(await listPublicProgrammes())
        return facts.length === 0 ? NO_PROGRAMMES_LISTED : results(facts)
      }

      case "list_camps_and_clinics": {
        // Thrown, not silently substituted with the platform's own tenant: a
        // turn with no resolved businessId is a wiring bug in the caller, and
        // answering with someone else's camps would be the exact leak this
        // parameter exists to close.
        if (!executorBusinessId) throw new Error("[chat-tools] list_camps_and_clinics called without ctx.businessId")
        const facts = absorb(await listPublicEvents(executorBusinessId))
```
After:
```ts
        const facts = absorb(await searchPublicFaqs(tenantFor(name), query, pageKey ?? undefined))
        return facts.length === 0 ? NO_FAQ_MATCH : results(facts)
      }

      case "list_programmes": {
        const facts = absorb(await listPublicProgrammes(tenantFor(name)))
        return facts.length === 0 ? NO_PROGRAMMES_LISTED : results(facts)
      }

      case "list_camps_and_clinics": {
        const facts = absorb(await listPublicEvents(tenantFor(name)))
```
Testimonials. Before: `        const facts = absorb(await listPublicTestimonials())` After: `        const facts = absorb(await listPublicTestimonials(tenantFor(name)))`

`lib/tenancy/platform.ts`: a NARROWER VARIANT entry. It anchors on the tail of the chat booking-offer entry and names no path that does not call the seam, so the reverse check stays green. Before:
```ts
 *     like the inbound ramp. Until G19b (2026-09-20) the chat did not call
 *     this at all: it read the three variables directly and had no tenant in
 *     the question.
```
After:
```ts
 *     like the inbound ramp. Until G19b (2026-09-20) the chat did not call
 *     this at all: it read the three variables directly and had no tenant in
 *     the question.
 *   - the chat assistant's FAQs, programmes and testimonials
 *     (lib/lead-engine/chat/facts.ts, G35). `faqs`, `programs` and
 *     `testimonials` have no `business_id` column, so every row in them is the
 *     platform business's own. The reader already HAS a real tenant -- the
 *     conversation's, stamped from the Host when it was created -- and
 *     consults this ONLY to decide whether that tenant is the business those
 *     rows describe: the same question lib/calendly/config-for-business.ts
 *     asks of its environment-configured calendar. Another business gets
 *     NOTHING, before any query -- never the platform's prices, or its
 *     clients' words, presented as that coach's. That is the owner's ruling,
 *     not a placeholder, and nothing is ever filed under this id here. When
 *     those tables gain a tenant column the gate becomes a predicate and this
 *     entry goes.
```

- [ ] **Step 4: Run it and watch it pass**

Other suites that import or mock a changed module:
  - `__tests__/lib/lead-engine/chat-facts.test.ts` **needs edits**, because its readers are called with the old arity. Before:
    ```ts
    import type { BusinessSettings } from "@/lib/db/businesses"
    ```
    After:
    ```ts
    import type { BusinessSettings } from "@/lib/db/businesses"
    import { platformBusinessId } from "@/lib/tenancy/platform"

    // Since G35 the FAQ, programme and testimonial readers answer only the
    // platform business (that gate is pinned in chat-facts-tenancy.test.ts). Every
    // test here is about a DIFFERENT column, so each asks as the platform.
    const PLATFORM = platformBusinessId()
    ```
    Then three replace_all edits:
    - `listPublicProgrammes()` → `listPublicProgrammes(PLATFORM)` (5 occurrences);
    - `listPublicTestimonials()` → `listPublicTestimonials(PLATFORM)` (1 occurrence);
    - `searchPublicFaqs("` → `searchPublicFaqs(PLATFORM, "` (4 occurrences).
  - `__tests__/lib/lead-engine/chat-refusals.test.ts` needs no edit. Its conversation fixture carries the platform literal and the seam is unmocked, so `list_programmes` and `search_faqs` still return rows. This makes it the end-to-end presence control through `/api/ask`.
  - These need no edit: `chat-slots.test.ts`, `chat-consult-tenant.test.ts` and `chat-validate.test.ts`, which only touch `book_consult` or the facts helpers; `__tests__/api/ask.test.ts`, which mocks `createToolExecutor` via `importOriginal`; and `__tests__/components/public/AskPanel.test.tsx`, which has a type-only import.
  - `__tests__/lib/tenancy/platform-inventory.test.ts` (forward check: `facts.ts` is now a caller and is named) and `__tests__/lib/lead-engine/no-brand-literals.test.ts` (sweeps `facts.ts` and `tools.ts`).

Run:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/lead-engine/chat-facts-tenancy.test.ts __tests__/lib/lead-engine/chat-tools.test.ts __tests__/lib/lead-engine/chat-facts.test.ts __tests__/lib/lead-engine/chat-refusals.test.ts __tests__/lib/lead-engine/chat-slots.test.ts __tests__/lib/lead-engine/chat-consult-tenant.test.ts __tests__/lib/lead-engine/chat-validate.test.ts __tests__/api/ask.test.ts __tests__/components/public/AskPanel.test.tsx __tests__/lib/tenancy/platform-inventory.test.ts __tests__/lib/lead-engine/no-brand-literals.test.ts
```
Expected: 11 files and 261 tests, all passing (9 + 30 + 21 + 12 + 16 + 8 + 80 + 50 + 27 + 5 + 3).

Prove each guard can fail. Apply one mutant, run `chat-facts-tenancy.test.ts` or `chat-tools.test.ts`, check that it goes red, then revert:
  - move `if (!servesPlatformRows(businessId)) return []` below the FAQ query → "no FAQs, and opens no client" fails. This covers the Step-2 false pass.
  - delete the testimonials gate → "no testimonials…" fails.
  - compare to the literal `"00000000-0000-0000-0000-000000000001"` instead of `platformBusinessId()` → all three controls fail.
  - pass a fixed id to `searchPublicFaqs` in `tools.ts` → "search_faqs gives another business's conversation nothing" fails.
  - reduce `tenantFor` to `return executorBusinessId as string` → the three new "throws…" tests and the existing camps "throws…" test fail.

- [ ] **Step 5: Commit**
```
git -C "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/g35-untenanted-readers" add lib/lead-engine/chat/facts.ts lib/lead-engine/chat/tools.ts lib/tenancy/platform.ts __tests__/lib/lead-engine/chat-facts-tenancy.test.ts __tests__/lib/lead-engine/chat-tools.test.ts __tests__/lib/lead-engine/chat-facts.test.ts
```
```
git -C "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/g35-untenanted-readers" commit -m "fix(chat): answer FAQs, programmes and testimonials only for the platform (G35)" -m "faqs, programs and testimonials have no business_id column; every row is the platform business's own. The chat's three readers now take the conversation's tenant and return nothing, before any query, for any other business. A coach's /ask assistant therefore says it does not know rather than quoting the platform's prices and clients as that coach's. This is the owner's ruling, and the chat's booking offer already follows it." -m "The tool executor passes ctx.businessId to all four retrieval tools through one tenantFor() guard. The guard throws on a turn with no tenant, as list_camps_and_clinics already did. facts.ts is named on the NARROWER VARIANT shelf of lib/tenancy/platform.ts."
```

---


### Task 7: The live FAQ and testimonial islands show nothing on a page that is not the platform's (§B2)

**Files:**
- Modify: `components/funnels/islands/index.tsx:17-24` (`FunnelRenderContext`), `:78-81` (`renderIsland`)
- Modify: `components/funnels/islands/FaqIsland.tsx:1-13`
- Modify: `components/funnels/islands/TestimonialsIsland.tsx:1-13`
- Modify: `app/(funnel)/go/[slug]/[[...step]]/page.tsx:179-188`
- Modify: `app/(funnel)/preview/[slug]/[[...step]]/page.tsx:201-215`
- Modify: `app/(funnel)/funnel-preview/[stepId]/page.tsx:227-251`
- Modify: `lib/tenancy/platform.ts:153-161` (NARROWER VARIANT shelf, after the Calendly webhook resolver entry)
- Create: `__tests__/components/funnels/live-feed-islands-tenant.test.tsx`
- Test: `__tests__/app/funnel-go-tenancy.test.tsx`, `__tests__/app/draft-preview-route.test.tsx`, `__tests__/app/funnel-draft-preview-page.test.tsx`
- Modify (context literals, tsc only): `__tests__/components/funnels/quiz-island-context.test.tsx:47-53`, `__tests__/components/funnels/form-island-sms-consent.test.tsx:35-41`

**Interfaces:**
- Consumes: `platformBusinessId(): string` from `lib/tenancy/platform.ts`
- Produces:
  - `FunnelRenderContext.businessId: string`. It is required.
  - `FaqIsland({ props, context }: { props: Record<string, unknown>; context: FunnelRenderContext }): Promise<JSX.Element | null>`
  - `TestimonialsIsland({ props, context })`, with the same shape.
  - A new NARROWER VARIANT entry in `lib/tenancy/platform.ts`. Its last line is ` *     about one document, which is this subsystem's worst failure.` and Task 8 anchors on that line.

- [ ] **Step 1: Write the failing tests**

(a) Create `__tests__/components/funnels/live-feed-islands-tenant.test.tsx`. Its mechanics were confirmed with a throwaway probe against today's code: the element shape, the `renderIsland` props and the call assertions all behave as the comments below say.

```tsx
// @vitest-environment node
//
// G35 §B2 — the platform's live FAQs and testimonials appear on the platform's
// pages ONLY.
//
// `faqs` and `testimonials` have no `business_id` column, so every row either
// island can show is the platform's own ("What is DJP Athlete?", its athletes'
// quotes). On another business's funnel page those rows would read as that
// coach's, so the islands render NOTHING there — the chat's booking offer
// makes the same call (lib/calendly/config-for-business.ts).
//
// The business is the one the ROUTE resolved and put on the render context,
// never the Host read inside the island: on /preview and /funnel-preview the
// Host is the admin's, not the funnel's, and preview must agree with /go.
//
// The islands are async server components, so they are CALLED and the element
// they return is inspected (the quiz-island-context.test.tsx pattern). Each
// absence test has its presence control directly beneath it.
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"

const listFaqsForPage = vi.fn()
const getTestimonials = vi.fn()
const getFeaturedTestimonials = vi.fn()

vi.mock("@/lib/db/faqs", () => ({ listFaqsForPage: (...a: unknown[]) => listFaqsForPage(...a) }))
vi.mock("@/lib/db/testimonials", () => ({
  getTestimonials: (...a: unknown[]) => getTestimonials(...a),
  getFeaturedTestimonials: (...a: unknown[]) => getFeaturedTestimonials(...a),
}))
// A sentinel rather than the real constant, so an island that compared against
// a hard-coded platform literal cannot pass.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz" }))
// The Host is deliberately the PLATFORM here. An island that resolved the Host
// instead of reading `context.businessId` would conclude "this is the
// platform's page" and render the platform's rows on the coach's page below —
// the preview-route disagreement the context exists to stop.
vi.mock("@/lib/tenancy/public", () => ({ resolvePublicTenant: async () => "platform-biz" }))

import { FaqIsland } from "@/components/funnels/islands/FaqIsland"
import { TestimonialsIsland } from "@/components/funnels/islands/TestimonialsIsland"
import { renderIsland, type FunnelRenderContext } from "@/components/funnels/islands"

const PLATFORM = "platform-biz"
const COACH = "coach-biz"

function contextFor(businessId: string): FunnelRenderContext {
  return {
    funnelId: "ffffffff-1111-4222-8333-444444444444",
    funnelSlug: "summer-camp",
    stepId: "3f1b7c5e-1111-4222-8333-444444444444",
    stepSlug: "index",
    isPreview: false,
    businessId,
  }
}

// No apostrophes: renderToStaticMarkup escapes one to `&#x27;`, and a
// `toContain` on the raw string would then fail for a reason that has nothing
// to do with tenancy.
const FAQ_ROW = { id: "faq-1", page_key: "home", question: "What is DJP Athlete?", answer: "A performance gym." }
const QUOTE_ROW = { id: "t-1", name: "Platform Athlete", quote: "Best coach I have trained with.", sport: "Baseball" }

beforeEach(() => {
  vi.resetAllMocks()
  listFaqsForPage.mockResolvedValue([FAQ_ROW])
  getTestimonials.mockResolvedValue([QUOTE_ROW])
  getFeaturedTestimonials.mockResolvedValue([QUOTE_ROW])
})

describe("FaqIsland on a page whose business is not the platform", () => {
  it("renders nothing, and never reads the faqs table", async () => {
    // MUTANT 1: no check at all — the coach's page shows "What is DJP
    // Athlete?" as its own FAQ. MUTANT 2: the check placed AFTER the read —
    // the result is still null, so only the call assertion can see it.
    const element = await FaqIsland({ props: { pageKey: "home" }, context: contextFor(COACH) })

    expect(element).toBeNull()
    expect(listFaqsForPage).not.toHaveBeenCalled()
  })

  it("(control) still renders the platform's own FAQs on the platform's page", async () => {
    // Without this, an island that returned null for everyone would pass the
    // test above.
    const element = (await FaqIsland({ props: { pageKey: "home" }, context: contextFor(PLATFORM) })) as ReactElement

    expect(renderToStaticMarkup(element)).toContain("What is DJP Athlete?")
    expect(listFaqsForPage).toHaveBeenCalledWith("home", { publishedOnly: true })
  })
})

describe("TestimonialsIsland on a page whose business is not the platform", () => {
  it("renders nothing, and reads neither testimonial list", async () => {
    // The same two mutants as the FAQ island. `featuredOnly: true` so the
    // featured reader is covered; the default path reads `getTestimonials`,
    // and both must stay untouched.
    const element = await TestimonialsIsland({ props: { featuredOnly: true }, context: contextFor(COACH) })

    expect(element).toBeNull()
    expect(getFeaturedTestimonials).not.toHaveBeenCalled()
    expect(getTestimonials).not.toHaveBeenCalled()
  })

  it("(control) still renders the platform's own testimonials on the platform's page", async () => {
    const element = (await TestimonialsIsland({ props: {}, context: contextFor(PLATFORM) })) as ReactElement

    expect(renderToStaticMarkup(element)).toContain("Best coach I have trained with.")
    expect(getTestimonials).toHaveBeenCalledWith(true)
  })
})

describe("renderIsland hands both live islands the page's context", () => {
  it.each(["faq", "testimonials"] as const)("passes the route's context to the %s island", (name) => {
    // MUTANT: `<FaqIsland props={props} />` with no context — what the registry
    // did before G35 (tsc refuses that now the prop is required) — or a
    // context rebuilt inside renderIsland, which WOULD type-check. `toBe`, so
    // only the route's own object passes.
    const context = contextFor(COACH)
    const element = renderIsland(name, { pageKey: "home" }, context) as ReactElement<{ context: FunnelRenderContext }>

    expect(element.props.context).toBe(context)
  })
})
```

(b) `__tests__/app/funnel-go-tenancy.test.tsx`: append this after the file's last test. Anchor on its end:

Before:
```tsx
    mocks.isBusinessMember.mockRejectedValue(new Error("db unavailable"))

    await expect(
      Page({ params: paramsFor("free-guide"), searchParams: Promise.resolve({ preview: "1" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404")

    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })
})
```
After:
```tsx
    mocks.isBusinessMember.mockRejectedValue(new Error("db unavailable"))

    await expect(
      Page({ params: paramsFor("free-guide"), searchParams: Promise.resolve({ preview: "1" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404")

    expect(mocks.getPublishedStep).toHaveBeenCalledWith("tenant-a", "free-guide", undefined, {
      includeUnpublished: false,
    })
  })
})

// G35 §B2. The live FAQ and testimonial islands decide from
// `context.businessId` whether the platform's rows may appear on this page, so
// the context must carry the tenant that owns the page being served — on /go,
// the Host's, the one `getPublishedStep` was scoped to.
describe("/go hands the Host's tenant to the islands", () => {
  it("puts the resolved tenant on the render context, and follows it when the Host changes", async () => {
    // MUTANT: the context built without `businessId` (a compile error now), or
    // with the platform's id, or from a second Host read. The second half is
    // the control: the value follows the Host rather than being a constant
    // that happens to equal "tenant-a".
    mocks.getPublishedStep.mockResolvedValue(PUBLISHED)

    mocks.resolvePublicTenant.mockResolvedValue("tenant-a")
    const onA = await Page({ params: paramsFor("free-guide"), searchParams: noSearchParams })
    expect(findContext(onA)?.businessId).toBe("tenant-a")

    mocks.resolvePublicTenant.mockResolvedValue("tenant-b")
    const onB = await Page({ params: paramsFor("free-guide"), searchParams: noSearchParams })
    expect(findContext(onB)?.businessId).toBe("tenant-b")
  })
})

/** Walks a returned element tree for the NodeRenderer's `context` prop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findContext(element: any): Record<string, unknown> | null {
  if (!element || typeof element !== "object") return null
  if (element.props && element.props.context) return element.props.context as Record<string, unknown>
  const children = element.props?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    const found = findContext(child)
    if (found) return found
  }
  return null
}
```

(c) `__tests__/app/draft-preview-route.test.tsx` (`/preview`). NodeRenderer is mocked to render nothing, but its element and props are still in the returned tree.

Before:
```tsx
    await render("summer-camp")
    expect(mock(renderDraftPreview).mock.calls[0][0].editable).not.toBe(true)
  })
})
```
After:
```tsx
    await render("summer-camp")
    expect(mock(renderDraftPreview).mock.calls[0][0].editable).not.toBe(true)
  })
})

describe("what it tells the islands", () => {
  it("hands the ADMIN tenant to the islands, never the Host's (G35)", async () => {
    // MUTANT: `businessId` taken from anywhere but `resolveAdminTenant` — on
    // this route the Host is the ADMIN's, not the funnel's. The live FAQ and
    // testimonial islands decide from it whether the platform's rows may
    // appear, so a wrong value makes this preview disagree with /go on the
    // funnel's own host. The second render is the control: the value follows
    // the admin tenant rather than being a constant.
    expect(findContext(await render("summer-camp"))?.businessId).toBe(BUSINESS_ID)

    const OTHER = "cccccccc-1111-4222-8333-444444444444"
    mock(resolveAdminTenant).mockResolvedValue({ businessId: OTHER, choices: [], isOperator: true })
    expect(findContext(await render("summer-camp"))?.businessId).toBe(OTHER)
  })
})

/** Walks a returned element tree for the NodeRenderer's `context` prop. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findContext(element: any): Record<string, unknown> | null {
  if (!element || typeof element !== "object") return null
  if (element.props && element.props.context) return element.props.context as Record<string, unknown>
  const children = element.props?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    const found = findContext(child)
    if (found) return found
  }
  return null
}
```

(d) `__tests__/app/funnel-draft-preview-page.test.tsx` (`/funnel-preview`). `findContext` already exists in this file.

Before:
```tsx
    expect(findContext(await render())).toMatchObject({ editable: false })
  })
```
After:
```tsx
    expect(findContext(await render())).toMatchObject({ editable: false })
  })

  it("hands the ADMIN tenant to the islands, never the Host's (G35)", async () => {
    // MUTANT: `businessId` from anywhere but `resolveAdminTenant` — the Host on
    // this route is the admin's, not the funnel's. The live FAQ and testimonial
    // islands decide from it whether the platform's rows may appear, so the
    // canvas must answer the way /go on the funnel's own host will. The second
    // render is the control: the value follows the admin tenant.
    expect(findContext(await render())).toMatchObject({ businessId: BUSINESS_ID })

    const OTHER = "cccccccc-1111-4222-8333-444444444444"
    mock(resolveAdminTenant).mockResolvedValue({ businessId: OTHER, choices: [], isOperator: true })
    expect(findContext(await render())).toMatchObject({ businessId: OTHER })
  })
```

- [ ] **Step 2: Run it and watch it fail**

```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/funnels/live-feed-islands-tenant.test.tsx __tests__/app/funnel-go-tenancy.test.tsx __tests__/app/draft-preview-route.test.tsx __tests__/app/funnel-draft-preview-page.test.tsx
```
Expected failures:
- **FaqIsland on a non-platform page.** It fails with "expected { …(10) } to be null", because the element is rendered with the FAQ row. `listFaqsForPage` was called once.
- **TestimonialsIsland on a non-platform page.** It fails the same way.
- **`renderIsland` context, both cases.** Each fails with "expected undefined to be {…}".
- **Route tests, all three.** They fail with `businessId` `undefined`: `/go` expected "tenant-a", `/preview` expected `BUSINESS_ID`, and `/funnel-preview` gives a toMatchObject mismatch.

Expected passes: the two island `(control)` tests, and every existing test in the three route suites.

- [ ] **Step 3: Implement**

(a) `components/funnels/islands/index.tsx`: the context gains the tenant.

Before:
```tsx
  /** Preview pages must not create real leads or real checkout sessions. */
  isPreview: boolean
```
After:
```tsx
  /** Preview pages must not create real leads or real checkout sessions. */
  isPreview: boolean
  /**
   * The business whose page this is — the tenant the ROUTE already resolved,
   * never re-resolved here. `/go` passes the Host's tenant (the one its
   * `getPublishedStep` read was scoped to); `/preview` and `/funnel-preview`
   * pass the admin session's tenant (the one their draft read was scoped to).
   *
   * REQUIRED, not optional. An optional tenant is how `getConversation` ended
   * up with `if (businessId)` and a caller that never passed one (G35). A route
   * that forgets it is a compile error, not an island that quietly decides
   * with no business in hand.
   *
   * WHY NOT `resolvePublicTenant()` INSIDE THE ISLAND, the way the event, form
   * and quiz islands do it: on the two preview routes the Host is the ADMIN'S,
   * not the funnel's. A platform admin previewing a coach's page would get the
   * platform back from the Host and see the platform's FAQs, while `/go` on
   * the coach's own host showed none — preview and live disagreeing about one
   * document, which is the worst failure this subsystem has. Read today by the
   * live FAQ and testimonial islands (G35); the others keep their Host reads,
   * which predate this field.
   */
  businessId: string
```

Before:
```tsx
    case "testimonials":
      return <TestimonialsIsland props={props} />
    case "faq":
      return <FaqIsland props={props} />
```
After:
```tsx
    case "testimonials":
      return <TestimonialsIsland props={props} context={context} />
    case "faq":
      return <FaqIsland props={props} context={context} />
```

(b) `components/funnels/islands/FaqIsland.tsx`

Before:
```tsx
// Pulls published FAQs for a page key at render time.

import { listFaqsForPage } from "@/lib/db/faqs"
import type { Faq } from "@/types/database"

interface FaqIslandProps {
  props: Record<string, unknown>
}

export async function FaqIsland({ props }: FaqIslandProps) {
  const pageKey = typeof props.pageKey === "string" ? props.pageKey : ""
```
After:
```tsx
// Pulls published FAQs for a page key at render time.

import { listFaqsForPage } from "@/lib/db/faqs"
import { platformBusinessId } from "@/lib/tenancy/platform"
import type { Faq } from "@/types/database"
import type { FunnelRenderContext } from "./index"

interface FaqIslandProps {
  props: Record<string, unknown>
  context: FunnelRenderContext
}

export async function FaqIsland({ props, context }: FaqIslandProps) {
  // THE PLATFORM'S FAQs, ON THE PLATFORM'S PAGES ONLY (G35). `faqs` has no
  // `business_id` column: every row is written for darrenjpaul.com ("What is
  // DJP Athlete?", "Where are you based?"). On another business's page they
  // would read as that coach's own answers, so that page gets NOTHING rather
  // than the platform's — the same call the chat's booking offer makes
  // (lib/calendly/config-for-business.ts).
  //
  // FIRST, before the read: a page that can never show the rows has no reason
  // to fetch them, and a check placed after the read is one refactor away
  // from a render that forgets it.
  //
  // `context.businessId` is the tenant the ROUTE resolved, never the Host read
  // here — see `FunnelRenderContext.businessId` for why that is the one the
  // preview and the live page agree on.
  if (context.businessId !== platformBusinessId()) return null

  const pageKey = typeof props.pageKey === "string" ? props.pageKey : ""
```

(c) `components/funnels/islands/TestimonialsIsland.tsx`

Before:
```tsx
import { getTestimonials, getFeaturedTestimonials } from "@/lib/db/testimonials"
import type { Testimonial } from "@/types/database"

interface TestimonialsIslandProps {
  props: Record<string, unknown>
}

export async function TestimonialsIsland({ props }: TestimonialsIslandProps) {
  const limit = typeof props.limit === "number" ? props.limit : 3
```
After:
```tsx
import { getTestimonials, getFeaturedTestimonials } from "@/lib/db/testimonials"
import { platformBusinessId } from "@/lib/tenancy/platform"
import type { Testimonial } from "@/types/database"
import type { FunnelRenderContext } from "./index"

interface TestimonialsIslandProps {
  props: Record<string, unknown>
  context: FunnelRenderContext
}

export async function TestimonialsIsland({ props, context }: TestimonialsIslandProps) {
  // THE PLATFORM'S ATHLETES, ON THE PLATFORM'S PAGES ONLY (G35). `testimonials`
  // has no `business_id` column: every quote is from someone the platform
  // coached. Shown on another business's page they would be presented as that
  // coach's clients — so that page gets nothing. Same rule, same reasons and
  // the same placement (before either read) as FaqIsland.
  if (context.businessId !== platformBusinessId()) return null

  const limit = typeof props.limit === "number" ? props.limit : 3
```

(d) `app/(funnel)/go/[slug]/[[...step]]/page.tsx`

Before:
```tsx
          stepSlug: stepRow.slug,
          isPreview,
        }}
```
After:
```tsx
          stepSlug: stepRow.slug,
          isPreview,
          // The Host's tenant — the one `getPublishedStep` above was scoped to,
          // so it is the business that owns this page. The live FAQ and
          // testimonial islands read it to decide whether the platform's rows
          // may appear here (G35).
          businessId,
        }}
```

(e) `app/(funnel)/preview/[slug]/[[...step]]/page.tsx`

Before:
```tsx
            // What makes the form usable ANYWAY — through an endpoint that
            // validates against the draft and writes nothing at all.
            testRun: true,
          }}
```
After:
```tsx
            // What makes the form usable ANYWAY — through an endpoint that
            // validates against the draft and writes nothing at all.
            testRun: true,
            // The ADMIN tenant the draft was read under, never the Host: on
            // this route the Host is the admin's, not the funnel's, and the
            // live FAQ and testimonial islands must answer here the way they
            // will on /go (G35).
            businessId,
          }}
```

(f) `app/(funnel)/funnel-preview/[stepId]/page.tsx`

Before:
```tsx
          // Passing the two independently would let the canvas end up with
          // anchors on the page and none in the form, or the reverse.
          editable,
        }}
```
After:
```tsx
          // Passing the two independently would let the canvas end up with
          // anchors on the page and none in the form, or the reverse.
          editable,
          // The ADMIN tenant the draft was read under, never the Host — the
          // same reasoning as the full-screen preview. The live FAQ and
          // testimonial islands decide from it whether the platform's rows may
          // appear, so the canvas must agree with /go (G35).
          businessId,
        }}
```

(g) `lib/tenancy/platform.ts`: add the islands to the NARROWER VARIANT shelf, after the Calendly webhook resolver entry.

The new entry names only these two paths, and both of them now call the seam. Any other `app|lib|components/….ts(x)` path written here would trip the reverse check, so the routes are named by URL and the event island in words.

Before:
```
 *     event type matching NEITHER is ignored rather than filed here.
 *   - the Stripe webhook's purchase capture (app/api/stripe/webhook/route.ts).
```
After:
```
 *     event type matching NEITHER is ignored rather than filed here.
 *   - the funnel page's live FAQ list and live testimonial feed
 *     (components/funnels/islands/FaqIsland.tsx and
 *     components/funnels/islands/TestimonialsIsland.tsx), since G35. Neither
 *     `faqs` nor `testimonials` has a `business_id` column: every row in them
 *     is the platform's own, written for darrenjpaul.com. The island does not
 *     resolve a tenant itself -- the route that renders it already has one
 *     (/go from the Host; /preview and /funnel-preview from the admin
 *     session) and hands it down on the render context -- and it consults
 *     this ONLY to decide whether that business is the one those rows
 *     describe. Any other business gets nothing rather than the platform's
 *     rows, the same call the chat's booking offer above makes: a coach's
 *     visitors must not read the platform's answers or its athletes' quotes
 *     as that coach's own. Deliberately NOT `resolvePublicTenant()` inside
 *     the island, the way the event island does it: on the two preview
 *     routes the Host is the admin's, not the funnel's, so a platform admin
 *     previewing a coach's page would see the platform's rows while the live
 *     page on the coach's host showed none -- preview and live disagreeing
 *     about one document, which is this subsystem's worst failure.
 *   - the Stripe webhook's purchase capture (app/api/stripe/webhook/route.ts).
```

- [ ] **Step 4: Run it and watch it pass**

First, make these edits to existing suites. Both are tsc-only; vitest does not type-check, and the new field is otherwise missing from the literals.

`__tests__/components/funnels/quiz-island-context.test.tsx`

Before:
```tsx
const CONTEXT: FunnelRenderContext = {
  funnelId: FUNNEL_ID,
  funnelSlug: "athlete-quiz",
  stepId: STEP_ID,
  stepSlug: "quiz",
  isPreview: false,
}
```
After:
```tsx
const CONTEXT: FunnelRenderContext = {
  funnelId: FUNNEL_ID,
  funnelSlug: "athlete-quiz",
  stepId: STEP_ID,
  stepSlug: "quiz",
  isPreview: false,
  // DISTINCT from the Host sentinel ("host-biz") on purpose: QuizIsland still
  // reads the Host for its SMS wording, and a fixture whose two tenants agreed
  // could not tell which one it read.
  businessId: "route-biz",
}
```

`__tests__/components/funnels/form-island-sms-consent.test.tsx`

Before:
```tsx
  stepSlug: "index",
  isPreview: false,
}
```
After:
```tsx
  stepSlug: "index",
  isPreview: false,
  // DISTINCT from the Host sentinel ("host-biz"), for the reason given in
  // quiz-island-context.test.tsx: FormIsland reads the Host, not this.
  businessId: "route-biz",
}
```

Then run the suites. They were found with `grep -rlE '(from|import\()\s*"@/components/funnels/(islands|NodeRenderer)'`, plus the three route pages, plus `leadgen.test.ts`, which reads both island source files:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/components/funnels/live-feed-islands-tenant.test.tsx __tests__/app/funnel-go-tenancy.test.tsx __tests__/app/draft-preview-route.test.tsx __tests__/app/funnel-draft-preview-page.test.tsx __tests__/components/funnels/quiz-island-context.test.tsx __tests__/components/funnels/form-island-sms-consent.test.tsx __tests__/lib/funnels/sections/leadgen.test.ts __tests__/lib/tenancy/platform-inventory.test.ts
```
Expected: all green. `platform-inventory.test.ts` stays 5/5: the forward check needs both island paths named, and the reverse check finds that both call the seam.

Type check. Run each as its own call:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit -p tsconfig.json > /private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/f66737df-ecd8-4579-a964-2a1254670317/scratchpad/g35-t7-tsc.txt 2>&1
```
```
grep -nE "components/funnels/islands/|app/\(funnel\)/|funnel-go-tenancy|draft-preview-route|funnel-draft-preview-page|live-feed-islands-tenant|quiz-island-context|form-island-sms-consent|lib/tenancy/platform" /private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/f66737df-ecd8-4579-a964-2a1254670317/scratchpad/g35-t7-tsc.txt
```
Expected: no lines.

Then:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx prettier --check components/funnels/islands/index.tsx components/funnels/islands/FaqIsland.tsx components/funnels/islands/TestimonialsIsland.tsx "app/(funnel)/go/[slug]/[[...step]]/page.tsx" "app/(funnel)/preview/[slug]/[[...step]]/page.tsx" "app/(funnel)/funnel-preview/[stepId]/page.tsx" __tests__/components/funnels/live-feed-islands-tenant.test.tsx __tests__/app/funnel-go-tenancy.test.tsx __tests__/app/draft-preview-route.test.tsx __tests__/app/funnel-draft-preview-page.test.tsx
```

Mutation check. Make each change, run the new suite, then revert it:
- Move the `platformBusinessId()` check in FaqIsland below `listFaqsForPage`. The "never reads the faqs table" test must go red.
- Drop `context={context}` from the `faq` case. The `renderIsland` test must go red. tsc also refuses this.

- [ ] **Step 5: Commit**

```
git add components/funnels/islands/index.tsx components/funnels/islands/FaqIsland.tsx components/funnels/islands/TestimonialsIsland.tsx "app/(funnel)/go/[slug]/[[...step]]/page.tsx" "app/(funnel)/preview/[slug]/[[...step]]/page.tsx" "app/(funnel)/funnel-preview/[stepId]/page.tsx" lib/tenancy/platform.ts __tests__/components/funnels/live-feed-islands-tenant.test.tsx __tests__/app/funnel-go-tenancy.test.tsx __tests__/app/draft-preview-route.test.tsx __tests__/app/funnel-draft-preview-page.test.tsx __tests__/components/funnels/quiz-island-context.test.tsx __tests__/components/funnels/form-island-sms-consent.test.tsx
```
Use the Write tool to put the message in `<scratchpad>/g35-t7-commit.txt`, then run `git commit -F <that path>`:
```
fix(funnels): live FAQ and testimonial islands show nothing off the platform (G35)

`faqs` and `testimonials` have no business_id column, so every row the two
live islands can show is the platform's own. On another business's funnel
page they rendered the platform's FAQs and its athletes' quotes as if they
were that coach's.

FunnelRenderContext gains a required businessId, set by /go (the Host's
tenant) and by /preview and /funnel-preview (the admin tenant). renderIsland
hands the context to both islands, which return null before reading anything
when the business is not the platform. The route's tenant, not
resolvePublicTenant() inside the island: on the preview routes the Host is
the admin's, and the preview must agree with /go.

Both islands are named on the NARROWER VARIANT shelf of lib/tenancy/platform.ts.
```

---

### Task 8: The catalogue, the publish gate and the builder prompt refuse the platform's live feeds off the platform (§B3, and §B4 for its files)

**Files:**
- Modify: `lib/funnels/sections/resolve.ts`. The changes are:
  - imports: `:114-125`, `:145`
  - `Catalogues`: `:224-238`
  - `UnknownFaqKey` and after: `:717-720`
  - `ResolveResult`: `:773-774`
  - `loadCatalogues`: `:488-567`
  - `resolveDoc`: `:1138`, `:1165-1181`, `:1335-1343`
  - describe functions and `publishGate`: `:1376-1383`, `:1463-1466`
- Modify: `lib/funnels/sections/prompt.ts:977-1042` (`BuilderCatalogueInput`, a new `LIVE_FEEDS_UNAVAILABLE`, `buildCatalogueBlock`)
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts`:
  - `:104` (import)
  - `:494-495` (`PageContext`)
  - `:508-554` (`loadPageContext`)
  - `:1251` (`buildSystemPrompt` call)
- Modify: `lib/tenancy/platform.ts`, after the Task 7 islands entry
- Test: `__tests__/lib/funnels/sections/resolve.test.ts`:
  - `:124-129`, `:685`, `:718`, `:757`, `:781-786`, `:1834`
  - new describes before `:1061`
  - the loadCatalogues block `:1352-1425`, `:1496-1506`, `:1612-1638`
- Test: `__tests__/lib/funnels/sections/prompt.test.ts:37-39,108-122`, plus four `faqPageKeys: []` literals and a new describe after `:899`
- Test: `__tests__/app/api/admin/funnels/build-route.test.ts:81,100`, plus a new describe before `:706`
- Test: `__tests__/components/admin/funnel-publish-actions.test.ts:46,70,306-326`
- Modify (untyped literals): `__tests__/api/funnels/offers-route.test.ts:50`, `__tests__/api/funnels/ai-plan-route.test.ts:80`
- Modify (tsc, integration lane): `__tests__/integration/builder-colour-live.test.ts:69`

**Interfaces:**
- Consumes:
  - `platformBusinessId(): string`
  - Task 7's platform.ts entry. Its last line, ` *     about one document, which is this subsystem's worst failure.`, is the anchor.
- Produces:
  - `Catalogues.liveFeedsAvailable: boolean`. It is required.
  - `export interface UnavailableLiveFeed { sectionId: string; kind: "faq" | "testimonial" }`
  - `ResolveResult.unavailableLiveFeeds: UnavailableLiveFeed[]`. When it is not empty, publishing is blocked.
  - `BuilderCatalogueInput.liveFeedsAvailable: boolean`. It is required.
  - `export const LIVE_FEEDS_UNAVAILABLE: string` in `lib/funnels/sections/prompt.ts`
  - Test helpers in `resolve.test.ts`:
    - `loadCataloguesWithStubbedDal(overrides?, businessId = STUB_BUSINESS_ID)`
    - `stubDal()` now also returns `faqCountsCalls`
    - `PLATFORM_STUB_ID = "platform-under-test"`

- [ ] **Step 1: Write the failing tests**

**(1a) `__tests__/lib/funnels/sections/resolve.test.ts`**

The `catalogue()` helper is the platform's own catalogue. This edit is needed at runtime, not only for tsc: without the flag, every existing live-FAQ test would be read as a non-platform case.

Before:
```ts
  return { recognition: lists(overrides), offer: lists(overrides), faqPageKeys, quizzes: [] }
}
```
After:
```ts
  //
  // `liveFeedsAvailable: true` — THE PLATFORM'S catalogue. Every FAQ test in
  // this file was written about the platform's own feeds, the only business
  // whose page keys are looked up at all (G35). Every other business is
  // `coachCatalogue()` below.
  return { recognition: lists(overrides), offer: lists(overrides), faqPageKeys, liveFeedsAvailable: true, quizzes: [] }
}
```

Use Edit with `replace_all: true` on the three `recognition/offer split` literals. There are exactly three occurrences, at `:685`, `:718` and `:757`.

Before: `      faqPageKeys: FAQ_KEYS,\n      quizzes: [],`
After: `      faqPageKeys: FAQ_KEYS,\n      liveFeedsAvailable: true,\n      quizzes: [],`

Before:
```ts
      faqPageKeys: before.faqPageKeys,
    }
```
After:
```ts
      faqPageKeys: before.faqPageKeys,
      liveFeedsAvailable: before.liveFeedsAvailable,
    }
```

Before: `  return { recognition, offer, faqPageKeys: FAQ_KEYS, quizzes: [] }`
After: `  return { recognition, offer, faqPageKeys: FAQ_KEYS, liveFeedsAvailable: true, quizzes: [] }`

Insert the new resolveDoc and publishGate tests immediately before the existing `describe("publishGate", () => {` at `:1061`.

Before:
```ts
describe("publishGate", () => {
  it("BLOCKS publish on an unknown faq pageKey — it is not a warning", () => {
```
After:
```ts
// ===========================================================================
// G35: the platform's live feeds on a business that is not the platform.
//
// `faqs` and `testimonials` have no `business_id` column, so every row either
// live island can show is the platform's own, and the islands render nothing
// on any other business's page. `loadCatalogues` says so with
// `liveFeedsAvailable: false` (and no FAQ keys); these pin what `resolveDoc`
// and `publishGate` do with it. Mock-free, like everything above.
// ===========================================================================

function liveTestimonial(id = "t1"): Section {
  return { id, kind: "testimonial", variant: "grid", style: {}, props: { source: "live" } }
}

function quoteTestimonial(id = "t2"): Section {
  return {
    id,
    kind: "testimonial",
    variant: "grid",
    style: {},
    props: { source: "quote", quotes: [{ quote: "Stronger than ever.", name: "A. Athlete" }] },
  }
}

/** What `loadCatalogues` answers for a business that is not the platform: no keys, no feeds. */
function coachCatalogue(): Catalogues {
  return { ...catalogue({}, []), liveFeedsAvailable: false }
}

describe("resolveDoc — the platform's live feeds on a business that is not the platform (G35)", () => {
  it("reports a live FAQ section as an unavailable feed, NOT as an unknown page key", () => {
    // MUTANT: no feed check, leaving the key check to catch it. With
    // `faqPageKeys: []` it WOULD be caught — as "no FAQs are filed under camps
    // … no page has FAQs yet", which sends the owner to add FAQ rows that
    // would still never appear on this business's page.
    const result = resolveDoc(docOf([liveFaq("camps")]), coachCatalogue())

    expect(result.unavailableLiveFeeds).toEqual([{ sectionId: "faq1", kind: "faq" }])
    expect(result.unknownFaqKeys).toEqual([])
  })

  it("reports a live testimonial section — the check that did not exist before G35", () => {
    // MUTANT: no testimonial branch at all, which is what shipped: nothing in
    // resolveDoc looked at a testimonial section, so a coach's page with a live
    // feed published green and rendered an empty band.
    const result = resolveDoc(docOf([liveTestimonial()]), coachCatalogue())

    expect(result.unavailableLiveFeeds).toEqual([{ sectionId: "t1", kind: "testimonial" }])
  })

  it("(control) reports nothing for the SAME live sections on the platform's own page", () => {
    // Without this, an implementation that flagged every live section for
    // everyone would pass both tests above. "camps" has rows, so the key check
    // stays quiet too.
    const result = resolveDoc(docOf([liveFaq("camps"), liveTestimonial()]), catalogue())

    expect(result.unavailableLiveFeeds).toEqual([])
    expect(result.unknownFaqKeys).toEqual([])
  })

  it("never reports inline FAQs or authored quotes — they are the business's own content", () => {
    // MUTANT: checking the section KIND without discriminating on `source`,
    // which would block every coach page with any FAQ or testimonial at all.
    // The live testimonial in the same doc is the presence control: a gutted
    // check that reports nothing fails here too.
    const result = resolveDoc(docOf([inlineFaq("faq2"), quoteTestimonial("t2"), liveTestimonial("t1")]), coachCatalogue())

    expect(result.unavailableLiveFeeds).toEqual([{ sectionId: "t1", kind: "testimonial" }])
  })

  it("does not rewrite the document — the fix needs content only the owner has", () => {
    // MUTANT: "helpfully" flipping the section to inline/quote. There is
    // nothing to put in it: an inline FAQ needs questions and a quote needs a
    // real person's words.
    const doc = docOf([liveFaq("camps"), liveTestimonial()])

    const result = resolveDoc(doc, coachCatalogue())

    expect(result.doc).toBe(doc)
    expect(result.unavailableLiveFeeds).toHaveLength(2)
  })
})

describe("publishGate — the platform's live feeds (G35)", () => {
  it("BLOCKS, in words that say whose list it is and what to switch to", () => {
    // MUTANT 1: reporting it as a warning — the owner cannot SEE an empty band
    // on a page they already approved, which is the line blockers sit on.
    // MUTANT 2: reusing `describeUnknownFaqKey`'s wording.
    const gate = publishGate(resolveDoc(docOf([liveFaq("camps"), liveTestimonial()]), coachCatalogue()))

    expect(gate.ok).toBe(false)
    expect(gate.warnings).toEqual([])
    expect(gate.blockers).toHaveLength(2)
    const [faqLine, testimonialLine] = gate.blockers
    expect(faqLine).toContain("faq1")
    expect(faqLine).toContain("DJP Athlete")
    expect(faqLine).toContain('"Inline"')
    expect(testimonialLine).toContain("t1")
    expect(testimonialLine).toContain("DJP Athlete")
    expect(testimonialLine).toContain('"Quote"')
    // Not the unknown-key sentence. Its presence control is the next test.
    expect(gate.blockers.join(" ")).not.toContain("no page has FAQs yet")
  })

  it("(control) the platform with no FAQ rows still gets the unknown-key sentence, not this one", () => {
    const gate = publishGate(resolveDoc(docOf([liveFaq("camps")]), catalogue({}, [])))

    expect(gate.blockers).toHaveLength(1)
    expect(gate.blockers[0]).toContain("no page has FAQs yet")
    expect(gate.blockers[0]).not.toContain("DJP Athlete")
  })
})

describe("publishGate", () => {
  it("BLOCKS publish on an unknown faq pageKey — it is not a warning", () => {
```

Next, the loadCatalogues block. Add the platform seam, count the FAQ reads, and add a `businessId` parameter.

Before:
```ts
/** Every test in this block reads as this tenant unless it says otherwise. */
const STUB_BUSINESS_ID = "biz-under-test"

async function stubDal(overrides: Partial<DalRows> = {}) {
  const rows: DalRows = { ...DEFAULT_DAL_ROWS, ...overrides }
  const getEventsCalls: { businessId: string; filters?: EventFilters }[] = []
  const quizDefinitionCalls: string[] = []
  const publishedEventsCalls: { businessId: string; filters?: EventFilters }[] = []

  vi.resetModules()
```
After:
```ts
/** Every test in this block reads as this tenant unless it says otherwise. */
const STUB_BUSINESS_ID = "biz-under-test"

/**
 * What `platformBusinessId()` answers inside this block (G35). A sentinel
 * rather than the real constant, so a `loadCatalogues` that compared against a
 * hard-coded platform literal instead of asking the seam cannot pass — and
 * DISTINCT from `STUB_BUSINESS_ID`, which is therefore a business that is NOT
 * the platform and gets no live feeds.
 */
const PLATFORM_STUB_ID = "platform-under-test"

async function stubDal(overrides: Partial<DalRows> = {}) {
  const rows: DalRows = { ...DEFAULT_DAL_ROWS, ...overrides }
  const getEventsCalls: { businessId: string; filters?: EventFilters }[] = []
  const quizDefinitionCalls: string[] = []
  const publishedEventsCalls: { businessId: string; filters?: EventFilters }[] = []
  // Every read of the faqs table, so "a business that is not the platform
  // never reads it" is observable rather than inferred from an empty list.
  const faqCountsCalls: number[] = []

  vi.resetModules()
  vi.doMock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => PLATFORM_STUB_ID }))
```

Before:
```ts
  vi.doMock("@/lib/db/faqs", () => ({
    getFaqCountsByPage: async () => rows.faqCounts,
  }))
```
After:
```ts
  vi.doMock("@/lib/db/faqs", () => ({
    getFaqCountsByPage: async () => {
      faqCountsCalls.push(1)
      return rows.faqCounts
    },
  }))
```

Before:
```ts
  const { loadCatalogues } = await import("@/lib/funnels/sections/resolve")
  return { loadCatalogues, getEventsCalls, publishedEventsCalls, quizDefinitionCalls }
}

async function loadCataloguesWithStubbedDal(overrides: Partial<DalRows> = {}) {
  const { loadCatalogues, getEventsCalls, publishedEventsCalls, quizDefinitionCalls } = await stubDal(overrides)
  return {
    catalogues: await loadCatalogues(STUB_BUSINESS_ID),
    getEventsCalls,
    publishedEventsCalls,
    quizDefinitionCalls,
  }
}
```
After:
```ts
  const { loadCatalogues } = await import("@/lib/funnels/sections/resolve")
  return { loadCatalogues, getEventsCalls, publishedEventsCalls, quizDefinitionCalls, faqCountsCalls }
}

async function loadCataloguesWithStubbedDal(overrides: Partial<DalRows> = {}, businessId: string = STUB_BUSINESS_ID) {
  const { loadCatalogues, getEventsCalls, publishedEventsCalls, quizDefinitionCalls, faqCountsCalls } =
    await stubDal(overrides)
  return {
    catalogues: await loadCatalogues(businessId),
    getEventsCalls,
    publishedEventsCalls,
    quizDefinitionCalls,
    faqCountsCalls,
  }
}
```

Before:
```ts
    vi.doUnmock("@/lib/db/quizzes")
    vi.resetModules()
  })
```
After:
```ts
    vi.doUnmock("@/lib/db/quizzes")
    vi.doUnmock("@/lib/tenancy/platform")
    vi.resetModules()
  })
```

Retarget `:1496` and do not delete it. It becomes the new rule, with a platform-id control beside it.

Before:
```ts
  it("reads the FAQ page keys from getFaqCountsByPage, sorted", async () => {
    // MUTANT: `faqPageKeys: []` (or dropping the read). It fails LOUDLY rather
    // than silently — every live FAQ section would become an unknown key and
    // block publish on pages that are fine — which is why it needs its own
    // test: none of the CTA assertions above can see this field at all.
    // The stub returns the keys in NON-alphabetical order, so `sort()` is
    // observable rather than accidental.
    const { catalogues } = await loadCataloguesWithStubbedDal()

    expect(catalogues.faqPageKeys).toEqual(["camps", "training"])
  })
```
After:
```ts
  it("gives a business that is not the platform NO FAQ keys and no live feeds, without reading the faqs table (G35)", async () => {
    // RETARGETED, NOT DELETED. This test used to load as `STUB_BUSINESS_ID`
    // and expect the platform's keys. That business is not the platform, and
    // the rows are the platform's own, so it now gets none.
    //
    // MUTANT 1: no platform check — the coach's builder is offered the
    // platform's page keys, a live FAQ section passes the gate, and the island
    // renders an empty band on the live page.
    // MUTANT 2: the check placed AFTER the read — the keys are discarded but
    // the table is still read for a business it can never serve. Only the call
    // count tells that apart from a correct implementation.
    const { catalogues, faqCountsCalls } = await loadCataloguesWithStubbedDal()

    expect(catalogues.faqPageKeys).toEqual([])
    expect(catalogues.liveFeedsAvailable).toBe(false)
    expect(faqCountsCalls).toEqual([])
  })

  it("(control) reads the PLATFORM's FAQ page keys from getFaqCountsByPage, sorted", async () => {
    // MUTANT: `faqPageKeys: []` for everyone (or dropping the read). It fails
    // LOUDLY rather than silently — every live FAQ section on the platform's
    // own pages would become a blocker on pages that are fine — which is why it
    // needs its own test: none of the CTA assertions above can see this field.
    // The stub returns the keys in NON-alphabetical order, so `sort()` is
    // observable rather than accidental. Same stub rows as the test above.
    const { catalogues, faqCountsCalls } = await loadCataloguesWithStubbedDal({}, PLATFORM_STUB_ID)

    expect(catalogues.faqPageKeys).toEqual(["camps", "training"])
    expect(catalogues.liveFeedsAvailable).toBe(true)
    expect(faqCountsCalls).toHaveLength(1)
  })
```

`:1612-1638` is the whole-object test. It flips too, so it loads as the platform to keep checking where the FAQ rows land.

Before:
```ts
    const { catalogues, quizDefinitionCalls } = await loadCataloguesWithStubbedDal()
```
After:
```ts
    // AS THE PLATFORM (G35): the only business whose FAQ rows are read, so the
    // only one where "the FAQ rows land under `faqPageKeys`" can be checked.
    const { catalogues, quizDefinitionCalls } = await loadCataloguesWithStubbedDal({}, PLATFORM_STUB_ID)
```

Before: `      faqPageKeys: ["camps", "training"],`
After: `      faqPageKeys: ["camps", "training"],\n      liveFeedsAvailable: true,`

**(1b) `__tests__/lib/funnels/sections/prompt.test.ts`**

Before:
```ts
  NOT_OFFERED_TO_THE_BUILDER,
} from "@/lib/funnels/sections/prompt"
```
After:
```ts
  NOT_OFFERED_TO_THE_BUILDER,
  LIVE_FEEDS_UNAVAILABLE,
} from "@/lib/funnels/sections/prompt"
```

Before: `    faqPageKeys: ["programs"],`
After: `    faqPageKeys: ["programs"],\n    // The platform's own builder: every assertion in this file predates G35.\n    liveFeedsAvailable: true,`

Use Edit with `replace_all: true` on the four other literals (`:284`, `:875`, `:892`, `:1046`). Missing the flag would print the new line at runtime.

Before: `      faqPageKeys: [],`
After: `      faqPageKeys: [],\n      liveFeedsAvailable: true,`

Insert after the "Block B carries names and never ids" describe.

Before:
```ts
    expect(block).toContain('"Comeback Code: Phase 2, Rebuilt"')
  })
})
```
After:
```ts
    expect(block).toContain('"Comeback Code: Phase 2, Rebuilt"')
  })
})

// ---------------------------------------------------------------------------
// Block B on a business that cannot use the platform's live feeds (G35)
//
// Block A tells every builder to PREFER live testimonials and live FAQs, and it
// is one frozen, cached prefix for every business, so it cannot carry an
// exception. Block B is where the business is known.
// ---------------------------------------------------------------------------
describe("Block B on a business that cannot use the platform's live feeds (G35)", () => {
  it("tells the model the live feeds are unavailable and what to write instead", () => {
    // MUTANT: the flag ignored. The model follows Block A's "prefer live",
    // writes a live FAQ section, and the owner meets a publish blocker on a
    // page the builder just told them was done.
    const block = buildCatalogueBlock({ ...catalogueInput(), faqPageKeys: [], liveFeedsAvailable: false })

    expect(block).toContain(LIVE_FEEDS_UNAVAILABLE)
    // The line itself, not only its presence: an emptied constant would
    // satisfy `toContain` above.
    expect(LIVE_FEEDS_UNAVAILABLE).toMatch(/source "inline"/)
    expect(LIVE_FEEDS_UNAVAILABLE).toMatch(/source "quote"/)
  })

  it("(control) says nothing of the kind to the platform's own builder", () => {
    // MUTANT: the line printed unconditionally, contradicting Block A's
    // "prefer live" on the one business whose rows the feeds hold.
    expect(buildCatalogueBlock(catalogueInput())).not.toContain(LIVE_FEEDS_UNAVAILABLE)
  })

  it("lives in Block B only — Block A stays the same cached prefix for every business", () => {
    // MUTANT: the exception written into Block A, which would either apply it
    // to the platform too or make Block A differ per business and lose the cache.
    const prompt = buildSystemPrompt({ ...catalogueInput(), faqPageKeys: [], liveFeedsAvailable: false })

    expect(prompt.startsWith(SECTION_BUILDER_BLOCK_A)).toBe(true)
    expect(SECTION_BUILDER_BLOCK_A).not.toContain(LIVE_FEEDS_UNAVAILABLE)
  })
})
```

**(1c) `__tests__/app/api/admin/funnels/build-route.test.ts`**

Before:
```ts
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))
vi.mock("@/lib/funnels/sections/doc", async (importOriginal) => {
```
After:
```ts
vi.mock("@/lib/db/events", () => ({ getEvents: vi.fn(), getPublishedEvents: vi.fn() }))
// The quiz reads `loadCatalogues` makes. Unmocked, they reached the dev clone
// through `.env.local` — harmless for `BUSINESS_ID`, which owns no quizzes
// there, but the G35 control below builds as the PLATFORM, which does, and a
// unit test must not depend on what the dev database holds today.
vi.mock("@/lib/db/quizzes", () => ({ listQuizzes: vi.fn(async () => []), getQuizDefinition: vi.fn(async () => null) }))
vi.mock("@/lib/funnels/sections/doc", async (importOriginal) => {
```

Before: `import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"`
After:
```ts
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { platformBusinessId } from "@/lib/tenancy/platform"
import { LIVE_FEEDS_UNAVAILABLE } from "@/lib/funnels/sections/prompt"
```

Before: `describe("POST .../build — the tenant brand kit", () => {`
After:
```ts
// ---------------------------------------------------------------------------
// G35: the platform's live feeds. `loadPageContext` reads the FAQ page keys a
// SECOND time, independently of `loadCatalogues`, for Block B — so it has to
// apply the same rule, or the model is offered keys the gate then refuses.
// `BUSINESS_ID` is not the platform's.
// ---------------------------------------------------------------------------

describe("POST .../build — the platform's live feeds (G35)", () => {
  it("tells a business that is not the platform the live feeds are unavailable, and offers it no FAQ keys", async () => {
    // MUTANT 1: `loadPageContext` with no platform check — Block B lists the
    // platform's page keys to a coach's builder. MUTANT 2: the check placed
    // after the read, in either reader — only the call assertion sees it.
    // MUTANT 3: the flag never reaching `buildSystemPrompt` — no line.
    await runTurn({ message: "hi", revision: 4 })

    const system = mock(streamAgent).mock.calls[0][0] as string
    expect(system).toContain(LIVE_FEEDS_UNAVAILABLE)
    expect(system).not.toContain('"coaching"')
    expect(getFaqCountsByPage).not.toHaveBeenCalled()
  })

  it("(control) offers the platform its own FAQ keys and says nothing about the feeds", async () => {
    mock(resolveAdminTenantForRequest).mockResolvedValue({
      businessId: platformBusinessId(),
      choices: [{ id: platformBusinessId(), name: "DJP Athlete", slug: "djp-athlete" }],
      isOperator: true,
    })

    await runTurn({ message: "hi", revision: 4 })

    const system = mock(streamAgent).mock.calls[0][0] as string
    expect(system).toContain('"coaching"')
    expect(system).not.toContain(LIVE_FEEDS_UNAVAILABLE)
  })
})

describe("POST .../build — the tenant brand kit", () => {
```

**(1d) `__tests__/components/admin/funnel-publish-actions.test.ts`**

`:306` would otherwise break: `BUSINESS_ID` is not the platform, so the section would be refused with the new wording, which names neither "kettlebells" nor "camps".

Before: `vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))`
After:
```ts
vi.mock("@/lib/db/faqs", () => ({ getFaqCountsByPage: vi.fn() }))
// The quiz reads the REAL `loadCatalogues` makes. Unmocked, they reached the
// dev clone through `.env.local`; the G35 tests below also publish as the
// PLATFORM, which owns real quizzes there, and a unit test must not depend on
// what the dev database holds today.
vi.mock("@/lib/db/quizzes", () => ({ listQuizzes: vi.fn(async () => []), getQuizDefinition: vi.fn(async () => null) }))
```

Before: `import { resolveAdminTenant } from "@/lib/tenancy/resolve"`
After: `import { resolveAdminTenant } from "@/lib/tenancy/resolve"\nimport { platformBusinessId } from "@/lib/tenancy/platform"`

Before:
```ts
  it("refuses a live FAQ section whose page key has no rows", async () => {
    // MUTANT KILLED: gating on `unresolved` alone. `faq.pageKey` is not a CTA,
    // so the CTA walk never sees it, and a key with no rows renders the whole
    // section as NOTHING on the live page — `compile.ok: true`, `warnings: []`.
    const doc = {
```
After:
```ts
  it("refuses a live FAQ section whose page key has no rows", async () => {
    // MUTANT KILLED: gating on `unresolved` alone. `faq.pageKey` is not a CTA,
    // so the CTA walk never sees it, and a key with no rows renders the whole
    // section as NOTHING on the live page — `compile.ok: true`, `warnings: []`.
    //
    // AS THE PLATFORM (G35). Only the platform's pages can show live FAQs at
    // all, so it is the only business on which a page key is looked up; on
    // `BUSINESS_ID` this section is refused for a different reason, pinned by
    // the next test.
    mock(resolveAdminTenant).mockResolvedValue({
      businessId: platformBusinessId(),
      choices: [{ id: platformBusinessId(), name: "DJP Athlete", slug: "djp-athlete" }],
      isOperator: true,
    })
    const doc = {
```

Before:
```ts
    expect(result.blockers.join(" ")).toContain("camps")
  })

  it("refuses a document the builder cannot read, instead of throwing at the owner", async () => {
```
After:
```ts
    expect(result.blockers.join(" ")).toContain("camps")
  })

  it("refuses a live FAQ section on a business that is not the platform, and says whose list it is (G35)", async () => {
    // MUTANT: `loadCatalogues` offering every business the platform's FAQ keys.
    // "camps" HAS rows, so without the G35 rule this page would publish and
    // its FAQ band would render empty on the coach's live page.
    const doc = {
      v: 1,
      engine: "sections",
      theme: { tone: "light", accent: "accent", radius: "soft" },
      sections: [
        { id: "faq1", kind: "faq", variant: "stack", style: {}, props: { source: "live", pageKey: "camps" } },
      ],
    } as SectionDoc

    const refused = await renderDocForPublish(STEP_ID, doc)

    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.blockers.join(" ")).toContain("DJP Athlete")
    // Not read at all for a business the rows can never serve.
    expect(getFaqCountsByPage).not.toHaveBeenCalled()

    // PRESENCE CONTROL: the same document, as the platform, publishes — so the
    // refusal above is about the business, not the document.
    mock(resolveAdminTenant).mockResolvedValue({
      businessId: platformBusinessId(),
      choices: [{ id: platformBusinessId(), name: "DJP Athlete", slug: "djp-athlete" }],
      isOperator: true,
    })
    const published = await renderDocForPublish(STEP_ID, doc)
    expect(published.ok).toBe(true)
  })

  it("refuses a document the builder cannot read, instead of throwing at the owner", async () => {
```

- [ ] **Step 2: Run it and watch it fail**

```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/funnels/sections/resolve.test.ts __tests__/lib/funnels/sections/prompt.test.ts __tests__/app/api/admin/funnels/build-route.test.ts __tests__/components/admin/funnel-publish-actions.test.ts
```

Expected failures in `resolve.test.ts`:
- **The five G35 `resolveDoc` tests.** `unavailableLiveFeeds` is `undefined`. The platform control fails too, because the field does not exist yet.
- **G35 `publishGate` BLOCKS.** There is 1 blocker, and it contains "no page has FAQs yet".
- **The retargeted non-platform `loadCatalogues` test.** It gets `["camps","training"]`, and `faqCountsCalls` is `[1]`.
- **The platform control.** `liveFeedsAvailable` is `undefined`, and the test expects `true`.
- **The whole-object `toEqual`.** The `liveFeedsAvailable` key is missing.

Expected failures in the other suites:
- **`prompt.test.ts`, "tells the model…".** `LIVE_FEEDS_UNAVAILABLE` is not exported yet.
- **`build-route.test.ts`, the non-platform test.** The prompt contains `"coaching"` and does not contain the line. `getFaqCountsByPage` was called.
- **`funnel-publish-actions.test.ts`, the G35 test.** `refused.ok` is `true`, because "camps" is a real key.

Expected to pass:
- Every existing test.
- The `publishGate` platform control.
- The retargeted `:306` publish-actions test.
- The two `prompt.test.ts` tests that involve `LIVE_FEEDS_UNAVAILABLE` only negatively. The build-route platform control may also fail at this point, but only because the import is still `undefined`. It must pass after Step 3b.

- [ ] **Step 3: Implement**

**(3a) `lib/funnels/sections/resolve.ts`**

Before:
```ts
  quizSectionPropsSchema,
  sectionDocSchema,
  type CtaTarget,
```
After:
```ts
  quizSectionPropsSchema,
  sectionDocSchema,
  testimonialPropsSchema,
  type CtaTarget,
```

Before:
```ts
import { getFaqCountsByPage } from "@/lib/db/faqs"
```
After:
```ts
import { getFaqCountsByPage } from "@/lib/db/faqs"
// Whether this business may use the platform's live FAQ and testimonial feeds
// at all — see `Catalogues.liveFeedsAvailable` (G35).
import { platformBusinessId } from "@/lib/tenancy/platform"
```

In the `Catalogues` interface:

Before:
```ts
   * this field closes.
   */
  faqPageKeys: string[]
```
After:
```ts
   * this field closes.
   */
  faqPageKeys: string[]
  /**
   * Whether this business may show the platform's LIVE FAQ list and LIVE
   * testimonial feed (G35). True for the platform business only.
   *
   * `faqs` and `testimonials` have no `business_id` column: every row is the
   * platform's own. The live islands render nothing on any other business's
   * page (keyed on the route's tenant), so for that business `faqPageKeys`
   * above is `[]` — the table is not even read — and `resolveDoc` reports a
   * live FAQ or live testimonial section as an `UnavailableLiveFeed` rather
   * than letting it publish as an empty band.
   *
   * A FLAG, NOT "`faqPageKeys` is empty". An empty key list already means
   * something else — the platform has no FAQ rows yet — and the two need
   * different words in front of the owner. Testimonials have no key list at
   * all, so without a flag their check would have nothing to read.
   *
   * REQUIRED, never optional, for the reason `faqPageKeys` is.
   */
  liveFeedsAvailable: boolean
```

In `loadCatalogues`:

Before:
```ts
export async function loadCatalogues(businessId: string): Promise<Catalogues> {
  const [allPrograms, offerPrograms, allPacks, offerPacks, allEvents, offerEvents, faqCounts] = await Promise.all([
```
After:
```ts
export async function loadCatalogues(businessId: string): Promise<Catalogues> {
  // THE ONE PLACE THIS FILE ASKS WHO THE PLATFORM IS (G35). The business is
  // already in hand; the seam is consulted only to decide whether it is the
  // business the `faqs` and `testimonials` rows describe. Not a fallback: a
  // business that is not the platform gets no live feeds, never the
  // platform's. lib/tenancy/platform.ts lists this file for that reason.
  const liveFeedsAvailable = businessId === platformBusinessId()
  const [allPrograms, offerPrograms, allPacks, offerPacks, allEvents, offerEvents, faqCounts] = await Promise.all([
```

Before:
```ts
    // `faqs` has no `business_id` column either -- same as programs and
    // session packs above, not this seam's to invent.
    getFaqCountsByPage(),
  ])
```
After:
```ts
    // `faqs` has no `business_id` column either -- same as programs and
    // session packs above, not this seam's to invent.
    //
    // NOT READ AT ALL for a business that is not the platform (G35): every
    // row is the platform's, the live FAQ island shows them to nobody else,
    // and a key list offered to that business would only let the builder
    // write sections the page can never fill. See `liveFeedsAvailable`.
    liveFeedsAvailable ? getFaqCountsByPage() : Promise.resolve<Record<string, number>>({}),
  ])
```

Before:
```ts
    faqPageKeys: Object.keys(faqCounts).sort(),
    quizzes,
  }
}
```
After:
```ts
    faqPageKeys: Object.keys(faqCounts).sort(),
    liveFeedsAvailable,
    quizzes,
  }
}
```

After `UnknownFaqKey`:

Before:
```ts
  /** Every key that DOES have rows, so the fix is one name away. */
  candidates: string[]
}
```
After:
```ts
  /** Every key that DOES have rows, so the fix is one name away. */
  candidates: string[]
}

/**
 * A `faq` or `testimonial` section set to `source: "live"` on a page whose
 * business is not the platform (G35).
 *
 * `faqs` and `testimonials` have no `business_id` column, so every row either
 * live feed can show is the PLATFORM's own. The live islands therefore render
 * nothing on any other business's page (FaqIsland.tsx / TestimonialsIsland.tsx,
 * keyed on the route's tenant) — and a section that renders nothing is exactly
 * the silent absence `UnknownFaqKey` above exists to stop: a heading over an
 * empty band on a page the owner has already approved.
 *
 * A SEPARATE ENTRY, NOT AN `UnknownFaqKey`, and the difference is what the
 * owner is told. That type's wording is "no FAQs are filed under X — no page
 * has FAQs yet", which sends the owner to add rows that would STILL not
 * appear: the rows are not missing, they belong to someone else.
 *
 * IT BLOCKS, for `UnknownFaqKey`'s reason: the owner cannot see the damage.
 * The island guarantees no visitor sees the platform's rows; this stops a new
 * page from publishing with a band that will be empty.
 *
 * NOT REWRITTEN. Converting the section to inline FAQs or authored quotes
 * needs content only the owner has.
 */
export interface UnavailableLiveFeed {
  /** The section carrying it. */
  sectionId: string
  /** Which feed — the section's own kind. */
  kind: "faq" | "testimonial"
}
```

In `ResolveResult`:

Before:
```ts
  /** NON-EMPTY MEANS PUBLISH IS BLOCKED. See `publishGate()`. */
  unknownFaqKeys: UnknownFaqKey[]
```
After:
```ts
  /** NON-EMPTY MEANS PUBLISH IS BLOCKED. See `publishGate()`. */
  unknownFaqKeys: UnknownFaqKey[]
  /**
   * NON-EMPTY MEANS PUBLISH IS BLOCKED. Live FAQ and live testimonial sections
   * on a business that cannot use the platform's feeds. See `UnavailableLiveFeed`.
   */
  unavailableLiveFeeds: UnavailableLiveFeed[]
```

In `resolveDoc`:

Before: `  const unknownFaqKeys: UnknownFaqKey[] = []`
After: `  const unknownFaqKeys: UnknownFaqKey[] = []\n  const unavailableLiveFeeds: UnavailableLiveFeed[] = []`

Before:
```ts
    if (section.kind === "faq") {
      const faqProps = faqPropsSchema.parse(section.props)
      if (faqProps.source === "live" && !catalogues.faqPageKeys.includes(faqProps.pageKey)) {
```
After:
```ts
    if (section.kind === "faq") {
      const faqProps = faqPropsSchema.parse(section.props)
      // CHECKED FIRST, AND INSTEAD OF the key check, not as well as it (G35).
      // On a business without the platform's feeds `faqPageKeys` is `[]`, so
      // the key check would report every live section as an unknown key — and
      // tell the owner "no page has FAQs yet", which sends them off to add rows
      // that would still never appear. One entry, with the true reason.
      if (faqProps.source === "live" && !catalogues.liveFeedsAvailable) {
        unavailableLiveFeeds.push({ sectionId: section.id, kind: "faq" })
      } else if (faqProps.source === "live" && !catalogues.faqPageKeys.includes(faqProps.pageKey)) {
```

Before: `    // QUIZZES THAT CANNOT SCORE. Beside the FAQ check above for the same`
After:
```ts
    // LIVE TESTIMONIALS, the FAQ branch's sibling (G35). Until now nothing here
    // looked at a testimonial section at all: its live feed takes no key, so
    // nothing could fail to resolve. Now something can — the feed itself, on a
    // business that is not the platform. `source: "quote"` is the owner's own
    // authored content and is never reported.
    //
    // Narrowed through the registry's own schema, never a cast — same rule the
    // FAQ branch follows.
    if (section.kind === "testimonial") {
      const testimonialProps = testimonialPropsSchema.parse(section.props)
      if (testimonialProps.source === "live" && !catalogues.liveFeedsAvailable) {
        unavailableLiveFeeds.push({ sectionId: section.id, kind: "testimonial" })
      }
    }

    // QUIZZES THAT CANNOT SCORE. Beside the FAQ check above for the same
```

Before:
```ts
    brokenStepLinks,
    unknownFaqKeys,
    unresolvedQuizzes,
```
After:
```ts
    brokenStepLinks,
    unknownFaqKeys,
    unavailableLiveFeeds,
    unresolvedQuizzes,
```

The describer and the gate:

Before:
```ts
    `"${entry.pageKey}", so that section would show nothing at all — ${known}.`
  )
}
```
After:
```ts
    `"${entry.pageKey}", so that section would show nothing at all — ${known}.`
  )
}

/**
 * Plain words, with the fix in them (G35). The owner picked "Live" under
 * "Content source" in the builder and has never seen a table name; what they
 * need is whose list it is and which setting to change. "Inline" and "Quote"
 * are the inspector's own labels for the other choice.
 */
function describeUnavailableLiveFeed(entry: UnavailableLiveFeed): string {
  const what = entry.kind === "faq" ? "live FAQs" : "live testimonials"
  const fix =
    entry.kind === "faq"
      ? `Set its "Content source" to "Inline" and write your own questions.`
      : `Set its "Content source" to "Quote" and add your own quotes.`
  return (
    `Section "${entry.sectionId}" shows ${what}, which come from DJP Athlete's own list and cannot be used on ` +
    `this business's pages, so that section would show nothing at all. ${fix}`
  )
}
```

Before: `    ...result.unknownFaqKeys.map(describeUnknownFaqKey),`
After:
```ts
    ...result.unknownFaqKeys.map(describeUnknownFaqKey),
    // BLOCKS, beside the unknown key it would otherwise be mistaken for (G35):
    // a live feed this business cannot use renders as nothing, exactly like a
    // key with no rows.
    ...result.unavailableLiveFeeds.map(describeUnavailableLiveFeed),
```

**(3b) `lib/funnels/sections/prompt.ts`**

Before:
```ts
  /** `page_key` values the faqs table actually has rows for. */
  faqPageKeys: string[]
```
After:
```ts
  /** `page_key` values the faqs table actually has rows for. */
  faqPageKeys: string[]
  /**
   * Whether this business may use the platform's live FAQ list and live
   * testimonial feed (G35) — `Catalogues.liveFeedsAvailable`'s question, asked
   * by the build route for the prompt. `false` adds `LIVE_FEEDS_UNAVAILABLE`
   * to Block B.
   *
   * Required, following the reasoning above: a forgotten argument must be a
   * compile error, not a coach's builder told to prefer a feed the gate will
   * refuse.
   */
  liveFeedsAvailable: boolean
```

Before: `function nameList(names: string[]): string {`
After:
```ts
/**
 * Block B's line for a business that is not the platform (G35).
 *
 * Block A tells EVERY builder to prefer `source: "live"` for testimonials and
 * FAQs, and it cannot be told otherwise per business: it is frozen and cached
 * as one prefix for every page of every business. So the exception lives
 * here, in the per-page block, where the business is known.
 *
 * `faqs` and `testimonials` have no `business_id` column — every row is DJP
 * Athlete's own — so on any other business's page the live islands show
 * nothing and the publish gate refuses the section. Saying so up front is
 * what keeps the model from building a section the owner then cannot publish.
 *
 * Exported so the tests assert the exact line rather than a paraphrase of it.
 */
export const LIVE_FEEDS_UNAVAILABLE =
  "Live FAQs and live testimonials are NOT available on this business's pages. Both lists belong to DJP " +
  "Athlete, not to this business, so a section using either cannot be published here. Write every `faq` " +
  'section with source "inline" and questions about THIS business\'s own offer. Write every `testimonial` ' +
  'section with source "quote" and only quotes the owner has given you — if they have given you none, leave ' +
  "the testimonial section out rather than inventing one."

function nameList(names: string[]): string {
```

Before: `  const { catalogue, faqPageKeys, stepSlugs, nextStepSlug, funnelSlug } = input`
After: `  const { catalogue, faqPageKeys, liveFeedsAvailable, stepSlugs, nextStepSlug, funnelSlug } = input`

Before, inside the template:
```
FAQ page keys (faq section, source "live", \`pageKey\`):
${nameList(faqPageKeys)}

Other steps in this funnel ({ kind: "step", stepSlug }):
```
After:
```
FAQ page keys (faq section, source "live", \`pageKey\`):
${nameList(faqPageKeys)}${
    // ONLY for a business that is not the platform, and absent (not "(none)",
    // not a "yes") for the platform, so the platform's Block B is exactly what
    // it was before G35.
    liveFeedsAvailable ? "" : `\n\n${LIVE_FEEDS_UNAVAILABLE}`
  }

Other steps in this funnel ({ kind: "step", stepSlug }):
```

**(3c) `app/api/admin/funnels/steps/[stepId]/build/route.ts`**

Before: `import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"`
After: `import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"\nimport { platformBusinessId } from "@/lib/tenancy/platform"`

Before:
```ts
  funnelSlug: string | null
  faqPageKeys: string[]
```
After:
```ts
  funnelSlug: string | null
  faqPageKeys: string[]
  /**
   * Whether this business may use the platform's live FAQ list and live
   * testimonial feed (G35): true for the platform only. Decided here rather
   * than read off the catalogue, because the catalogue can fail to load while
   * this context degrades on its own — and the answer is a pure function of
   * the business, so both branches of `loadPageContext` can tell the truth.
   * `faqPageKeys` above is `[]` whenever this is false.
   */
  liveFeedsAvailable: boolean
```

Before:
```ts
async function loadPageContext(businessId: string, funnelId: string, thisStepSlug: string): Promise<PageContext> {
  const brandKit = await loadBrandKitSafely(businessId)
```
After:
```ts
async function loadPageContext(businessId: string, funnelId: string, thisStepSlug: string): Promise<PageContext> {
  const brandKit = await loadBrandKitSafely(businessId)

  // THE PLATFORM'S LIVE FEEDS, AND ONLY THE PLATFORM'S (G35) — the rule
  // `loadCatalogues` applies, applied again here because this is a SECOND,
  // independent read of the FAQ keys (Block B's list), and a second reader
  // without it would offer a coach's builder keys the gate then refuses.
  // `faqs` and `testimonials` have no `business_id` column; every row is the
  // platform's own. Outside the `try`, and pure: the degraded branch below
  // must tell the model the same truth.
  const liveFeedsAvailable = businessId === platformBusinessId()
```

Before:
```ts
      listSteps(businessId, funnelId),
      getFaqCountsByPage(),
    ])
```
After:
```ts
      listSteps(businessId, funnelId),
      // Not read at all for a business the rows can never serve.
      liveFeedsAvailable ? getFaqCountsByPage() : Promise.resolve<Record<string, number>>({}),
    ])
```

Before: `      faqPageKeys: Object.keys(faqCounts).sort(),\n      brandKit,`
After: `      faqPageKeys: Object.keys(faqCounts).sort(),\n      liveFeedsAvailable,\n      brandKit,`

Before: `      faqPageKeys: [],\n      brandKit,`
After: `      faqPageKeys: [],\n      liveFeedsAvailable,\n      brandKit,`

Before: `    faqPageKeys: context.faqPageKeys,\n    stepSlugs: context.stepSlugs,`
After: `    faqPageKeys: context.faqPageKeys,\n    liveFeedsAvailable: context.liveFeedsAvailable,\n    stepSlugs: context.stepSlugs,`

**(3d) `lib/tenancy/platform.ts`**: two entries after the Task 7 islands entry. Only paths that call the seam are named.

Before:
```
 *     about one document, which is this subsystem's worst failure.
 *   - the Stripe webhook's purchase capture (app/api/stripe/webhook/route.ts).
```
After:
```
 *     about one document, which is this subsystem's worst failure.
 *   - the funnel builder's catalogue and publish gate
 *     (lib/funnels/sections/resolve.ts, in `loadCatalogues`), since G35 --
 *     the gate's half of the island entry directly above. It already has the
 *     admin's tenant, and consults this only to decide whether that tenant
 *     may use the platform's live FAQ and testimonial feeds. Any other
 *     business gets no FAQ page keys (the table is not even read) and
 *     `liveFeedsAvailable: false`, so `resolveDoc` reports a live FAQ or live
 *     testimonial section as a blocker the owner can act on. The island is
 *     what guarantees no visitor sees the platform's rows; this is what stops
 *     a new page publishing with a band the island will leave empty.
 *   - the AI page builder's prompt
 *     (app/api/admin/funnels/steps/[stepId]/build/route.ts, in
 *     `loadPageContext`), since G35. It reads the FAQ page keys a SECOND time,
 *     independently of the catalogue, for Block B of the prompt, so it applies
 *     the same rule itself -- a second reader without it would offer a coach's
 *     builder keys the gate then refuses. For any other business it reads no
 *     keys and Block B says the live feeds are unavailable. Block A cannot say
 *     it: Block A is one cached prefix shared by every business.
 *   - the Stripe webhook's purchase capture (app/api/stripe/webhook/route.ts).
```

- [ ] **Step 4: Run it and watch it pass**

First, edit the remaining `Catalogues` and `BuilderCatalogueInput` literals.

`__tests__/api/funnels/offers-route.test.ts:50`. This literal is untyped (a `mockResolvedValue` argument) and already lacks `quizzes`.

Before: `  faqPageKeys: [],\n}`
After:
```ts
  faqPageKeys: [],
  // "biz-1" is not the platform (G35), so this is what loadCatalogues would
  // answer for it. The offers route reads only `offer`.
  liveFeedsAvailable: false,
}
```

`__tests__/api/funnels/ai-plan-route.test.ts:80`

Before: `    faqPageKeys: [],\n  })`
After: `    faqPageKeys: [],\n    liveFeedsAvailable: false,\n  })`

`__tests__/integration/builder-colour-live.test.ts:69`. This is in the integration lane, so it is checked by tsc only; do not run it, because it calls the real model.

Before: `    faqPageKeys: [],\n    stepSlugs: [],`
After: `    faqPageKeys: [],\n    liveFeedsAvailable: true,\n    stepSlugs: [],`

Then run the suites. They were found by grepping for importers and mocks of `@/lib/funnels/sections/resolve`, `@/lib/funnels/sections/prompt` and the build route, plus the suites that run the real `loadCatalogues`/`publishGate` through `preview-render`, `publish-actions` and the two publish routes:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/funnels/sections/resolve.test.ts __tests__/lib/funnels/load-catalogues-tenancy.test.ts __tests__/lib/funnels/sections/prompt.test.ts __tests__/app/api/admin/funnels/build-route.test.ts __tests__/app/api/admin/funnels/build-route-render.test.ts __tests__/lib/funnels/sections/builder-config.test.ts __tests__/components/admin/funnel-publish-actions.test.ts __tests__/app/api/admin/funnels/publish-route.test.ts __tests__/app/api/admin/funnels/funnel-publish-route.test.ts __tests__/lib/funnels/preview-render.test.ts __tests__/app/funnel-draft-preview-page.test.tsx __tests__/api/funnels/offers-route.test.ts __tests__/api/funnels/ai-plan-route.test.ts __tests__/lib/funnels/sections/quiz-origination.test.ts __tests__/lib/funnels/sections/leadgen.test.ts __tests__/lib/funnels/sections/review/audit-prompt-agreement.test.ts __tests__/lib/funnels/sections/review/reviser.test.ts __tests__/lib/tenancy/platform-inventory.test.ts
```
Expected: all green. For `platform-inventory.test.ts`, the forward check needs both new paths, and the reverse check finds that both call the seam.

Type check. Run each as its own call:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit -p tsconfig.json > /private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/f66737df-ecd8-4579-a964-2a1254670317/scratchpad/g35-t8-tsc.txt 2>&1
```
```
grep -nE "lib/funnels/sections/(resolve|prompt)\.ts|steps/\[stepId\]/build/route\.ts|sections/(resolve|prompt)\.test\.ts|build-route\.test|funnel-publish-actions\.test|offers-route\.test|ai-plan-route\.test|builder-colour-live\.test|lib/tenancy/platform\.ts" /private/tmp/claude-501/-Users-aeangabrielletayawa-Desktop-Darren-Paul-Projects-djpathlete/f66737df-ecd8-4579-a964-2a1254670317/scratchpad/g35-t8-tsc.txt
```
Expected: no lines.

Then:
```
PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx prettier --check lib/funnels/sections/resolve.ts lib/funnels/sections/prompt.ts "app/api/admin/funnels/steps/[stepId]/build/route.ts" __tests__/lib/funnels/sections/resolve.test.ts __tests__/lib/funnels/sections/prompt.test.ts __tests__/app/api/admin/funnels/build-route.test.ts __tests__/components/admin/funnel-publish-actions.test.ts __tests__/api/funnels/offers-route.test.ts __tests__/api/funnels/ai-plan-route.test.ts __tests__/integration/builder-colour-live.test.ts
```

Mutation check. Make each change, run the owning suite, then revert it:
- In `loadCatalogues`, read `getFaqCountsByPage()` unconditionally and apply the flag to the keys afterwards. The retargeted resolve test must go red on `faqCountsCalls`.
- Delete the testimonial branch. The "reports a live testimonial section" test must go red.
- Swap the FAQ branch back to the key check alone. The "NOT as an unknown page key" test must go red.
- In `loadPageContext`, drop the flag. The build-route non-platform test must go red.

- [ ] **Step 5: Commit**

```
git add lib/funnels/sections/resolve.ts lib/funnels/sections/prompt.ts "app/api/admin/funnels/steps/[stepId]/build/route.ts" lib/tenancy/platform.ts __tests__/lib/funnels/sections/resolve.test.ts __tests__/lib/funnels/sections/prompt.test.ts __tests__/app/api/admin/funnels/build-route.test.ts __tests__/components/admin/funnel-publish-actions.test.ts __tests__/api/funnels/offers-route.test.ts __tests__/api/funnels/ai-plan-route.test.ts __tests__/integration/builder-colour-live.test.ts
```
Use the Write tool to put the message in `<scratchpad>/g35-t8-commit.txt`, then run `git commit -F <that path>`:
```
fix(funnels): the builder and publish gate refuse the platform's live feeds off the platform (G35)

Once the islands stopped showing the platform's FAQs and testimonials on other
businesses' pages, the builder and the gate still offered them: a coach could
publish a live FAQ or testimonial section that renders as an empty band.

loadCatalogues answers faqPageKeys [] and the new required liveFeedsAvailable
false for any business that is not the platform, without reading the faqs
table. resolveDoc records a live FAQ or live testimonial section there as an
UnavailableLiveFeed, not as an UnknownFaqKey, whose "no page has FAQs yet"
would send the owner to add rows that still would not appear. publishGate
blocks on it in words that name the fix. Nothing inspected testimonial
sections before. The build route's own FAQ-key read follows the same rule, and
Block B tells a non-platform builder to write inline FAQs and authored quotes
instead.

resolve.test.ts's FAQ-key test is retargeted to the new rule, with a platform
control beside it. resolve.ts and the build route are named on the NARROWER
VARIANT shelf of lib/tenancy/platform.ts.
```

---


### Task 9: Agent jobs carry the platform business (spec §C1)

**Files:**
- Modify: `app/api/admin/internal/seo-agent/route.ts:10,31` (import; `input` of the direct Firestore write, which stays because it sets `triggeredBy`)
- Modify: `app/api/admin/internal/social-agent-cron/route.ts:4,18-22`
- Modify: `app/api/admin/social/agent/run/route.ts:9,29`
- Modify: `lib/tenancy/platform.ts:124-127`. This adds one entry to the CORRECT BY CONSTRUCTION shelf, after the invite-claim entry.
- Test: `__tests__/api/admin/internal/seo-agent.test.ts` (extend the existing suite)
- Create: `__tests__/api/admin/internal/social-agent-cron.test.ts` (this route has no suite today)
- Create: `__tests__/api/admin/social/agent-run.test.ts` (this route has no suite today)

**Interfaces:**
- Consumes: `platformBusinessId(): string` from `lib/tenancy/platform.ts` (already exists).
- Produces: every `seo_agent_run` and `social_agent_run` job written by these three routes carries `input.businessId: string`, equal to `platformBusinessId()`. Task 10 reads `input.businessId` in `functions/src/seo-agent.ts` and `functions/src/social-agent.ts`.

- [ ] **Step 1: Write the failing test**

1a. Extend `__tests__/api/admin/internal/seo-agent.test.ts` with three exact-string edits.

Edit 1. old:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
```
new:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { SYSTEM_USER_ID } from "@/lib/system-user"
```

Edit 2. old:
```ts
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-ts" },
}))
```
new:
```ts
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-ts" },
}))
// G35. The seam is mocked to an id nothing else in the job could produce.
// SYSTEM_USER_ID (the job's userId) and the platform business id are the SAME
// literal, "00000000-0000-0000-0000-000000000001", so an assertion on the real
// id could not tell a stamp read from the seam from `businessId: userId`.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz-g35" }))
```

Edit 3. old (the end of the happy-path test and of the file):
```ts
      triggeredBy: "seo_agent_cron",
    })
  })
})
```
new:
```ts
      triggeredBy: "seo_agent_cron",
    })
  })

  // G35. MUTANTS: no businessId (today's input); `businessId: SYSTEM_USER_ID`;
  // the platform literal inline. The last two equal the REAL platform id, so
  // only the seam mocked to a distinct id above tells them apart.
  it("stamps the platform business into the job input, read from the seam", async () => {
    isCronSkipped.mockResolvedValueOnce({ skipped: false })
    jobSetMock.mockResolvedValueOnce(undefined)
    await call()
    const jobArg = jobSetMock.mock.calls[0]?.[0] as { input: Record<string, unknown> }
    expect(jobArg.input).toEqual({
      userId: SYSTEM_USER_ID,
      businessId: "platform-biz-g35",
      runDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })
})
```

1b. Create `__tests__/api/admin/internal/social-agent-cron.test.ts`:
```ts
// POST /api/admin/internal/social-agent-cron — the Tue/Thu cron's enqueue
// (functions/src/index.ts socialAgentCron fetches it with the cron bearer).
// This route had no suite; G35 gives it one for the claim it now makes: the
// job carries the business whose owners the agent's alert goes to, read from
// the platform seam.
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  createAiJob: vi.fn(),
  settings: {} as Record<string, unknown>,
  bearer: "",
}))

vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.bearer ? { authorization: `Bearer ${h.bearer}` } : {}),
}))
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table !== "system_settings") throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: (_column: string, key: string) => ({
            maybeSingle: async () => ({
              data: key in h.settings ? { value: h.settings[key] } : null,
              error: null,
            }),
          }),
        }),
      }
    },
  }),
}))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: h.createAiJob }))
// A distinct id: nothing else in this job ("system", "linkedin") could produce it.
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz-g35" }))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/admin/internal/social-agent-cron/route"

function call() {
  return POST(new NextRequest("https://example.test/api/admin/internal/social-agent-cron", { method: "POST" }))
}

beforeEach(() => {
  h.createAiJob.mockReset()
  h.createAiJob.mockResolvedValue({ jobId: "job-1", status: "pending" })
  h.settings = { automation_paused: false, cron_social_agent_enabled: true }
  h.bearer = "cron-secret"
  process.env.INTERNAL_CRON_TOKEN = "cron-secret"
})

describe("POST /api/admin/internal/social-agent-cron", () => {
  // MUTANTS: no businessId (the route before G35); `businessId: "system"`
  // (the job's userId). The exact-object assertion catches both.
  it("stamps the platform business into the job input, read from the seam (G35)", async () => {
    const res = await call()
    expect(await res.json()).toEqual({ jobId: "job-1", status: "pending" })
    expect(h.createAiJob).toHaveBeenCalledWith({
      type: "social_agent_run",
      userId: "system",
      input: { platform: "linkedin", businessId: "platform-biz-g35" },
    })
  })

  // Absence; the test above is its presence control (same mocks, gate open).
  it("enqueues nothing when the cron is switched off", async () => {
    h.settings.cron_social_agent_enabled = false
    const res = await call()
    expect(await res.json()).toEqual({ skipped: "cron_social_agent_enabled=false" })
    expect(h.createAiJob).not.toHaveBeenCalled()
  })

  it("401s a wrong bearer and enqueues nothing", async () => {
    h.bearer = "wrong"
    const res = await call()
    expect(res.status).toBe(401)
    expect(h.createAiJob).not.toHaveBeenCalled()
  })
})
```

1c. Create `__tests__/api/admin/social/agent-run.test.ts`:
```ts
// POST /api/admin/social/agent/run — a manual social-agent run. No suite
// before G35; this one pins which business the job carries.
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  canAccessAdminPath: vi.fn(),
  createAiJob: vi.fn(),
  resolveAdminTenantForRequest: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/permissions/guard", () => ({ canAccessAdminPath: h.canAccessAdminPath }))
vi.mock("@/lib/ai-jobs", () => ({ createAiJob: h.createAiJob }))
vi.mock("@/lib/tenancy/platform", () => ({ platformBusinessId: () => "platform-biz-g35" }))
// This route HAS a session, so "use the admin's selected business" is the
// tempting fix. It is the wrong one: the agent's subject is the platform's own
// blog whichever business is selected. The resolver is mocked to a DIFFERENT
// business so that mutant stamps "coach-b-biz" and fails the assertions below.
vi.mock("@/lib/tenancy/resolve", () => ({
  resolveAdminTenantForRequest: h.resolveAdminTenantForRequest,
  resolveAdminTenant: h.resolveAdminTenantForRequest,
  NoAccessibleBusinessError: class NoAccessibleBusinessError extends Error {},
}))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/admin/social/agent/run/route"

function call(body: unknown) {
  return POST(
    new NextRequest("https://example.test/api/admin/social/agent/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  h.auth.mockReset()
  h.auth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  h.canAccessAdminPath.mockReset()
  h.canAccessAdminPath.mockResolvedValue(true)
  h.createAiJob.mockReset()
  h.createAiJob.mockResolvedValue({ jobId: "job-1", status: "pending" })
  h.resolveAdminTenantForRequest.mockReset()
  h.resolveAdminTenantForRequest.mockResolvedValue({ businessId: "coach-b-biz", choices: [], isOperator: true })
})

describe("POST /api/admin/social/agent/run", () => {
  // MUTANTS: no businessId (the route before G35); the admin's selected
  // business (resolveAdminTenantForRequest, mocked to coach-b-biz above).
  it("stamps the PLATFORM business, not the admin's selected one (G35)", async () => {
    const res = await call({})
    expect(res.status).toBe(202)
    expect(h.createAiJob).toHaveBeenCalledWith({
      type: "social_agent_run",
      userId: "admin-1",
      input: { platform: "linkedin", businessId: "platform-biz-g35" },
    })
  })

  it("keeps a manual topic override beside the stamp", async () => {
    await call({ blogPostId: "post-1" })
    expect(h.createAiJob).toHaveBeenCalledWith({
      type: "social_agent_run",
      userId: "admin-1",
      input: { platform: "linkedin", businessId: "platform-biz-g35", blogPostId: "post-1" },
    })
  })

  // Absence; the first test is its presence control (same mocks, a session).
  it("enqueues nothing without an admin session", async () => {
    h.auth.mockResolvedValueOnce(null)
    const res = await call({})
    expect(res.status).toBe(401)
    expect(h.createAiJob).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/api/admin/internal/seo-agent.test.ts __tests__/api/admin/internal/social-agent-cron.test.ts __tests__/api/admin/social/agent-run.test.ts`

Expected result: `4 failed | 7 passed (11)`. I measured this at plan time against a probe copy.
- seo-agent test "stamps the platform business into the job input, read from the seam" fails with `AssertionError: expected { …(2) } to deeply equal { …(3) }`, because the input has only `userId` and `runDate`.
- social-agent-cron test "stamps the platform business …" fails with `expected "vi.fn()" to be called with arguments: [ { type: 'social_agent_run', …(2) } ]`.
- agent-run tests "stamps the PLATFORM business …" and "keeps a manual topic override …" fail with the same `called with arguments` error.
- All 401, skipped-gate and no-session tests pass.

- [ ] **Step 3: Implement**

3a. `app/api/admin/internal/seo-agent/route.ts`

Edit 1. old:
```ts
import { SYSTEM_USER_ID } from "@/lib/system-user"
```
new:
```ts
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { platformBusinessId } from "@/lib/tenancy/platform"
```

Edit 2. old:
```ts
    input: { userId: SYSTEM_USER_ID, runDate: new Date().toISOString().slice(0, 10) },
```
new:
```ts
    // businessId (G35): whose OWNERS the agent's flag_for_human alert goes to.
    // The platform's, by construction rather than for want of a resolver:
    // every table the SEO agent reads and writes (gsc_query_daily, blog_posts,
    // content_calendar, seo_agent_memos) has no business_id and describes
    // darrenjpaul.com's own search data. lib/tenancy/platform.ts lists this
    // route under CORRECT BY CONSTRUCTION. Read from the seam, never copied
    // from userId: SYSTEM_USER_ID happens to be the same literal as the
    // platform business id, and that coincidence must not become the source.
    input: {
      userId: SYSTEM_USER_ID,
      businessId: platformBusinessId(),
      runDate: new Date().toISOString().slice(0, 10),
    },
```

3b. `app/api/admin/internal/social-agent-cron/route.ts`

Edit 1. old:
```ts
import { createAiJob } from "@/lib/ai-jobs"
```
new:
```ts
import { createAiJob } from "@/lib/ai-jobs"
import { platformBusinessId } from "@/lib/tenancy/platform"
```

Edit 2. old:
```ts
    userId: "system",
    input: { platform: "linkedin" },
  })
```
new:
```ts
    userId: "system",
    // businessId (G35): whose owners get the "no eligible topic" alert. The
    // platform's, by construction: a cron has no session to resolve from, and
    // nothing the social agent reads or writes (blog_posts, strategy_briefs,
    // social_posts, social_agent_memos) has a business_id. lib/tenancy/platform.ts
    // lists this route under CORRECT BY CONSTRUCTION.
    input: { platform: "linkedin", businessId: platformBusinessId() },
  })
```

3c. `app/api/admin/social/agent/run/route.ts`

Edit 1. old:
```ts
import { canAccessAdminPath } from "@/lib/permissions/guard"
```
new:
```ts
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { platformBusinessId } from "@/lib/tenancy/platform"
```

Edit 2. old:
```ts
  const input: Record<string, unknown> = { platform }
```
new:
```ts
  // businessId (G35): whose owners get the agent's "no eligible topic" alert.
  // The PLATFORM's, not the business this admin has selected, although this
  // route has a session and could resolve one: every table the social agent
  // reads and writes (blog_posts, strategy_briefs, social_posts,
  // platform_connections, social_agent_memos) has no business_id, so the run
  // is about darrenjpaul.com's blog whichever business is selected. Stamping
  // the selected one would alert a coach's owners about the platform's posts.
  // lib/tenancy/platform.ts lists this route under CORRECT BY CONSTRUCTION.
  const input: Record<string, unknown> = { platform, businessId: platformBusinessId() }
```

3d. `lib/tenancy/platform.ts`, on the CORRECT BY CONSTRUCTION shelf. The anchor is the invite-claim entry, which appears exactly once (checked at plan time). No other G35 task edits that entry.

old:
```
 *   - the invite claim's plain-team-invite branch
 *     (app/api/public/invite/[token]/claim/route.ts). An invite with no
 *     business_id is a /admin/team invite, which is by definition onto the
 *     platform's own business; the membership row it writes says so.
```
new:
```
 *   - the invite claim's plain-team-invite branch
 *     (app/api/public/invite/[token]/claim/route.ts). An invite with no
 *     business_id is a /admin/team invite, which is by definition onto the
 *     platform's own business; the membership row it writes says so.
 *   - the SEO and social agents' JOB BUSINESS: the `businessId` that three
 *     enqueue routes stamp into the job input --
 *     app/api/admin/internal/seo-agent/route.ts (the weekly SEO cron),
 *     app/api/admin/internal/social-agent-cron/route.ts (the Tue/Thu social
 *     cron) and app/api/admin/social/agent/run/route.ts (a manual run). The
 *     Firebase agents read it to decide whose owners get the agent's in-app
 *     alert (G35). Every table those agents read or write -- `blog_posts`,
 *     `gsc_query_daily`, `content_calendar`, the SEO and social agents' memo
 *     tables, `social_posts`, `platform_connections`, `strategy_briefs`,
 *     `notifications` -- has no `business_id`, and their subject is
 *     darrenjpaul.com's own search and blog data, so the platform is the
 *     answer rather than a placeholder. The two crons have no session. The
 *     manual route HAS one and still must not resolve the admin's selected
 *     business: an operator with a coach's business selected would stamp
 *     that coach, whose owners would then be alerted about the platform's
 *     blog. The functions never default a missing `businessId` (a job
 *     enqueued before G35); they skip the alert and log why.
```

The reverse-check regex picks up exactly three new paths from this paragraph, and all three are now callers (checked at plan time). Do not add `app/api/admin/automation/trigger/route.ts` or any `functions/src/lib/...` path to this prose: the regex would read them as stale paths.

- [ ] **Step 4: Run it and watch it pass**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/api/admin/internal/seo-agent.test.ts __tests__/api/admin/internal/social-agent-cron.test.ts __tests__/api/admin/social/agent-run.test.ts __tests__/lib/tenancy/platform-inventory.test.ts`

Expected result: 11 of 11 route tests pass (measured on the probe) and 5 of 5 inventory tests pass. If you run the inventory test after 3a-3c but before 3d, its forward check fails and names exactly the three route files. That confirms the paragraph is load-bearing.

Mutants checked at plan time, each of which turned a named test red:
- `businessId: SYSTEM_USER_ID` in the SEO route
- `(await resolveAdminTenantForRequest(request)).businessId` in the manual route (both of its stamp tests fail)

Compile gate: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'app/api/admin/(internal/seo-agent|internal/social-agent-cron|social/agent/run)/route\.ts|__tests__/api/admin/(internal/seo-agent|internal/social-agent-cron|social/agent-run)\.test\.ts|lib/tenancy/platform\.ts'` should print nothing. None of these files is in `.claude/baselines/tsc-ce6f2aba-perfile.txt` (main checkout), so any line it prints is new.

Other suites that import or mock a changed module:
- The seo-agent route: only `__tests__/api/admin/internal/seo-agent.test.ts`, extended above.
- The other two routes: none.
- `lib/tenancy/platform.ts` changes in its comment only, so these suites need no edit and no re-run. Suites that import it: `__tests__/api/admin/internal/bookkeeping-income-sync.test.ts`, `__tests__/lib/db/bookings.test.ts`, `__tests__/integration/api/shop/leads.test.ts`, `__tests__/integration/chat-live.test.ts`. Suites that mock it: `__tests__/api/assessment/submit-route.test.ts`, `__tests__/api/public/invite-claim.test.ts`, `__tests__/api/spine/questionnaire-spine.test.ts`, `__tests__/api/stripe/webhook-{abandoned-checkout-purchase-guard,capture-tenant,contact-source,funnel-purchase,session-pack}.test.ts`, `__tests__/api/webhooks/calendly-booking.test.ts`, `__tests__/api/webhooks/calendly-tenant-resolution.test.ts`, `__tests__/app/sitemap-funnels.test.ts`, `__tests__/db/google-ads-accounts-tenancy.test.ts`, `__tests__/lib/tenancy/public.test.ts`.

- [ ] **Step 5: Commit**

`git add app/api/admin/internal/seo-agent/route.ts app/api/admin/internal/social-agent-cron/route.ts app/api/admin/social/agent/run/route.ts lib/tenancy/platform.ts __tests__/api/admin/internal/seo-agent.test.ts __tests__/api/admin/internal/social-agent-cron.test.ts __tests__/api/admin/social/agent-run.test.ts`

`git commit -m "feat(agents): stamp the platform business on SEO and social agent jobs (G35)" -m "The SEO and social agents' alerts move to the owners of the job's business in the next commit, and nothing in their pipeline carries a business: every table they read or write has no business_id. The three enqueue routes now stamp businessId from platformBusinessId(): the weekly SEO cron's direct Firestore write (kept, since createAiJob cannot set triggeredBy), the Tue/Thu social cron, and the manual social run." -m "The platform is the answer by construction, and lib/tenancy/platform.ts now says so on its CORRECT BY CONSTRUCTION shelf. The manual route has a session and still does not use the admin's selected business: the agent's subject is the platform's own blog, so a selected coach would be alerted about posts that are not theirs." -m "The tests mock the seam to a distinct id, because SYSTEM_USER_ID and the platform business id are the same literal and an assertion on the real id could not tell the stamp from businessId: userId. The social cron and the manual run had no suites; each has one now."`

---

### Task 10: Agent alerts go to the owners of the job's business (spec §C2-C4)

**Files:**
- Create: `functions/src/lib/notify-business-owners.ts`
- Create: `functions/src/__tests__/notify-business-owners.test.ts`
- Modify: `functions/src/seo/execute.ts:7-14` (import, `AgentContext`) and `:127-165` (`executeFlagForHuman`)
- Modify: `functions/src/seo-agent.ts:11,28-29,144-151`
- Modify: `functions/src/social-agent.ts:22-24,31-32,44-47,595-611`
- Test: `functions/src/__tests__/seo-execute.test.ts:40,54,66,85,93-138,150`
- Test: `functions/src/__tests__/seo-agent.test.ts:1,102,136,200-204`
- Test: `functions/src/__tests__/social-agent.test.ts:1-6` and the end of the file
- Modify: `__tests__/integration/postgrest-select-contract.test.ts:110-126` (the two `profiles` entries in `KNOWN_REFUSED`)

**Interfaces:**
- Consumes: `input.businessId: string` on `seo_agent_run` / `social_agent_run` jobs, stamped by Task 9. It is absent on jobs enqueued before Task 9, and both handlers handle that case.
- Produces:
```ts
// functions/src/lib/notify-business-owners.ts
export interface OwnerNotification { type: "info" | "success" | "warning" | "error"; title: string; message: string; link: string | null }
export type NotifyOwnersResult = { ok: true; notificationId: string; ownerCount: number } | { ok: false; error: string }
export async function notifyBusinessOwners(supabase: SupabaseClient, businessId: string, notification: OwnerNotification): Promise<NotifyOwnersResult>
// functions/src/seo/execute.ts
export interface AgentContext { memoId: string; userId: string; businessId: string | null }
// functions/src/social-agent.ts
export interface SocialAgentInput { platform?: AgentPlatform; blogPostId?: string; businessId?: string }
```

- [ ] **Step 1: Write the failing test**

1a. Create `functions/src/__tests__/notify-business-owners.test.ts`:
```ts
// notifyBusinessOwners (G35): an agent's alert goes to the OWNERS of the
// business the job was enqueued for, as one in-app bell row each.
//
// The fake APPLIES the filters and orders it is handed. An argument-blind fake
// — one that returns the same rows whatever `.eq` or `.order` was called with —
// passes with either predicate deleted, which is precisely the mutant these
// tests exist to catch. It also returns the inserted rows REVERSED, because
// RETURNING order is not something PostgREST promises; a helper that takes
// `rows[0]` gets the wrong owner's id here instead of by luck in production.
import { describe, it, expect, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { notifyBusinessOwners } from "../lib/notify-business-owners.js"

type Member = { business_id: string; user_id: string; role: string; created_at: string }
type PgError = { code: string; message: string }
type Resolve = (value: unknown) => unknown
type Reject = (reason: unknown) => unknown

function fakeSupabase(opts: { members: Member[]; readError?: PgError; insertError?: PgError }) {
  const inserted: Array<Record<string, unknown>> = []
  const from = vi.fn((table: string) => {
    if (table === "business_members") {
      const filters: Array<[string, unknown]> = []
      const orders: Array<{ column: string; ascending: boolean }> = []
      const read = () => {
        if (opts.readError) return { data: null, error: opts.readError }
        const rows = opts.members
          .filter((m) => filters.every(([column, value]) => (m as Record<string, unknown>)[column] === value))
          .sort((a, b) => {
            for (const { column, ascending } of orders) {
              const x = String((a as Record<string, unknown>)[column])
              const y = String((b as Record<string, unknown>)[column])
              if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1)
            }
            return 0
          })
        return { data: rows.map((m) => ({ user_id: m.user_id })), error: null }
      }
      const builder = {
        select: (_columns: string) => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value])
          return builder
        },
        order: (column: string, o?: { ascending?: boolean }) => {
          orders.push({ column, ascending: o?.ascending !== false })
          return builder
        },
        then: (resolve: Resolve, reject?: Reject) => Promise.resolve(read()).then(resolve, reject),
      }
      return builder
    }
    if (table === "notifications") {
      return {
        insert: (rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows)
          return {
            select: (_columns: string) =>
              Promise.resolve(
                opts.insertError
                  ? { data: null, error: opts.insertError }
                  : {
                      data: rows.map((r) => ({ id: `notif-${String(r.user_id)}`, user_id: r.user_id })).reverse(),
                      error: null,
                    },
              ),
          }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { client: { from } as unknown as SupabaseClient, inserted, from }
}

const NOTE = { type: "warning" as const, title: "T", message: "M", link: "/admin/strategy" }

const member = (business_id: string, user_id: string, role: string, created_at = "2026-01-01T00:00:00Z"): Member => ({
  business_id,
  user_id,
  role,
  created_at,
})

describe("notifyBusinessOwners", () => {
  // MUTANT: drop `.eq("business_id", businessId)` — biz-b's owner is belled
  // about biz-a's job. Presence control in the same test: biz-a's owner IS.
  it("bells the owners of the given business and nobody else's", async () => {
    const fake = fakeSupabase({
      members: [member("biz-a", "owner-a", "owner"), member("biz-b", "owner-b", "owner")],
    })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: true, notificationId: "notif-owner-a", ownerCount: 1 })
    expect(fake.inserted.map((r) => r.user_id)).toEqual(["owner-a"])
  })

  // MUTANT: drop `.eq("role", "owner")` — the coach and the staff member are
  // belled too. Owner ruling 3 names owners only.
  it("skips the business's coaches and staff", async () => {
    const fake = fakeSupabase({
      members: [
        member("biz-a", "coach-a", "coach"),
        member("biz-a", "owner-a", "owner"),
        member("biz-a", "staff-a", "staff"),
      ],
    })
    await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(fake.inserted.map((r) => r.user_id)).toEqual(["owner-a"])
  })

  it("writes the row the bell reads: type, title, message, link, unread", async () => {
    const fake = fakeSupabase({ members: [member("biz-a", "owner-a", "owner")] })
    await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(fake.inserted).toEqual([
      { user_id: "owner-a", type: "warning", title: "T", message: "M", link: "/admin/strategy", is_read: false },
    ])
  })

  // The id the SEO agent stores and the outcome tracker reads back 14 days
  // later is ONE notifications row: the first owner's, by created_at then
  // user_id. The fixture is built so each mutant picks a different owner:
  //   - no `.order("created_at")`: user_id alone puts "owner-0-late" first;
  //   - no `.order("user_id")`: the two January owners keep fixture order,
  //     so "owner-2" comes first;
  //   - `ascending: false` on created_at: "owner-0-late" again;
  //   - `rows[0]` instead of a lookup by user_id: the fake returns the insert
  //     reversed, so that is "owner-0-late"'s row.
  it("returns the FIRST owner's notification id, by created_at then user_id", async () => {
    const fake = fakeSupabase({
      members: [
        member("biz-a", "owner-0-late", "owner", "2026-02-01T00:00:00Z"),
        member("biz-a", "owner-2", "owner", "2026-01-01T00:00:00Z"),
        member("biz-a", "owner-1", "owner", "2026-01-01T00:00:00Z"),
      ],
    })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: true, notificationId: "notif-owner-1", ownerCount: 3 })
    // Every owner is still belled; only the returned id is the first one's.
    expect(fake.inserted.map((r) => r.user_id)).toEqual(["owner-1", "owner-2", "owner-0-late"])
  })

  // MUTANT: fall back to someone (the platform's owner, "the first admin")
  // when the business has no owner. The schema does not require one.
  it("reports a business with no owner and inserts nothing", async () => {
    const fake = fakeSupabase({ members: [member("biz-a", "coach-a", "coach")] })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: false, error: "business biz-a has no owner to notify" })
    expect(fake.from).not.toHaveBeenCalledWith("notifications")
    // Presence control: the read itself did happen.
    expect(fake.from).toHaveBeenCalledWith("business_members")
  })

  // MUTANT: destructure `data` only (what social-agent.ts did with profiles) —
  // a failed read then looks like "no owners" and the error vanishes.
  it("returns a failed read as an error, with its code, and inserts nothing", async () => {
    const fake = fakeSupabase({
      members: [member("biz-a", "owner-a", "owner")],
      readError: { code: "PGRST205", message: "relation not found" },
    })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: false, error: "business_members read failed (PGRST205 relation not found)" })
    expect(fake.from).not.toHaveBeenCalledWith("notifications")
  })

  it("returns a failed insert as an error", async () => {
    const fake = fakeSupabase({
      members: [member("biz-a", "owner-a", "owner")],
      insertError: { code: "23503", message: "fk violation" },
    })
    const out = await notifyBusinessOwners(fake.client, "biz-a", NOTE)
    expect(out).toEqual({ ok: false, error: "notifications insert failed (23503 fk violation)" })
    // Presence control: the insert was attempted.
    expect(fake.inserted.map((r) => r.user_id)).toEqual(["owner-a"])
  })
})
```

1b. `functions/src/__tests__/seo-execute.test.ts`: apply edit 1 before edit 2.

Edit 1. Replace the whole `describe("executeFlagForHuman", …)` block, from `describe("executeFlagForHuman", () => {` through its closing `})`, which is the original text of lines 93-138 (it ends after `expect(out.error).toMatch(/no admin user/i)\n  })\n})`). new:
```ts
describe("executeFlagForHuman", () => {
  // G35. The flag goes to the OWNERS of the job's business, through
  // notifyBusinessOwners (its own suite pins the read). This fake answers
  // business_members the way the table would — filtered by what the caller
  // asked for — so these tests can tell WHICH business reached the read.
  // owner-1 owns biz-1; owner-2 owns biz-2, where coach-2 also works.
  function routeOwnersAndNotifications() {
    const inserted: Array<Record<string, unknown>> = []
    const members = [
      { business_id: "biz-1", user_id: "owner-1", role: "owner" },
      { business_id: "biz-2", user_id: "owner-2", role: "owner" },
      { business_id: "biz-2", user_id: "coach-2", role: "coach" },
    ]
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "business_members") {
        const filters: Array<[string, unknown]> = []
        const builder = {
          select: (_columns: string) => builder,
          eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return builder
          },
          order: (_column: string, _o?: unknown) => builder,
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve({
              data: members
                .filter((m) => filters.every(([c, v]) => (m as Record<string, unknown>)[c] === v))
                .map((m) => ({ user_id: m.user_id })),
              error: null,
            }).then(resolve, reject),
        }
        return builder
      }
      if (table === "notifications") {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            inserted.push(...rows)
            return {
              select: (_columns: string) =>
                Promise.resolve({
                  data: rows.map((r) => ({ id: `notif-${String(r.user_id)}`, user_id: r.user_id })),
                  error: null,
                }),
            }
          },
        }
      }
      return {}
    })
    return inserted
  }

  // MUTANT: read ctx.userId, or the platform business, in place of
  // ctx.businessId. Either one finds no owner of biz-2 (or the wrong one).
  it("bells the owners of ctx.businessId and returns that row's id", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    const inserted = routeOwnersAndNotifications()
    const out = await executeFlagForHuman(
      { issue: "Cannibalization", urgency: "medium", context: "Posts A and B compete on keyword X" },
      { memoId: "memo-1", userId: "u", businessId: "biz-2" },
    )
    expect(out).toEqual({ executed: true, execution_target_id: "notif-owner-2" })
    expect(inserted).toEqual([
      {
        user_id: "owner-2",
        type: "info",
        title: "SEO Agent: Cannibalization",
        message: "Posts A and B compete on keyword X",
        link: "/admin/seo-agent/memos",
        is_read: false,
      },
    ])
  })

  // MUTANT: default a missing businessId to the platform business (the
  // functions twin of SINGLETON_BUSINESS_ID). A job enqueued before G35 has
  // no businessId, and its alert is skipped rather than sent to a guess.
  // Presence control: the test above reaches the database for the same action.
  it("fails closed for a job with no businessId: no read, no insert, a reason", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    routeOwnersAndNotifications()
    const out = await executeFlagForHuman(
      { issue: "x", urgency: "high", context: "y" },
      { memoId: "memo-1", userId: "u", businessId: null },
    )
    expect(out.executed).toBe(false)
    expect(out.execution_target_id).toBeNull()
    expect(out.error).toMatch(/no businessId/)
    expect(supabaseFromMock).not.toHaveBeenCalled()
  })

  it("returns executed=false, with the helper's reason, when the business has no owner", async () => {
    const { executeFlagForHuman } = await import("../seo/execute.js")
    const inserted = routeOwnersAndNotifications()
    const out = await executeFlagForHuman(
      { issue: "x", urgency: "low", context: "y" },
      { memoId: "memo-1", userId: "u", businessId: "biz-3" },
    )
    expect(out).toEqual({
      executed: false,
      execution_target_id: null,
      error: "business biz-3 has no owner to notify",
    })
    expect(inserted).toEqual([])
  })
})
```

Edit 2 (`replace_all: true`). old `{ memoId: "memo-1", userId: "u" }`, new `{ memoId: "memo-1", userId: "u", businessId: "biz-1" }`. This hits 5 remaining sites: queueNewPost ×2, queueRefresh, internalLinkSweep and the dispatcher. `AgentContext.businessId` is required, and the functions `tsc` compiles tests.

1c. `functions/src/__tests__/seo-agent.test.ts`

Edit 1. old `import { describe, expect, it, vi, beforeEach } from "vitest"`, new `import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"`.

Edit 2 (happy path). old:
```ts
      data: () => ({ status: "pending", type: "seo_agent_run", input: { userId: "admin-uuid" } }),
    })
```
new:
```ts
      data: () => ({
        status: "pending",
        type: "seo_agent_run",
        input: { userId: "admin-uuid", businessId: "biz-1" },
      }),
    })
```

Edit 3. old:
```ts
    expect(executeActionMock).toHaveBeenCalledTimes(2)
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { memoId: string }).memoId).toBe("memo-1")
  })
```
new:
```ts
    expect(executeActionMock).toHaveBeenCalledTimes(2)
    // G35: the job's business reaches every executor, beside the memo and
    // the user. MUTANT: ctx built as { memoId, userId } — flag_for_human then
    // has no business to find owners in.
    expect(executeActionMock.mock.calls.map((c) => c[1])).toEqual([
      { memoId: "memo-1", userId: "admin-uuid", businessId: "biz-1" },
      { memoId: "memo-1", userId: "admin-uuid", businessId: "biz-1" },
    ])
    const finalUpdate = jobRefUpdate.mock.calls.at(-1)?.[0] as { status?: string; result?: unknown }
    expect(finalUpdate?.status).toBe("completed")
    expect((finalUpdate?.result as { memoId: string }).memoId).toBe("memo-1")
  })
```

Edit 4. old:
```ts
    await handleSeoAgent("done-job")
    expect(gatherSeoSignalsMock).not.toHaveBeenCalled()
  })

  describe("self-critique pass", () => {
```
new:
```ts
    await handleSeoAgent("done-job")
    expect(gatherSeoSignalsMock).not.toHaveBeenCalled()
  })

  describe("the job's business, and what each action did (G35)", () => {
    const spies: Array<{ mockRestore: () => void }> = []
    afterEach(() => {
      for (const s of spies.splice(0)) s.mockRestore()
    })
    function silence(method: "log" | "warn" | "error") {
      const spy = vi.spyOn(console, method).mockImplementation(() => {})
      spies.push(spy)
      return spy
    }
    const messages = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]))

    function runWith(input: Record<string, unknown>, results: Array<Record<string, unknown>>) {
      jobRefGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: "pending", type: "seo_agent_run", input }),
      })
      gatherSeoSignalsMock.mockResolvedValueOnce({
        gsc_28d: { total_clicks: 0, total_impressions: 0, avg_position: 0, top_winnable: [], top_decayed: [] },
        inventory: { total_posts: 0, oldest_post_age_days: 0, never_refreshed_count: 0 },
        recent_tavily: [],
        orphan_post_ids: [],
        last_8_memos_outcomes: [],
        gsc_distinct_dates: 30,
        brief_context: null,
        tool_performance: [],
      })
      reasonAboutWeekMock.mockResolvedValueOnce({
        decision: {
          rationale: "r",
          actions: [
            { rank: 1, tool: "flag_for_human", args: { issue: "i", urgency: "low", context: "c" } },
            { rank: 2, tool: "queue_new_post", args: { keyword: "deadlift", angle: "a" } },
          ],
          brief_alignment_score: null,
          agent_confidence: 9,
          dissent_from_upstream: { dissents: false, reason: null },
        },
        tokens_used: 1,
      })
      for (const r of results) executeActionMock.mockResolvedValueOnce(r)
      supabaseFromMock.mockImplementation(defaultSupabaseRouter({ critiqueFlag: { enabled: false } }))
    }

    // MUTANT: default a missing businessId to the platform business. A job
    // enqueued by a route older than G35 carries none; flag_for_human then
    // fails closed, and this warning is where that shows in the logs.
    it("threads a job with no businessId as null, and warns that its alert will not be sent", async () => {
      const warn = silence("warn")
      silence("log")
      runWith({ userId: "u" }, [
        { executed: true, execution_target_id: "t1" },
        { executed: true, execution_target_id: "t2" },
      ])
      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-old-route")
      expect(executeActionMock.mock.calls[0]?.[1]).toEqual({ memoId: "memo-1", userId: "u", businessId: null })
      expect(messages(warn).some((m) => m.includes("no input.businessId"))).toBe(true)
    })

    // Presence control for the warning above: same run, business present.
    it("does not warn when the job carries its business", async () => {
      const warn = silence("warn")
      silence("log")
      runWith({ userId: "u", businessId: "biz-1" }, [
        { executed: true, execution_target_id: "t1" },
        { executed: true, execution_target_id: "t2" },
      ])
      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-new-route")
      expect(executeActionMock.mock.calls[0]?.[1]).toEqual({ memoId: "memo-1", userId: "u", businessId: "biz-1" })
      expect(messages(warn).some((m) => m.includes("no input.businessId"))).toBe(false)
    })

    // MUTANT: the old log line, which printed executed and target only. The
    // flag's PGRST205 went unseen on every run for exactly that reason.
    it("logs an action's error and a guardrail's rejection instead of dropping them", async () => {
      const error = silence("error")
      const warn = silence("warn")
      runWith({ userId: "u", businessId: "biz-1" }, [
        { executed: false, execution_target_id: null, error: "business biz-1 has no owner to notify" },
        { executed: false, execution_target_id: null, rejection_reason: "brief_dont_do:deadlift" },
      ])
      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-failed-actions")
      expect(messages(error)).toContainEqual(
        expect.stringContaining(
          "tool=flag_for_human executed=false target=null error=business biz-1 has no owner to notify",
        ),
      )
      expect(messages(warn)).toContainEqual(
        expect.stringContaining("tool=queue_new_post executed=false target=null rejected=brief_dont_do:deadlift"),
      )
    })

    // Presence control: a clean action still logs on console.log, unadorned.
    it("logs a clean action as before", async () => {
      const log = silence("log")
      const error = silence("error")
      runWith({ userId: "u", businessId: "biz-1" }, [
        { executed: true, execution_target_id: "notif-1" },
        { executed: true, execution_target_id: "cc-1" },
      ])
      const { handleSeoAgent } = await import("../seo-agent.js")
      await handleSeoAgent("job-clean")
      expect(messages(log)).toContainEqual(
        "[seo-agent] action rank=1 tool=flag_for_human executed=true target=notif-1",
      )
      expect(messages(error)).toEqual([])
    })
  })

  describe("self-critique pass", () => {
```

1d. `functions/src/__tests__/social-agent.test.ts`. This drives the `no_eligible_topic` branch end to end for the first time.

Edit 1. old:
```ts
import { describe, it, expect, vi } from "vitest"
import {
  buildCopywriterUserMessage,
  buildReviewerUserMessage,
  buildTrendingBlock,
  latestTavilyTopics,
```
new:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// G35. handleSocialAgentRun is driven end to end at the bottom of this file,
// so the job document and the Supabase client are faked for the whole file.
// The helper suites above never reach either: each passes its own `supabase`.
const h = vi.hoisted(() => ({ jobGet: vi.fn(), jobUpdate: vi.fn(), from: vi.fn() }))
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: h.jobGet, update: h.jobUpdate }) }) }),
  FieldValue: { serverTimestamp: () => "server-ts" },
}))
vi.mock("../lib/supabase.js", () => ({ getSupabase: () => ({ from: h.from }) }))

import {
  buildCopywriterUserMessage,
  buildReviewerUserMessage,
  buildTrendingBlock,
  handleSocialAgentRun,
  latestTavilyTopics,
```

Edit 2 (append after the file's last `})`, the end of `describe("listConnectedSocialPlatforms", …)`):
```ts

describe("handleSocialAgentRun — no eligible topic (G35)", () => {
  // Every recent post matches the approved brief's dont_do, so the strategist
  // picks nothing and the handler takes the no_eligible_topic branch: a memo,
  // an alert to the owners of the job's business, and a completed-but-skipped
  // job. The REAL scorer decides that ("deload" is in the post's title).
  const BRIEF = {
    id: "brief-1",
    week_of: "2026-09-21",
    themes: [],
    audience_focus: "",
    priority_channel: "social",
    keywords_to_chase: [],
    hooks_to_test: [],
    ctas: [],
    dont_do: ["deload"],
  }
  const MEMBERS = [
    { business_id: "biz-1", user_id: "owner-1", role: "owner" },
    { business_id: "biz-2", user_id: "owner-2", role: "owner" },
  ]
  let inserted: Array<Record<string, unknown>> = []
  const spies: Array<{ mockRestore: () => void }> = []
  function silence(method: "warn" | "error") {
    const spy = vi.spyOn(console, method).mockImplementation(() => {})
    spies.push(spy)
    return spy
  }
  const messages = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]))

  function route(opts: { membersError?: { code: string; message: string } } = {}) {
    inserted = []
    h.from.mockImplementation((table: string) => {
      if (table === "strategy_briefs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: BRIEF, error: null }),
        }
      }
      if (table === "blog_posts") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{ id: "b1", title: "Deload weeks, explained", slug: "deload-weeks", excerpt: null, content: null }],
            error: null,
          }),
        }
      }
      if (table === "social_agent_memos") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      if (table === "business_members") {
        // Filtered by what the caller asked for, so the test can tell WHICH
        // business reached the read.
        const filters: Array<[string, unknown]> = []
        const builder = {
          select: (_columns: string) => builder,
          eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return builder
          },
          order: (_column: string, _o?: unknown) => builder,
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(
              opts.membersError
                ? { data: null, error: opts.membersError }
                : {
                    data: MEMBERS.filter((m) =>
                      filters.every(([c, v]) => (m as Record<string, unknown>)[c] === v),
                    ).map((m) => ({ user_id: m.user_id })),
                    error: null,
                  },
            ).then(resolve, reject),
        }
        return builder
      }
      if (table === "notifications") {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            inserted.push(...rows)
            return {
              select: (_columns: string) =>
                Promise.resolve({
                  data: rows.map((r) => ({ id: `notif-${String(r.user_id)}`, user_id: r.user_id })),
                  error: null,
                }),
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
  }
  const job = (input: Record<string, unknown>) =>
    h.jobGet.mockResolvedValue({ data: () => ({ status: "pending", type: "social_agent_run", input }) })

  beforeEach(() => {
    h.from.mockReset()
    h.jobGet.mockReset()
    h.jobUpdate.mockReset()
    h.jobUpdate.mockResolvedValue(undefined)
  })
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore()
  })

  // MUTANTS, all caught by the exact row: the old `profiles` read (PGRST205,
  // so no bell at all); the dead link /admin/social-agent/memos; the platform
  // business in place of the job's (it would bell owner-1).
  it("bells the owners of the job's business, linking to the brief on /admin/strategy", async () => {
    route()
    job({ platform: "linkedin", businessId: "biz-2" })
    await handleSocialAgentRun("job-1")
    expect(inserted).toEqual([
      {
        user_id: "owner-2",
        type: "warning",
        title: "Social agent could not find an eligible topic",
        message: "All recent published posts matched the brief's dont_do filter. Brief id: brief-1",
        link: "/admin/strategy",
        is_read: false,
      },
    ])
    expect(h.jobUpdate.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "completed",
      result: { skipped: "no_eligible_topic", brief_id: "brief-1" },
    })
  })

  // MUTANT: default a missing businessId to the platform business. A job
  // enqueued before G35 sends no alert and says so; it still completes.
  it("sends no alert for a job with no businessId, warns, and still completes", async () => {
    const warn = silence("warn")
    route()
    job({ platform: "linkedin" })
    await handleSocialAgentRun("job-old-route")
    expect(h.from).not.toHaveBeenCalledWith("business_members")
    expect(inserted).toEqual([])
    // Presence control: the branch DID run — its memo was written.
    expect(h.from).toHaveBeenCalledWith("social_agent_memos")
    expect(messages(warn).some((m) => m.includes("no input.businessId"))).toBe(true)
    expect(h.jobUpdate.mock.calls.at(-1)?.[0]).toMatchObject({ status: "completed" })
  })

  // MUTANT: the helper's result ignored, the way the profiles read's error was
  // (`const { data: admins } = …`). A failed alert is logged, not swallowed,
  // and the job still completes: the agent's decision not to draft stands.
  it("logs a failed alert instead of dropping it", async () => {
    const error = silence("error")
    route({ membersError: { code: "42501", message: "permission denied" } })
    job({ platform: "linkedin", businessId: "biz-2" })
    await handleSocialAgentRun("job-2")
    expect(messages(error)).toContainEqual(
      expect.stringContaining("business_members read failed (42501 permission denied)"),
    )
    expect(inserted).toEqual([])
    expect(h.jobUpdate.mock.calls.at(-1)?.[0]).toMatchObject({ status: "completed" })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

One-time setup: the worktree has no `functions/node_modules`. Link the main checkout's copy with `ln -s "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/functions/node_modules" "/Users/aeangabrielletayawa/Desktop/Darren Paul Projects/djpathlete/.claude/worktrees/g35-untenanted-readers/functions/node_modules"`. The alternative is `npm ci --prefix functions`. Never stage the link; see the notes below.

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npm --prefix functions test -- src/__tests__/notify-business-owners.test.ts src/__tests__/seo-execute.test.ts src/__tests__/seo-agent.test.ts src/__tests__/social-agent.test.ts`

Expected result, measured on a probe copy:
- `notify-business-owners.test.ts` fails to load because `../lib/notify-business-owners.js` does not exist yet.
- 10 tests fail:
  - seo-execute ×3, the whole flag describe. The old code reads `profiles`, which the router answers with `{}`.
  - seo-agent ×4. The happy path fails with `expected [ { memoId: 'memo-1', …(1) }, …(1) ] to deeply equal [ { memoId: 'memo-1', …(2) }, …(1) ]`. "threads … null" and "does not warn" fail on ctx without `businessId`. "logs an action's error …" fails with `expected [] to deep equally contain StringContaining{…}`.
  - social-agent ×3. "bells the owners …" fails with `expected [] to deeply equal [ { user_id: 'owner-2', …(5) } ]`. "sends no alert …" fails on the missing warning. "logs a failed alert …" fails on the missing error line.
- "logs a clean action as before" passes. It is the control.

- [ ] **Step 3: Implement**

3a. Create `functions/src/lib/notify-business-owners.ts`:
```ts
// functions/src/lib/notify-business-owners.ts
//
// The in-app bell for an agent's alert, addressed to the OWNERS of the
// business the job was enqueued for (G35; the owner's ruling: "owners of the
// job's business, as in-app bell rows"). Two callers: the SEO agent's
// flag_for_human action (seo/execute.ts) and the social agent's "no eligible
// topic" branch (social-agent.ts). The job input carries the business because
// nothing else in this pipeline can: every table the agents read and write
// has no business_id.
//
// WHAT THIS REPLACED. Both callers read `profiles` for the first row with
// role='admin'. There is no `profiles` table, so PostgREST answered PGRST205
// on every run and no agent alert has ever reached anyone; the social branch
// did not even look at the error. Pointing that read at `users` would have
// made it live and untenanted at once: "the first platform admin", whichever
// business the job was about.
//
// THE STRINGS ARE LITERAL ON PURPOSE. `npm run test:integration:selects`
// collects every `.from(...).select(...)` in functions/src and probes it, with
// its `.order()` columns, against the dev clone's live schema. It resolves
// only string literals and consts; a table, select or order column passed in
// as a parameter lands on that test's KNOWN_UNRESOLVED ratchet and fails the
// run. Keep every string in both chains below literal.
//
// ONE ID BACK, NOT A LIST. The SEO agent stores what this returns as the
// action's execution_target_id, and the outcome tracker resolves it 14 days
// later by reading ONE notifications row by id (resolveFlagOutcome, in the
// Next.js app). `notifications` has no column tying sibling rows together, so
// the other owners' rows cannot be found from it. The id returned is therefore
// the FIRST owner's row in a fixed order (business_members.created_at, then
// user_id), and "acknowledged" on that memo means THAT owner read it. With one
// owner per business, which is every business on the dev clone today, that is
// the whole story. The first owner's row is found by user_id in what the
// insert returns, not by position: RETURNING order is not something PostgREST
// promises.
//
// Errors come back as values, never thrown. PostgREST resolves a failure
// rather than throwing (the booking ingest's business_members fan-out checks
// its read the same way), and neither caller should fail its whole run
// because a bell could not be rung: one is a weekly action loop, the other a
// job that has already, correctly, decided not to draft.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface OwnerNotification {
  /** notifications.type is CHECK-constrained to these four. */
  type: "info" | "success" | "warning" | "error"
  title: string
  message: string
  link: string | null
}

export type NotifyOwnersResult =
  | { ok: true; notificationId: string; ownerCount: number }
  | { ok: false; error: string }

export async function notifyBusinessOwners(
  supabase: SupabaseClient,
  businessId: string,
  notification: OwnerNotification,
): Promise<NotifyOwnersResult> {
  const { data: owners, error: ownersError } = await supabase
    .from("business_members")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true })
  if (ownersError) {
    return { ok: false, error: `business_members read failed (${ownersError.code} ${ownersError.message})` }
  }
  const ownerIds = ((owners as Array<{ user_id: string }> | null) ?? []).map((o) => o.user_id)
  if (ownerIds.length === 0) {
    // Not defaulted to anyone. The schema does not require an owner (the only
    // key is (business_id, user_id)), and ringing some other business's bell
    // is the leak this helper exists to close.
    return { ok: false, error: `business ${businessId} has no owner to notify` }
  }

  const { data: rows, error: insertError } = await supabase
    .from("notifications")
    .insert(
      ownerIds.map((userId) => ({
        user_id: userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        is_read: false,
      })),
    )
    .select("id, user_id")
  if (insertError) {
    return { ok: false, error: `notifications insert failed (${insertError.code} ${insertError.message})` }
  }
  const first = ((rows as Array<{ id: string; user_id: string }> | null) ?? []).find(
    (r) => r.user_id === ownerIds[0],
  )
  if (!first) {
    return { ok: false, error: "notifications insert returned no row for the first owner" }
  }
  return { ok: true, notificationId: first.id, ownerCount: ownerIds.length }
}
```

3b. `functions/src/seo/execute.ts`

Edit 1. old:
```ts
import { getSupabase } from "../lib/supabase.js"
import type { Action } from "./decision-schema.js"
import type { SeoSignalsSummary } from "./signals.js"

export interface AgentContext {
  memoId: string
  userId: string
}
```
new:
```ts
import { getSupabase } from "../lib/supabase.js"
import { notifyBusinessOwners } from "../lib/notify-business-owners.js"
import type { Action } from "./decision-schema.js"
import type { SeoSignalsSummary } from "./signals.js"

export interface AgentContext {
  memoId: string
  userId: string
  /**
   * The business the job was enqueued for: `input.businessId`, stamped by the
   * enqueue route since G35 (the platform's own, by construction — every table
   * this agent reads and writes has no business_id). Only flag_for_human reads
   * it, to find whose owners to bell.
   *
   * Nullable, never optional, and never defaulted: a job enqueued by a route
   * older than G35 carries none, and its flag is then skipped with a reason
   * rather than sent to a guessed business. An optional tenant is how
   * getConversation ended up with `if (businessId)` and a caller that never
   * passed one; a required-but-nullable one makes every caller say which.
   */
  businessId: string | null
}
```

Edit 2. The body of `executeFlagForHuman`. old: everything from `  const supabase = getSupabase()\n\n  // Resolve admin user via role lookup. Solo-dev project — one admin row.` through `  return { executed: true, execution_target_id: (data as { id: string }).id }\n}`, which is original lines 131-165. new:
```ts
  // Fail closed (G35). No business on the job means no one to address the
  // flag to; it is skipped with a reason seo-agent.ts logs, never defaulted.
  // Checked before the client is even built, so a skipped flag touches nothing.
  if (!ctx.businessId) {
    return {
      executed: false,
      execution_target_id: null,
      error: "job carries no businessId (enqueued before G35?); flag not sent",
    }
  }

  // The owners of the job's business, one bell row each. This used to read
  // `profiles` for "the first admin" — a table that does not exist, so every
  // flag died on PGRST205 (see notifyBusinessOwners for the whole story).
  const outcome = await notifyBusinessOwners(getSupabase(), ctx.businessId, {
    // Map urgency → notifications.type (constrained to info/success/warning/error).
    // 'high' → warning (most-attention category), 'medium'/'low' → info.
    type: args.urgency === "high" ? "warning" : "info",
    title: `SEO Agent: ${args.issue}`,
    message: args.context,
    link: "/admin/seo-agent/memos",
  })
  if (!outcome.ok) {
    return { executed: false, execution_target_id: null, error: outcome.error }
  }
  // ONE id — the first owner's row — because the outcome tracker resolves
  // this by reading a single notification by id 14 days later.
  return { executed: true, execution_target_id: outcome.notificationId }
}
```

3c. `functions/src/seo-agent.ts`

Edit 1. old `import { executeAction, type ExecutionResult } from "./seo/execute.js"`, new `import { executeAction, type AgentContext, type ExecutionResult } from "./seo/execute.js"`.

Edit 2. old:
```ts
  const input = job.input as { userId: string }
  const userId = input.userId
```
new:
```ts
  const input = job.input as { userId: string; businessId?: unknown }
  const userId = input.userId
  // The business whose owners a flag_for_human alert goes to, stamped by the
  // enqueue route since G35 (app/api/admin/internal/seo-agent). A job enqueued
  // by a route older than that carries none; it is threaded as null — never
  // defaulted to the platform — and the flag executor skips its alert. Said
  // here once, so a run whose flags all come back "not sent" explains itself.
  const businessId =
    typeof input.businessId === "string" && input.businessId !== "" ? input.businessId : null
  if (!businessId) {
    console.warn(
      `[seo-agent] Job ${jobId} has no input.businessId (enqueued before G35?); a flag_for_human action will not be sent`,
    )
  }
```

Edit 3. old:
```ts
    const ctx = { memoId, userId }
    const results: ExecutionResult[] = []
    for (const action of finalDecision.actions) {
      const r = await executeAction(action, ctx, signals)
      results.push(r)
      console.log(
        `[seo-agent] action rank=${action.rank} tool=${action.tool} executed=${r.executed} target=${r.execution_target_id ?? "null"}`,
      )
    }
```
new:
```ts
    const ctx: AgentContext = { memoId, userId, businessId }
    const results: ExecutionResult[] = []
    for (const action of finalDecision.actions) {
      const r = await executeAction(action, ctx, signals)
      results.push(r)
      // r.error and r.rejection_reason used to be dropped here: only executed
      // and target were printed, the memo keeps only those two, and the job
      // still ends "completed". That is how every flag_for_human dying on
      // PGRST205 went unseen. A failed action logs as an error, a guardrail
      // rejection (a decision, not a fault) as a warning.
      const line = `[seo-agent] action rank=${action.rank} tool=${action.tool} executed=${r.executed} target=${r.execution_target_id ?? "null"}`
      if (r.error) console.error(`${line} error=${r.error}`)
      else if (r.rejection_reason) console.warn(`${line} rejected=${r.rejection_reason}`)
      else console.log(line)
    }
```

3d. `functions/src/social-agent.ts`

Edit 1 (header comment). old:
```ts
// Input: { platform?: AgentPlatform; blogPostId?: string }
//   platform — if set, only that platform runs (overrides connection filter).
//   blogPostId — manual topic override.
```
new:
```ts
// Input: { platform?: AgentPlatform; blogPostId?: string; businessId?: string }
//   platform — if set, only that platform runs (overrides connection filter).
//   blogPostId — manual topic override.
//   businessId — whose owners get the "no eligible topic" alert (G35).
```

Edit 2. old:
```ts
import { fewShotsBlock } from "./lib/few-shots.js"
import { scoreBlogVsBrief } from "./strategy/brief-blog-scorer.js"
```
new:
```ts
import { fewShotsBlock } from "./lib/few-shots.js"
import { notifyBusinessOwners } from "./lib/notify-business-owners.js"
import { scoreBlogVsBrief } from "./strategy/brief-blog-scorer.js"
```

Edit 3. old:
```ts
export interface SocialAgentInput {
  platform?: AgentPlatform
  blogPostId?: string
}
```
new:
```ts
export interface SocialAgentInput {
  platform?: AgentPlatform
  blogPostId?: string
  /**
   * The business whose owners the "no eligible topic" alert goes to, stamped
   * by both enqueue routes since G35 (the platform's own, by construction:
   * nothing this agent reads or writes has a business_id). Optional here only
   * because a job enqueued before G35 does not carry it; such a job sends no
   * alert rather than guessing a business.
   */
  businessId?: string
}
```

Edit 4. old:
```ts
        // Notify the coach (admin) — mirrors executeFlagForHuman shape.
        const { data: admins } = await supabase
          .from("profiles")
          .select("id")
          .eq("role", "admin")
          .limit(1)
        const adminId = (admins as Array<{ id: string }> | null)?.[0]?.id
        if (adminId) {
          await supabase.from("notifications").insert({
            user_id: adminId,
            type: "warning",
            title: "Social agent could not find an eligible topic",
            message: `All recent published posts matched the brief's dont_do filter. Brief id: ${brief.id}`,
            link: "/admin/social-agent/memos",
            is_read: false,
          })
        }
```
new:
```ts
        // Tell the owners of the job's business (G35). This used to read
        // `profiles` for "the first admin" — a table that does not exist —
        // and destructured only `data`, so the PGRST205 vanished and this
        // alert has never been sent. The helper's result is checked now: a
        // failed alert is logged, and the job still completes, because the
        // agent's decision not to draft stands either way.
        //
        // The link is the brief, on /admin/strategy: its dont_do is what
        // filtered every topic. The old /admin/social-agent/memos is not a page.
        const businessId =
          typeof input.businessId === "string" && input.businessId !== "" ? input.businessId : null
        if (!businessId) {
          console.warn(
            `[social-agent] Job ${jobId} has no input.businessId (enqueued before G35?); the "no eligible topic" alert was not sent`,
          )
        } else {
          const alert = await notifyBusinessOwners(supabase, businessId, {
            type: "warning",
            title: "Social agent could not find an eligible topic",
            message: `All recent published posts matched the brief's dont_do filter. Brief id: ${brief.id}`,
            link: "/admin/strategy",
          })
          if (!alert.ok) {
            console.error(`[social-agent] Job ${jobId} "no eligible topic" alert failed: ${alert.error}`)
          }
        }
```

3e. `__tests__/integration/postgrest-select-contract.test.ts`. Delete both `profiles` entries in this commit; otherwise the "still refused" check fails on stale entries. old:
```ts
  {
    file: "functions/src/seo/execute.ts",
    table: "profiles",
    select: "id",
    code: "PGRST205",
    why:
      "There is no profiles table; users carries role. The SEO agent's flag-for-human action returns this " +
      "error every time, so no flag has reached the admin. Pointing it at users makes an untenanted " +
      "'first admin' reader live, which is a tenancy decision (G35), not a typo.",
  },
  {
    file: "functions/src/social-agent.ts",
    table: "profiles",
    select: "id",
    code: "PGRST205",
    why: "Same missing profiles table: the 'no eligible topic' notification to the admin is never sent. See seo/execute.ts.",
  },
  {
    file: "functions/src/social-outcome-tracker.ts",
```
new:
```ts
  {
    file: "functions/src/social-outcome-tracker.ts",
```

- [ ] **Step 4: Run it and watch it pass**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npm --prefix functions test -- src/__tests__/notify-business-owners.test.ts src/__tests__/seo-execute.test.ts src/__tests__/seo-agent.test.ts src/__tests__/social-agent.test.ts`

Expected result: 4 files and 49 tests pass: helper 7, seo-execute 8, seo-agent 13, social-agent 21. This was measured at plan time.

Mutants checked at plan time, each turning the named test red:
- helper without `.eq("business_id")`
- helper without `.eq("role","owner")`
- helper without `.order("created_at")`, without `.order("user_id")`, or with `ascending:false`
- helper using `rows[0]`
- helper ignoring `ownersError`
- execute defaulting to the platform literal; execute using `ctx.userId`
- seo-agent defaulting `businessId`; seo-agent with the old log line; seo-agent ctx without `businessId`
- social with the dead link; social defaulting `businessId`; social ignoring `alert.ok`

Deploy compile gate: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npm --prefix functions run build` must exit 0. It runs `tsc` over `src/**/*.ts`, tests included; firebase.json's predeploy runs exactly this in deploy-functions.yml. It writes `functions/dist/`, which is gitignored. At plan time the planned code type-checked clean against functions' vitest 2.1.9 and `@supabase/supabase-js` types.

Live contract: `PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npm run test:integration:selects` should be green:
- the two `profiles` entries are gone and the reads are gone;
- `business_members select user_id order created_at, user_id` and `notifications select id, user_id` were probed live at plan time with limit 0 and accepted;
- the collector resolves both new chains with nothing unresolved.

Other suites that import or mock a changed module:
- `functions/src/seo/execute.ts`: `seo-execute.test.ts` (edited), and `seo-agent.test.ts`, which mocks it with `executeAction` only. That mock needs no edit, because `AgentContext` is a type import.
- `functions/src/seo-agent.ts` and `functions/src/social-agent.ts`: only their own suites, both edited above. `functions/src/index.ts` imports them dynamically by jobId and needs no change.
- `__tests__/lib/seo-agent/outcomes.test.ts` and `__tests__/api/admin/internal/outcome-tracker.test.ts` do not import any changed module, and the single-id contract they pin is unchanged. No edit needed.

`SINGLETON_BUSINESS_ID` production-file count stays at 5. No new reference: the functions twin in `tenancy-constants.ts` is not imported.

- [ ] **Step 5: Commit**

`git add functions/src/lib/notify-business-owners.ts functions/src/__tests__/notify-business-owners.test.ts functions/src/seo/execute.ts functions/src/seo-agent.ts functions/src/social-agent.ts functions/src/__tests__/seo-execute.test.ts functions/src/__tests__/seo-agent.test.ts functions/src/__tests__/social-agent.test.ts __tests__/integration/postgrest-select-contract.test.ts`

Stage exact paths only. `functions/node_modules` is a symlink and must not be staged.

`git commit -m "fix(agents): send SEO and social agent alerts to the owners of the job's business (G35)" -m "Both alerts read a profiles table that does not exist. PostgREST answered PGRST205 on every run: the SEO flag returned the error, which seo-agent.ts never logged, and the social branch never looked at it. No agent alert has ever reached anyone." -m "notifyBusinessOwners (functions/src/lib) reads business_members for role owner under the job's businessId, with literal select strings so the PostgREST select contract probes them, checks the read error, and inserts one bell row per owner. It returns the first owner's notification id (created_at, then user_id), because the outcome tracker resolves a flag by reading one notification by id." -m "A job with no businessId (enqueued before the previous commit) is not defaulted: the flag returns executed=false with a reason, and the social branch logs a warning. seo-agent.ts now logs each action's error and rejection reason. The social alert links to /admin/strategy; /admin/social-agent/memos is not a page. The two profiles entries leave KNOWN_REFUSED in the same commit, since the contract fails on a stale entry."`

---


### Task 11: The UNTENANTED BY SCHEMA shelf, its inventory checks, and the live column probe (spec §D1 and §D2)

**Files:**
- Create: `__tests__/helpers/untenanted-by-schema.ts`
- Modify: `__tests__/lib/tenancy/platform-inventory.test.ts:31-37` (header and imports), `:95-100` (`inventoryPaths`), `:107-111` (forward check), `:141-153` (reverse check and end of file)
- Modify: `__tests__/integration/postgrest-select-contract.test.ts:33-38` (imports), `:250-254` (after the controls describe)
- Modify: `lib/tenancy/platform.ts:230-235` (the new shelf is appended as the last block of `platformBusinessId`'s doc comment)

**Interfaces:**
- Consumes: none from earlier tasks in code. In prose, the S7 paragraph says the funnel catalogue's FAQ read "consults this seam, on the NARROWER VARIANT shelf". That sentence is only true once the B3/B4 tasks have landed, so run this task after them.
- Produces, from `__tests__/helpers/untenanted-by-schema.ts`:
  - `export type UntenantedRead = { file: string; fn: string; table: string; reads?: string; row: string; surfaces?: string[] }`
  - `export const UNTENANTED_BY_SCHEMA: UntenantedRead[]` (19 rows covering the 12 readers S1-S12)
  - `export function untenantedTables(): string[]`
  - `export function functionBody(source: string, fn: string): string | null`
  - `export function statementsAddingBusinessId(sql: string, table: string): string[]`
  - `export function migrationsAddingBusinessId(table: string, root?: string): string[]`
  - `export function staleReasons(entry: UntenantedRead, root?: string): string[]`
- Produces, inside `platform-inventory.test.ts`: `SHELF_CARVE_OUTS`, `SHELF_HEADER = "UNTENANTED BY SCHEMA --"`, `inventoryParts(): { shelf: string; rest: string }` and `pathsIn(text: string): string[]`. Task 12 edits this file next to them.

- [ ] **Step 1: Write the failing test**

Create `__tests__/helpers/untenanted-by-schema.ts`. It is shared with the live contract, so the list lives here and not in the test file.

```ts
// The UNTENANTED BY SCHEMA shelf of lib/tenancy/platform.ts, as data.
//
// One list, read by two tests so they cannot drift apart:
//   - the platform inventory test proves each entry is still TRUE in the code
//     and in the migrations, and that the shelf's prose names it;
//   - the live PostgREST select contract proves each table still has no
//     `business_id` column on the dev clone, which is the only check that
//     sees a column added outside supabase/migrations.
//
// An entry is a READER of a table that has no `business_id` column, on a
// surface more than one business can reach. It goes stale in exactly two
// ways, and each must fail a test rather than leave a false sentence on the
// shelf:
//   - the reader is converted or deleted, so the read the entry describes is
//     no longer inside the function it names (`functionBody`);
//   - the table gains the column, so "untenanted by schema" stops being true
//     (`statementsAddingBusinessId` over the migrations here; the 42703 probe
//     in the select contract for everything else).
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type UntenantedRead = {
  /** Repo-relative path of the file the read sits in. */
  file: string
  /** The top-level function containing the read; "GET"/"POST" for a route handler. */
  fn: string
  /** The table read. It must have NO `business_id` column. */
  table: string
  /**
   * What must still appear inside `fn` for the entry to be true. Defaults to
   * `.from("<table>")`. An entry whose function reaches the table through a
   * DAL call names that call instead.
   */
  reads?: string
  /** The ledger row that owns the decision. */
  row: string
  /** Other paths the shelf's paragraph names for this entry: the pages and routes that reach it. */
  surfaces?: string[]
}

/**
 * One row per (file, function, table). A function that reads three tables is
 * three rows, because each table can gain its column on its own. Grouped by
 * the shelf's paragraphs, in the design's order (S1-S12,
 * docs/superpowers/specs/2026-09-25-g35-untenanted-readers-design.md §D1).
 */
export const UNTENANTED_BY_SCHEMA: UntenantedRead[] = [
  // S1 — the programme list, the programme page, analytics.
  {
    file: "lib/db/programs.ts",
    fn: "getPrograms",
    table: "programs",
    row: "G37",
    surfaces: ["app/(admin)/admin/programs/page.tsx", "app/(admin)/admin/analytics/page.tsx"],
  },
  { file: "lib/db/programs.ts", fn: "getAllPrograms", table: "programs", row: "G37" },
  {
    file: "lib/db/programs.ts",
    fn: "getProgramById",
    table: "programs",
    row: "G37",
    surfaces: ["app/(admin)/admin/programs/[id]/page.tsx"],
  },
  // S2 — the programme list's counts and completion rate.
  { file: "lib/db/assignments.ts", fn: "getAssignments", table: "program_assignments", row: "G37" },
  { file: "lib/db/assignments.ts", fn: "getAssignmentCountsByProgram", table: "program_assignments", row: "G37" },
  // S3 — the copy-sources route: three tables, three rows.
  { file: "app/api/admin/programs/copy-sources/route.ts", fn: "GET", table: "programs", row: "G37" },
  { file: "app/api/admin/programs/copy-sources/route.ts", fn: "GET", table: "program_assignments", row: "G37" },
  { file: "app/api/admin/programs/copy-sources/route.ts", fn: "GET", table: "users", row: "G37" },
  // S4 — the client roster behind the assign picker.
  { file: "lib/db/users.ts", fn: "getClients", table: "users", row: "G37" },
  // S5 — the pipeline's grantable programmes.
  {
    file: "lib/db/pipeline.ts",
    fn: "listGrantablePrograms",
    table: "programs",
    row: "G37",
    surfaces: ["app/(admin)/admin/pipeline/page.tsx", "app/api/admin/pipeline/grant/route.ts"],
  },
  // S6 — the contact record's payments leg.
  {
    file: "lib/db/contact-detail.ts",
    fn: "getContactDetail",
    table: "payments",
    row: "G04",
    surfaces: ["app/(admin)/admin/contacts/[id]/page.tsx"],
  },
  // S7 — the funnel catalogue. Reaches both tables through aliased DAL
  // readers, so the needle is the call. Its FAQ read is NOT here: that one is
  // gated on the seam (the NARROWER VARIANT shelf).
  {
    file: "lib/funnels/sections/resolve.ts",
    fn: "loadCatalogues",
    table: "programs",
    reads: "listAllPrograms()",
    row: "G31",
  },
  {
    file: "lib/funnels/sections/resolve.ts",
    fn: "loadCatalogues",
    table: "session_pack_products",
    reads: "listAllSessionPackProducts()",
    row: "G31",
  },
  // S8 — public funnel checkout. The needle is the unbound product id: G40
  // binds it to the page's offers, which changes this line and makes the
  // entry stale on purpose.
  {
    file: "app/api/funnels/checkout/route.ts",
    fn: "POST",
    table: "programs",
    reads: "getProgramById(body.productId)",
    row: "G40",
  },
  // S9 — attribution keyed on a user_id that spans businesses.
  {
    file: "lib/db/marketing-attribution.ts",
    fn: "findAttributionForContact",
    table: "marketing_attribution",
    row: "G42",
    surfaces: ["app/api/stripe/webhook/route.ts", "lib/bookings/ingest.ts"],
  },
  // S10 — one newsletter list for every business.
  {
    file: "lib/db/newsletter.ts",
    fn: "getActiveSubscribers",
    table: "newsletter_subscribers",
    row: "G38",
    surfaces: ["app/(admin)/admin/newsletter/page.tsx"],
  },
  {
    file: "lib/db/newsletter.ts",
    fn: "getAllSubscribers",
    table: "newsletter_subscribers",
    row: "G38",
    surfaces: ["app/(admin)/admin/newsletter/subscribers/page.tsx"],
  },
  // S11 — the platform's waiver on every business's public surfaces.
  {
    file: "lib/db/legal-documents.ts",
    fn: "getActiveDocument",
    table: "legal_documents",
    row: "G43",
    surfaces: [
      "components/funnels/islands/FormIsland.tsx",
      "app/(marketing)/camps/page.tsx",
      "app/(marketing)/clinics/page.tsx",
    ],
  },
  // S12 — one inquiry by id.
  {
    file: "lib/db/lead-inquiries.ts",
    fn: "getLeadInquiryById",
    table: "lead_inquiries",
    row: "G45",
    surfaces: ["app/api/admin/leads/[id]/regenerate-analysis/route.ts"],
  },
]

/** Every table on the shelf, once each, sorted. */
export function untenantedTables(): string[] {
  return [...new Set(UNTENANTED_BY_SCHEMA.map((e) => e.table))].sort()
}

/**
 * The source of top-level function `fn`: from its declaration to the first
 * line after it that is nothing but `}`. Prettier closes a top-level function
 * on such a line and indents everything inside it, so this is the function
 * and nothing after it. "Nothing but" matters: a multi-line parameter type
 * closes in column 0 too — `}): Promise<…> {` in `findAttributionForContact`
 * — and stopping there would slice off the whole body. Null when there is no
 * such declaration, so a renamed reader reads as stale instead of matching
 * somewhere else in the file.
 *
 * Function-scoped on purpose: lib/db/programs.ts contains `.from("programs")`
 * eight times, so a whole-file search would keep an entry "true" long after
 * its own reader was converted. The `\s*[(<]` after the name is the other
 * half: without it `getPrograms` would also find `getProgramsCount`.
 */
export function functionBody(source: string, fn: string): string | null {
  const decl = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*[(<]`, "m").exec(source)
  if (!decl) return null
  const rest = source.slice(decl.index)
  const end = rest.search(/^\}[ \t]*$/m)
  return end === -1 ? null : rest.slice(0, end + 1)
}

/**
 * The statements in one migration's SQL that give `table` a `business_id`
 * column. Comments are stripped and the text split on `;` FIRST, so a
 * `business_id` in a comment, or in the next statement about another table,
 * cannot match. Three shapes:
 *   alter table T … add [column] [if not exists] business_id
 *   alter table T … rename [column] x to business_id
 *   create table T ( … business_id … )
 * T may be schema-qualified and quoted, and must END where the name ends, so
 * `programs` never matches `programs_archive`.
 *
 * A column added by dynamic SQL (`execute format('alter table %I …')`) is
 * invisible here. The select contract's 42703 probe is what sees that.
 */
export function statementsAddingBusinessId(sql: string, table: string): string[] {
  const t = `(?:"?public"?\\.)?"?${table}"?`
  const alter = `\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${t}\\s`
  const shapes = [
    new RegExp(`${alter}[\\s\\S]*?\\badd\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?"?business_id"?\\b`, "i"),
    new RegExp(`${alter}[\\s\\S]*?\\brename\\s+(?:column\\s+)?"?\\w+"?\\s+to\\s+"?business_id"?\\b`, "i"),
    new RegExp(`\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${t}\\s*\\([\\s\\S]*?\\bbusiness_id\\b`, "i"),
  ]
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ")
  return code
    .split(";")
    .map((s) => s.trim())
    .filter((s) => shapes.some((re) => re.test(s)))
}

const migrationsByRoot = new Map<string, { name: string; sql: string }[]>()

function migrations(root: string): { name: string; sql: string }[] {
  let list = migrationsByRoot.get(root)
  if (!list) {
    const dir = join(root, "supabase/migrations")
    list = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }))
    migrationsByRoot.set(root, list)
  }
  return list
}

/** "<migration file>: <statement head>" for every statement that gives `table` a `business_id`. */
export function migrationsAddingBusinessId(table: string, root: string = process.cwd()): string[] {
  return migrations(root).flatMap(({ name, sql }) =>
    statementsAddingBusinessId(sql, table).map((s) => `${name}: ${s.replace(/\s+/g, " ").slice(0, 100)}`),
  )
}

/**
 * Why `entry` no longer describes the code, or [] when it still does. The
 * same function judges the real list and the test's control fixtures, so a
 * control that fails here proves the real entries went through a check that
 * CAN fail.
 */
export function staleReasons(entry: UntenantedRead, root: string = process.cwd()): string[] {
  const where = `${entry.file} · ${entry.fn} · ${entry.table}`
  const path = join(root, entry.file)
  if (!existsSync(path)) return [`${where}: the file does not exist`]
  const reasons: string[] = []
  const body = functionBody(readFileSync(path, "utf8"), entry.fn)
  const needle = entry.reads ?? `.from("${entry.table}")`
  if (body === null) reasons.push(`${where}: no top-level function ${entry.fn}`)
  else if (!body.includes(needle)) reasons.push(`${where}: ${entry.fn} no longer contains ${needle}`)
  for (const hit of migrationsAddingBusinessId(entry.table, root)) {
    reasons.push(`${where}: a migration gives ${entry.table} a business_id — ${hit}`)
  }
  for (const surface of entry.surfaces ?? []) {
    if (!existsSync(join(root, surface))) reasons.push(`${where}: surface ${surface} does not exist`)
  }
  return reasons
}
```

Edit `__tests__/lib/tenancy/platform-inventory.test.ts`. There are four exact-string edits.

Edit 1. Before:
```ts
// The forward check alone cannot see the second or the fourth: it is a
// substring test over the whole comment, and the comment names quiz/submit
// in the very sentence that says it is not a caller.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { callersOf } from "../../helpers/seam-callers"
```
After:
```ts
// The forward check alone cannot see the second or the fourth: it is a
// substring test over the whole comment, and the comment names quiz/submit
// in the very sentence that says it is not a caller.
//
// G35 added a shelf of NON-callers: UNTENANTED BY SCHEMA, readers of a table
// with no `business_id` column. It is the last block of the comment, and the
// caller checks read the comment WITHOUT it (`inventoryParts`): a reader named
// there is not claimed to call anything, and a caller named only there has
// not been put on a caller shelf. The shelf has its own checks, in the second
// describe below, over the list in __tests__/helpers/untenanted-by-schema.ts.
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { callersOf } from "../../helpers/seam-callers"
import {
  UNTENANTED_BY_SCHEMA,
  functionBody,
  migrationsAddingBusinessId,
  staleReasons,
  statementsAddingBusinessId,
  type UntenantedRead,
} from "../../helpers/untenanted-by-schema"
```

Edit 2. Before:
```ts
/** Every path-like token the inventory file names, deduped. */
function inventoryPaths(): string[] {
  const text = readFileSync(join(ROOT, INVENTORY), "utf8")
  const found = text.match(/(?:app|lib|components)\/[\w.\-()[\]/]+\.tsx?/g) ?? []
  return [...new Set(found)].filter((p) => p !== INVENTORY).sort()
}
```
After:
```ts
/**
 * Paths the UNTENANTED BY SCHEMA shelf names in its preamble PRECISELY TO SAY
 * they are not entries. The shelf's own reverse check allows these and the
 * entries' own paths, and nothing else.
 */
const SHELF_CARVE_OUTS = [
  // "its `marketing_attribution` read is by session ids taken from rows
  //  already filtered on `business_id`, so it is correct by construction"
  "lib/automation/campaign-revenue.ts",
  // "the platform's own digests and content pipeline: content attribution
  //  (…) and the weekly report (…)"
  "lib/db/content-attribution.ts",
  "lib/analytics/weekly-report.ts",
]

const SHELF_HEADER = "UNTENANTED BY SCHEMA --"

/**
 * The inventory in two parts: the UNTENANTED BY SCHEMA shelf (from its header
 * to the end of the doc comment, which is where it sits) and everything else.
 * Throws unless the header appears exactly once and the comment closes after
 * it — a second copy, or a shelf moved out of the comment, would make this
 * split lie.
 */
function inventoryParts(): { shelf: string; rest: string } {
  const text = readFileSync(join(ROOT, INVENTORY), "utf8")
  const start = text.indexOf(SHELF_HEADER)
  const end = start === -1 ? -1 : text.indexOf("*/", start)
  if (start === -1 || end === -1 || text.indexOf(SHELF_HEADER, start + 1) !== -1) {
    throw new Error(`${INVENTORY} must carry the "${SHELF_HEADER}" shelf exactly once, inside its doc comment`)
  }
  return { shelf: text.slice(start, end), rest: text.slice(0, start) + text.slice(end) }
}

/** Every path-like token in `text`, deduped, the inventory file itself excluded. */
function pathsIn(text: string): string[] {
  const found = text.match(/(?:app|lib|components)\/[\w.\-()[\]/]+\.tsx?/g) ?? []
  return [...new Set(found)].filter((p) => p !== INVENTORY).sort()
}

/** Every path the inventory names OUTSIDE the UNTENANTED BY SCHEMA shelf. */
function inventoryPaths(): string[] {
  return pathsIn(inventoryParts().rest)
}
```

Edit 3. Before:
```ts
  it("names every file that references platformBusinessId, so the seam list cannot silently go stale", () => {
    const inventory = readFileSync(join(ROOT, INVENTORY), "utf8")
    const missing = callers().filter((file) => !inventory.includes(file))
    expect(missing).toEqual([])
  })
```
After:
```ts
  // Read WITHOUT the UNTENANTED BY SCHEMA shelf: a caller named only there has
  // not been given a caller shelf. The overlap test below is why that matters.
  it("names every file that references platformBusinessId, so the seam list cannot silently go stale", () => {
    const { rest } = inventoryParts()
    const missing = callers().filter((file) => !rest.includes(file))
    expect(missing).toEqual([])
  })

  // Some files ARE named on both: the Stripe webhook is an attribution surface
  // on the UNTENANTED BY SCHEMA shelf and a caller on the NARROWER VARIANT
  // shelf. The first expectation is the presence control that makes reading
  // `rest` above load-bearing; the second is the property a whole-comment
  // forward check would lose, since the shelf's mention alone satisfied it.
  it("still names on a caller shelf every caller the UNTENANTED BY SCHEMA shelf also names (MUTANT: forward check over the whole comment)", () => {
    const { shelf, rest } = inventoryParts()
    const onBoth = callers().filter((file) => pathsIn(shelf).includes(file))
    expect(onBoth.length).toBeGreaterThan(0)
    expect(onBoth.filter((file) => !rest.includes(file))).toEqual([])
  })
```

Edit 4. Before (the reverse check and the file's closing `})`):
```ts
  // the seam, unless it is on one of the two explicit lists above — both of
  // which carry, per entry, the sentence that puts it there.
  it("names no file that has stopped referencing the seam", () => {
    const excluded = new Set([...NAMED_BUT_NOT_CALLERS, ...NAMED_AS_CONTEXT])
    const referenced = new Set(callers())
    const stale = inventoryPaths().filter((p) => !excluded.has(p) && !referenced.has(p))
    expect(stale).toEqual([])
  })
})
```
After:
```ts
  // the seam, unless it is on one of the two explicit lists above — both of
  // which carry, per entry, the sentence that puts it there.
  //
  // `inventoryPaths()` leaves out the UNTENANTED BY SCHEMA shelf: every path on
  // it names a reader that does NOT touch the seam, which is the shelf's whole
  // point. It gets its own reverse check in the describe below.
  it("names no file that has stopped referencing the seam", () => {
    const excluded = new Set([...NAMED_BUT_NOT_CALLERS, ...NAMED_AS_CONTEXT])
    const referenced = new Set(callers())
    const stale = inventoryPaths().filter((p) => !excluded.has(p) && !referenced.has(p))
    expect(stale).toEqual([])
  })
})

// G35 §D1-§D2. The shelf names readers of tables with NO `business_id`
// column, on surfaces more than one business can reach. The list is in
// __tests__/helpers/untenanted-by-schema.ts, shared with the live select
// contract, which probes each table for the column on the dev clone.
describe("lib/tenancy/platform.ts — the UNTENANTED BY SCHEMA shelf", () => {
  // Presence control for every "nothing is stale" check below: an emptied or
  // truncated list would pass all of them vacuously. Twelve is the design's
  // count of readers (S1-S12); the list has one row per table each reads.
  it("lists at least the twelve readers the design names", () => {
    expect(new Set(UNTENANTED_BY_SCHEMA.map((e) => e.file)).size).toBeGreaterThanOrEqual(12)
  })

  // (a) The prose names each entry — on the SHELF, not merely somewhere in
  // the comment, where a caller shelf's mention of the same file would do.
  it("names every entry's file, function, surfaces and ledger row on the shelf itself", () => {
    const { shelf } = inventoryParts()
    const named = new Set(pathsIn(shelf))
    const missing = UNTENANTED_BY_SCHEMA.flatMap((e) => [
      ...[e.file, ...(e.surfaces ?? [])].filter((p) => !named.has(p)).map((p) => `${e.fn}: path ${p}`),
      ...(shelf.includes(e.fn) ? [] : [`${e.file}: function ${e.fn}`]),
      ...(new RegExp(`\\b${e.row}\\b`).test(shelf) ? [] : [`${e.file}: ledger row ${e.row}`]),
    ])
    expect(missing).toEqual([])
  })

  // (b) and (c). Each entry is still TRUE: its read is inside the function it
  // names, and no migration has given its table a `business_id`. Converting a
  // reader, deleting it, or adding the column fails here until the entry
  // leaves the shelf.
  it("describes the code as it is: every read is inside its function, and no migration adds business_id to its table", () => {
    expect(UNTENANTED_BY_SCHEMA.flatMap((e) => staleReasons(e))).toEqual([])
  })

  // (d) The shelf's own reverse check. The caller checks above skip the shelf
  // entirely, so without this a path could sit on it describing nothing.
  it("names no path that is not an entry's file, an entry's surface or a stated carve-out", () => {
    const { shelf } = inventoryParts()
    const allowed = new Set([
      ...UNTENANTED_BY_SCHEMA.flatMap((e) => [e.file, ...(e.surfaces ?? [])]),
      ...SHELF_CARVE_OUTS,
    ])
    expect(pathsIn(shelf).filter((p) => !allowed.has(p))).toEqual([])
    expect(SHELF_CARVE_OUTS.filter((p) => !existsSync(join(ROOT, p)))).toEqual([])
  })

  // (e) The checks above CAN fail. Each fixture goes through the same
  // `staleReasons` the real list does.
  describe("controls", () => {
    it("an entry for a table that HAS business_id is stale, and for that reason alone (MUTANT: the migration scan never matches)", () => {
      const fixture: UntenantedRead = { file: "lib/db/events.ts", fn: "getEvents", table: "events", row: "G35" }
      const reasons = staleReasons(fixture)
      expect(reasons.some((r) => r.includes("00252_events_business_id.sql"))).toBe(true)
      expect(reasons.filter((r) => !r.includes("a migration gives events a business_id"))).toEqual([])
    })

    it("an entry whose read sits in a SIBLING function is stale (MUTANT: search the whole file, or slice to its end)", () => {
      // lib/db/programs.ts reads `programs` eight times; `getClient` is not one of them.
      expect(staleReasons({ file: "lib/db/programs.ts", fn: "getClient", table: "programs", row: "G37" })).toEqual([
        'lib/db/programs.ts · getClient · programs: getClient no longer contains .from("programs")',
      ])
    })

    it("an entry naming a function that does not exist is stale", () => {
      expect(
        staleReasons({ file: "lib/db/programs.ts", fn: "getProgramsNobodyWrote", table: "programs", row: "G37" }),
      ).toEqual([
        "lib/db/programs.ts · getProgramsNobodyWrote · programs: no top-level function getProgramsNobodyWrote",
      ])
    })

    it("finds a function by its whole name, not a prefix (MUTANT: no boundary after the name)", () => {
      const src = [
        "export async function getProgramsCount() {",
        "  return 1",
        "}",
        "export async function getPrograms() {",
        "  return 2",
        "}",
        "",
      ].join("\n")
      expect(functionBody(src, "getPrograms")).toBe("export async function getPrograms() {\n  return 2\n}")
    })

    // findAttributionForContact is shaped exactly like this, and the first
    // version of the slice returned its signature without its body.
    it("does not end a function at the column-0 brace of a multi-line parameter type (MUTANT: stop at any column-0 `}`)", () => {
      const src = [
        "export async function find(args: {",
        "  userId: string",
        "}): Promise<void> {",
        "  read()",
        "}",
        "",
      ].join("\n")
      expect(functionBody(src, "find")).toContain("read()")
    })

    describe("the migration scan", () => {
      it("matches each of the three shapes that give a table the column", () => {
        expect(
          statementsAddingBusinessId(
            "alter table public.programs add column if not exists business_id uuid;",
            "programs",
          ),
        ).toHaveLength(1)
        expect(
          statementsAddingBusinessId('ALTER TABLE "programs" RENAME COLUMN tenant_id TO business_id;', "programs"),
        ).toHaveLength(1)
        expect(
          statementsAddingBusinessId(
            "create table programs (\n  id uuid primary key,\n  business_id uuid\n);",
            "programs",
          ),
        ).toHaveLength(1)
      })

      it("ignores a commented-out statement (MUTANT: comments not stripped)", () => {
        const sql =
          "-- alter table programs add column business_id uuid;\n/* alter table programs add column business_id uuid; */"
        expect(statementsAddingBusinessId(sql, "programs")).toEqual([])
      })

      it("ignores business_id in the NEXT statement, about another table (MUTANT: no split on ;)", () => {
        const sql = "alter table programs add column note text;\nalter table events add column business_id uuid;"
        expect(statementsAddingBusinessId(sql, "programs")).toEqual([])
        // Control: the same text does match the table it is about.
        expect(statementsAddingBusinessId(sql, "events")).toHaveLength(1)
      })

      it("ignores a table whose name only STARTS with the entry's (MUTANT: no boundary after the table name)", () => {
        expect(
          statementsAddingBusinessId("alter table programs_archive add column business_id uuid;", "programs"),
        ).toEqual([])
      })

      it("ignores a constraint over an existing business_id, which adds no column (MUTANT: any `add` before business_id)", () => {
        const sql =
          "alter table programs add constraint programs_business_fk foreign key (business_id) references businesses (id);"
        expect(statementsAddingBusinessId(sql, "programs")).toEqual([])
      })

      it("reads the real migrations: events (00252) and business_members (created with it) are found, `event` is not", () => {
        expect(migrationsAddingBusinessId("events").some((h) => h.startsWith("00252_events_business_id.sql"))).toBe(
          true,
        )
        expect(migrationsAddingBusinessId("business_members").length).toBeGreaterThan(0)
        expect(migrationsAddingBusinessId("event")).toEqual([])
      })
    })
  })
})
```

Edit `__tests__/integration/postgrest-select-contract.test.ts`. There are two edits.

Before:
```ts
import {
  collectSelects,
  type CollectedSelects,
  type OrderColumn,
  type SelectCall,
} from "@/scripts/lib/collect-postgrest-selects"
```
After:
```ts
import {
  collectSelects,
  type CollectedSelects,
  type OrderColumn,
  type SelectCall,
} from "@/scripts/lib/collect-postgrest-selects"
import { untenantedTables } from "../helpers/untenanted-by-schema"
```

Before:
```ts
    it("a table that does not exist is refused (PGRST205)", async () => {
      const r = await probe(client, null, "not_a_table_control", "id")
      expect(r?.code).toBe("PGRST205")
    })
  })
```
After:
```ts
    it("a table that does not exist is refused (PGRST205)", async () => {
      const r = await probe(client, null, "not_a_table_control", "id")
      expect(r?.code).toBe("PGRST205")
    })
  })

  // G35 §D2. Every table on the UNTENANTED BY SCHEMA shelf of
  // lib/tenancy/platform.ts is there because it has NO business_id column.
  // platform-inventory.test.ts proves no MIGRATION adds one; only the live
  // schema can say the column arrived some other way — a statement run by
  // hand, a dashboard edit, dynamic SQL the migration scan cannot read. A
  // table that stops answering 42703 has grown the column: move its readers
  // off the shelf and give them a predicate, rather than editing this test.
  describe("the UNTENANTED BY SCHEMA shelf's tables still have no business_id", () => {
    it("control: a table that HAS business_id answers the same probe without an error", async () => {
      expect(await probe(client, null, "events", "business_id")).toBeNull()
    })

    it.each(untenantedTables())("%s has no business_id column (42703)", async (table) => {
      const r = await probe(client, null, table, "business_id")
      expect(r?.code).toBe("42703")
    })
  })
```

- [ ] **Step 2: Run it and watch it fail**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts`

Expected result: 5 failures, each with `Error: lib/tenancy/platform.ts must carry the "UNTENANTED BY SCHEMA --" shelf exactly once, inside its doc comment`. The five are the forward check, the overlap test, the reverse check, (a) and (d). On an unmodified base the file has 21 tests, so 16 pass: the presence control, the quiz/submit and calendly pins, the "twelve readers" control, (b)+(c) (the reads and migrations are already true today), and all 11 controls.

The live probe cannot fail on the real list, because every table already lacks the column. To see that it can fail, temporarily use `it.each([...untenantedTables(), "events"])`. The extra case fails with `expected undefined to be '42703'`. Revert afterwards.

- [ ] **Step 3: Implement**

Edit `lib/tenancy/platform.ts`. The anchor is the closing paragraph of the doc comment.

Before:
```ts
 * literals scattered across routes. Calling every one of them a "resolution"
 * would be a lie; naming each honestly, and naming WHICH kind, is the whole
 * value.
 */
export function platformBusinessId(): string {
```
After:
```ts
 * literals scattered across routes. Calling every one of them a "resolution"
 * would be a lie; naming each honestly, and naming WHICH kind, is the whole
 * value.
 *
 * UNTENANTED BY SCHEMA -- NOT callers of this function, and listed here for
 * exactly that reason. Every shelf above is a call site that lands on the
 * platform's business. These readers name no business at all, because the
 * table they read has no `business_id` column to name one with, so "the
 * rows" means every business's rows. They are listed only where more than
 * one business can reach them: through a permission an owner can grant to
 * staff, a public route that resolved a Host tenant, or a job that serves
 * every business. Production has one business (2026-09-23), so none of them
 * leaks today; each is a fuse for the white-label destination, and each
 * names the ledger row that owns the decision.
 *
 * Do not "fix" one by adding a business predicate: there is no column to
 * filter on, and PostgREST answers 42703. Converting a reader means a column,
 * a writer and a backfill first -- and then it leaves this shelf. The
 * platform inventory test fails when a listed read is no longer where this
 * says it is, or when a migration gives its table the column; the live
 * select contract fails when the column appears any other way.
 *
 * NOT entries, named so they do not read as omissions:
 *   - `users` read by one id or one email (the register route, the contact,
 *     inquiry and funnel forms, the funnel checkout). That is identity -- one
 *     login serves every business -- not a business's data. The client
 *     ROSTER is different, and is an entry below.
 *   - `marketing_attribution` read by `session_id`
 *     (`getAttributionBySession`, `getUnclaimedAttribution`): keyed on the
 *     visitor's own cookie, so it returns that visitor's row and no one
 *     else's.
 *   - lib/automation/campaign-revenue.ts. Its `marketing_attribution` read
 *     is by session ids taken from `opportunities` and `contacts` rows
 *     already filtered on `business_id`, so it is correct by construction,
 *     and says so where it reads.
 *   - the platform's own digests and content pipeline: content attribution
 *     (lib/db/content-attribution.ts), the weekly report
 *     (lib/analytics/weekly-report.ts), and the newsletter subscriber deltas
 *     it and the Daily Brief read. They have the Daily Brief's shape
 *     (above): one platform recipient, not a surface a second business
 *     reaches.
 *   - whole subsystems that are untenanted end to end: the blog, the website
 *     CMS, money (payments, orders, subscriptions), analytics, the exercise
 *     library, the client portal, and the social, SEO and AI tables. Each is
 *     one decision, not a reader at a time, and ledger row G36 names them.
 *     `system_settings` (platform flags) and `businesses` (the tenant
 *     registry itself) are not a business's data at all.
 *
 * The entries:
 *   - `getPrograms`, `getAllPrograms` and `getProgramById`
 *     (lib/db/programs.ts) read `programs`. The programme list and the
 *     programme page (app/(admin)/admin/programs/page.tsx,
 *     app/(admin)/admin/programs/[id]/page.tsx) reach them through the
 *     `programs` permission, which the Coach preset grants, and the
 *     analytics page (app/(admin)/admin/analytics/page.tsx) through
 *     `analytics`. A second business's coach sees every business's
 *     programmes -- most of them private plans named after an athlete -- and
 *     opens any of them by id. G37.
 *   - `getAssignments` and `getAssignmentCountsByProgram`
 *     (lib/db/assignments.ts) read `program_assignments`. The same programme
 *     list: every business's assignments feed its counts and its completion
 *     rate. G37.
 *   - the copy-sources route's GET
 *     (app/api/admin/programs/copy-sources/route.ts) reads `programs`,
 *     `program_assignments` and `users`, behind `programs`. It returns every
 *     active programme with each assignee's full name, so a coach reads
 *     other businesses' client names. G37.
 *   - `getClients` (lib/db/users.ts) reads `users`: the client ROSTER, not
 *     an identity lookup. The assign picker on the programme page reaches
 *     it (`programs`), and it skips the client scoping only the client pages
 *     apply, so every business's clients are offered. G37.
 *   - `listGrantablePrograms` (lib/db/pipeline.ts) reads `programs`. The
 *     pipeline board (app/(admin)/admin/pipeline/page.tsx) and its grant
 *     route (app/api/admin/pipeline/grant/route.ts) reach it through
 *     `contacts`, which the Coach preset grants. MIXED SCOPE: the board is
 *     the business's own, the programmes it offers are every business's, and
 *     a grant hands one of them out. G37.
 *   - `getContactDetail` (lib/db/contact-detail.ts), its payments leg, reads
 *     `payments` by the contact's `user_id`. The contact record
 *     (app/(admin)/admin/contacts/[id]/page.tsx) reaches it through
 *     `contacts`. `linkContactsToUser` links one login into every business's
 *     contact with that email, so a coach sees another business's payments
 *     for a shared address. The read says so in place. G04.
 *   - `loadCatalogues` (lib/funnels/sections/resolve.ts) reads `programs`
 *     and `session_pack_products` through their DAL readers. The funnel
 *     builder, both publish routes and both draft previews reach it through
 *     `funnels`. A second business's builder offers the platform's
 *     programmes and packs, and a page it publishes can sell them. Its FAQ
 *     read is not an entry: that one consults this seam, on the NARROWER
 *     VARIANT shelf. G31.
 *   - the funnel checkout's POST (app/api/funnels/checkout/route.ts) reads
 *     `programs` through `getProgramById`. Public; its tenant comes from the
 *     Host. It checks only that the product id is a UUID with a price -- not
 *     that it is one of the published page's offers, active, public, or this
 *     business's -- and files the sale under the Host's business. G40.
 *   - `findAttributionForContact` (lib/db/marketing-attribution.ts) reads
 *     `marketing_attribution` by `user_id`. The Stripe webhook
 *     (app/api/stripe/webhook/route.ts; one Stripe account for every
 *     business) and the booking ingest (lib/bookings/ingest.ts; every
 *     business's bookings) reach it. Once `linkContactsToUser` links one
 *     login to two businesses' contacts, a click id captured on one
 *     business's page attaches to the other's purchase or booking. G42.
 *   - `getActiveSubscribers` and `getAllSubscribers` (lib/db/newsletter.ts)
 *     read `newsletter_subscribers`: one list for every business. The
 *     newsletter pages (app/(admin)/admin/newsletter/page.tsx,
 *     app/(admin)/admin/newsletter/subscribers/page.tsx) reach them through
 *     `blog`, which the Marketing Manager preset grants, and the analytics
 *     page through `analytics`. The public subscribe route resolves a Host
 *     tenant and then writes this list anyway, so a visitor who subscribed on
 *     a coach's host is mailed by the platform's newsletter. G38.
 *   - `getActiveDocument` (lib/db/legal-documents.ts) reads
 *     `legal_documents`. Public surfaces that resolved a Host tenant reach
 *     it: the funnel form (components/funnels/islands/FormIsland.tsx), the
 *     camp and clinic pages (app/(marketing)/camps/page.tsx,
 *     app/(marketing)/clinics/page.tsx, and each event's own page) and the
 *     event signup and checkout. Every business's customers see, and record
 *     their acceptance of, the platform's waiver. An owner and legal
 *     decision before it is a code one. G43.
 *   - `getLeadInquiryById` (lib/db/lead-inquiries.ts) reads `lead_inquiries`
 *     by id alone. The regenerate-analysis route
 *     (app/api/admin/leads/[id]/regenerate-analysis/route.ts) reaches it
 *     through `leads`, which the Front Desk and Marketing Manager presets
 *     grant, and returns the whole row. Reaching one needs its UUID, and no
 *     list of these rows sits on a grantable surface. G45.
 */
export function platformBusinessId(): string {
```

- [ ] **Step 4: Run it and watch it pass**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts __tests__/lib/tenancy/public-inventory.test.ts __tests__/lib/lead-engine/enroll-call-site-inventory.test.ts`

Expected: all pass. That is 21 in platform-inventory, 4 in public-inventory and 7 in enroll-call-site-inventory on an unmodified base. The last two share `__tests__/helpers/seam-callers.ts` and read seam prose, so they confirm nothing else parses the comment differently.

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npm run test:integration:selects`

Expected: 12 existing tests plus 10 new ones pass. The new ones are the `events` control and 9 tables answering 42703: lead_inquiries, legal_documents, marketing_attribution, newsletter_subscribers, payments, program_assignments, programs, session_pack_products and users. The worktree's `.env.local` is already a symlink to the dev clone env.

Other suites that import or mock `@/lib/tenancy/platform`: the change is to a doc comment only, so none needs an edit or a run.
- `__tests__/api/admin/internal/bookkeeping-income-sync.test.ts`
- `__tests__/api/assessment/submit-route.test.ts`
- `__tests__/api/public/invite-claim.test.ts`
- `__tests__/api/spine/questionnaire-spine.test.ts`
- `__tests__/api/stripe/webhook-abandoned-checkout-purchase-guard.test.ts`
- `__tests__/api/stripe/webhook-capture-tenant.test.ts`
- `__tests__/api/stripe/webhook-contact-source.test.ts`
- `__tests__/api/stripe/webhook-funnel-purchase.test.ts`
- `__tests__/api/stripe/webhook-session-pack.test.ts`
- `__tests__/api/webhooks/calendly-booking.test.ts`
- `__tests__/api/webhooks/calendly-tenant-resolution.test.ts`
- `__tests__/app/sitemap-funnels.test.ts`
- `__tests__/db/google-ads-accounts-tenancy.test.ts`
- `__tests__/integration/api/shop/leads.test.ts`
- `__tests__/integration/chat-live.test.ts`
- `__tests__/lib/db/bookings.test.ts`
- `__tests__/lib/tenancy/public.test.ts`

- [ ] **Step 5: Commit**

`git add __tests__/helpers/untenanted-by-schema.ts __tests__/lib/tenancy/platform-inventory.test.ts __tests__/integration/postgrest-select-contract.test.ts lib/tenancy/platform.ts`

`git commit -m "docs(tenancy): put the readers of untenanted tables on a shelf of their own (G35 §D1-§D2)" -m "Twelve readers of tables with no business_id sit on surfaces a second business can reach: a grantable staff permission, a Host-resolved public route, or a job for every business. They never call platformBusinessId(), so the seam's inventory could not see them. They now have a shelf, UNTENANTED BY SCHEMA, the last block of the doc comment, and each entry names its table, surface, who reaches it and the ledger row that owns it." -m "The inventory test keeps the shelf true. Each read must still be inside the function named for it (function-scoped: programs.ts reads programs eight times). No migration may add business_id to its table. Every path the shelf names must be an entry, a surface or a stated carve-out. The caller checks now read the comment WITHOUT the shelf, because the Stripe webhook is named on both, and a whole-comment forward check would be satisfied by the shelf's mention alone. The live select contract probes each shelf table for business_id and expects 42703, the only check that sees a column added outside the migrations."`

### Task 12: In-place notes at every shelf read, and the four stale comments corrected (spec §D3)

**Files:**
- Modify: `__tests__/helpers/untenanted-by-schema.ts` (add `functionRegion` and `hasInPlaceNote` before `statementsAddingBusinessId`)
- Modify: `__tests__/lib/tenancy/platform-inventory.test.ts` (import, the in-place ratchet, one control, and the stale-comment describe)
- Modify: `lib/db/programs.ts:9-11`, `:33-36`, `:46-48`
- Modify: `lib/db/assignments.ts:10-12`, `:107-109`
- Modify: `app/api/admin/programs/copy-sources/route.ts:23-25`
- Modify: `lib/db/users.ts:59-61`
- Modify: `lib/db/pipeline.ts:2096-2100` (the `listGrantablePrograms` JSDoc)
- Modify: `app/(admin)/admin/pipeline/page.tsx:79-81` (stale)
- Modify: `lib/funnels/sections/resolve.ts:490-492` (add the row id to the existing G31-style comment)
- Modify: `app/api/funnels/checkout/route.ts:91-93`
- Modify: `lib/db/marketing-attribution.ts:128-149` (stale, both halves)
- Modify: `lib/bookings/ingest.ts:560-570` (stale)
- Modify: `lib/db/newsletter.ts:53-55`, `:78-80`
- Modify: `lib/db/legal-documents.ts:8-10`
- Modify: `lib/db/lead-inquiries.ts:93-94`
- Modify: `lib/automation/campaign-revenue.ts:316-318` (the carve-out's in-place comment)

**Interfaces:**
- Consumes: from Task 11, `UNTENANTED_BY_SCHEMA`, `UntenantedRead`, `functionBody(source, fn): string | null`, and the test file's `ROOT`, `join` and `readFileSync`.
- Produces:
  - `export function functionRegion(source: string, fn: string): string | null`
  - `export function hasInPlaceNote(entry: UntenantedRead, root?: string): boolean`
  - From then on, any new shelf entry must carry an in-place note naming its table's missing `business_id` and its row.

- [ ] **Step 1: Write the failing test**

In `__tests__/helpers/untenanted-by-schema.ts`, insert before the `statementsAddingBusinessId` doc comment.

Before:
```ts
/**
 * The statements in one migration's SQL that give `table` a `business_id`
```
After:
```ts
/**
 * `functionBody` plus everything since the previous line that is nothing but
 * `}` -- the close of the top-level block before it. That is where the
 * function's doc comment sits, so a note may be written there or at the read
 * inside the body, and either counts. It stops at the previous block on
 * purpose: a note on the function ABOVE must not count for this one.
 */
export function functionRegion(source: string, fn: string): string | null {
  const body = functionBody(source, fn)
  if (body === null) return null
  const start = source.indexOf(body)
  const closes = [...source.slice(0, start).matchAll(/^\}[ \t]*$/gm)]
  const from = closes.length > 0 ? (closes[closes.length - 1].index ?? 0) + 1 : 0
  return source.slice(from, start + body.length)
}

/**
 * Whether `entry`'s function says IN PLACE that its table has no
 * `business_id`, and which ledger row owns that: "`<table>` … no
 * `business_id`" inside one sentence, plus the row id, anywhere in
 * `functionRegion`. Comment markers and line breaks are flattened first, so a
 * note wrapped across lines still matches.
 */
export function hasInPlaceNote(entry: UntenantedRead, root: string = process.cwd()): boolean {
  const region = functionRegion(readFileSync(join(root, entry.file), "utf8"), entry.fn)
  if (region === null) return false
  const prose = region.replace(/\n[ \t]*(?:\/\/|\*)?[ \t]*/g, " ")
  return (
    new RegExp("`" + entry.table + "`[^.]*?\\bno `business_id`", "i").test(prose) &&
    new RegExp(`\\b${entry.row}\\b`).test(prose)
  )
}

/**
 * The statements in one migration's SQL that give `table` a `business_id`
```

In `__tests__/lib/tenancy/platform-inventory.test.ts`, make four edits.

Edit 1 (import). Before:
```ts
  UNTENANTED_BY_SCHEMA,
  functionBody,
  migrationsAddingBusinessId,
```
After:
```ts
  UNTENANTED_BY_SCHEMA,
  functionBody,
  hasInPlaceNote,
  migrationsAddingBusinessId,
```

Edit 2 (the ratchet). Before:
```ts
    expect(SHELF_CARVE_OUTS.filter((p) => !existsSync(join(ROOT, p)))).toEqual([])
  })

  // (e) The checks above CAN fail.
```
After:
```ts
    expect(SHELF_CARVE_OUTS.filter((p) => !existsSync(join(ROOT, p)))).toEqual([])
  })

  // §D3. The shelf is one place to look; the read is where someone about to
  // "just add a predicate" will be standing. Every entry's function says, in
  // place, that its table has no `business_id` and which row owns that.
  it("has an in-place note at every read: its table has no business_id, and the ledger row that owns it", () => {
    const missing = UNTENANTED_BY_SCHEMA.filter((e) => !hasInPlaceNote(e)).map(
      (e) => `${e.file} · ${e.fn} · ${e.table} (${e.row})`,
    )
    expect(missing).toEqual([])
  })

  // (e) The checks above CAN fail.
```

Edit 3 (a control). Before:
```ts
    // findAttributionForContact is shaped exactly like this, and the first
    // version of the slice returned its signature without its body.
```
After:
```ts
    // createProgram sits directly under getProgramById, whose note is the
    // nearest one above it. It must not borrow it.
    it("does not credit a function with the note on the function above it (MUTANT: the region reaches back past the previous block)", () => {
      expect(hasInPlaceNote({ file: "lib/db/programs.ts", fn: "getProgramById", table: "programs", row: "G37" })).toBe(
        true,
      )
      expect(hasInPlaceNote({ file: "lib/db/programs.ts", fn: "createProgram", table: "programs", row: "G37" })).toBe(
        false,
      )
    })

    // findAttributionForContact is shaped exactly like this, and the first
    // version of the slice returned its signature without its body.
```

Edit 4 (end of file). Before:
```ts
        expect(migrationsAddingBusinessId("event")).toEqual([])
      })
    })
  })
})
```
After:
```ts
        expect(migrationsAddingBusinessId("event")).toEqual([])
      })
    })
  })
})

// G35 §D3. Four comments described a world that no longer exists, each in a
// way that would talk a reader out of the shelf above. Each test pins the
// false sentence gone AND the code it sat on still there, so deleting the
// read (or the file) cannot pass for correcting the comment.
describe("comments the UNTENANTED BY SCHEMA shelf contradicted are corrected", () => {
  const source = (path: string) => readFileSync(join(ROOT, path), "utf8")

  it("the pipeline page no longer calls its programme list 'nothing to scope'", () => {
    const page = source("app/(admin)/admin/pipeline/page.tsx")
    expect(page).toContain("listGrantablePrograms()")
    expect(page).not.toContain("there is nothing to scope")
    expect(page).toContain("G37")
  })

  // The corrected docstring QUOTES both old claims in order to retire them,
  // so the needles are the claims as they were asserted, not the quotes.
  it("findAttributionForContact no longer argues from phase 4 or from user_id being per-business", () => {
    const dal = source("lib/db/marketing-attribution.ts")
    expect(dal).toContain("export async function findAttributionForContact(")
    expect(dal).not.toContain("where the tenant is not resolved until")
    expect(dal).not.toContain("never shared across businesses the way")
    expect(dal).toContain("linkContactsToUser")
  })

  it("the booking ingest no longer says nothing writes contacts.user_id", () => {
    const ingest = source("lib/bookings/ingest.ts")
    expect(ingest).toContain("findAttributionForContact({ userId })")
    expect(ingest).not.toContain("WHICH NOTHING WRITES FOR A BOOKING")
    expect(ingest).toContain("linkContactsToUser")
  })

  // The shelf's preamble names this file as NOT an entry; the read says why
  // where it happens, so the next reader does not "fix" a correct read.
  it("campaign revenue's attribution read says in place why it is not on the shelf", () => {
    const revenue = source("lib/automation/campaign-revenue.ts")
    expect(revenue).toContain('.in("session_id", chunk)')
    expect(revenue).toContain("NOT on the UNTENANTED BY SCHEMA shelf")
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts`

Expected: 6 failures out of 27.
- The in-place ratchet lists 18 entries, which is every row except `lib/db/contact-detail.ts · getContactDetail · payments (G04)`. That one already passes through its "WHITE-LABEL WATCH (G04)" comment. The two `loadCatalogues` rows fail only because their region lacks `G31`.
- The `createProgram` control fails its first expectation (`expected false to be true`) because `getProgramById` has no note yet.
- The four stale-comment tests fail with `not to contain 'there is nothing to scope'`, `not to contain 'where the tenant is not resolved until'`, `not to contain 'WHICH NOTHING WRITES FOR A BOOKING'` and `to contain 'NOT on the UNTENANTED BY SCHEMA shelf'`.

- [ ] **Step 3: Implement** (comments only; no code changes)

`lib/db/programs.ts`, `getPrograms`. Before:
```ts
export async function getPrograms() {
  const supabase = getClient()
  const { data, error } = await supabase
```
After:
```ts
export async function getPrograms() {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G37). `programs` has no `business_id` column, so
  // this is every business's programmes, and there is no predicate to add
  // without inventing the column. Staff holding `programs` (the Coach preset)
  // read it through /admin/programs. Listed on the shelf in
  // lib/tenancy/platform.ts; the table converts first, then this read.
  const { data, error } = await supabase
```

`lib/db/programs.ts`, `getAllPrograms` JSDoc. Before:
```ts
 * DO NOT reach for this to render a list to a visitor or an admin picker —
 * it will happily hand back retired products. Recognition only.
 */
export async function getAllPrograms() {
```
After:
```ts
 * DO NOT reach for this to render a list to a visitor or an admin picker —
 * it will happily hand back retired products. Recognition only.
 *
 * UNTENANTED BY SCHEMA (G37), like `getPrograms` above: `programs` has no
 * `business_id` column, so "every program" is every business's.
 */
export async function getAllPrograms() {
```

`lib/db/programs.ts`, `getProgramById`. Before:
```ts
export async function getProgramById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("programs").select("*").eq("id", id).single()
```
After:
```ts
export async function getProgramById(id: string) {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G37): `programs` has no `business_id` column, so an
  // id from ANY business resolves here. /admin/programs/[id] opens whatever
  // id is in its URL, and the funnel checkout sells whatever id its body
  // names (G40). See the shelf in lib/tenancy/platform.ts.
  const { data, error } = await supabase.from("programs").select("*").eq("id", id).single()
```

`lib/db/assignments.ts`, `getAssignments`. Before:
```ts
export async function getAssignments(userId?: string) {
  const supabase = getClient()
  let query
```
After:
```ts
export async function getAssignments(userId?: string) {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G37). `program_assignments` has no `business_id`
  // column, and neither has the `programs` row it embeds, so with no `userId`
  // this is every business's assignments: /admin/programs builds its counts
  // and its completion rate from exactly that. See the shelf in
  // lib/tenancy/platform.ts.
  let query
```

`lib/db/assignments.ts`, `getAssignmentCountsByProgram`. Before:
```ts
export async function getAssignmentCountsByProgram(): Promise<Record<string, number>> {
  const supabase = getClient()
  const { data, error }
```
After:
```ts
export async function getAssignmentCountsByProgram(): Promise<Record<string, number>> {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G37): `program_assignments` has no `business_id`
  // column, so these counts run across every business. See `getAssignments`.
  const { data, error }
```

`app/api/admin/programs/copy-sources/route.ts`. Before:
```ts
    const supabase = createServiceRoleClient()

    const [programsRes, assignmentsRes] = await Promise.all([
```
After:
```ts
    const supabase = createServiceRoleClient()

    // UNTENANTED BY SCHEMA (G37). `programs`, `program_assignments` and `users`
    // have no `business_id` column, so every business's active programmes come
    // back WITH their assignees' full names, to anyone holding `programs` (the
    // Coach preset) — the guard above checks that permission and nothing
    // else. There is no predicate to add without the columns. See the shelf
    // in lib/tenancy/platform.ts.
    const [programsRes, assignmentsRes] = await Promise.all([
```

`lib/db/users.ts`, `getClients`. Before:
```ts
export async function getClients() {
  const supabase = getClient()
  const { data, error } = await supabase
```
After:
```ts
export async function getClients() {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G37). `users` has no `business_id` column, so this
  // roster is every business's clients, and the assign picker on
  // /admin/programs/[id] offers all of them to anyone holding `programs`. It
  // also skips `resolveClientScope`, which only the /admin/clients pages
  // apply. Looking ONE user up by id or email is identity, not this; see the
  // shelf in lib/tenancy/platform.ts.
  const { data, error } = await supabase
```

`lib/db/pipeline.ts`, the `listGrantablePrograms` JSDoc. Before:
```ts
 * The real hazard is therefore picking the WRONG athlete's plan out of
 * eighteen similar names, which is a case for search in the picker rather than
 * for a narrower query here. Noted, not built.
 */
export async function listGrantablePrograms(): Promise<
```
After:
```ts
 * The real hazard is therefore picking the WRONG athlete's plan out of
 * eighteen similar names, which is a case for search in the picker rather than
 * for a narrower query here. Noted, not built.
 *
 * UNTENANTED BY SCHEMA (G37), and it is where "a named plan in this list is
 * correct, not a leak" stops being true. `programs` has no `business_id`
 * column, so once a second business exists this is EVERY business's priced
 * plans, offered on that business's own pipeline board to anyone holding
 * `contacts` (the Coach preset) — and a grant hands one of them out. There is
 * no predicate to add without the column. See the shelf in
 * lib/tenancy/platform.ts.
 */
export async function listGrantablePrograms(): Promise<
```

`app/(admin)/admin/pipeline/page.tsx` (stale). Before:
```ts
  // `listGrantablePrograms()` takes no businessId: `programs` has no
  // business_id column at all (it is the shared program catalog, not a
  // per-tenant table) -- this is not a scoping gap, there is nothing to scope.
```
After:
```ts
  // MIXED SCOPE, and a gap rather than a design. The board and the settings
  // are this tenant's own, but `listGrantablePrograms()` takes no businessId
  // because `programs` has no `business_id` column: the grant picker offers
  // EVERY business's priced programmes, most of them plans named after one
  // athlete, and a grant hands one out. There is no predicate to add without
  // the column. Ledger row G37 owns the decision; the read is on the
  // UNTENANTED BY SCHEMA shelf in lib/tenancy/platform.ts.
```

`lib/funnels/sections/resolve.ts`, inside `loadCatalogues`'s `Promise.all`. Re-anchor if a B3 task reworded this comment; the ratchet only needs `G31` somewhere in the region. Before:
```ts
    // `programs` has no `business_id` column at all -- unconverted, not
    // frozen. There is no per-tenant predicate to add without inventing a
    // column this table does not have.
```
After:
```ts
    // `programs` has no `business_id` column at all -- unconverted, not
    // frozen. There is no per-tenant predicate to add without inventing a
    // column this table does not have. UNTENANTED BY SCHEMA (G31), with the
    // packs pair below: on the shelf in lib/tenancy/platform.ts.
```

`app/api/funnels/checkout/route.ts`. Before:
```ts
  let program
  try {
    program = await getProgramById(body.productId)
```
After:
```ts
  // UNTENANTED BY SCHEMA (G40). `programs` has no `business_id` column, and
  // this reads whatever product id the request body names, checked above only
  // for being a UUID and below only for having a price: not for being one of
  // this page's offers, active, public, or this business's. The sale is then
  // filed under the Host's business either way. G40 binds the id to the
  // published version's offers; see the shelf in lib/tenancy/platform.ts.
  let program
  try {
    program = await getProgramById(body.productId)
```

`lib/db/marketing-attribution.ts` (stale, both halves). Before:
```ts
/**
 * Attribution for a contact, keyed on the contact's OWN user_id.
 *
 * marketing_attribution has no business_id and cannot get one in this phase:
 * captureAttribution runs in proxy.ts, where the tenant is not resolved until
 * phase 4, and a column with no correct writer is a labelling gap rather than
 * a feature. So the tenant safety here comes from HOW the userId was obtained
 * -- the caller resolved it from a contact of its own business.
 *
 * The old `users!inner(email)` join is gone, and nothing is lost by it:
 * marketing_attribution.user_id is nullable with a partial index
 * (00101:7,25), so that join only ever matched rows already CLAIMED by a
 * registered user. A contact with no user_id had no match then either -- and
 * an EMAIL match besides was a cross-tenant path once two coaches can share a
 * lead: a click id captured on coach A's funnel would attach to coach B's
 * contact the moment that shared lead typed the same address into both.
 * user_id is unique to one account, never shared across businesses the way an
 * email string can be, so keying on it removes that path with no schema
 * change.
 *
 * The 30-day default window is unchanged -- it is a settled decision.
 */
```
After:
```ts
/**
 * Attribution for a contact, keyed on the contact's OWN user_id.
 *
 * UNTENANTED BY SCHEMA (G42; the shelf in lib/tenancy/platform.ts).
 * `marketing_attribution` has no `business_id` column, so this read cannot be
 * scoped to a business, and HOW the caller obtained `userId` does not make it
 * so. This comment used to give two reasons it was safe. Both have expired:
 *   - "the tenant is not resolved until phase 4". The row is written by the
 *     same-origin track route that proxy.ts posts to
 *     (app/api/public/attribution/track/route.ts), and since phase 4 a
 *     public route can resolve its Host's business (`resolvePublicTenant`).
 *     A column would now have a correct writer, and `landing_url` carries the
 *     host on 509 of 512 dev-clone rows (2026-09-25), so it could be
 *     backfilled. Whether to is G42.
 *   - "user_id is never shared across businesses". A `users` row is ONE login
 *     for every business, and G04's `linkContactsToUser` links it into every
 *     business's contact with that email. So once one person is a contact of
 *     two businesses, a click id captured on one business's page attaches to
 *     the other's purchase or booking — through the Stripe webhook and the
 *     booking ingest, both of which call this.
 *
 * The old `users!inner(email)` join is gone, and nothing is lost by it:
 * marketing_attribution.user_id is nullable with a partial index
 * (00101:7,25), so that join only ever matched rows already CLAIMED by a
 * registered user. Keying on user_id rather than an email string still
 * narrows the cross-business path to people who made an account. It does not
 * close it.
 *
 * The 30-day default window is unchanged -- it is a settled decision.
 */
```

`lib/bookings/ingest.ts`, in `writeRow` (stale). Before:
```ts
  // THIS HOP DEPENDS ON contacts.user_id, WHICH NOTHING WRITES FOR A BOOKING.
  // The only writer in the schema is merge_contacts (SQL, carries a loser's
  // user_id onto the survivor) — no registration or claim flow ever sets it
  // directly. So this path resolves for a contact that happened to arrive
  // here via a merge with an already-claimed contact, and for nobody else,
  // until a real writer exists. Review round 1: TWO owner items, not one —
  // (1) claim-at-registration actually firing (marketing_attribution.user_id
  // itself, which the Stripe half of this fallback already depends on via
  // tryResolveUserIdFromEmail), and separately (2) something writing
  // contacts.user_id at registration/claim time, which is phase-2 scope and
  // is not attempted here.
```
After:
```ts
  // THIS HOP DEPENDS ON contacts.user_id, WHICH G04 GAVE WRITERS. This used
  // to say nothing wrote it but merge_contacts. Since G04 (2026-09-20),
  // `upsertContactIdentity` links a capture to the account with the same
  // email, `linkContactsToUser` fills every unlinked contact with that email
  // when someone registers, is added from /admin/clients or claims an invite,
  // and migration 00264 backfilled the rest (43 of 170 on production). So
  // this fallback now resolves for anyone with an account.
  //
  // Which is also how it crosses businesses. `linkContactsToUser` is
  // deliberately unscoped (one login serves every business), so one person's
  // contacts in two businesses share one user_id, and
  // `findAttributionForContact` — keyed on that user_id, over a table with no
  // `business_id` — can hand one business's click id to the other's booking.
  // Ledger row G42; see that function's docstring.
  //
  // Still separate, from review round 1: whether marketing_attribution.user_id
  // itself gets claimed (the register, inquiry and newsletter paths are its
  // only writers), which the Stripe half of this fallback also depends on via
  // tryResolveUserIdFromEmail.
```

`lib/db/newsletter.ts`, `getActiveSubscribers`. Before:
```ts
export async function getActiveSubscribers(): Promise<{ email: string }[]> {
  const supabase = getClient()
  // Paginated
```
After:
```ts
export async function getActiveSubscribers(): Promise<{ email: string }[]> {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G38). `newsletter_subscribers` has no `business_id`
  // column: this is ONE list for every business. The public subscribe route
  // resolves the Host's business and then writes here anyway, so someone who
  // subscribed on a coach's host is on the platform's list. See the shelf in
  // lib/tenancy/platform.ts.
  //
  // Paginated
```

`lib/db/newsletter.ts`, `getAllSubscribers`. Before:
```ts
export async function getAllSubscribers(): Promise<Subscriber[]> {
  const supabase = getClient()
  // Paginated
```
After:
```ts
export async function getAllSubscribers(): Promise<Subscriber[]> {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G38): `newsletter_subscribers` has no `business_id`
  // column, so /admin/newsletter/subscribers lists every business's
  // subscribers to anyone holding `blog`. See `getActiveSubscribers`.
  //
  // Paginated
```

`lib/db/legal-documents.ts`. Before:
```ts
export async function getActiveDocument(type: LegalDocumentType) {
  const supabase = getClient()
  const { data, error } = await supabase
```
After:
```ts
export async function getActiveDocument(type: LegalDocumentType) {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G43). `legal_documents` has no `business_id`
  // column, so this is the PLATFORM's document of `type`, and the camp,
  // clinic, event and funnel-form surfaces that resolved another business's
  // Host show it, and record acceptance of it, all the same. Whose waiver a
  // coach's customers should sign is an owner and legal decision, not a
  // predicate to add here. See the shelf in lib/tenancy/platform.ts.
  const { data, error } = await supabase
```

`lib/db/lead-inquiries.ts`. Before:
```ts
export async function getLeadInquiryById(id: string) {
  const supabase = getClient()
```
After:
```ts
export async function getLeadInquiryById(id: string) {
  const supabase = getClient()
  // UNTENANTED BY SCHEMA (G45). `lead_inquiries` has no `business_id` column
  // (the public inquiry route resolves the Host's business, then writes here
  // without it), so this reads any business's inquiry by id. Reaching one
  // needs its UUID, and no list of these rows sits on a grantable surface.
  // See the shelf in lib/tenancy/platform.ts.
```

`lib/automation/campaign-revenue.ts`, in `readCampaignRevenue` (the carve-out's in-place comment). Before:
```ts
  // One read for every source's sessions, not one per source: the same session
  // is commonly all three (somebody landed, asked and bought). Chunked because
  // the id list travels in the query string — see IN_CHUNK.
```
After:
```ts
  // One read for every source's sessions, not one per source: the same session
  // is commonly all three (somebody landed, asked and bought). Chunked because
  // the id list travels in the query string — see IN_CHUNK.
  //
  // NOT on the UNTENANTED BY SCHEMA shelf (lib/tenancy/platform.ts), and
  // correct by construction. `marketing_attribution` has no `business_id`
  // column, but every session id read here came from the three reads above,
  // each filtered on `business_id`, and a session id is one visitor's own
  // cookie — so this returns this business's visitors' rows and no one
  // else's. A new session source that is NOT tenant-filtered would break
  // that; the shelf's preamble names this file for exactly that reason.
```

- [ ] **Step 4: Run it and watch it pass**

`PATH="/Users/aeangabrielletayawa/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/tenancy/platform-inventory.test.ts __tests__/lib/tenancy/public-inventory.test.ts __tests__/lib/lead-engine/no-brand-literals.test.ts`

Expected: all pass (27, 4 and 3 on an unmodified base).
- `no-brand-literals.test.ts` is required, not optional. It sweeps the raw text of `lib/db/pipeline.ts`, `lib/automation/campaign-revenue.ts` and `app/(admin)/admin/pipeline/page.tsx`, comments included, for `DJP Athlete`, `Darren` and `darrenjpaul.com`. The new comments contain none of them.
- `public-inventory.test.ts` confirms that the `resolvePublicTenant` mention in the new marketing-attribution docstring is read as a comment, not as a caller.

Other suites that import or mock a changed module: every change here is a comment, so none needs an edit, and a run only confirms that the files still parse.
- `@/lib/db/programs`: `__tests__/api/funnels/checkout-route.test.ts`, `__tests__/lib/funnels/preview-render.test.ts`, `__tests__/app/api/admin/funnels/{build-route,build-route-render,publish-route,funnel-publish-route}.test.ts`, `__tests__/app/funnel-draft-preview-page.test.tsx`, `__tests__/components/admin/funnel-publish-actions.test.ts`, `__tests__/lib/services/{assign-program,attendance-program-advance,client-packs-view,my-packs-view,resync-week-access}.test.ts`, `__tests__/lib/analytics/sections/coaching-weekly.test.ts`, the `__tests__/api/stripe/webhook-*.test.ts` family, `__tests__/api/webhooks/{pipeline-hooks,sequence-exit-hooks}.test.ts`, `__tests__/api/spine/purchase-spine.test.ts`
- `@/lib/db/assignments`: the same stripe, spine and services families, plus `__tests__/api/admin/generate-week-equipment-override.test.ts`, `__tests__/api/admin/sessions/slot-link.test.ts`, `__tests__/api/session-packs/checkout-program.test.ts`, `__tests__/lib/profile-share-data.test.ts`, `__tests__/lib/services/{access-guard,program-progression.orchestration}.test.ts`
- `@/lib/db/users`: 42 suites, led by the stripe webhook, spine, billing and pack-renewal families; comment-only.
- `@/lib/db/pipeline`: `__tests__/db/pipeline.test.ts`, `__tests__/app/admin/pipeline-page-tenancy.test.tsx`, `__tests__/app/api/admin/pipeline/{grant-route,boards-route,stages-route}.test.ts`, `__tests__/lib/bookings/{ingest,ingest-tenancy}.test.ts`, `__tests__/lib/db/coach-scoped-reads.test.ts`, and others.
- `@/lib/db/marketing-attribution`: `__tests__/lib/db/marketing-attribution-find.test.ts`, `__tests__/lib/db/marketing-attribution-claim.test.ts`, `__tests__/api/public/attribution/track.test.ts`, `__tests__/lib/bookings/{ingest,ingest-tenancy}.test.ts`, and others.
- `@/lib/bookings/ingest`: `__tests__/lib/bookings/{ingest,ingest-tenancy}.test.ts`, `__tests__/api/webhooks/{calendly-booking,calendly-tenant-resolution}.test.ts`
- `@/lib/db/newsletter`: `__tests__/api/newsletter/{tenant,attribution-capture,unsubscribe-reaches-the-engine}.test.ts`, `__tests__/api/spine/newsletter-spine.test.ts`, `__tests__/lib/analytics/sections/{funnel-weekly,revenue-funnel-daily}.test.ts`, `__tests__/lib/email-missing-key.test.ts`
- `@/lib/db/legal-documents`: `__tests__/app/marketing/camps-clinics-tenancy.test.tsx`, `__tests__/components/funnels/form-island-sms-consent.test.tsx`, `__tests__/api/events/{checkout,signup}.test.ts`, `__tests__/lib/events/checkout.test.ts`, `__tests__/api/spine/event-signup-spine.test.ts`, `__tests__/api/auth/register-links-contact.test.ts`
- `@/lib/db/lead-inquiries`: `__tests__/lib/db/{lead-inquiries,lead-inquiries-schema-tolerance}.test.ts`, `__tests__/api/inquiry/attribution-capture.test.ts`, `__tests__/api/spine/{inquiry-pipeline,inquiry-spine}.test.ts`
- `@/lib/automation/campaign-revenue`: `__tests__/lib/automation/campaign-revenue.test.ts`, `__tests__/app/admin/campaign-revenue-page.test.tsx`
- `@/lib/funnels/sections/resolve`: `__tests__/lib/funnels/sections/resolve.test.ts`, `__tests__/lib/funnels/load-catalogues-tenancy.test.ts`, `__tests__/api/funnels/{offers-route,ai-plan-route}.test.ts`
- No suite covers `app/api/admin/programs/copy-sources/route.ts`.

Do not run `prettier --write` on the six Task 12 files that were already unformatted before this branch: `lib/db/programs.ts`, `lib/db/pipeline.ts`, `lib/db/marketing-attribution.ts`, `lib/bookings/ingest.ts`, `lib/db/newsletter.ts` and `lib/db/lead-inquiries.ts`. It would churn lines this task does not own.

- [ ] **Step 5: Commit**

`git add __tests__/helpers/untenanted-by-schema.ts __tests__/lib/tenancy/platform-inventory.test.ts lib/db/programs.ts lib/db/assignments.ts app/api/admin/programs/copy-sources/route.ts lib/db/users.ts lib/db/pipeline.ts "app/(admin)/admin/pipeline/page.tsx" lib/funnels/sections/resolve.ts app/api/funnels/checkout/route.ts lib/db/marketing-attribution.ts lib/bookings/ingest.ts lib/db/newsletter.ts lib/db/legal-documents.ts lib/db/lead-inquiries.ts lib/automation/campaign-revenue.ts`

`git commit -m "docs(tenancy): say at every untenanted read that its table has no business_id (G35 §D3)" -m "The shelf in lib/tenancy/platform.ts is one place to look. The read is where someone about to 'just add a predicate' is standing. Every shelf read now says in place that its table has no business_id and which ledger row owns it, and the inventory test fails for any entry without that note, so a new entry cannot skip it." -m "Four comments argued the opposite and are corrected. The pipeline page called its programme list 'nothing to scope'. findAttributionForContact argued from phase 4 and from user_id never being shared across businesses; linkContactsToUser shares it by design. The booking ingest said nothing writes contacts.user_id; G04 gave it three writers. The campaign-revenue attribution read, correct by construction, now says so where it reads."`

---


### Task 13: Close G35 in the ledger and record rows G36-G45

**Files:**
- Modify: `docs/lead-engine-gaps-to-ship-2026-09-19.md` (the G35 row; a new "Found by G35's sweep" group after it; the phase table; the NOT FINISHED table; the one-screen headline; the scoreboard; "Everything still waiting on the owner"; "Next unblocked")

**Interfaces:**
- Consumes: the commits of Tasks 1-12 (their SHAs go in the row); the spec's Section E.
- Produces: nothing code depends on.

- [ ] **Step 1: Re-measure before writing.** Run `git log --oneline main..HEAD` and record every task commit. Re-read the spec's Section E. The ledger's own rule: a row's status lives in several places; edit all of them.

- [ ] **Step 2: Close the G35 row.** Change its header to `### G35 · Readers with no tenant predicate · **S → M** · **BUILT 2026-09-25**` and append bullets, in the ledger's voice, covering:
  - the sweep (197 read sites on the 38 tenanted tables, 41 without a predicate, most safe by construction), the critic's untenanted-behind-a-permission class, and that production has one business so every item was a fuse;
  - the owner's four rulings (scope; show nothing; agent alerts to owners; bell alerts to owner+coach);
  - what was built, one line per spec section A1-A5, B1-B4, C1-C4, D1-D3, each with its commit SHA;
  - replace the row's "Carries one owner question" bullet with the answer (owners, in-app; `KNOWN_REFUSED`'s two `profiles` entries deleted);
  - the stale example the row carried: suppressions were already per-business (`contact_suppressions_uniq` is `UNIQUE (business_id, identifier)`, `isSuppressed` filters), so only `hasConsent` needed the predicate;
  - Verified: the numbers from Task 14 (fill after Task 14; do not write numbers before they are measured).

- [ ] **Step 3: Add the new rows after G35**, under `#### Found by G35's sweep (2026-09-25) — recorded, not built`, one `### G3x · title · **size** · **decision/owner**` block each, copying the substance of spec Section E verbatim-in-meaning with its evidence (file:line) and, where it needs one, the owner's question as a bold "Question:" line: G36 grantable staff surfaces (admin AI chat headline), G37 programmes/assignments/clients shared, G38 one newsletter list, G39 ads subsystem mixes businesses, G40 funnel checkout sells any programme, G41 critic's attribution filter + select contract blind to filters, G42 `marketing_attribution` has no tenant, G43 every business's customers accept the platform's waiver, G44 schema guards, G45 small ownership checks.

- [ ] **Step 4: Update every status place.**
  - Phase table: Phase 4's gaps cell becomes `~~G30~~, ~~G31~~, G32, ~~G33~~, ~~G35~~` and its size `M` (G32 only), and add a row `| 4b — found by G35's sweep | G36-G45 | decisions + S/M rows |`.
  - NOT FINISHED table: remove G35; add G36-G45 with their size and "why open" (decision / not started).
  - One-screen headline: `**35 of 47 rows are finished …  12 are not.**` (37 + 10 new = 47; done 34 + G35 = 35).
  - Scoreboard: `47 rows · 35 done · 12 open`, add `**G35**` to Done, Open becomes `G32 G34 G36 G37 G38 G39 G40 G41 G42 G43 G44 G45`.
  - "Everything still waiting on the owner": remove the answered agent-alert question; add one line each for G36, G37, G38, G39, G42, G43.
  - "Next unblocked": G32 (M), then the S rows G40, G41, G45 that need no owner.
  - Recount after editing: `grep -c "^### G" docs/lead-engine-gaps-to-ship-2026-09-19.md` must agree with the headline's row count (subtract lettered sub-rows as the ledger counts them: G19b and G30b are rows).

- [ ] **Step 5: Commit**

```bash
git add docs/lead-engine-gaps-to-ship-2026-09-19.md
git commit -m "docs(lead-engine): close G35 and record the ten rows its sweep found

G35 swept every read of the 38 tenanted tables and every untenanted table
behind a grantable permission. The readers where the tenant was in hand are
fixed; the rest are recorded as G36-G45 with the owner's questions, because
each is a scoping decision, not a bug fix."
```

### Task 14: Verify the whole branch, drive it in the real app, and review it

**Files:**
- Create: `scripts/capture-g35-untenanted-screenshots.mjs`, `screenshots/g35-untenanted-readers/*.png`, `screenshots/g35-untenanted-readers/README.html`
- Modify: `docs/lead-engine-gaps-to-ship-2026-09-19.md` (the G35 row's Verified bullet)

**Interfaces:**
- Consumes: every task above.
- Produces: the measured numbers for the ledger; the screenshots.

- [ ] **Step 1: Targeted suites.** Collect every test file that imports or mocks a module changed on the branch:
  `git diff --name-only main..HEAD` → for each changed `lib/`, `app/`, `components/` module, `grep -rlE '(from|import\()\s*"@/<module>"' __tests__` and `grep -rl 'vi.mock("@/<module>"' __tests__`; dedupe; exclude `__tests__/integration/chat-live.test.ts` (live model lane). Run them in one `npx vitest run <files…>` call with Node 24. Expected: all pass. A failure is ours until a control run at `main` fails the same way.

- [ ] **Step 2: Functions suites.** `PATH=… npm --prefix functions test -- <every functions/src/__tests__ file touched or importing a touched module>`. Expected: pass. Also `PATH=… npx --prefix functions tsc --noEmit -p functions` exits 0.

- [ ] **Step 3: Gates.**
  - `PATH=… npx tsc --noEmit -p tsconfig.json > <scratchpad>/tsc-g35.txt` then compare the per-file error counts with the baseline (sort + diff): expect IDENTICAL, 238 / 54.
  - `PATH=… npm run build` exit 0 (run with no dev server using this worktree's `.next`).
  - `PATH=… npm run test:integration:selects`: pass, with the two `profiles` entries gone and the shelf column probes in.
  - `git grep -l SINGLETON_BUSINESS_ID HEAD -- '*.ts' '*.tsx' | sed "s/^HEAD://" | grep -v '^__tests__/\|/__tests__/\|^scripts/' | wc -l` → 5.
  - `npm run lint` is broken repo-wide (`next lint` removed in Next 16): skip and say so.

- [ ] **Step 4: Drive it in the real app on the dev clone** (never production). Start `npx next dev --port 3063` with output to a scratchpad log. Chromium with `--host-resolver-rules=MAP phase4-coach.test 127.0.0.1` reaches the second business's host (`phase4-coach.test` → business `82d5b238-1653-4a04-9d2d-2f65e5a8c225`, per `business_domains`). Capture, annotated with `scripts/_annotate-lib.mjs` (markers in raw pixels from `boundingBox × deviceScaleFactor`, pointer parked, dev badge hidden with `nextjs-portal { display:none }`), light only (admin has no dark mode):
  1. `/ask` on `phase4-coach.test`, asking "What do your clients say about you?": the reply must not quote a platform testimonial or name Darren; the tool result is empty. Control: the same question on `localhost` (platform) quotes testimonials.
  2. A draft funnel owned by the second business with a live FAQ section, opened in `/preview` as the operator with the `djp_business` cookie set to that business: the preview banner shows the new blocker wording and the FAQ island renders nothing. Create the draft through the admin API and DELETE it at the end (additive and reversed; dev clone only; say so in the script header). Control: a platform funnel with the same section renders its FAQs.
  Write `README.html` (house pattern, see `screenshots/g33-sms-sender-phone/README.html`) naming what each shot shows and anything not captured, and why.

- [ ] **Step 5: Whole-branch review.** Run a multi-lens review workflow over `main..HEAD` (lenses: tenancy correctness of every changed reader; the seam inventories and their tests; functions/deploy-order behaviour; test quality incl. vacuous passes and mocks that invent shapes; ledger/spec honesty), each lens followed by an adversarial verifier. Fix every confirmed finding with its own test, re-run the affected suites, and record the review's outcome in the G35 row.

- [ ] **Step 6: Record and commit.** Fill the G35 row's Verified bullet with the measured numbers (suite files/tests, functions suites, tsc, build, selects, SINGLETON count, screenshots, review findings). Commit the screenshots, the capture script and the ledger.

```bash
git add scripts/capture-g35-untenanted-screenshots.mjs screenshots/g35-untenanted-readers docs/lead-engine-gaps-to-ship-2026-09-19.md
git commit -m "test(g35): drive the second business's chat and funnel in the real app, and record the gates"
```

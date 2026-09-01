# Lead Engine — the last mile: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a provider-side misconfiguration cost a deferred retry instead of a destroyed campaign, repair the 73 runs the last one destroyed, and close the two remaining Lead Engine builds.

**Architecture:** The sequence tick already owns a defer-with-backoff mechanism (`transientBackoffMs`, `MAX_ATTEMPTS`) reached from `runSequenceTick`'s per-run catch. The email send path bypasses it: its inner `try` swallows every provider throw into `markFailed` + `failRun`, which is terminal because `recordSend` will not re-claim a `failed` message row. The fix routes *configuration* faults into the mechanism that already exists, leaving the message row `queued` so `recordSend`'s crashed-attempt path recovers it. Recipient faults keep today's terminal behaviour.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (service-role DAL in `lib/db/`), Resend, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-01-lead-engine-last-mile-design.md](../specs/2026-09-01-lead-engine-last-mile-design.md)

## Global Constraints

- **Branch:** `feat/lead-engine-last-mile`. Do not push to `main`; do not deploy.
- **Nothing touches production.** No flag flips, no `business_settings` writes, no running the repair script against prod. Everything is staged for a human.
- **Baselines:** `tsc --noEmit` sits at exactly **251** errors. A falling count hides new errors as surely as a rising one — compare, don't eyeball. Fifteen tests are red on `main` across five suites, inherited; do not attribute them to this work.
- **Targeted tests only** — `npx vitest run <path>`. Not the full suite. A build (`npm run build`) is the separate "did I break compilation" gate.
- **`npm run lint` does not work at all** (Next 16 removed `next lint`). Do not try it.
- **Migration numbers collide silently.** The highest applied is `00234_attendance_arrangements.sql`. Take `00235`.
- **No Claude attribution** in commit messages.
- **Every mutation must be run, not reasoned about.** A comment edit is not a mutation.

---

### Task 1: The provider error keeps its shape, and a fault gets a class

Today `sendRenderedSequenceEmail` throws `new Error("sendSequenceEmail failed: " + error.message)` and discards Resend's `name` and `statusCode`. Nothing downstream can tell an unverified domain from a bad mailbox, because the only surviving evidence is prose.

**Files:**
- Modify: `lib/lead-engine/email.ts` (add `SequenceSendError`, `classifySendFault`; change the throw at ~line 372)
- Test: `__tests__/lib/lead-engine/send-fault-classification.test.ts` (create)

**Interfaces:**
- Produces: `class SequenceSendError extends Error { providerErrorName: string | null; statusCode: number | null }`
- Produces: `function classifySendFault(err: unknown): "configuration" | "recipient"`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
//
// The fault classes in lib/lead-engine/email.ts. The DEFAULT IS
// "configuration", and that direction is deliberate: an unrecognised error
// costs five deferred retries (MAX_ATTEMPTS), while the old default
// permanently destroyed every claimed run — which is what happened to all 73
// sms_repermission runs on 2026-08-31.
import { describe, it, expect } from "vitest"
import { SequenceSendError, classifySendFault } from "@/lib/lead-engine/email"

describe("classifySendFault", () => {
  it("calls the unverified-domain rejection a configuration fault", () => {
    // The verbatim message production returned on 2026-08-31.
    const err = new SequenceSendError(
      "sendSequenceEmail failed: The darrenjpaul.com domain is not verified. Please, add and verify your domain on https://resend.com/domains",
      { providerErrorName: "validation_error", statusCode: 403 },
    )
    expect(classifySendFault(err)).toBe("configuration")
  })

  it("calls a named bad recipient a recipient fault", () => {
    const err = new SequenceSendError("sendSequenceEmail failed: Invalid `to` field.", {
      providerErrorName: "invalid_to_address",
      statusCode: 422,
    })
    expect(classifySendFault(err)).toBe("recipient")
  })

  it("defaults an unrecognised error to configuration", () => {
    expect(classifySendFault(new Error("something nobody has seen before"))).toBe("configuration")
  })

  it("treats a rate limit as configuration, not as the recipient's fault", () => {
    const err = new SequenceSendError("sendSequenceEmail failed: Too many requests.", {
      providerErrorName: "rate_limit_exceeded",
      statusCode: 429,
    })
    expect(classifySendFault(err)).toBe("configuration")
  })
})

describe("SequenceSendError", () => {
  it("keeps the message format callers already match on", () => {
    const err = new SequenceSendError("sendSequenceEmail failed: boom", {
      providerErrorName: null,
      statusCode: null,
    })
    expect(err.message).toBe("sendSequenceEmail failed: boom")
    expect(err).toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/lead-engine/send-fault-classification.test.ts`
Expected: FAIL — `SequenceSendError` and `classifySendFault` are not exported from `@/lib/lead-engine/email`.

- [ ] **Step 3: Write the implementation**

In `lib/lead-engine/email.ts`, beside `BusinessNotConfiguredError`:

```ts
/**
 * A provider rejection that KEEPS ITS SHAPE.
 *
 * `sendRenderedSequenceEmail` used to throw a bare Error carrying only
 * `error.message`, so every caller downstream saw prose and nothing else.
 * `classifySendFault` cannot tell an unverified sending domain from an
 * undeliverable mailbox out of prose, and on 2026-08-31 that cost all 73
 * `sms_repermission` runs — a settings-field typo was handled as if 73
 * separate mailboxes had each refused.
 *
 * The message format is UNCHANGED (`sendSequenceEmail failed: …`) because
 * `last_error` strings already in the database, and tests, match on it.
 */
export class SequenceSendError extends Error {
  readonly providerErrorName: string | null
  readonly statusCode: number | null

  constructor(message: string, meta: { providerErrorName: string | null; statusCode: number | null }) {
    super(message)
    this.name = "SequenceSendError"
    this.providerErrorName = meta.providerErrorName
    this.statusCode = meta.statusCode
  }
}

/**
 * Faults that belong to THIS RECIPIENT and will fail again identically on a
 * retry. Deliberately a short list: see `classifySendFault` for why the
 * absent cases are the safe ones.
 */
const RECIPIENT_FAULT_NAMES = new Set(["invalid_to_address", "invalid_recipient"])

/**
 * Which kind of fault is this — the configuration's, or the recipient's?
 *
 * *** THE DEFAULT IS "configuration", AND THAT IS THE WHOLE POINT. ***
 *
 * A configuration fault (unverified domain, revoked key, suspended account,
 * exhausted quota, provider 5xx) fails every run in the batch identically and
 * self-heals the moment the configuration changes. A recipient fault belongs
 * to one address and will fail the same way forever.
 *
 * Getting this backwards is not symmetric. Classifying a recipient fault as
 * configuration costs five deferred retries and then fails terminally anyway,
 * because `MAX_ATTEMPTS` bounds it. Classifying a configuration fault as a
 * recipient fault destroys the campaign: `recordSend` will not re-claim a
 * `failed` message row, so those runs have no way back in without a hand-run
 * database repair. That is the 31 August failure exactly.
 *
 * So the recipient list is short and explicit, and everything unrecognised —
 * including every error Resend has not shipped yet — takes the bounded path.
 */
export function classifySendFault(err: unknown): "configuration" | "recipient" {
  if (!(err instanceof SequenceSendError)) return "configuration"
  if (err.providerErrorName && RECIPIENT_FAULT_NAMES.has(err.providerErrorName)) return "recipient"
  // 422 is Resend's "we understood the request and refused this value". It is
  // the recipient's only when the value it refused IS the recipient — a 422
  // naming the `from` address is a configuration fault wearing the same code.
  if (err.statusCode === 422 && /\bto\b|recipient/i.test(err.message)) return "recipient"
  return "configuration"
}
```

Then change the throw in `sendRenderedSequenceEmail` (it currently reads `throw new Error(...)`):

```ts
  if (error) {
    // The shape is preserved, not just the sentence — see SequenceSendError.
    const meta = error as { name?: string; statusCode?: number }
    throw new SequenceSendError(`sendSequenceEmail failed: ${error.message}`, {
      providerErrorName: meta.name ?? null,
      statusCode: meta.statusCode ?? null,
    })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/lead-engine/send-fault-classification.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the neighbouring suite to prove the message format did not move**

Run: `npx vitest run __tests__/lib/lead-engine/email.test.ts`
Expected: PASS, unchanged count.

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/email.ts __tests__/lib/lead-engine/send-fault-classification.test.ts
git commit -m "feat(lead-engine): a provider rejection keeps its shape, and gets a class"
```

---

### Task 2: A configuration fault defers the run instead of burning it

**Files:**
- Modify: `lib/automation/sequence-tick-runner.ts` (the email branch's catch at ~line 451; the per-run catch at ~line 632)
- Test: `__tests__/lib/automation/sequence-tick-send-faults.test.ts` (create)

**Interfaces:**
- Consumes: `classifySendFault`, `SequenceSendError` from Task 1.
- Produces: `const CONFIG_FAULT_MIN_DEFER_MS = 20 * 60 * 1000` (module-private).

- [ ] **Step 1: Write the failing test**

Copy the harness header, mocks and fixtures verbatim from
`__tests__/lib/automation/sequence-tick-email-env.test.ts` lines 26–175 (the
`resend`-package mock, the `@/lib/db/sequences` mock, `SETTINGS`, `makeRun`,
`EMAIL_STEP`, `sendableContext`, `beforeEach`). Mocking at the `resend`
package boundary keeps `sendRenderedSequenceEmail` and `classifySendFault`
real, which is the point: the classification is exercised through the actual
throw site.

Then:

```ts
describe("a configuration fault", () => {
  it("defers the run and leaves the message row queued", async () => {
    // Resend's own shape for the 31 August failure.
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: "The darrenjpaul.com domain is not verified." },
    })
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    // The row stays claimable. markFailed is what makes a run unrecoverable,
    // because recordSend refuses to re-claim a `failed` row.
    expect(markFailed).not.toHaveBeenCalled()
    expect(failRun).not.toHaveBeenCalled()
    expect(deferRun).toHaveBeenCalledTimes(1)
    expect(summary.config_faults).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it("defers past recordSend's 15-minute reclaim window", async () => {
    // A shorter defer bounces on `send_in_progress`: recordSend sees its own
    // queued row as too young to re-claim and hands back claimed:false.
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: "The darrenjpaul.com domain is not verified." },
    })
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("run-1", { attempts: 1 })])

    const before = Date.now()
    await runSequenceTick()

    const until = (deferRun as ReturnType<typeof vi.fn>).mock.calls[0][1] as Date
    expect(until.getTime() - before).toBeGreaterThan(15 * 60 * 1000)
  })

  it("still fails terminally once attempts are exhausted", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: "The darrenjpaul.com domain is not verified." },
    })
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("run-1", { attempts: 5 })])

    const summary = await runSequenceTick()

    expect(deferRun).not.toHaveBeenCalled()
    expect(failRun).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(1)
  })
})

describe("a recipient fault", () => {
  it("still fails the run terminally, exactly as before", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "invalid_to_address", statusCode: 422, message: "Invalid `to` field." },
    })
    ;(claimDueRuns as ReturnType<typeof vi.fn>).mockResolvedValue([makeRun("run-1")])

    const summary = await runSequenceTick()

    expect(markFailed).toHaveBeenCalledTimes(1)
    expect(failRun).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(1)
    expect(summary.config_faults ?? 0).toBe(0)
  })
})
```

Both directions get their own test on purpose: one test that passes whichever
way the branch goes pins neither.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/automation/sequence-tick-send-faults.test.ts`
Expected: FAIL — `markFailed` is called, `summary.config_faults` is undefined.

- [ ] **Step 3: Implement**

In `lib/automation/sequence-tick-runner.ts`, add the import and constant:

```ts
import { classifySendFault, SequenceSendError } from "@/lib/lead-engine/email"

/**
 * The floor on a configuration fault's defer, and it is NOT a tuning knob.
 *
 * `recordSend` re-claims a crashed attempt only once the queued row is older
 * than `RECLAIM_WINDOW_MS` (15 minutes, lib/db/sequences.ts). A retry that
 * lands inside that window finds its own row too young, gets claimed:false,
 * and burns a tick deferring on `send_in_progress`. 20 > 15 with room for
 * clock skew between the tick and the database.
 */
const CONFIG_FAULT_MIN_DEFER_MS = 20 * 60 * 1000
```

Replace the email branch's catch (currently `markFailed` + `failRun` + `summary.failed += 1` + `return`):

```ts
      } catch (err) {
        // WHICH FAULT IS THIS? A recipient's, or the configuration's?
        //
        // A recipient fault is the case this catch was written for: nothing
        // was delivered and nothing will be, so the message row is genuinely
        // failed. failRun rather than a retry is deliberate — recordSend will
        // not re-claim a row in status 'failed', so a retried run would
        // deadlock on `send_in_progress` forever.
        //
        // A CONFIGURATION fault is the opposite case and used to be handled
        // as if it were this one. It fails every run in the batch identically
        // and self-heals the moment the setting changes — so the row is left
        // `queued`, which is simply true (nothing was delivered), and the
        // throw is re-raised for runSequenceTick's per-run catch to defer
        // with the backoff that already exists. recordSend's crashed-attempt
        // path then re-claims the row once the reclaim window passes.
        //
        // This is what all 73 sms_repermission runs needed on 2026-08-31 and
        // did not get.
        if (classifySendFault(err) === "configuration") throw err

        const message = err instanceof Error ? err.message : String(err)
        await markFailed(messageId as string, message)
        await failRun(run.id, message)
        summary.failed += 1
        return
      }
```

In the per-run catch, replace the `if (retryable)` defer line:

```ts
        if (retryable) {
          const isConfigFault = err instanceof SequenceSendError && classifySendFault(err) === "configuration"
          const backoffMs = isConfigFault
            ? Math.max(transientBackoffMs(attempts), CONFIG_FAULT_MIN_DEFER_MS)
            : transientBackoffMs(attempts)
          await deferRun(run.id, new Date(now.getTime() + backoffMs), TRANSIENT_ERROR_DEFER_REASON)
          summary.deferred += 1
          if (isConfigFault) summary.config_faults = (summary.config_faults ?? 0) + 1
        } else {
```

Add to `TickSummary`:

```ts
  /**
   * Runs deferred because the PROVIDER was misconfigured, not because
   * anything about the contact was wrong. Counted separately from `deferred`
   * because it is the one deferral that means a human must act: it will
   * repeat every tick until somebody fixes the setting, and after
   * MAX_ATTEMPTS it starts failing runs for real. The tick reports itself
   * failed when this is non-zero — see the route.
   */
  config_faults?: number
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/automation/sequence-tick-send-faults.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run every neighbouring tick suite — this file has four**

Run: `npx vitest run __tests__/lib/automation/sequence-tick.test.ts __tests__/lib/automation/sequence-tick-sms.test.ts __tests__/lib/automation/sequence-tick-email-env.test.ts __tests__/lib/automation/sequence-tick-origin.test.ts`
Expected: PASS, unchanged counts.

- [ ] **Step 6: Mutate to prove the tests bite**

Apply each, run the suite, confirm RED, revert:
1. Change `classifySendFault(err) === "configuration"` to `=== "recipient"` — the configuration tests must fail.
2. Change `CONFIG_FAULT_MIN_DEFER_MS` to `1000` — the reclaim-window test must fail.
3. Delete the `if (isConfigFault)` count line — the `config_faults` assertion must fail.

Commit before mutating: a mutation harness built on `git checkout --` is only safe on a committed tree.

- [ ] **Step 7: Commit**

```bash
git add lib/automation/sequence-tick-runner.ts __tests__/lib/automation/sequence-tick-send-faults.test.ts
git commit -m "fix(lead-engine): a misconfigured provider defers the run, it does not destroy it"
```

---

### Task 3: A blocked tick is a failed tick

A silent defer is a worse bug than a loud failure: if all 73 had quietly deferred, nobody would have known either.

**Files:**
- Modify: `app/api/admin/internal/sequence-tick/route.ts`
- Test: `__tests__/api/admin/internal/sequence-tick.test.ts` (extend if present; create if not)

- [ ] **Step 1: Write the failing test**

```ts
it("reports the tick failed when the provider was misconfigured", async () => {
  ;(runSequenceTick as ReturnType<typeof vi.fn>).mockResolvedValue({
    claimed: 3, sent: 2, deferred: 1, exited: 0, completed: 0, failed: 0, config_faults: 1,
  })

  await POST(authorizedRequest())

  // A batch half-blocked by a provider misconfiguration is not a healthy
  // tick, even though two messages went out.
  expect(logCronEnd).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    "failed",
    expect.objectContaining({ message: expect.stringContaining("1 configuration fault") }),
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/admin/internal/sequence-tick.test.ts`
Expected: FAIL — the route ends the cron run `ok`.

- [ ] **Step 3: Implement**

After the `runSequenceTick` call, before the existing success `logCronEnd`:

```ts
    // A configuration fault is invisible from the outside: the runs defer,
    // the tick returns 200, and nothing sends — which is the 31 August
    // failure mode wearing a quieter face. Reporting the tick FAILED puts it
    // in front of automation-health-scanner (daily 08:00 UTC, emails on
    // critical), which already lists this cron. Note the message carries the
    // provider's own sentence: a cron reason of "[object Object]" is a
    // failure nobody can act on.
    if ((summary.config_faults ?? 0) > 0) {
      await logCronEnd(supabase, runId, "failed", {
        message: `${summary.config_faults} configuration fault(s): the email provider rejected every attempt. Nothing sent; runs deferred, not lost.`,
        ...summary,
      })
      return NextResponse.json(summary)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/admin/internal/sequence-tick.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/internal/sequence-tick/route.ts __tests__/api/admin/internal/sequence-tick.test.ts
git commit -m "fix(lead-engine): a tick blocked by the provider reports itself failed"
```

---

### Task 4: Placeholder copy cannot go live

All four `quiz_*` sequences carry `PLACEHOLDER COPY — not reviewed. Do not activate this sequence until this line is gone.` The marker is an honour system, one SQL `UPDATE` from mailing placeholder text to an athlete who was just told something personal about their body.

**Files:**
- Create: `lib/lead-engine/placeholder-guard.ts`
- Test: `__tests__/lib/lead-engine/placeholder-guard.test.ts`

**Interfaces:**
- Produces: `const PLACEHOLDER_MARKER = "PLACEHOLDER COPY"`
- Produces: `function findLivePlaceholders(rows: Array<{ key: string; status: string; body: string | null }>): string[]` — returns the keys of sequences that are `active` and still carry the marker.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { findLivePlaceholders, PLACEHOLDER_MARKER } from "@/lib/lead-engine/placeholder-guard"

const PLACEHOLDER_BODY = `${PLACEHOLDER_MARKER} — not reviewed. Do not activate this sequence until this line is gone.\n\nHi {{name}}`

describe("findLivePlaceholders", () => {
  it("names an active sequence still carrying the marker", () => {
    expect(
      findLivePlaceholders([{ key: "quiz_rebuilder", status: "active", body: PLACEHOLDER_BODY }]),
    ).toEqual(["quiz_rebuilder"])
  })

  it("leaves a draft sequence alone — that is where placeholder copy belongs", () => {
    expect(
      findLivePlaceholders([{ key: "quiz_rebuilder", status: "draft", body: PLACEHOLDER_BODY }]),
    ).toEqual([])
  })

  // The presence control: without it, a green result proves nothing about
  // whether the function looked at anything at all.
  it("passes real copy that happens to be active", () => {
    expect(
      findLivePlaceholders([{ key: "new_lead_nurture", status: "active", body: "Hi {{name}}, welcome." }]),
    ).toEqual([])
  })

  it("names every offender, not just the first", () => {
    expect(
      findLivePlaceholders([
        { key: "quiz_rebuilder", status: "active", body: PLACEHOLDER_BODY },
        { key: "quiz_parent_coach", status: "active", body: PLACEHOLDER_BODY },
      ]),
    ).toEqual(["quiz_rebuilder", "quiz_parent_coach"])
  })

  it("does not trip over a null body", () => {
    expect(findLivePlaceholders([{ key: "wait_only", status: "active", body: null }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/lead-engine/placeholder-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/lead-engine/placeholder-guard.ts — the one thing standing between
// unreviewed copy and a real athlete's inbox.
//
// The four quiz_* sequences were seeded with bodies that open
// "PLACEHOLDER COPY — not reviewed. Do not activate this sequence until this
// line is gone." That instruction is addressed to a human, and a human is
// exactly who will be in a hurry. Activating a sequence is one UPDATE.
//
// This is pure so it can be asserted in the test suite, where it fails at
// build time while someone can still fix it, rather than at 8am on a Tuesday
// when the tick claims the run.

export const PLACEHOLDER_MARKER = "PLACEHOLDER COPY"

/**
 * Keys of sequences that are live AND still carry the marker.
 *
 * Order follows the input, so the caller's error message lists them in a
 * stable order rather than whatever the database felt like returning.
 */
export function findLivePlaceholders(
  rows: Array<{ key: string; status: string; body: string | null }>,
): string[] {
  return rows
    .filter((row) => row.status === "active" && (row.body ?? "").includes(PLACEHOLDER_MARKER))
    .map((row) => row.key)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/lead-engine/placeholder-guard.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/lead-engine/placeholder-guard.ts __tests__/lib/lead-engine/placeholder-guard.test.ts
git commit -m "feat(lead-engine): unreviewed copy cannot be live"
```

---

### Task 5: Repair the 73

They cannot be re-enrolled — `enrolContactManually` returns `already_enrolled_once` for a contact whose run exists and is not active, which is correct and must not be weakened for a one-off repair.

**Files:**
- Create: `scripts/repair-failed-sequence-runs.mjs`
- Create: `scripts/_repair-failed-sequence-runs-lib.mjs` (the pure half)
- Test: `__tests__/scripts/repair-failed-sequence-runs.test.ts`

**Interfaces:**
- Produces: `function selectRepairable(runs, { sequenceKey, errorPattern })` — the three-predicate filter, pure and testable without a database.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { selectRepairable } from "../../scripts/_repair-failed-sequence-runs-lib.mjs"

const RUN = {
  id: "run-1",
  status: "failed",
  sequence_key: "sms_repermission",
  last_error: "sendSequenceEmail failed: The darrenjpaul.com domain is not verified.",
}

describe("selectRepairable", () => {
  const args = { sequenceKey: "sms_repermission", errorPattern: "domain is not verified" }

  it("selects a run matching all three predicates", () => {
    expect(selectRepairable([RUN], args).map((r) => r.id)).toEqual(["run-1"])
  })

  // Each predicate gets its own test: a filter with three conditions where
  // only one is ever exercised is a filter with one condition.
  it("skips a run that is not failed", () => {
    expect(selectRepairable([{ ...RUN, status: "active" }], args)).toEqual([])
  })

  it("skips a run belonging to another sequence", () => {
    expect(selectRepairable([{ ...RUN, sequence_key: "new_lead_nurture" }], args)).toEqual([])
  })

  it("skips a run that failed for a different reason", () => {
    expect(selectRepairable([{ ...RUN, last_error: "Invalid `to` field." }], args)).toEqual([])
  })

  it("skips a run with no recorded error rather than assuming it matches", () => {
    expect(selectRepairable([{ ...RUN, last_error: null }], args)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/scripts/repair-failed-sequence-runs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure half**

```js
// scripts/_repair-failed-sequence-runs-lib.mjs — the pure half of the repair,
// split out so the predicate that decides WHICH rows get rewritten can be
// tested without a database in front of it.

/**
 * The three predicates, all required.
 *
 * A repair script's danger is not the write, it is the selection: a filter
 * that quietly widens rewrites rows nobody inspected. All three must match,
 * and a run with no recorded error is SKIPPED rather than assumed to match —
 * "we do not know why this failed" is not the same answer as "it failed for
 * the reason we are repairing", and conflating them is how a repair reaches a
 * run it was never pointed at.
 */
export function selectRepairable(runs, { sequenceKey, errorPattern }) {
  return runs.filter(
    (run) =>
      run.status === "failed" &&
      run.sequence_key === sequenceKey &&
      typeof run.last_error === "string" &&
      run.last_error.includes(errorPattern),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/scripts/repair-failed-sequence-runs.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the runnable script**

`scripts/repair-failed-sequence-runs.mjs`, modelled on
`scripts/configure-lead-engine-sms.mjs`. It MUST:

- Carry the same header invariant: **never run by a session against production — a human runs it, pointed at `.env.prod`.**
- Take `--env <file>`, `--sequence <key>`, `--error-pattern <text>`, `--next-run-at <iso8601>` and `--apply` (absent = dry run, the default).
- **Refuse to run without `--next-run-at`.** There is no default, because the dating of ten-day-old messages is the owner's decision and the script must not make it by omission.
- Print the host it is about to write to, and the count it matched, before doing anything.
- For each matched run, in order: delete its `sequence_messages` rows (deletion, not a status change — `(run_id, step_id)` is uniquely indexed and the dead row is what blocks the re-claim), then update the run to `status='active', attempts=0, current_position=0, last_error=null, next_run_at=<arg>` **guarded by `.eq("status","failed")`** so a row that changed underneath is skipped rather than clobbered.
- Write one `audit_logs` row for the batch and one `contact_timeline_events` row per contact.
- Read the rows back afterwards and print the resulting counts. A write that was not read back is a claim, not a result.

- [ ] **Step 6: Verify the dry run against the DEV clone only**

Run: `node scripts/repair-failed-sequence-runs.mjs --env .env.local --sequence sms_repermission --error-pattern "domain is not verified" --next-run-at 2026-09-02T12:00:00Z`
Expected: prints the dev host, matches 0 rows there, writes nothing. **Do not point it at `.env.prod`.**

- [ ] **Step 7: Commit**

```bash
git add scripts/repair-failed-sequence-runs.mjs scripts/_repair-failed-sequence-runs-lib.mjs __tests__/scripts/repair-failed-sequence-runs.test.ts
git commit -m "feat(lead-engine): a hand-run repair for runs a provider fault destroyed"
```

---

### Task 6: NOT STARTED — surface verified, work is real (status 2026-09-01)

Unlike Task 7 this one **is** implementable as written. Verified tonight:
`components/admin/pipeline-board.tsx` renders the board, a drop into Won POSTs
`/api/admin/pipeline/move`, and `stageKind === "won"` is already a branch in
the card. The grant machinery it reuses is all present.

It was not started because it is a multi-hour build (migration, DAL, pure
logic, route, dialog, tests) and is **not on the critical path** — the engine
sends without it. Start here next session.

### Task 6 (specification): An athlete account when a deal is won

Prompted, never automatic. A Won card can mean a cash deal, a camp, or an unpriced plan, so the safe reading of a dragged card is "ask".

**Files:**
- Create: `supabase/migrations/00235_manual_grant_idempotency.sql`
- Modify: `lib/db/funnel-checkout-grants.ts`
- Create: `lib/funnels/checkout/grant-manual.ts`
- Create: `app/api/admin/opportunities/[id]/grant/route.ts`
- Test: `__tests__/lib/funnels/checkout/grant-manual.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 00235_manual_grant_idempotency.sql
--
-- A grant made by hand from a won pipeline card has no Stripe session, and
-- `funnel_checkout_grants` is keyed on one. Without a key of its own, a
-- double-click or a card dragged out of Won and back mints a second account
-- and a second "set your password" email to somebody who has already set one.
--
-- The two keys are mutually exclusive: a row is either a checkout grant or a
-- manual one, never both, and exactly one of them must be present.
ALTER TABLE public.funnel_checkout_grants
  ALTER COLUMN stripe_session_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS funnel_checkout_grants_opportunity_id_key
  ON public.funnel_checkout_grants (opportunity_id)
  WHERE opportunity_id IS NOT NULL;

ALTER TABLE public.funnel_checkout_grants
  ADD CONSTRAINT funnel_checkout_grants_one_key
  CHECK (num_nonnulls(stripe_session_id, opportunity_id) = 1);
```

- [ ] **Step 2: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { grantWonOpportunity } from "@/lib/funnels/checkout/grant-manual"

const ports = () => ({
  getOpportunity: vi.fn().mockResolvedValue({
    id: "opp-1", outcome: "won", contact_id: "c-1", source_session_id: null,
  }),
  existingGrant: vi.fn().mockResolvedValue(null),
  grantProgram: vi.fn().mockResolvedValue({ userId: "u-1", accountCreated: true }),
  recordGrant: vi.fn().mockResolvedValue(undefined),
})

describe("grantWonOpportunity", () => {
  it("grants once and records the opportunity as the key", async () => {
    const p = ports()
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result.outcome).toBe("granted")
    expect(p.recordGrant).toHaveBeenCalledWith(expect.objectContaining({ opportunity_id: "opp-1" }))
  })

  it("refuses a second grant on the same card", async () => {
    const p = ports()
    p.existingGrant.mockResolvedValue({ opportunity_id: "opp-1", user_id: "u-1" })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result.outcome).toBe("already_granted")
    expect(p.grantProgram).not.toHaveBeenCalled()
  })

  it("refuses a card that reached Won through checkout — it is already provisioned", async () => {
    const p = ports()
    p.getOpportunity.mockResolvedValue({
      id: "opp-1", outcome: "won", contact_id: "c-1", source_session_id: "cs_test_123",
    })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result.outcome).toBe("provisioned_by_checkout")
    expect(p.grantProgram).not.toHaveBeenCalled()
  })

  it("refuses a card that is not won", async () => {
    const p = ports()
    p.getOpportunity.mockResolvedValue({ id: "opp-1", outcome: null, contact_id: "c-1", source_session_id: null })
    const result = await grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)
    expect(result.outcome).toBe("not_won")
    expect(p.grantProgram).not.toHaveBeenCalled()
  })

  it("refuses rather than risking a double grant when the ledger cannot be read", async () => {
    const p = ports()
    p.existingGrant.mockRejectedValue(new Error("ledger unreadable"))
    await expect(grantWonOpportunity({ opportunityId: "opp-1", programId: "prog-1" }, p)).rejects.toThrow()
    expect(p.grantProgram).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/funnels/checkout/grant-manual.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `lib/funnels/checkout/grant-manual.ts`**

Ports-and-adapters, matching `lib/funnels/checkout/deps.ts`. The four refusals
above are the whole of its logic; the granting itself delegates to the port so
the rules stay in `grant.ts`/`grant-program.ts` and cannot drift between the
checkout and manual paths. Do NOT swallow a read failure into `false` — being
unable to check is not permission to risk a double grant, the same posture
`funnel-checkout-grants.ts` already documents.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/funnels/checkout/grant-manual.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Wire the route and the board prompt**

`app/api/admin/opportunities/[id]/grant/route.ts` — admin-gated, wrapped in
`withAudit()`, action slug added to `lib/audit/actions.ts`. The board's Won
transition opens a program picker and calls it. Follow
`components/ui/data-table.tsx` house chrome for any list rendered in the picker.

- [ ] **Step 7: Apply the migration to dev and commit**

Per standing instruction, apply to the dev clone automatically (the applier
carries the `DROP POLICY` guard; never put one in the `.sql`).

```bash
git add supabase/migrations/00235_manual_grant_idempotency.sql lib/funnels/checkout/grant-manual.ts lib/db/funnel-checkout-grants.ts app/api/admin/opportunities lib/audit/actions.ts __tests__/lib/funnels/checkout/grant-manual.test.ts
git commit -m "feat(pipeline): a won deal can hand the athlete their account"
```

---

### Task 7: BLOCKED — the panel cannot reach the data (discovered 2026-09-01)

**Do not attempt this task as written.** It assumes `LeadInquiryPanel` can be
handed the quiz's injury answers. It cannot, and the reason is structural:

- The panel renders only on `/admin/clients/[id]`, which is keyed on a **user**.
- A quiz attempt is keyed on **`contact_id`**.
- The join between them is `contacts.user_id`, which is **null on all 168 rows
  in production**. Nothing writes it — the same inert link the spec lists as
  out of scope in §8, and the reason the pipeline reconciler has never repaired
  a dropped payment webhook.
- `/admin/contacts` is a **list with no detail screen**, so there is no
  contact-keyed surface to put this on either.

So the work is not "add a prop". It is either populating `contacts.user_id`
(a separate, larger job with its own correctness questions about matching
people by email and phone) or building a contact detail screen (not specified,
and a bigger change than the thing it would host).

**Both are the owner's call, not a session's.** Reopen §4 of the spec before
writing any code here.

What remains true from §4 regardless: **no Airtable integration is built, and
none should be.**

### Task 7 (original, retained for when the blocker is resolved): The quiz's injury answers reach the panel

**Files:**
- Modify: `components/admin/clients/LeadInquiryPanel.tsx`
- Test: `__tests__/components/admin/lead-inquiry-panel.test.tsx`

The Athlete Quiz asks two injury questions (positions 50 and 65, the Rebuilder
branch). They are **scored multiple-choice, not narrative**: what a coach gets
is "how recent" and "how confident the cause was addressed" as bands, not "left
ACL, March, still swelling".

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the quiz's injury bands as bands, not as an injury history", () => {
  render(<LeadInquiryPanel leadInquiry={{ injuries: null }} quizInjury={{
    recency: "Within the last month", causeAddressed: "Not confident",
  }} />)
  expect(screen.getByText("Within the last month")).toBeInTheDocument()
  expect(screen.getByText(/from the quiz/i)).toBeInTheDocument()
})

// The presence control. "No quiz section on screen" passes just as well when
// the component rendered nothing at all.
it("omits the quiz section when there are no quiz answers, while still rendering the enquiry text", () => {
  render(<LeadInquiryPanel leadInquiry={{ injuries: "Sore left knee since March" }} quizInjury={null} />)
  expect(screen.getByText("Sore left knee since March")).toBeInTheDocument()
  expect(screen.queryByText(/from the quiz/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/admin/lead-inquiry-panel.test.tsx`
Expected: FAIL — the component takes no `quizInjury` prop.

- [ ] **Step 3: Implement**

Add the optional `quizInjury` prop and a section that renders beneath the
existing "Injuries / Limitations" block, labelled so the source is unambiguous
("From the quiz" + the question wording). Presenting a band as if it were a
history would be worse than showing nothing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/admin/lead-inquiry-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/admin/clients/LeadInquiryPanel.tsx __tests__/components/admin/lead-inquiry-panel.test.tsx
git commit -m "feat(leads): the quiz's injury answers reach the panel a coach reads"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **compare against 251**, and grep the output for the files this branch touched. A count that fell is not automatically good.
- [ ] `npm run build` → exit 0.
- [ ] Re-run every suite this branch touched, in one command, and read the "Test Files"/"Tests" lines — not the Duration lines.
- [ ] Update `JOURNAL.md` (local only — never staged, never committed).

## What must NOT happen

- No push to `main`, no deploy, no Vercel env change.
- No write to production `business_settings`, no flag flip, no running the repair script against `.env.prod`.
- Do not weaken `already_enrolled_once` to make the 73 re-enrollable.
- Do not add an Airtable integration.
- Do not "fix" the 15 inherited red tests or the 251 tsc errors; they are the baseline and changing them hides this branch's own effects.

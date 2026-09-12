# Lead Engine Audit Fixes (2026-09-13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten code defects from `docs/lead-engine-audit-2026-09-13.md` §3–§4 on one branch, each with a test that fails on `main` and passes here.

**Architecture:** Every task is an isolated fix to an existing flow. No new tables, no migrations, no new env vars. Tenant scoping stays as it is (every new reader takes `businessId`). Where a task changes a function's contract, the task lists every caller and the test suites that pin it.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role client via `lib/db/*`), Zod 4, Vitest (Node 24 via `nvm use`; the default shell Node 20 makes vitest throw), Resend SDK 6.x, Twilio webhooks.

**Spec:** `docs/lead-engine-audit-2026-09-13.md` (§3 defects, §4 ranked order) and the task prompt that commissioned this plan.

## Global Constraints

- Branch `fix/lead-engine-audit-2026-09-13`, cut from `main @ 5a20f4ff`. Never push, merge or deploy. Never write to production (the prod MCP is read-only; do not run `.env.prod` scripts).
- Commit messages: conventional prefix, no `Co-Authored-By`, no "Generated with", no AI attribution anywhere. Never stage `JOURNAL.md`.
- Tests: run `nvm use` first. Targeted suites only. Route suites under `__tests__/api/**` and `__tests__/app/api/**` need `// @vitest-environment node` at the top of the file or they report "no tests".
- tsc: the per-file error SET must match `main` (baseline 238 errors, ~54 files). A falling total hides new errors; Task 11 diffs the set.
- Never add a `SINGLETON_BUSINESS_ID` reference. Use `platformBusinessId()` where a tenant genuinely cannot be resolved.
- Do not touch: `claim_sequence_runs`, the PATCH `kind` refusal, the convert/steps guards, the 73 failed runs, email-consent gating, `scripts/repair-failed-sequence-runs.mjs`.
- Admin UI is light-only; use semantic Tailwind tokens; tables use `components/ui/data-table.tsx` (no table is added by this plan).
- Every test names the mutant it kills in a comment. After the suite is green, actually apply at least one named mutation by hand and confirm the test goes red, then revert (see memory: "Run the mutation, don't trust the comment").

---

### Task 1: Form redirect — the builder guesses the funnel slug (audit §3.1)

**Files:**
- Modify: `lib/funnels/sections/prompt.ts:670-676` (Block A text), `:750-835` (`BuilderCatalogueInput`, `buildCatalogueBlock`)
- Modify: `app/api/admin/funnels/steps/[stepId]/build/route.ts:415-480` (`PageContext`, `loadPageContext`), `:1140-1146` (where the catalogue input is assembled)
- Modify: `lib/funnels/connections.ts:409-440` (`autoConnectOps` form branch)
- Modify: `lib/funnels/publish-plan.ts` (`funnelPublishPlan` gains an injected connectivity check)
- Modify: `app/api/admin/funnels/[id]/publish/route.ts:200-225` (build the check from `funnelConnections`)
- Test: `__tests__/lib/funnels/sections/prompt.test.ts`, `__tests__/lib/funnels/connections.test.ts`, `__tests__/lib/funnels/publish-plan.test.ts`, `__tests__/app/api/admin/funnels/funnel-publish-route.test.ts`, `__tests__/app/api/admin/funnels/build-route.test.ts`

**Interfaces:**
- Produces: `BuilderCatalogueInput.funnelSlug: string | null` (required key). `funnelPublishPlan(steps, gate, connectivity?: (stepId: string) => string[])`. `autoConnectOps` now also repairs a form whose `redirectUrl` is `/go/<X>/<nextStepSlug>` with `X !== funnelSlug`.

**Why three changes, not one.** (a) The prompt fix stops the model inventing a slug. (b) The publish blocker stops any already-built funnel with a dead end going live (today "leads nowhere" is a warning and Publish stays enabled). (c) The `autoConnectOps` repair gives the rail's existing "connect this page" button something to do on the exact shape the model produced; without it the rail shows the warning, publish is refused, and there is no one-click fix.

- [ ] **Step 1: Failing prompt test.** In `prompt.test.ts`, extend the `catalogueInput()` helper with `funnelSlug: "off-season-speed-camp-dxf8"` and add:

```ts
it("prints the form's exact redirect URL from the REAL funnel slug, never a slugified name", () => {
  // MUTANT: building the URL from anything but `funnelSlug`, or omitting it.
  const block = buildCatalogueBlock({ ...catalogueInput(), funnelSlug: "off-season-speed-camp-dxf8", nextStepSlug: "thank-you" })
  expect(block).toContain('"/go/off-season-speed-camp-dxf8/thank-you"')
})
it("names no redirect URL on the last page", () => {
  const block = buildCatalogueBlock({ ...catalogueInput(), funnelSlug: "x", nextStepSlug: null })
  expect(block).not.toContain("/go/x/")
})
it("says the redirect cannot be written when the funnel slug is unknown", () => {
  // Degraded page-context load: the model must be told to leave the form on "message", not to guess.
  const block = buildCatalogueBlock({ ...catalogueInput(), funnelSlug: null, nextStepSlug: "thank-you" })
  expect(block).toMatch(/do not write a redirectUrl/i)
})
```
Run: `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts` → FAIL (type error / missing text).

- [ ] **Step 2: Implement the prompt change.** Add to `BuilderCatalogueInput`:
```ts
/**
 * The funnel's REAL address slug, or `null` when the page context could not
 * be read. The model has to write `redirectUrl: "/go/<this>/<next>"` for a
 * form, and until this field existed it invented the slug from the funnel's
 * NAME — right whenever address == slugify(name), a 404 after submit the
 * first time they differ (audit 2026-09-13 §3.1). Stable for the life of a
 * page except across a rename, which only costs a prompt-cache miss.
 */
funnelSlug: string | null
```
In `buildCatalogueBlock`, where the next page is named, render, when `nextStepSlug` is set:
- with `funnelSlug`: `Any form on this page redirects there: successMode "redirect" and redirectUrl exactly "/go/${funnelSlug}/${nextStepSlug}".`
- without: `The funnel's address could not be read, so do not write a redirectUrl for a form on this page — leave successMode "message"; the owner connects it afterwards.`
In Block A replace `redirectUrl: "/go/<funnel-slug>/<next-page-slug>"` with `redirectUrl: the exact value the catalogue gives (never build the path yourself)`.
In the build route, add `funnelSlug: string | null` to `PageContext` (`funnel?.slug ?? null`, and `null` in the degraded branch) and pass `funnelSlug: context.funnelSlug` where `stepSlugs`/`nextStepSlug` are passed (~line 1143). tsc will point at every other `BuilderCatalogueInput` literal (tests included); add the key to each.

- [ ] **Step 3: Failing connections tests.** In `connections.test.ts` under `describe("autoConnectOps")`:
```ts
it("repairs a form redirect that names the RIGHT next page under the WRONG funnel slug", () => {
  // MUTANT: keeping "half-configured is still configured" for this exact shape.
  const doc = docWith([formSection({ successMode: "redirect", redirectUrl: "/go/off-season-speed-camp/thank-you" })])
  const plan = autoConnectOps(doc, { funnelSlug: "off-season-speed-camp-dxf8", nextStepSlug: "thank-you" })
  expect(plan.ops).toEqual([{ op: "update_section", id: "signup", props: { successMode: "redirect", redirectUrl: "/go/off-season-speed-camp-dxf8/thank-you" } }])
  expect(plan.changes).toEqual([expect.objectContaining({ field: "redirectUrl", to: "thank-you" })])
})
it("leaves a redirect to a DIFFERENT page of another funnel alone — that is a choice", () => {
  const doc = docWith([formSection({ successMode: "redirect", redirectUrl: "/go/other-funnel/pricing" })])
  expect(autoConnectOps(doc, { funnelSlug: "mine", nextStepSlug: "thank-you" }).ops).toEqual([])
})
it("leaves an https redirect alone", () => { /* same shape, redirectUrl: "https://example.com/thanks" → ops [] */ })
```
Use the file's existing fixture helpers (read the top of the file; do not invent new ones if `formSection`/`docWith` equivalents exist under other names).

- [ ] **Step 4: Implement the repair.** In `autoConnectOps`'s form branch, after computing `hasUrl`, add:
```ts
// WRONG FUNNEL, RIGHT PAGE. The builder used to write the next page's slug
// under a slug it invented from the funnel NAME (audit 2026-09-13 §3.1). That
// exact shape — "/go/<not this funnel>/<exactly the next page>" — is the
// model's guess, not the owner's choice, so it is the one non-empty URL this
// function may correct. Anything else that is non-empty stays untouched.
const wrongFunnelRightPage =
  hasUrl && /^\/go\/[^/?#]+\/[^/?#]+$/.test(record.redirectUrl as string) &&
  !(record.redirectUrl as string).startsWith(`/go/${target.funnelSlug}/`) &&
  (record.redirectUrl as string).split("/")[3] === target.nextStepSlug
```
and treat `untouched || wrongFunnelRightPage` as the condition for the patch.

- [ ] **Step 5: Failing publish-plan test.**
```ts
it("REFUSES a page the connectivity check says leads nowhere, under that page's name", () => {
  // MUTANT: ignoring the third argument.
  const plan = funnelPublishPlan(
    [step({ id: "a", name: "Signup", position: 1 }), step({ id: "b", name: "Thanks", position: 2 })],
    () => ({ ok: true, blockers: [] }),
    (stepId) => (stepId === "a" ? ["Signup leads nowhere: no button or form on it goes to another page of this funnel."] : []),
  )
  expect(plan.ok).toBe(false)
  expect(plan.publish).toEqual([])
  expect(plan.problems).toEqual([{ stepId: "a", stepName: "Signup", problems: [expect.stringContaining("leads nowhere")], blank: false }])
})
it("merges connectivity problems into a page the gate ALSO blocked, as one entry", () => { /* gate returns a blocker for "a"; expect problems[0].problems to have length 2 */ })
```

- [ ] **Step 6: Implement in `publish-plan.ts`.** Signature `funnelPublishPlan(steps, gate, connectivity: (stepId: string) => string[] = () => [])`. After the gate verdict for a step with a doc: `const extra = connectivity(step.id)`; if the gate failed, append `extra` to that problem's list; else if `extra.length > 0`, push `{ stepId, stepName, problems: extra, blank: false }`; else publish. Do not call `connectivity` for a doc-less step (it is already a blank-page problem). Keep the module a leaf (no new imports).

- [ ] **Step 7: Failing route test.** In `funnel-publish-route.test.ts`, add a two-step funnel fixture: step 1 doc has a `form` section with `successMode: "redirect", redirectUrl: "/go/free-trial-week-2/thank-you"` (funnel slug is `free-trial-week`), step 2 a plain hero. Expect 422 with `pages[0].problems[0]` matching `/leads nowhere/` and `publishStep` never called. Control: the same fixture with `redirectUrl: "/go/free-trial-week/thank-you"` publishes both steps (200). The form fixture must satisfy `formIslandSchema` (`formKey`, at least one field) — copy the shape from `__tests__/lib/funnels/connections.test.ts`.

- [ ] **Step 8: Implement in the publish route.** Before `funnelPublishPlan`, build
```ts
const connectivity = funnelConnections(
  funnel.slug,
  toPublish.map((s, i) => ({ id: s.id, name: s.name, slug: steps[i].slug, position: s.position, isEntry: steps[i].is_entry, doc: s.doc })),
)
const deadEndNames = new Map(connectivity.deadEnds.map((id) => [id, steps.find((s) => s.id === id)?.name ?? id]))
```
(`toPublish` is built by `steps.map`, so indexes line up; say so in a comment.) Pass `(stepId) => deadEndNames.has(stepId) ? [\`${deadEndNames.get(stepId)} leads nowhere: no button or form on this page goes to another page of this funnel. Use "connect this page" in the rail, or make it the last page.\`] : []`. Import `funnelConnections` from `@/lib/funnels/connections`. A single-step funnel has no dead ends by construction (the last page is exempt), so landing pages are unaffected.

- [ ] **Step 9: Run** `npx vitest run __tests__/lib/funnels/sections/prompt.test.ts __tests__/lib/funnels/connections.test.ts __tests__/lib/funnels/publish-plan.test.ts __tests__/app/api/admin/funnels/funnel-publish-route.test.ts __tests__/app/api/admin/funnels/build-route.test.ts` → all green. Mutation check: revert the `connectivity` argument in the route and confirm the 422 test fails.

- [ ] **Step 10: Commit** `fix(funnels): give the builder the real funnel slug and block dead-end pages at publish`

---

### Task 2: Leads arrive nameless (audit §3.2)

**Files:**
- Modify: `app/api/funnels/submit/route.ts:112-114, 416-421`
- Test: new `__tests__/api/funnels/submit-lead-name.test.ts` (copy the mock block from `__tests__/api/funnels/submit-sms-consent.test.ts`, keep `// @vitest-environment node`)

- [ ] **Step 1: Failing tests.** Fields fixture: `[{name:"athlete_name",label:"Athlete",type:"text",role:"athlete_name"},{name:"parent_name",label:"Parent",type:"text",role:"parent_name"},{name:"email",type:"email",...}]`. Cases:
  - parent + athlete both filled → `createSubmission` called with `name: "Aean Audit"` (parent), and `sendNewFunnelLeadEmail` called with `name: "Aean Audit"`. (MUTANT: preferring athlete, or still reading only `first_name`.)
  - only athlete filled → `name: "Riley Audit"`.
  - legacy `first_name`/`last_name` → `"Riley Audit"` (regression control).
  - a field named `your_name` with no role → used; a field named `username`… not needed. Keep to: role first, then legacy keys, then any field whose `name` contains `name` and whose `type` is `text`, preferring one containing `parent`.
  - no name-shaped field → `null`.
  `getPublishedFormConfig` must return `{ fields, formKey }`; `getFunnelById` must return `{ status: "published", ... }` from Task 4 onward (add it now so this suite survives Task 4).

- [ ] **Step 2: Implement.**
```ts
function buildName(fields: FunnelFormField[], payload: Record<string, string>): string | null {
  const value = (name: string | undefined) => (name ? (payload[name] ?? "").trim() : "")
  const byRole = (role: string) => fields.find((f) => f.role === role)?.name
  // 1. Explicit roles: the parent is who the coach calls, so parent first.
  for (const candidate of [value(byRole("parent_name")), value(byRole("athlete_name"))]) if (candidate) return candidate
  // 2. The shape the first templates used.
  const legacy = `${payload.first_name ?? payload.name ?? ""} ${payload.last_name ?? ""}`.trim()
  if (legacy) return legacy
  // 3. Any text field whose name says "name" — a parent one first.
  const named = fields.filter((f) => f.type === "text" && /name/.test(f.name) && value(f.name))
  const parent = named.find((f) => /parent|guardian/.test(f.name))
  return value((parent ?? named[0])?.name) || null
}
```
Update the call site to `buildName(fields, payload)`.

- [ ] **Step 3: Run** the new suite plus `__tests__/api/funnels/submit-sms-consent.test.ts` and `__tests__/app/api/funnels/submit-checkout.test.ts` → green. **Commit** `fix(funnels): capture the lead's name from role-tagged and *_name fields`

---

### Task 3: Refuse an unverified sender domain (audit §4 #1)

**Files:**
- Create: `lib/email/sender-domains.ts`
- Modify: `app/api/admin/businesses/[id]/route.ts:70-85`
- Test: new `__tests__/lib/email/sender-domains.test.ts`; extend `__tests__/api/admin/business-settings.test.ts`

**Interfaces:**
- Produces: `listVerifiedSenderDomains(): Promise<{ ok: true; domains: string[] } | { ok: false; reason: "no_api_key" | "api_error" }>` and `senderDomainVerdict(email: string, verified: string[]): { ok: true } | { ok: false; domain: string }`.

Decision: exact-domain match (the 08-31 fault was apex vs subdomain; a subdomain rule in either direction would have let it through). Fail closed when Resend cannot be asked — the message says why, and clearing the field (`""`) is always allowed.

- [ ] **Step 1: Failing unit tests.** Mock `@/lib/resend` (`resend.domains.list`). Cases: returns lowercased names with `status === "verified"` only (MUTANT: including `pending`); `error` from the SDK → `{ ok: false, reason: "api_error" }`; no `RESEND_API_KEY` → `{ ok: false, reason: "no_api_key" }` without calling the SDK; `senderDomainVerdict("noreply@Send.DarrenJPaul.com", ["send.darrenjpaul.com"])` ok; apex against subdomain list → `{ ok: false, domain: "darrenjpaul.com" }`.

- [ ] **Step 2: Implement** `lib/email/sender-domains.ts` using `resend` from `@/lib/resend`:
```ts
export async function listVerifiedSenderDomains() {
  if (!process.env.RESEND_API_KEY) return { ok: false as const, reason: "no_api_key" as const }
  const { data, error } = await resend.domains.list()
  if (error || !data) return { ok: false as const, reason: "api_error" as const }
  return { ok: true as const, domains: data.data.filter((d) => d.status === "verified").map((d) => d.name.toLowerCase()) }
}
export function senderDomainVerdict(email: string, verified: string[]) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? ""
  return verified.includes(domain) ? { ok: true as const } : { ok: false as const, domain }
}
```

- [ ] **Step 3: Failing route tests** (in `business-settings.test.ts`, mock `@/lib/email/sender-domains`): `{settings:{sender_email:"noreply@darrenjpaul.com"}}` with verified `["send.darrenjpaul.com"]` → 400, body `error` matches `/darrenjpaul\.com.*not verified/i`, `updateBusinessSettings` NOT called; verified match → 200 and called; `sender_email: ""` → 200 without calling the domain list; list `{ok:false, reason:"api_error"}` → 400 with `/could not confirm/i`, not saved. Presence control: a patch without `sender_email` never calls `listVerifiedSenderDomains`.

- [ ] **Step 4: Implement in the route** after Zod parse, before any write:
```ts
const senderEmail = parsed.data.settings?.sender_email
if (senderEmail) {
  const verified = await listVerifiedSenderDomains()
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason === "no_api_key"
      ? "Email sending is not configured on this server, so the sender domain cannot be checked. The sender email was not changed."
      : "Could not confirm the sender domain with Resend just now. Try again in a minute. The sender email was not changed." }, { status: 400 })
  }
  const verdict = senderDomainVerdict(senderEmail, verified.domains)
  if (!verdict.ok) {
    return NextResponse.json({ error: `${verdict.domain} is not verified at Resend, so email sent from it would be dropped. Use an address on a verified domain (${verified.domains.join(", ") || "none yet"}).` }, { status: 400 })
  }
}
```
Keep the Zod format check as is. The form already surfaces `json.error` under the Save button.

- [ ] **Step 5: Run** both suites → green. **Commit** `fix(businesses): refuse a sender email whose domain Resend has not verified`

---

### Task 4: Pin /go's serve rule; gate submit on funnel status; escape the slug (audit §3.6)

**Files:**
- Modify: `lib/db/funnels.ts:52-62` (`getFunnelBySlug`), `app/api/funnels/submit/route.ts:85-100`
- Test: new `__tests__/lib/db/funnel-serve-rule.test.ts`; extend the submit suites

- [ ] **Step 1: Failing DAL tests** (harness style: `__tests__/lib/db/funnel-kind.test.ts` — a chainable thenable builder; add `ilike`, `maybeSingle`, `limit` to it). Cases for `getPublishedStep`:
  - funnel `status: "draft"` → `null` and `funnel_steps` never queried (MUTANT: dropping the status gate).
  - `status: "published"`, step `published_version_id: null` → `null` and `funnel_step_versions` never queried (MUTANT: falling back to latest version without `includeUnpublished`).
  - `status: "published"` + pvid → returns `nodes`/`css` and queried `funnel_step_versions` with `.eq("id", pvid)`.
  - `includeUnpublished: true` on a draft funnel with no pvid → queries latest version by `step_id` (regression control for the preview path).
  Cases for `getFunnelBySlug`: `"%"` → `.ilike` receives `"\\%"`; `"a_b"` → `"a\\_b"`; `"plain-slug"` unchanged. (MUTANT: no escaping.)

- [ ] **Step 2: Implement escaping.**
```ts
/** PostgREST `ilike` treats % and _ as wildcards; a URL segment is not a pattern. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}
```
and `.ilike("slug", escapeLikePattern(slug))`. Slugs are validated as `[a-z0-9-]` on write, so this only ever changes a request that was never going to match.

- [ ] **Step 3: Failing submit tests.** In `submit-sms-consent.test.ts` (and the checkout suite) make `getFunnelById` resolve `{ id, name, status: "published", notify_emails: null }` in `beforeEach`, then add one case: `getFunnelById` resolves `{ status: "draft" }` → 404 `{ error: "This page is no longer live." }`, `createSubmission` never called (MUTANT: no status check). Presence control: `getFunnelById` was called with `parsedBody.funnelId`.

- [ ] **Step 4: Implement** in the submit route, right after the `config` null check:
```ts
// The step's published_version_id survives an unpublish; only the funnel row
// says whether the page is live. Without this, a direct POST kept capturing
// and enrolling leads for a funnel /go was already 404ing (audit §3.6).
const funnel = await getFunnelById(parsedBody.funnelId).catch(() => null)
if (!funnel || funnel.status !== "published") {
  return NextResponse.json({ error: "This page is no longer live." }, { status: 404 })
}
```
Reuse this `funnel` in `notifyCoachOfLead` if the signature makes that clean; otherwise leave that helper alone. Note `/api/funnels/preview-submit` is a separate route and must keep answering for drafts — do not touch it. Check `__tests__/api/quiz-submit-funnel-lead.test.ts` and `__tests__/api/funnels/submit-*.test.ts` for other suites that hit this route and give them a published funnel.

- [ ] **Step 5: Run** the new suite, `__tests__/api/funnels/submit-sms-consent.test.ts`, `__tests__/app/api/funnels/submit-checkout.test.ts`, `__tests__/app/api/funnels/preview-submit.test.ts`, `__tests__/lib/db/funnel-kind.test.ts` → green. **Commit** `fix(funnels): pin the /go serve rule, gate submit on funnel status, escape the slug lookup`

---

### Task 5: Two unwatchable crons (audit §4 #9)

**Files:**
- Modify: `app/api/admin/internal/pipeline-reconcile/route.ts:26-33`, `app/api/admin/internal/funnel-window/route.ts`, `lib/cron-catalog.ts` (add an entry after `pipeline-reconcile`), `lib/automation/automation-health-scanner.ts:72` (move `funnelWindowCron` into the `reports_to_cron_runs` group)
- Test: `__tests__/api/admin/internal/pipeline-reconcile.test.ts`, new `__tests__/api/admin/internal/funnel-window.test.ts` (copy the reconcile harness), `__tests__/lib/automation/automation-health-scanner.test.ts`, any `cron-catalog` test (`grep -rl cron-catalog __tests__`)

Decision: a skipped run is logged as a `success` row with `detail: { skipped: reason }`, so "never succeeded once" stops firing for a cron that is deliberately off, and the row proves the schedule is alive. (A flag-off cron that leaves NO row is indistinguishable from a dead scheduler — that is the audit finding.)

- [ ] **Step 1: Failing tests (reconcile).** In the two `{ skipped }` tests add `expect(logCronStart).toHaveBeenCalledWith(expect.anything(), "pipelineReconcileCron")` and `expect(logCronEnd).toHaveBeenCalledWith(expect.anything(), "run-1", "success", { skipped: "disabled" })`. MUTANT: the early return before `logCronStart`.

- [ ] **Step 2: Implement (reconcile).** Move `createServiceRoleClient()` + `logCronStart` above the gate; on `gate.skipped`: `await logCronEnd(supabase, runId, "success", { skipped: gate.reason }); return NextResponse.json({ skipped: gate.reason })`.

- [ ] **Step 3: Failing tests (funnel-window).** New suite mocking `@/lib/db/system-settings`, `@/lib/db/funnels` (`listFunnels`, `updateFunnel`), `@/lib/audit/record`, `@/lib/db/cron-runs`, `@/lib/supabase`. Cases: 401 paths; skipped → `logCronStart("funnelWindowCron")` + `logCronEnd(..., "success", { skipped })`; happy path closes the selected funnel and `logCronEnd(..., "success", { considered, closed, failed })`; one `updateFunnel` rejection → 500 and `logCronEnd(..., "failed", ...)`. Use a fixture `listFunnels` returns with one funnel `status:"published", ends_at: past, auto_close: true` — read `lib/automation/funnel-window-closer.ts` for the exact column names `selectFunnelsToClose` reads and use those.

- [ ] **Step 4: Implement (funnel-window).** Same shell as reconcile: `logCronStart(supabase, "funnelWindowCron")` before the gate; wrap the body in try/catch; `logCronEnd` with `"failed"` when `failed.length > 0` or on throw, else `"success"`; response unchanged.

- [ ] **Step 5: Catalog + scanner.** Add to `lib/cron-catalog.ts` after the `pipeline-reconcile` entry:
```ts
{
  name: "funnel-window",
  label: "Close funnels whose run window has ended",
  description: "Every day, takes offline any published funnel or landing page whose end date has passed and whose owner asked for it to close automatically. OFF by default; flip the toggle to enable.",
  schedule: "0 4 * * *", timezone: "UTC", humanSchedule: "Daily at 04:00 UTC",
  firebaseFunction: "funnelWindowCron", phase: "lead-engine-1c",
  enabledKey: "cron_funnel_window_enabled", defaultEnabled: false,
},
```
(Match the `phase` value the reconcile entry uses; read the type.) In the scanner, delete the `funnelWindowCron` line from the no-cron_runs group and add to the reporting group: `{ name: "funnelWindowCron", sla_hours: 30, reports_to_cron_runs: true, watch_from: "2026-09-13", enabled_flag: "cron_funnel_window_enabled", enabled_flag_default: false }`. Scanner test: assert the roster entry has `reports_to_cron_runs` and `watch_from` (the existing "missing watch_from" test already guards half of this).

- [ ] **Step 6: Run** the four suites → green. **Commit** `fix(crons): log pipeline-reconcile and funnel-window runs before the flag gate`

---

### Task 6: Audit rows for funnel create/update/delete carry no target (audit §4 #12)

**Files:**
- Modify: `lib/audit/with-audit.ts` (target resolver receives the response as a third argument), `app/api/admin/funnels/[id]/route.ts` (PATCH + DELETE options), `app/api/admin/funnels/route.ts:27-28` (POST options), the DELETE handler's success body
- Test: new `__tests__/lib/audit/with-audit-target-response.test.ts`; extend `__tests__/app/api/admin/funnels/patch-route.test.ts` and `__tests__/app/api/admin/funnels/delete-route-quiz.test.ts`; check for an existing create-route suite (`grep -rl 'funnels/route' __tests__`)

- [ ] **Step 1: Failing withAudit test.** `withAudit({ action:"x", category:"admin_write", target: async (_r, _c, res) => { const b = await res!.json(); return { type:"funnel", id: b.funnel.id } } }, handler)` → `recordAudit` called with `target: { type:"funnel", id:"f1" }`; and the handler's own response body is still readable by the caller (the resolver must clone). Streaming response → resolver receives `undefined`.

- [ ] **Step 2: Implement.** `TargetResolver` function type gains `response?: Response`; in `withAudit` call `options.target(request, context, response && !isStreamingResponse(response) ? response.clone() : undefined)`. Move the target resolution to after the `thrown` check so a thrown handler still records `target` from `(request, context)` only. Existing resolvers ignore the third argument.

- [ ] **Step 3: Failing route tests.**
  - PATCH: `recordAudit` called with `target: { type:"funnel", id: FUNNEL_ID, label: <name> }` and `metadata: { fields: ["status"], status: "draft", slug, kind }` on a successful `{status:"draft"}` patch (the unpublish the audit could not attribute). MUTANT: options without `target`.
  - DELETE: `target: { type:"funnel", id, label }` and `metadata: { slug, kind, status }` read from the pre-delete row (handler already reads steps; also `getFunnelById` first). DELETE's success body becomes `{ ok: true, deleted: { id, slug, name, kind, status } }` so the resolver can read it; assert the body still has `ok: true` (existing tests).
  - POST create: `target: { type:"funnel", id: <created id>, label: name }`, `metadata: { slug, kind, template }` from the response body.

- [ ] **Step 4: Implement** the three option blocks. For PATCH the `metadata` callback reads the request clone's JSON for `fields: Object.keys(body)` and the response clone's `funnel` for `status/slug/kind`; `target` reads `ctx.params.id` and the response `funnel.name` for `label`. Where the handler 4xx'd, the resolver returns `{ type:"funnel", id }` with no label (the body has no funnel).

- [ ] **Step 5: Run** the audit suites and `__tests__/app/api/admin/funnels/{patch-route,delete-route-quiz,convert-route,add-step-route}.test.ts` → green (the PATCH `kind` refusals must still be 400). **Commit** `fix(audit): record the funnel row on create, update and delete audit rows`

---

### Task 7: SMS — tenant by messaging service SID, queued row before the send, env visible in the thread (audit §4 #11)

**Files:**
- Modify: `lib/db/businesses.ts:189-200` (add `getBusinessByMessagingServiceSid`), `app/api/webhooks/twilio/inbound/route.ts:235-247`, `lib/db/sms-messages.ts` (add `markSmsMessageOutcome`), `lib/lead-engine/sms.ts:355-410` (`sendManualSms`), `app/(admin)/admin/sms/[phone]/page.tsx:80-140`, `components/admin/sms/SmsComposer.tsx` (new `envMissing` prop)
- Test: `__tests__/api/webhooks/twilio-inbound.test.ts`, `__tests__/lib/db/sms-messages.test.ts`, `__tests__/lib/lead-engine/send-manual-sms.test.ts`, `__tests__/app/admin/sms-thread-page-tenancy.test.tsx`, `__tests__/components/admin/sms-composer.test.tsx`

**Interfaces:**
- Produces: `getBusinessByMessagingServiceSid(sid: string): Promise<string | null>` (same throw contract as `getBusinessBySmsNumber`); `markSmsMessageOutcome(id: string, outcome: { kind: "sent"; twilioSid: string } | { kind: "failed"; errorCode: string | null }): Promise<void>`; `SmsComposer` prop `envMissing?: boolean`.

Honesty note for the code comment and the report: the queued-row-first change moves the row's creation ahead of the Twilio POST, but the Twilio SID is only known when the POST returns, so a status callback that arrives before `markSmsMessageOutcome` writes the SID still resolves to `unknown_message`. The window shrinks from "POST latency + insert" to "response → one UPDATE"; it does not close. Say exactly that in the comment; do not claim the race is fixed.

- [ ] **Step 1: Failing inbound tests.** Seed `business_settings` with `{ business_id: "biz-ms", sms_sender_phone: "", sms_messaging_service_sid: "MG123" }` and post a form body with `MessagingServiceSid=MG123`, `To=+12025550199` → every written row carries `business_id: "biz-ms"` (MUTANT: matching `To` only). Second: both a SID match and a phone match exist for different businesses → the SID wins (it is the more specific identity). Third: neither matches → `platformBusinessId()` (existing behaviour, keep its test).

- [ ] **Step 2: Implement.** `getBusinessByMessagingServiceSid` mirrors `getBusinessBySmsNumber` on `sms_messaging_service_sid` (empty string → `null` before querying; throw on error; `maybeSingle`). In the route: `const messagingServiceSid = params.MessagingServiceSid ?? ""` and `const businessId = (await getBusinessByMessagingServiceSid(messagingServiceSid)) ?? (await getBusinessBySmsNumber(rawTo)) ?? platformBusinessId()`. Update the header comment ("The To number is the ONLY tenant evidence" is no longer true).

- [ ] **Step 3: Failing DAL + send tests.** `sms-messages.test.ts`: `markSmsMessageOutcome(id, {kind:"sent", twilioSid})` updates `{ status:"sent", twilio_sid }` by id with `.neq("status","delivered")` (MUTANT: unconditional update that could un-deliver); `{kind:"failed", errorCode}` writes `status:"failed", error_code`. `send-manual-sms.test.ts` (mock `markSmsMessageOutcome` too): success path → `insertSmsMessage` called with `status:"queued"` and `twilioSid` absent BEFORE the Twilio send (assert call order via `mock.invocationCallOrder`), then `markSmsMessageOutcome(id, {kind:"sent", twilioSid: providerId})`; failure path → `markSmsMessageOutcome(id, {kind:"failed", errorCode:"21610"})` and NO second insert (update the two existing `failed`-row assertions accordingly); insert failure before the send → the send is still attempted and the outcome update skipped with a logged error (a DB blip must not silence a coach's reply — keep the existing "recording failed" semantics).

- [ ] **Step 4: Implement `sendManualSms`.** Insert `{ status: "queued" }` before `sendRenderedSequenceSms`; keep `messageId` from it; on success `markSmsMessageOutcome(messageId, { kind: "sent", twilioSid })`; on send failure `markSmsMessageOutcome(messageId, { kind: "failed", errorCode })` then rethrow. Each DAL call has its own try/catch with the existing log lines. If the initial insert failed (`messageId === null`), fall back to the current insert-after behaviour so the conversation still gets a row.

- [ ] **Step 5: Failing UI tests.** Thread page test: with `TWILIO_ACCOUNT_SID` unset, `SmsComposer` receives `envMissing: true`; composer test: `envMissing` renders text matching `/Twilio credentials are not set on this server/` and disables the send button; `notConfigured` keeps its current message (presence control: the two messages differ).

- [ ] **Step 6: Implement.** Page: `import { smsEnvPresent } from "@/lib/lead-engine/sms"`, `const envMissing = !smsEnvPresent()`, pass it. Composer: `blocked = suppressed || notConfigured || envMissing`; render the env message in the same slot as the not-configured one, env first.

- [ ] **Step 7: Run** all five suites (pin `// @vitest-environment node` where a suite reports no tests) → green. **Commit** `fix(sms): resolve the tenant by messaging service SID, write the queued row first, surface missing Twilio env`

---

### Task 8: Pipeline board switcher, and a service type on bookings (audit §4 #7)

**Files:**
- Modify: `lib/db/pipeline.ts` (add `listPipelines`), `app/(admin)/admin/pipeline/page.tsx`, `lib/bookings/ingest.ts:57-125, 310-323`, `app/api/webhooks/calendly/route.ts:255-290`, `app/api/webhooks/ghl-booking/route.ts:123-150`
- Create: `components/admin/pipeline/BoardSwitcher.tsx`
- Test: `__tests__/app/admin/pipeline-page-tenancy.test.tsx`, new `__tests__/components/admin/board-switcher.test.tsx`, `__tests__/lib/bookings/ingest.test.ts`, `__tests__/api/webhooks/calendly-booking.test.ts`, `__tests__/db/pipeline.test.ts`

**Interfaces:**
- Produces: `listPipelines(businessId: string): Promise<Array<{ id: string; key: string; name: string }>>` (active only, ordered by `created_at`); `BookingIngestInput.serviceType?: string | null`; `<BoardSwitcher boards={[{key,name}]} activeKey={string} />` renders `<Link href={`/admin/pipeline?board=${key}`}>` pills.

Design decisions (brainstormed; do not widen): the board is chosen by `?board=<pipelines.key>` on the existing page — no new route, no tabs component, no pipeline-creation UI, no tiers. An unknown or missing key falls back to `DEFAULT_PIPELINE_KEY`. Bookings carry a `serviceType` that the Calendly adapter fills from `scheduled_event.name` only when that name contains the word "assessment" (case-insensitive); GHL passes `null`. This is the only booking-side signal that exists today; a `coach_calendar_connections.service_type` column is the right long-term home and is deliberately NOT added here (no writer, no UI).

- [ ] **Step 1: Failing DAL test** (`__tests__/db/pipeline.test.ts` harness): `listPipelines("biz-a")` returns only `biz-a`'s active pipelines, `archived` excluded, ordered by `created_at` (MUTANT: missing `business_id` predicate → returns biz-b's row too).

- [ ] **Step 2: Implement** `listPipelines` with `.eq("business_id", businessId).eq("status", "active").order("created_at")`.

- [ ] **Step 3: Failing page tests.** Update the tenancy test: `readBoard` called with `(DEFAULT_PIPELINE_KEY, BUSINESS_ID)` when no `searchParams.board`; with `searchParams: Promise.resolve({ board: "assessment" })` and `listPipelines` returning coaching + assessment → `readBoard("assessment", BUSINESS_ID)`; unknown key `"nope"` → `readBoard(DEFAULT_PIPELINE_KEY, ...)` (MUTANT: passing the raw query value through). Mock `listPipelines` in the `@/lib/db/pipeline` factory. Component test: renders one link per board, marks the active one with `aria-current="page"`, hrefs are `/admin/pipeline?board=<key>`.

- [ ] **Step 4: Implement.** Page signature `PipelinePage({ searchParams }: { searchParams: Promise<{ board?: string }> })`; `const boards = await listPipelines(businessId)`; `const activeKey = boards.some((b) => b.key === requested) ? requested : DEFAULT_PIPELINE_KEY`; `readBoard(activeKey, businessId)`. Heading copy: `${name.leading} ${activeBoard.name} pipeline.` Render `<BoardSwitcher>` above `<PipelineBoard>` only when `boards.length > 1`. Switcher styling: `inline-flex gap-1 rounded-lg border border-border bg-white p-1`, active pill `bg-primary text-primary-foreground`, inactive `text-muted-foreground hover:bg-surface/50`; `font-body`; no hex.

- [ ] **Step 5: Failing ingest tests.** `ingest.test.ts`: `input({ serviceType: "assessment" })` → `applyPipelineEvent` called with `pipelineKey: "assessment"`; `serviceType: null` → `"coaching"` (control). `calendly-booking.test.ts`: fixture with `scheduled_event.name: "Movement Assessment (30 min)"` → `ingestBookingMock` called with `serviceType: "assessment"`; name `"Intro Call"` → `serviceType: null`.

- [ ] **Step 6: Implement.** Add `serviceType?: string | null` to `BookingIngestInput` with a doc comment naming the Calendly-name rule and the missing column; `routeToPipeline({ event: "booking", serviceType: input.serviceType ?? null })`; update the "always routes to Coaching" comment at `:313-316`. Calendly: `serviceType: /\bassessment\b/i.test(data.scheduled_event.name ?? "") ? "assessment" : null`. GHL: `serviceType: null`.

- [ ] **Step 7: Run** the five suites → green. **Commit** `feat(pipeline): board switcher on /admin/pipeline and a service type on bookings`

---

### Task 9: Attribution for every /go visitor (audit §3.5)

**Files:**
- Modify: `proxy.ts:34-68` (`captureAttribution`), `app/api/public/attribution/track/route.ts`, `lib/lead-engine/capture.ts` (`CaptureLeadInput.attributionSessionId`), `lib/db/contacts.ts:125-150, 270-290` (backfill on update/merge), the seven public `captureLead` callers: `app/api/contact/route.ts`, `app/api/inquiry/route.ts`, `app/api/ask/capture/route.ts`, `app/api/shop/leads/route.ts`, `app/api/newsletter/route.ts`, `app/api/events/[id]/signup/route.ts`, `app/api/events/[id]/checkout/route.ts` (not the Stripe webhook — no cookie)
- Test: new `__tests__/proxy-attribution-go.test.ts` (harness: `__tests__/proxy-admin-headers.test.ts`), `__tests__/lib/marketing/attribution.test.ts`, new `__tests__/api/public/attribution-track.test.ts`, `__tests__/lib/lead-engine/capture-tenancy.test.ts`, `__tests__/db/contacts-record-event.test.ts`, `__tests__/api/newsletter/attribution-capture.test.ts`, `__tests__/api/inquiry/attribution-capture.test.ts`

- [ ] **Step 1: Failing proxy tests.** `GET /go/off-season-speed-camp-dxf8` with no query and no cookie → response sets `djp_attr` (MUTANT: the early return). Same path with an existing valid cookie → not re-issued. `GET /programs` with no params → no cookie (the rule is /go-only; presence control). Stub `global.fetch` and assert the track POST body has `session_id`, `landing_url: "http://localhost/go/off-season-speed-camp-dxf8"`, no tracking keys. Keep the fetch fire-and-forget (never awaited) and say so in the comment.

- [ ] **Step 2: Implement.** In `captureAttribution`: `const funnelLanding = req.nextUrl.pathname.startsWith("/go/")`; `if (!hasAnyTrackingParam(params) && !funnelLanding) return res`; when `funnelLanding` and `params.landing_url` is unset, set `params.landing_url = clip(origin + pathname)` (export a small `landingUrlFor(url: URL)` from `lib/marketing/attribution.ts` rather than duplicating the clip). The rest is unchanged.

- [ ] **Step 3: Failing track-route test.** Body `{ session_id, landing_url: "https://x/go/a" }` with no tracking keys → 204 and `upsertAttributionBySession` called; body with neither tracking keys nor `landing_url` → 400 (MUTANT: dropping the guard entirely).

- [ ] **Step 4: Implement.** Replace `if (!hasAnyTrackingParam(params))` with `if (!hasAnyTrackingParam(params) && !params.landing_url)`; update the header comment ("called from middleware on landings that include any tracking query param, or any /go landing").

- [ ] **Step 5: Failing capture + contacts tests.** `capture-tenancy.test.ts`: `captureLead({ ..., attributionSessionId: "sess-1" })` forwards `attributionSessionId: "sess-1"` to `recordContactEvent` (MUTANT: field dropped). `contacts-record-event.test.ts`: existing contact with `first_touch_session_id: null` + event carrying `"sess-2"` → row now has `"sess-2"`; existing contact with `"sess-1"` + event `"sess-2"` → stays `"sess-1"` (first touch wins; MUTANT: overwrite). Extend the mock's `select` to return `first_touch_session_id`.

- [ ] **Step 6: Implement.** `CaptureLeadInput.attributionSessionId?: string | null` → pass through. In `findMatchCandidates` select `id,email,phone_e164,created_at,first_touch_session_id` and add it to `MatchCandidate`. In both the `update` and `merge` branches of `upsertContactIdentity`, add to the patch: `...(existing?.first_touch_session_id == null && input.attributionSessionId ? { first_touch_session_id: input.attributionSessionId } : {})`.

- [ ] **Step 7: Callers.** In each of the seven routes: `attributionSessionId: parseAttrCookie(request.headers.get("cookie"))` (import from `@/lib/marketing/cookies`; the inquiry and newsletter routes already parse it — reuse their variable). Add one assertion to `__tests__/api/newsletter/attribution-capture.test.ts` and `__tests__/api/inquiry/attribution-capture.test.ts` that `captureLead` received the cookie's session id.

- [ ] **Step 8: Run** all listed suites → green. **Commit** `fix(attribution): stamp every /go visitor and carry the session into the contact spine`

---

### Task 10: `lib/email.ts` reports success with no API key (audit §4, latent)

**Files:**
- Modify: `lib/email.ts:17-36`, `lib/shop/emails.ts:163-195`
- Test: new `__tests__/lib/email-missing-key.test.ts`, `__tests__/lib/shop/emails.test.ts`

- [ ] **Step 1: Failing tests.** With `RESEND_API_KEY` deleted and `resend` mocked to record calls: `sendPasswordResetEmail(...)` → the SDK is NOT called and the function's return/throw reflects an error (read the sender: if it returns `{ success: false }` assert that; if it only logs, assert `console.error` was called with a message containing `RESEND_API_KEY`). Pick one sender of each shape found by `grep -n 'const { error } = await resend' lib/email.ts` and `grep -n 'const { data, error }' lib/email.ts`. `sendFreeDownloadEmail` with the key set and the SDK returning `{ data: null, error: { name: "validation_error", message: "bad" } }` → rejects with a message containing `"bad"` (MUTANT: ignoring the result); with no key → rejects with `/RESEND_API_KEY/` (MUTANT: the silent `return`).

- [ ] **Step 2: Implement.** In `lib/email.ts` the wrapper returns
```ts
return { data: null, error: { name: "missing_required_field", message: `RESEND_API_KEY is not set — "${args.subject}" was not sent` } } as Awaited<ReturnType<typeof _resendClient.emails.send>>
```
(and the batch twin). List every sender whose behaviour changes: `grep -c 'if (error)' lib/email.ts` — they already log on `error`; now they log when the key is missing instead of returning silently. Check each exported sender that `throw`s on error (`grep -n 'throw' lib/email.ts`) and list them in the commit body; a caller of one of those in a hot path with no key is dev/test-only (production has the key). In `lib/shop/emails.ts`, `sendFreeDownloadEmail`: replace the `warnMissingKey` early return with `throw new Error("RESEND_API_KEY is not set — the download email cannot be sent")`, and read the send result: `const { error } = await resend.emails.send(...); if (error) throw new Error(\`free download email failed: ${error.message}\`)`. `app/api/shop/leads/route.ts:56-64` already catches and answers 502 — leave it.

- [ ] **Step 3: Run** the two new/extended suites plus `__tests__/lib/email-events.test.ts`, `__tests__/lib/email-chat-escalation.test.ts`, `__tests__/lib/automation/sequence-tick-side-effects.test.ts` → green. **Commit** `fix(email): report a missing RESEND_API_KEY as an error instead of a silent success`

---

### Task 11: Whole-branch verification

- [ ] **Step 1: tsc set diff.** `git worktree add /tmp/djp-main-baseline main --detach` (symlink `.env.local` is not needed for tsc; run `npm ci` there only if `node_modules` is required — it is, so `ln -s` the main checkout's `node_modules` for tsc only). In both trees: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E '^[^ ]+\([0-9]+,[0-9]+\): error' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort -u > /tmp/tsc-<tree>.txt`, then `comm -13 /tmp/tsc-main.txt /tmp/tsc-branch.txt` must be empty. Remove the worktree afterwards.
- [ ] **Step 2: Targeted suites**, one command, every suite named in Tasks 1–10 plus the eight suites the audit already verified (`__tests__/app/api/admin/funnels/{patch-route,convert-route,add-step-route}.test.ts`, `__tests__/app/api/funnels/preview-submit.test.ts`, `__tests__/lib/tenancy/platform-inventory.test.ts`, `__tests__/lib/automation/{sequence-tick,sequence-tick-send-faults,sequence-tick-sms}.test.ts`). Never the full suite.
- [ ] **Step 3: Drive the redirect fix on dev.** `nvm use && (nohup npm run dev > /tmp/dev.log 2>&1 &)`; give the `build` stage of `scripts/capture-lead-engine-audit.mjs` a NEW custom slug (edit the script's slug constant; it must differ from slugify(name)); run `node --env-file=.env.local scripts/capture-lead-engine-audit.mjs build`; confirm the published `project_data` redirectUrl starts with `/go/<new slug>/` and the thank-you page answers 200. Expect the coach-alert email to `darren@darrenjpaul.com` (documented behaviour) — use a `+alias` of `tayawaschoolworks@gmail.com` and a phone above `+12025550150`. Save the shots under `screenshots/lead-engine-audit-fixes/`.
- [ ] **Step 4: Final review** with `superpowers:requesting-code-review` over `main..HEAD`; fix Criticals/Importants; re-run the affected suites.
- [ ] **Step 5: Journal.** Dated `[Bug fix]` entry at the top of `JOURNAL.md` with mistakes + lessons. Do not stage it. Confirm `git log main..HEAD --format=%B | grep -ci 'co-authored\|generated with'` is 0.

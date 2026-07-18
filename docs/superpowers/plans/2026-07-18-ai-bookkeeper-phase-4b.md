# AI Bookkeeper Phase 4b — Emailed Accountant Pack + Quarterly Cron — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Spec: Phase-4 design §13 (`docs/superpowers/specs/2026-07-18-ai-bookkeeper-phase-4-design.md`) — the outbound tails, now authorized.

**Goal:** Email the Phase-4 accountant pack outward (flag-gated, default OFF) — a manual "Email to accountant" action on the Reports page, and a quarterly Firebase cron that mails the prior quarter's pack to a stored accountant address.

**Architecture:** One shared server module builds+sends the email (Resend `attachments`, base64 xlsx — a NEW surface, never used in-repo). Two callers: an admin-gated route (manual send from the Reports page) and an internal token-gated route (called by a functions `onSchedule` cron, app-side logic — no functions/lib twin). Both flags DB-backed, seeded OFF via migration 00187 (D10: outward-emitting).

**Tech stack:** Resend SDK via `lib/resend.ts` (`resend`, `FROM_EMAIL` — the insights-email precedent), existing `buildAccountantPack`/`loadReportBundle`/`listAllDocuments`/`presetRange`, `isCronSkipped`/`getSetting`/`setSetting`, `logCronStart/logCronEnd(supabase, …)`, Firebase `onSchedule` POST-with-Bearer pattern.

## Global Constraints

- **Both surfaces are OUTBOUND → DB-backed flags, default OFF**: `bookkeeping_email_pack_enabled` (manual), `cron_bookkeeping_quarterly_pack_enabled` (cron). Seeded `'false'::jsonb` via `INSERT … ON CONFLICT (key) DO NOTHING` (00186 syntax incl. `description` column).
- Manual route self-gates `auth()` → 403 and returns **404 when the flag is off** (the excel-template flag precedent). Internal route gates on Bearer `INTERNAL_CRON_TOKEN` → 401 (revenue-digest precedent) + `isCronSkipped`.
- Resend attachment: `attachments: [{ filename, content: buffer.toString("base64") }]`; explicit `RESEND_API_KEY` presence check → 500 before attempting; Resend `error` → **502**, never a crash; audit records failure outcome.
- Email body carries the honesty block (GROSS / estimate — the CPA files / candidate for review / books separate) and cc's the coach (`COACH_EMAIL` env, `darren@darrenjpaul.com`) when the recipient differs.
- New audit slug `bookkeeping.report_emailed` (category `commerce` — an outbound write, unlike the `admin_read_sensitive` downloads).
- Accountant address: `bookkeeping_accountant_email` system_setting (seeded `'""'::jsonb`). Manual dialog prefills from it and offers a "remember for quarterly sends" checkbox (`remember: true` → `setSetting`); cron **skips as success-with-reason when unset**.
- Cron: functions `onSchedule("0 9 1 1,4,7,10 *")` → POST `/api/admin/internal/bookkeeping-quarterly-pack` with Bearer token; secrets `[supabaseUrl, supabaseServiceRoleKey, internalCronToken, appUrl]`; `logCronStart/End` with `res.ok` check (the runAgentStrategist improved pattern); add `{ name: "bookkeepingQuarterlyPackCron", sla_hours: 2280 }` to `EXPECTED_CRONS`.
- Quarter window = `presetRange("last_quarter", today)` — reuse, don't reimplement.
- Money/CSV/xlsx rules unchanged from Phase 4 (integer cents, formatCents, ledger-only reads). No new tables.
- Stage only your own files; never the pre-existing dirty ones. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration 00187 + validators + audit slug

**Files:**
- Create: `supabase/migrations/00187_bookkeeping_email_pack.sql`
- Modify: `lib/validators/bookkeeping.ts` (append), `lib/audit/actions.ts` (append to `// bookkeeping` block)
- Test: `__tests__/lib/bookkeeping/report-validators.test.ts` (append describe)

**Interfaces produced:** `emailPackSchema` = `{ from: DATE, to: DATE, recipient_email: z.string().email().max(200), remember: z.boolean().optional() }` + the same `from<=to` and 5-year refines as `reportQuerySchema`; audit slug row `{ slug: "bookkeeping.report_emailed", category: "commerce", description: "Accountant pack emailed" }`.

- [ ] **Step 1: failing validator test** (append to report-validators.test.ts):

```ts
describe("emailPackSchema", () => {
  it("requires a valid recipient email", () => {
    expect(emailPackSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", recipient_email: "not-an-email" }).success).toBe(false)
    expect(emailPackSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", recipient_email: "cpa@firm.com" }).success).toBe(true)
  })
  it("keeps the window rules", () => {
    expect(emailPackSchema.safeParse({ from: "2026-03-31", to: "2026-01-01", recipient_email: "cpa@firm.com" }).success).toBe(false)
    expect(emailPackSchema.safeParse({ from: "2019-01-01", to: "2026-01-01", recipient_email: "cpa@firm.com" }).success).toBe(false)
  })
  it("remember is optional boolean", () => {
    expect(emailPackSchema.safeParse({ from: "2026-01-01", to: "2026-03-31", recipient_email: "cpa@firm.com", remember: true }).success).toBe(true)
  })
})
```
(import `emailPackSchema` alongside the existing imports)

- [ ] **Step 2:** run → fail (not exported).
- [ ] **Step 3: implement.** Migration (match 00186's seed syntax exactly — it uses `insert into system_settings (key, value, description)`):

```sql
-- 00187_bookkeeping_email_pack.sql
-- Phase 4b: outbound accountant-pack email flags + stored accountant address.
-- Both flags default OFF (D10: outward-emitting). Additive, reversible, inert without code.
insert into system_settings (key, value, description) values
  ('bookkeeping_email_pack_enabled', 'false'::jsonb, 'Enable the manual "Email to accountant" action on /admin/books/reports'),
  ('cron_bookkeeping_quarterly_pack_enabled', 'false'::jsonb, 'Enable the quarterly accountant-pack email cron'),
  ('bookkeeping_accountant_email', '""'::jsonb, 'Accountant recipient for the quarterly pack (empty = cron skips)')
on conflict (key) do nothing;
```
**Verify `system_settings` column names against migration 00186 before writing** (if 00186 has no `description` column in its insert, match whatever it actually does).

Validators (append after `quickbooksQuerySchema`, reusing the existing `withinFiveYears` helper):

```ts
export const emailPackSchema = z.object({
  from: DATE,
  to: DATE,
  recipient_email: z.string().email().max(200),
  remember: z.boolean().optional(),
})
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" })
  .refine(withinFiveYears, { message: "window too large (max 5 years)" })
```

Audit row after `bookkeeping.report_exported`:
```ts
  { slug: "bookkeeping.report_emailed", category: "commerce", description: "Accountant pack emailed" },
```

- [ ] **Step 4:** validator tests green; `npx tsc --noEmit` clean for touched files. Do NOT apply the migration (the controller applies it via MCP).
- [ ] **Step 5: commit** — `feat(bookkeeper): 00187 email-pack flags + emailPackSchema + report_emailed audit slug`

---

### Task 2: Shared send module — `lib/bookkeeping/email-pack.ts`

**Files:**
- Create: `lib/bookkeeping/email-pack.ts`
- Test: `__tests__/lib/bookkeeping/email-pack.test.ts`

**Interfaces produced:**

```ts
export interface SendAccountantPackInput {
  recipient: string
  from: string   // YYYY-MM-DD window start
  to: string     // YYYY-MM-DD window end
  buffer: Buffer // the xlsx from buildAccountantPack
}
export function accountantPackEmailHtml(from: string, to: string): string
export async function sendAccountantPack(input: SendAccountantPackInput): Promise<{ error: string | null }>
```

- [ ] **Step 1: failing test** (mock `@/lib/resend`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/resend", () => ({
  resend: { emails: { send: vi.fn() } },
  FROM_EMAIL: "DJP <no-reply@darrenjpaul.com>",
}))

import { resend } from "@/lib/resend"
import { sendAccountantPack, accountantPackEmailHtml } from "@/lib/bookkeeping/email-pack"

const send = resend.emails.send as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = "re_test"
  process.env.COACH_EMAIL = "darren@darrenjpaul.com"
})

describe("accountantPackEmailHtml", () => {
  it("carries the honesty block", () => {
    const html = accountantPackEmailHtml("2026-01-01", "2026-03-31")
    expect(html).toContain("GROSS")
    expect(html).toContain("CPA")
    expect(html).toContain("candidate")
    expect(html).toContain("2026-01-01")
  })
})

describe("sendAccountantPack", () => {
  it("sends the xlsx as a base64 attachment with the period filename, cc'ing the coach", async () => {
    send.mockResolvedValue({ data: { id: "email_1" }, error: null })
    const buffer = Buffer.from("xlsx-bytes")
    const res = await sendAccountantPack({ recipient: "cpa@firm.com", from: "2026-01-01", to: "2026-03-31", buffer })
    expect(res.error).toBeNull()
    const arg = send.mock.calls[0][0]
    expect(arg.to).toBe("cpa@firm.com")
    expect(arg.cc).toBe("darren@darrenjpaul.com")
    expect(arg.attachments).toEqual([
      { filename: "djp-accountant-pack-2026-01-01-2026-03-31.xlsx", content: buffer.toString("base64") },
    ])
    expect(arg.subject).toContain("Accountant pack")
  })
  it("does not cc when the recipient IS the coach", async () => {
    send.mockResolvedValue({ data: { id: "e" }, error: null })
    await sendAccountantPack({ recipient: "darren@darrenjpaul.com", from: "2026-01-01", to: "2026-03-31", buffer: Buffer.from("x") })
    expect(send.mock.calls[0][0].cc).toBeUndefined()
  })
  it("returns the resend error message on failure", async () => {
    send.mockResolvedValue({ data: null, error: { message: "boom" } })
    const res = await sendAccountantPack({ recipient: "cpa@firm.com", from: "2026-01-01", to: "2026-03-31", buffer: Buffer.from("x") })
    expect(res.error).toBe("boom")
  })
  it("fails fast when RESEND_API_KEY is unset (never a silent no-op on the money path)", async () => {
    delete process.env.RESEND_API_KEY
    const res = await sendAccountantPack({ recipient: "cpa@firm.com", from: "2026-01-01", to: "2026-03-31", buffer: Buffer.from("x") })
    expect(res.error).toMatch(/RESEND_API_KEY/)
    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** run → fail. **Step 3: implement:**

```ts
/** Phase-4b outbound: emails the accountant pack xlsx via Resend attachments
 *  (base64 — first attachment use in the repo). Shared by the manual
 *  email-pack route and the quarterly cron's internal route. Fails LOUD when
 *  Resend isn't configured — an outbound money artifact must never silently
 *  no-op. */
import { resend, FROM_EMAIL } from "@/lib/resend"

export interface SendAccountantPackInput {
  recipient: string
  from: string
  to: string
  buffer: Buffer
}

export function accountantPackEmailHtml(from: string, to: string): string {
  return `
  <div style="font-family: sans-serif; max-width: 560px;">
    <h2>DJP Athlete — Accountant Pack</h2>
    <p>Attached: the bookkeeping workbook for <strong>${from}</strong> to <strong>${to}</strong> (occurred-on dates, inclusive).</p>
    <ul style="font-size: 13px; color: #444;">
      <li>All figures are <strong>GROSS</strong> — Stripe fees and payouts are not netted.</li>
      <li>Every number is an <strong>estimate for planning; the CPA files</strong>.</li>
      <li>This pack is a <strong>candidate for the accountant's review</strong>, never a filed return.</li>
      <li>Business and personal finances live in separate books; no sheet mixes them.</li>
    </ul>
    <p style="font-size: 12px; color: #888;">Sent from the DJP Athlete bookkeeping system.</p>
  </div>`
}

export async function sendAccountantPack(input: SendAccountantPackInput): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" }
  const coach = process.env.COACH_EMAIL
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: input.recipient,
    ...(coach && coach !== input.recipient ? { cc: coach } : {}),
    subject: `Accountant pack — ${input.from} to ${input.to} (gross, estimates)`,
    html: accountantPackEmailHtml(input.from, input.to),
    attachments: [
      { filename: `djp-accountant-pack-${input.from}-${input.to}.xlsx`, content: input.buffer.toString("base64") },
    ],
  })
  if (error) return { error: error.message ?? "Resend send failed" }
  return { error: null }
}
```
(If the Resend SDK type for `attachments` differs — e.g. wants `content: Buffer` — adapt to what type-checks while KEEPING base64 string if the SDK accepts it; note any deviation.)

- [ ] **Step 4:** tests green; tsc clean. **Step 5: commit** — `feat(bookkeeper): shared accountant-pack email sender (Resend attachments, base64)`

---

### Task 3: Manual route — `POST /api/admin/bookkeeping/reports/email-pack`

**Files:**
- Create: `app/api/admin/bookkeeping/reports/email-pack/route.ts`
- Test: `__tests__/app/api/admin/bookkeeping/reports-email-pack.test.ts`

- [ ] **Step 1: failing test** (mock auth, system-settings, report-data, bookkeeping DAL, accountant-pack, email-pack, audit):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db/system-settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock("@/lib/bookkeeping/report-data", () => ({ loadReportBundle: vi.fn() }))
vi.mock("@/lib/db/bookkeeping", () => ({ listAllDocuments: vi.fn() }))
vi.mock("@/lib/bookkeeping/accountant-pack", () => ({ buildAccountantPack: vi.fn() }))
vi.mock("@/lib/bookkeeping/email-pack", () => ({ sendAccountantPack: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { auth } from "@/lib/auth"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { sendAccountantPack } from "@/lib/bookkeeping/email-pack"
import { recordAudit } from "@/lib/audit/record"
import { POST } from "@/app/api/admin/bookkeeping/reports/email-pack/route"

const UUID = "11111111-2222-4333-8444-555555555555"
const admin = { user: { id: UUID, role: "admin" } }
const body = (b: unknown) => ({ json: async () => b }) as never
const okBody = { from: "2026-01-01", to: "2026-03-31", recipient_email: "cpa@firm.com" }

beforeEach(() => {
  vi.clearAllMocks()
  ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(admin)
  ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(true) // flag ON
  ;(loadReportBundle as ReturnType<typeof vi.fn>).mockResolvedValue({ books: [], accounts: [], entries: [] })
  ;(listAllDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(buildAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("xlsx"))
  ;(sendAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null })
})

describe("POST /api/admin/bookkeeping/reports/email-pack", () => {
  it("403 when not admin", async () => {
    ;(auth as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect((await POST(body(okBody))).status).toBe(403)
    expect(sendAccountantPack).not.toHaveBeenCalled()
  })
  it("404 when the flag is OFF (outbound stays dark by default)", async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    expect((await POST(body(okBody))).status).toBe(404)
    expect(sendAccountantPack).not.toHaveBeenCalled()
  })
  it("400 on invalid recipient", async () => {
    expect((await POST(body({ ...okBody, recipient_email: "nope" }))).status).toBe(400)
  })
  it("502 + failure audit when the send fails", async () => {
    ;(sendAccountantPack as ReturnType<typeof vi.fn>).mockResolvedValue({ error: "boom" })
    const res = await POST(body(okBody))
    expect(res.status).toBe(502)
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.report_emailed", outcome: "failure",
    }))
  })
  it("200: builds, sends, audits success; remember=false leaves the stored address alone", async () => {
    const res = await POST(body(okBody))
    expect(res.status).toBe(200)
    expect(buildAccountantPack).toHaveBeenCalled()
    expect(sendAccountantPack).toHaveBeenCalledWith(expect.objectContaining({ recipient: "cpa@firm.com" }))
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "bookkeeping.report_emailed", category: "commerce", outcome: "success",
      metadata: expect.objectContaining({ recipient_email: "cpa@firm.com" }),
    }))
    expect(setSetting).not.toHaveBeenCalled()
  })
  it("remember=true persists bookkeeping_accountant_email", async () => {
    await POST(body({ ...okBody, remember: true }))
    expect(setSetting).toHaveBeenCalledWith("bookkeeping_accountant_email", "cpa@firm.com", UUID)
  })
})
```

- [ ] **Step 2:** run → fail. **Step 3: implement:**

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { emailPackSchema } from "@/lib/validators/bookkeeping"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { sendAccountantPack } from "@/lib/bookkeeping/email-pack"
import { recordAudit } from "@/lib/audit/record"

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

    const enabled = await getSetting<boolean>("bookkeeping_email_pack_enabled", false)
    if (!enabled) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const parsed = emailPackSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
    const { from, to, recipient_email, remember } = parsed.data

    const [{ books, accounts, entries }, documents] = await Promise.all([loadReportBundle(from, to), listAllDocuments()])
    const buffer = await buildAccountantPack({ from, to, books, accounts, entries, documents })

    const { error } = await sendAccountantPack({ recipient: recipient_email, from, to, buffer })
    if (error) {
      void recordAudit({
        action: "bookkeeping.report_emailed", category: "commerce", outcome: "failure",
        metadata: { recipient_email, from, to, error }, request,
      })
      return NextResponse.json({ error: "Failed to send" }, { status: 502 })
    }

    if (remember) await setSetting("bookkeeping_accountant_email", recipient_email, session.user.id)

    void recordAudit({
      action: "bookkeeping.report_emailed", category: "commerce", outcome: "success",
      metadata: { recipient_email, from, to, entry_count: entries.length }, request,
    })
    return NextResponse.json({ ok: true, sentTo: recipient_email })
  } catch (error) {
    console.error("Email accountant pack error:", error)
    return NextResponse.json({ error: "Failed to email accountant pack" }, { status: 500 })
  }
}
```
**Verify `setSetting`'s exact signature in lib/db/system-settings.ts** (expected `setSetting(key, value, updatedBy)`) and adapt the call+test if it differs.

- [ ] **Step 4:** green; tsc clean. **Step 5: commit** — `feat(bookkeeper): manual email-pack route (flag-gated 404, 502-resilient, audited)`

---

### Task 4: Internal quarterly route + EXPECTED_CRONS entry

**Files:**
- Create: `app/api/admin/internal/bookkeeping-quarterly-pack/route.ts`
- Modify: `lib/automation/automation-health-scanner.ts` (append `{ name: "bookkeepingQuarterlyPackCron", sla_hours: 2280 }` to `EXPECTED_CRONS` — quarterly ≈ 2208h + slack; check for a test pinning the list length and update it)
- Test: `__tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts` (follow the folder's existing internal-route test if one exists — check `__tests__/api/admin/internal/`)

Route (revenue-digest precedent — Bearer token, isCronSkipped, logCronStart/End):

```ts
// POST /api/admin/internal/bookkeeping-quarterly-pack
// Called by functions bookkeepingQuarterlyPackCron on Jan/Apr/Jul/Oct 1.
// Emails the PRIOR calendar quarter's accountant pack to the stored address.
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped, getSetting } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { presetRange } from "@/lib/bookkeeping/period"
import { loadReportBundle } from "@/lib/bookkeeping/report-data"
import { listAllDocuments } from "@/lib/db/bookkeeping"
import { buildAccountantPack } from "@/lib/bookkeeping/accountant-pack"
import { sendAccountantPack } from "@/lib/bookkeeping/email-pack"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({ enabledKey: "cron_bookkeeping_quarterly_pack_enabled", defaultEnabled: false })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingQuarterlyPackCron")
  try {
    const recipient = await getSetting<string>("bookkeeping_accountant_email", "")
    if (!recipient) {
      await logCronEnd(supabase, runId, "success", { skipped: "no accountant email configured" })
      return NextResponse.json({ skipped: "no accountant email configured" }, { status: 200 })
    }

    const today = new Date().toISOString().slice(0, 10)
    const { from, to } = presetRange("last_quarter", today)
    const [{ books, accounts, entries }, documents] = await Promise.all([loadReportBundle(from, to), listAllDocuments()])
    const buffer = await buildAccountantPack({ from, to, books, accounts, entries, documents })
    const { error } = await sendAccountantPack({ recipient, from, to, buffer })
    if (error) throw new Error(error)

    void recordAudit({
      action: "bookkeeping.report_emailed", category: "commerce", outcome: "success",
      actor: { type: "system", label: "bookkeepingQuarterlyPackCron" },
      metadata: { recipient_email: recipient, from, to, entry_count: entries.length, trigger: "quarterly_cron" },
    })
    await logCronEnd(supabase, runId, "success", { sentTo: recipient, from, to, entry_count: entries.length })
    return NextResponse.json({ ok: true, sentTo: recipient, from, to })
  } catch (err) {
    const message = (err as Error).message
    console.error("[bookkeeping-quarterly-pack] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```
**Verify `recordAudit`'s actor-override shape in lib/audit/record.ts** (CLAUDE.md says it accepts an `actor` override for system/cron writes) — adapt the call to the real shape (grep an existing cron/webhook recordAudit usage); if no system-actor precedent exists, follow whatever record.ts's types allow.

Tests: 401 without/with-wrong bearer; flag-off → `{skipped}` 200 with NO logCronStart; empty recipient → 200 skipped + logCronEnd success with reason; happy path (mock everything; assert presetRange window passed through, sendAccountantPack called with stored recipient, logCronEnd success); send-error → 500 + logCronEnd failed. Mock modules exactly like Task 3 plus `@/lib/db/cron-runs` and `@/lib/supabase`.

- [ ] Steps: failing tests → implement → green → tsc clean → **commit** `feat(bookkeeper): internal quarterly-pack route + health-scanner expected entry`

---

### Task 5: Functions cron — `bookkeepingQuarterlyPackCron`

**Files:**
- Modify: `functions/src/index.ts` (append near the other insights crons, e.g. after the bookkeeping retention cron)

Follow the improved POST pattern (runAgentStrategist, index.ts ~880-910): `onSchedule({ schedule: "0 9 1 1,4,7,10 *", timeZone: "Etc/UTC", region: "us-central1", secrets: [supabaseUrl, supabaseServiceRoleKey, internalCronToken, appUrl] })` → guard `APP_URL`/`INTERNAL_CRON_TOKEN` present → `fetch(`${baseUrl}/api/admin/internal/bookkeeping-quarterly-pack`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}" })` → check `res.ok`. **Note:** the app route does its own `logCronStart/End` — the functions side must NOT double-log (check how other POST-delegating crons handle this: if siblings like revenueDigestCron log functions-side while the route does not, follow THAT split instead and remove route-side logging accordingly; pick whichever side the existing crons log on, consistently — report which you found).
Match the exact timeZone value used by sibling onSchedule crons (check — some use "Etc/UTC").

Verification: `cd functions && npm run build` clean; if a functions test suite covers index exports, run it (`npm test` in functions/) and confirm no regressions.

- [ ] **Commit** — `feat(bookkeeper): quarterly accountant-pack cron (flag OFF, POSTs internal route)`

---

### Task 6: Reports UI — Email-to-accountant dialog

**Files:**
- Modify: `app/(admin)/admin/books/reports/page.tsx` — server page reads the flag + stored address and passes props:

```tsx
import { listBooks } from "@/lib/db/bookkeeping"
import { getSetting } from "@/lib/db/system-settings"
import { ReportsClient } from "@/components/admin/bookkeeping/ReportsClient"

export const metadata = { title: "Reports — Books — Admin" }

export default async function BooksReportsPage() {
  const [books, emailPackEnabled, accountantEmail] = await Promise.all([
    listBooks(),
    getSetting<boolean>("bookkeeping_email_pack_enabled", false),
    getSetting<string>("bookkeeping_accountant_email", ""),
  ])
  return <ReportsClient books={books} emailPackEnabled={emailPackEnabled} defaultAccountantEmail={accountantEmail} />
}
```

- Modify: `components/admin/bookkeeping/ReportsClient.tsx` — props become `{ books, emailPackEnabled, defaultAccountantEmail }: { books: BookkeepingBook[]; emailPackEnabled: boolean; defaultAccountantEmail: string }`; add an "Email to accountant" outline Button (Mail icon) to the export row, rendered ONLY when `emailPackEnabled`, opening the dialog with the current `from`/`to`.
- Create: `components/admin/bookkeeping/EmailPackDialog.tsx` — follow ManualEntryDialog's Dialog+fetch+toast idiom: props `{ open, onOpenChange, from, to, defaultRecipient }`; a `type="email"` input prefilled with `defaultRecipient`; a "Remember for quarterly sends" checkbox (defaults false); period displayed read-only ("Sends the accountant pack for {from} – {to} — gross figures, estimates; the CPA files."); Send button POSTs `/api/admin/bookkeeping/reports/email-pack` with `{ from, to, recipient_email, remember }`, disabled while sending or when the input is empty; success → `toast.success("Pack emailed to …")` + close; failure → `toast.error(data.error ?? "Failed to send")`.

Verification: `npx tsc --noEmit` clean for the three files; `npx vitest run __tests__/app/api/admin/bookkeeping __tests__/lib/bookkeeping` green (route/page contract untouched elsewhere).

- [ ] **Commit** — `feat(bookkeeper): Email-to-accountant dialog (flag-gated, remember-address option)`

---

### Task 7: Verification (controller)
- [ ] Scoped: `npx vitest run __tests__/lib/bookkeeping __tests__/app/api/admin/bookkeeping __tests__/api/admin/internal/bookkeeping-quarterly-pack.test.ts __tests__/lib/csv` green.
- [ ] Apply migration 00187 via `mcp__supabase__apply_migration` (additive, flags false = inert) + verify seeds live.
- [ ] Full suite vs known-red baseline; `npm run build` GREEN; `cd functions && npm run build` (+ functions tests) GREEN.
- [ ] Whole-branch review (Opus) — trace: flag OFF → both surfaces dark (404 / skipped, nothing sends); flag ON manual path recipient→attachment bytes; cron path stored-address→window→send; audit rows both outcomes.

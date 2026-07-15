# AI Lead Analysis + Draft Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a lead submits the inquiry form, automatically generate an AI priority signal, summary, and draft reply; surface these in the coach's notification email and on the lead's admin page, with unambiguous `mailto:`/`tel:` actions that always reach the lead directly (replacing the confusing system reply-to).

**Architecture:** `POST /api/inquiry` persists the raw submission to a new `lead_inquiries` table, calls a pure `generateLeadAnalysis()` helper (Sonnet via the existing `callAgent` wrapper), logs the call through the existing `ai_generation_log` pattern, and passes the result into `sendInquiryEmail`. The admin client page reads the same row and renders an editable draft + Email/Call buttons, with a "Regenerate" action hitting a new admin-gated route that reuses the identical generation function.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres), `@ai-sdk/anthropic` via `lib/ai/anthropic.ts` (`callAgent`, `MODEL_SONNET`), Zod, Vitest.

## Global Constraints

- Follow the project's DAL convention: one file per table in `lib/db/`, service-role client only, throw on Supabase error.
- `callAgent` (not raw `generateObject`) is mandatory for any new structured AI output — it forces `structuredOutputMode: "jsonTool"`, which is required for Zod `.min()/.max()` constraints to survive (see `lib/ai/anthropic.ts:75-86`).
- No feature flag for this feature (per project convention: flags are reserved for money/mass-email risk; this is neither).
- New audit actions must be added to the closed list in `lib/audit/actions.ts`.
- This project has no `src/`; path alias `@/*` maps to the repo root.
- Commit after each task.

---

### Task 1: `lead_inquiries` migration

**Files:**
- Create: `supabase/migrations/00182_lead_inquiries.sql`

**Interfaces:**
- Produces: table `lead_inquiries` with columns `id, lead_user_id, name, email, phone, service, sport, experience, goals, injuries, how_heard, gclid, ai_priority, ai_priority_reason, ai_summary, ai_draft_reply, ai_generated_at, ai_generation_log_id, created_at` — consumed by Tasks 5, 7, 9, 11.

- [ ] **Step 1: Write the migration file**

```sql
-- 00182_lead_inquiries.sql
-- Persists raw inquiry-form submissions (previously only used transiently in
-- the notification email, never stored anywhere) plus AI-generated
-- priority/summary/draft-reply fields for the lead's admin page and the
-- coach notification email.

CREATE TABLE IF NOT EXISTS lead_inquiries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  service               TEXT NOT NULL,
  sport                 TEXT,
  experience            TEXT,
  goals                 TEXT NOT NULL,
  injuries              TEXT,
  how_heard             TEXT,
  gclid                 TEXT,
  ai_priority           TEXT CHECK (ai_priority IN ('high','medium','low')),
  ai_priority_reason    TEXT,
  ai_summary            TEXT,
  ai_draft_reply        TEXT,
  ai_generated_at       TIMESTAMPTZ,
  ai_generation_log_id  UUID REFERENCES ai_generation_log(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_inquiries_lead_user_id ON lead_inquiries(lead_user_id);

ALTER TABLE lead_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all lead inquiries" ON lead_inquiries FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
```

- [ ] **Step 2: Apply the migration**

Use the `mcp__supabase__apply_migration` tool with `name: "00182_lead_inquiries"` and the SQL body above (this project's convention — the Supabase CLI is not linked; see `supabase_migrations_via_mcp` project memory).

- [ ] **Step 3: Verify**

Use `mcp__supabase__list_tables` and confirm `lead_inquiries` appears with the columns above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00182_lead_inquiries.sql
git commit -m "feat(db): add lead_inquiries table for AI lead analysis"
```

---

### Task 2: Types

**Files:**
- Modify: `types/database.ts` (insert after the `AiGenerationLog` interface, currently ending at line 662)

**Interfaces:**
- Produces: `LeadPriority` type, `LeadInquiry` interface — consumed by Tasks 5, 7, 8, 9, 10, 11.

- [ ] **Step 1: Add the type and interface**

Insert immediately after the closing brace of `AiGenerationLog` (after line 662, before `export interface TrackedExercise {`):

```ts
export type LeadPriority = "high" | "medium" | "low"

export interface LeadInquiry {
  id: string
  lead_user_id: string | null
  name: string
  email: string
  phone: string | null
  service: string
  sport: string | null
  experience: string | null
  goals: string
  injuries: string | null
  how_heard: string | null
  gclid: string | null
  ai_priority: LeadPriority | null
  ai_priority_reason: string | null
  ai_summary: string | null
  ai_draft_reply: string | null
  ai_generated_at: string | null
  ai_generation_log_id: string | null
  created_at: string
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced (pre-existing unrelated errors, if any, are out of scope — see project memory on baseline tsc noise).

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "feat(types): add LeadInquiry and LeadPriority types"
```

---

### Task 3: `mailto:`/`tel:` link builder

**Files:**
- Create: `lib/leads/build-mailto-link.ts`
- Test: `__tests__/lib/leads/build-mailto-link.test.ts`

**Interfaces:**
- Produces: `buildLeadMailtoLink({ email, subject, body }): string`, `buildTelLink(phone: string): string` — consumed by Tasks 7 (email template) and 10 (admin panel).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/leads/build-mailto-link.test.ts
import { describe, it, expect } from "vitest"
import { buildLeadMailtoLink, buildTelLink } from "@/lib/leads/build-mailto-link"

describe("buildLeadMailtoLink", () => {
  it("encodes spaces as %20, not +", () => {
    const link = buildLeadMailtoLink({
      email: "lead@example.com",
      subject: "Re: Hi there",
      body: "Thanks for reaching out",
    })
    expect(link).toContain("subject=Re%3A%20Hi%20there")
    expect(link).toContain("body=Thanks%20for%20reaching%20out")
    expect(link).not.toContain("+")
  })

  it("starts with mailto: and the raw address", () => {
    const link = buildLeadMailtoLink({ email: "lead@example.com", subject: "s", body: "b" })
    expect(link.startsWith("mailto:lead@example.com?")).toBe(true)
  })

  it("truncates long bodies with an ellipsis", () => {
    const longBody = "a".repeat(700)
    const link = buildLeadMailtoLink({ email: "lead@example.com", subject: "s", body: longBody })
    const bodyParam = decodeURIComponent(link.split("body=")[1])
    expect(bodyParam.length).toBeLessThanOrEqual(601)
    expect(bodyParam.endsWith("…")).toBe(true)
  })

  it("leaves short bodies untouched", () => {
    const link = buildLeadMailtoLink({ email: "lead@example.com", subject: "s", body: "short" })
    const bodyParam = decodeURIComponent(link.split("body=")[1])
    expect(bodyParam).toBe("short")
  })
})

describe("buildTelLink", () => {
  it("strips formatting characters, keeps digits and a leading +", () => {
    expect(buildTelLink("(786) 831-1665")).toBe("tel:7868311665")
    expect(buildTelLink("+1 786-831-1665")).toBe("tel:+17868311665")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/leads/build-mailto-link.test.ts`
Expected: FAIL — `Cannot find module '@/lib/leads/build-mailto-link'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/leads/build-mailto-link.ts

// mailto: bodies have practical length limits across mail clients (some
// truncate well before 2000 chars). Keep this well under that ceiling —
// generateLeadAnalysis's prompt also asks for a short draft, this is the
// defensive backstop regardless of what the model returns.
const MAILTO_BODY_MAX_CHARS = 600

export function buildLeadMailtoLink({
  email,
  subject,
  body,
}: {
  email: string
  subject: string
  body: string
}): string {
  const truncatedBody =
    body.length > MAILTO_BODY_MAX_CHARS ? `${body.slice(0, MAILTO_BODY_MAX_CHARS).trimEnd()}…` : body
  // encodeURIComponent (not URLSearchParams) — mailto per RFC 6068 expects
  // %20 for spaces; URLSearchParams' form-encoding would emit "+" instead,
  // which some mail clients render literally.
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(truncatedBody)}`
  return `mailto:${email}?${query}`
}

export function buildTelLink(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "")
  return `tel:${digits}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/leads/build-mailto-link.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/leads/build-mailto-link.ts __tests__/lib/leads/build-mailto-link.test.ts
git commit -m "feat(leads): add mailto/tel link builder"
```

---

### Task 4: AI lead-analysis generation helper

**Files:**
- Create: `lib/ai/lead-analysis.ts`
- Test: `__tests__/lib/ai/lead-analysis.test.ts`

**Interfaces:**
- Consumes: `callAgent(systemPrompt, userMessage, schema, options)` and `MODEL_SONNET` from `@/lib/ai/anthropic` (existing).
- Produces: `generateLeadAnalysis(input: LeadAnalysisInput): Promise<AgentCallResult<LeadAnalysisResult>>`, `LeadAnalysisResult` type — consumed by Tasks 7 (email/route wiring), 9 (regenerate route).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/ai/lead-analysis.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

describe("generateLeadAnalysis", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("calls callAgent with MODEL_SONNET and returns its content", async () => {
    const mockCallAgent = vi.fn().mockResolvedValue({
      content: {
        priority: "high",
        priority_reason: "Clear goals, ready to book.",
        summary: "Logan is a baseball player looking for in-person coaching.",
        draft_reply: "Hi Logan, thanks for reaching out...",
      },
      tokens_used: 500,
    })
    vi.doMock("@/lib/ai/anthropic", () => ({
      callAgent: mockCallAgent,
      MODEL_SONNET: "sonnet",
    }))

    const { generateLeadAnalysis } = await import("@/lib/ai/lead-analysis")
    const result = await generateLeadAnalysis({
      name: "Logan Scalzo",
      serviceLabel: "In-Person Coaching",
      sport: "Baseball",
      experience: null,
      goals: "Get faster and stronger for next season",
      injuries: null,
      howHeard: null,
    })

    expect(result.content.priority).toBe("high")
    expect(mockCallAgent).toHaveBeenCalledTimes(1)
    const [systemPrompt, userMessage, , options] = mockCallAgent.mock.calls[0]
    expect(systemPrompt).toContain("Coach Darren")
    expect(userMessage).toContain("Logan Scalzo")
    expect(userMessage).toContain("Baseball")
    expect(options).toMatchObject({ model: "sonnet" })
  })

  it("omits optional fields from the prompt when absent", async () => {
    const mockCallAgent = vi.fn().mockResolvedValue({
      content: { priority: "low", priority_reason: "Vague ask.", summary: "Thin info.", draft_reply: "Hi..." },
      tokens_used: 300,
    })
    vi.doMock("@/lib/ai/anthropic", () => ({
      callAgent: mockCallAgent,
      MODEL_SONNET: "sonnet",
    }))

    const { generateLeadAnalysis } = await import("@/lib/ai/lead-analysis")
    await generateLeadAnalysis({
      name: "Jane Doe",
      serviceLabel: "Online Coaching",
      goals: "Just getting started",
    })

    const userMessage = mockCallAgent.mock.calls[0][1]
    expect(userMessage).not.toContain("Sport:")
    expect(userMessage).not.toContain("Injuries")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/ai/lead-analysis.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/lead-analysis'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/lead-analysis.ts
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "@/lib/ai/anthropic"

export const leadAnalysisSchema = z.object({
  priority: z.enum(["high", "medium", "low"]),
  priority_reason: z.string().min(1).max(220),
  summary: z.string().min(1).max(600),
  draft_reply: z.string().min(1).max(900),
})

export type LeadAnalysisResult = z.infer<typeof leadAnalysisSchema>

const SYSTEM_PROMPT = `You are helping Coach Darren, owner of DJP Athlete, triage and respond to new coaching inquiries submitted through his website. You will be given the raw details someone submitted through the inquiry form.

Return:
1. priority: "high" | "medium" | "low" — how promising/ready-to-book this lead looks. High = clear goals, ready to commit, no ambiguity. Medium = interested but vague, or has open questions. Low = very thin information, likely just browsing, or a mismatch for what DJP Athlete offers.
2. priority_reason: one sentence (under 25 words), in plain language, explaining the priority call and referencing something specific from what they wrote. If they mentioned an injury or physical limitation, surface it here — Darren needs to see that immediately.
3. summary: 2-3 sentences a busy coach can read in five seconds to understand who this lead is and what they want.
4. draft_reply: a warm, ready-to-send email reply FROM Darren TO the lead, under 120 words. Reference their specific goals/sport by name, don't invent facts not present in the submission, and end by inviting them to book a call. Sign off as "Coach Darren, DJP Athlete".

Be direct and specific — avoid generic filler. This is a real business email, not a template.`

export interface LeadAnalysisInput {
  name: string
  serviceLabel: string
  sport?: string | null
  experience?: string | null
  goals: string
  injuries?: string | null
  howHeard?: string | null
}

export async function generateLeadAnalysis(input: LeadAnalysisInput) {
  const userMessage = [
    `Name: ${input.name}`,
    `Service requested: ${input.serviceLabel}`,
    input.sport ? `Sport: ${input.sport}` : null,
    input.experience ? `Experience level: ${input.experience}` : null,
    input.injuries ? `Injuries/limitations: ${input.injuries}` : null,
    input.howHeard ? `How they heard about us: ${input.howHeard}` : null,
    `Goals (in their own words):\n${input.goals}`,
  ]
    .filter(Boolean)
    .join("\n")

  return callAgent(SYSTEM_PROMPT, userMessage, leadAnalysisSchema, { model: MODEL_SONNET, maxTokens: 1200 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/ai/lead-analysis.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ai/lead-analysis.ts __tests__/lib/ai/lead-analysis.test.ts
git commit -m "feat(ai): add generateLeadAnalysis helper"
```

---

### Task 5: `lead_inquiries` data access layer

**Files:**
- Create: `lib/db/lead-inquiries.ts`
- Test: `__tests__/lib/db/lead-inquiries.test.ts`

**Interfaces:**
- Consumes: `LeadInquiry` type from `@/types/database` (Task 2), `createServiceRoleClient` from `@/lib/supabase` (existing).
- Produces: `createLeadInquiry(data)`, `updateLeadInquiryAiFields(id, updates)`, `getLeadInquiryByUserId(userId): Promise<LeadInquiry | null>`, `getLeadInquiryById(id): Promise<LeadInquiry>` — consumed by Tasks 7, 9, 11.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/db/lead-inquiries.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const state: { result: { data: unknown; error: unknown }; lastInsert?: unknown; lastUpdate?: unknown } = {
  result: { data: null, error: null },
}

function makeBuilder() {
  const single = vi.fn(() => Promise.resolve(state.result))
  const maybeSingle = vi.fn(() => Promise.resolve(state.result))
  const limit = vi.fn(() => ({ maybeSingle }))
  const order = vi.fn(() => ({ limit }))
  const eqAfterSelect = vi.fn(() => ({ order, single }))
  return {
    insert: vi.fn((payload: unknown) => {
      state.lastInsert = payload
      return { select: vi.fn(() => ({ single })) }
    }),
    update: vi.fn((payload: unknown) => {
      state.lastUpdate = payload
      return { eq: vi.fn(() => ({ select: vi.fn(() => ({ single })) })) }
    }),
    select: vi.fn(() => ({ eq: eqAfterSelect })),
  }
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: vi.fn(() => makeBuilder()) }),
}))

import {
  createLeadInquiry,
  updateLeadInquiryAiFields,
  getLeadInquiryByUserId,
  getLeadInquiryById,
} from "@/lib/db/lead-inquiries"

beforeEach(() => {
  state.result = { data: { id: "li-1" }, error: null }
  state.lastInsert = undefined
  state.lastUpdate = undefined
})

describe("createLeadInquiry", () => {
  it("inserts the raw submission fields", async () => {
    await createLeadInquiry({
      lead_user_id: "user-1",
      name: "Logan Scalzo",
      email: "logan@example.com",
      phone: "7868311665",
      service: "in_person",
      sport: "Baseball",
      experience: null,
      goals: "Get faster",
      injuries: null,
      how_heard: null,
      gclid: null,
    })
    expect(state.lastInsert).toMatchObject({ name: "Logan Scalzo", service: "in_person" })
  })

  it("throws on error", async () => {
    state.result = { data: null, error: { message: "boom" } }
    await expect(
      createLeadInquiry({
        lead_user_id: null,
        name: "x",
        email: "x@example.com",
        phone: null,
        service: "in_person",
        sport: null,
        experience: null,
        goals: "x",
        injuries: null,
        how_heard: null,
        gclid: null,
      }),
    ).rejects.toBeTruthy()
  })
})

describe("updateLeadInquiryAiFields", () => {
  it("updates the AI-generated fields", async () => {
    await updateLeadInquiryAiFields("li-1", {
      ai_priority: "high",
      ai_priority_reason: "Clear goals",
      ai_summary: "Summary",
      ai_draft_reply: "Draft",
      ai_generation_log_id: "log-1",
      ai_generated_at: "2026-07-15T00:00:00.000Z",
    })
    expect(state.lastUpdate).toMatchObject({ ai_priority: "high", ai_generation_log_id: "log-1" })
  })
})

describe("getLeadInquiryByUserId", () => {
  it("returns the most recent row for the user", async () => {
    state.result = { data: { id: "li-1", lead_user_id: "user-1" }, error: null }
    const row = await getLeadInquiryByUserId("user-1")
    expect(row?.id).toBe("li-1")
  })
})

describe("getLeadInquiryById", () => {
  it("returns the row", async () => {
    state.result = { data: { id: "li-1" }, error: null }
    const row = await getLeadInquiryById("li-1")
    expect(row.id).toBe("li-1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/db/lead-inquiries.test.ts`
Expected: FAIL — `Cannot find module '@/lib/db/lead-inquiries'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/db/lead-inquiries.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { LeadInquiry, LeadPriority } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function createLeadInquiry(
  data: Omit<
    LeadInquiry,
    "id" | "created_at" | "ai_priority" | "ai_priority_reason" | "ai_summary" | "ai_draft_reply" | "ai_generated_at" | "ai_generation_log_id"
  >,
) {
  const supabase = getClient()
  const { data: result, error } = await supabase.from("lead_inquiries").insert(data).select().single()
  if (error) throw error
  return result as LeadInquiry
}

export async function updateLeadInquiryAiFields(
  id: string,
  updates: {
    ai_priority: LeadPriority
    ai_priority_reason: string
    ai_summary: string
    ai_draft_reply: string
    ai_generation_log_id: string | null
    ai_generated_at: string
  },
) {
  const supabase = getClient()
  const { data, error } = await supabase.from("lead_inquiries").update(updates).eq("id", id).select().single()
  if (error) throw error
  return data as LeadInquiry
}

export async function getLeadInquiryByUserId(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_inquiries")
    .select("*")
    .eq("lead_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as LeadInquiry | null
}

export async function getLeadInquiryById(id: string) {
  const supabase = getClient()
  const { data, error } = await supabase.from("lead_inquiries").select("*").eq("id", id).single()
  if (error) throw error
  return data as LeadInquiry
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/db/lead-inquiries.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/db/lead-inquiries.ts __tests__/lib/db/lead-inquiries.test.ts
git commit -m "feat(db): add lead_inquiries data access layer"
```

---

### Task 6: Audit action

**Files:**
- Modify: `lib/audit/actions.ts` (in the `// automation` section, after the `ai.*` entries around line 89)

**Interfaces:**
- Produces: audit slug `"lead.ai_analysis_generated"` — consumed by Tasks 7, 9.

- [ ] **Step 1: Add the audit action row**

Insert a new entry directly after the existing `ai.generation_completed` row (around line 89 in the `// automation` section):

```ts
  { slug: "lead.ai_analysis_generated", category: "automation", description: "AI priority/summary/draft-reply generated for a lead inquiry" },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/audit/actions.ts
git commit -m "feat(audit): add lead.ai_analysis_generated action"
```

---

### Task 7: Email template — AI section + Email/Call buttons

**Files:**
- Modify: `lib/email.ts` (`sendInquiryEmail`, currently lines 1653-1755)

**Interfaces:**
- Consumes: `buildLeadMailtoLink`, `buildTelLink` (Task 3), `LeadAnalysisResult` (Task 4), existing `ctaButton`, `infoCard`, `sectionLabel`, `emailLayout` helpers in this file.
- Produces: `sendInquiryEmail` gains an optional `aiAnalysis?: LeadAnalysisResult | null` param — consumed by Task 8.

- [ ] **Step 1: Add imports**

At the top of `lib/email.ts`, alongside the existing imports (after line 5):

```ts
import type { LeadAnalysisResult } from "@/lib/ai/lead-analysis"
import { buildLeadMailtoLink, buildTelLink } from "@/lib/leads/build-mailto-link"
```

- [ ] **Step 2: Replace `sendInquiryEmail`**

Replace the entire function (lines 1653-1755, from `export async function sendInquiryEmail({` through its closing `}`) with:

```ts
const PRIORITY_STYLES: Record<LeadAnalysisResult["priority"], { bg: string; color: string; label: string }> = {
  high: { bg: "#dcfce7", color: "#166534", label: "High Priority" },
  medium: { bg: "#fef3c7", color: "#92400e", label: "Medium Priority" },
  low: { bg: "#ede9e3", color: "#78736c", label: "Low Priority" },
}

export async function sendInquiryEmail({
  name,
  email,
  phone,
  serviceLabel,
  sport,
  experience,
  goals,
  injuries,
  how_heard,
  aiAnalysis,
}: {
  name: string
  email: string
  phone?: string | null
  serviceLabel: string
  sport?: string | null
  experience?: string | null
  goals: string
  injuries?: string | null
  how_heard?: string | null
  aiAnalysis?: LeadAnalysisResult | null
}) {
  const infoRows: { label: string; value: string }[] = [
    { label: "Name", value: name },
    { label: "Email", value: email },
    { label: "Service", value: serviceLabel },
  ]
  if (phone) infoRows.push({ label: "Phone", value: phone })
  if (sport) infoRows.push({ label: "Sport", value: sport })
  if (experience) infoRows.push({ label: "Experience", value: experience })
  if (how_heard) infoRows.push({ label: "How They Heard About Us", value: how_heard })

  const firstName = name.split(" ")[0]
  const priorityStyle = aiAnalysis ? PRIORITY_STYLES[aiAnalysis.priority] : null

  const aiSectionHtml = aiAnalysis
    ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
            <tr>
              <td>
                <span style="display:inline-block; background-color:${priorityStyle!.bg}; color:${priorityStyle!.color}; font-size:11px; font-weight:600; padding:4px 14px; border-radius:2px; letter-spacing:0.5px;">
                  ${priorityStyle!.label}
                </span>
                <p style="margin:8px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:14px; color:#5c5750; line-height:1.7;">
                  ${aiAnalysis.priority_reason}
                </p>
              </td>
            </tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #0E3F50;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Suggested Reply
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${aiAnalysis.draft_reply}
                </p>
              </td>
            </tr>
          </table>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
            <tr>
              <td style="padding-right:12px;">
                ${ctaButton(
                  buildLeadMailtoLink({
                    email,
                    subject: `Re: Your ${serviceLabel} Application`,
                    body: aiAnalysis.draft_reply,
                  }),
                  `Email ${firstName}`,
                )}
              </td>
              ${phone ? `<td>${ctaButton(buildTelLink(phone), `Call ${firstName}`, "secondary")}</td>` : ""}
            </tr>
          </table>
    `
    : `
          <p style="margin:32px 0 0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:13px; color:#a09b94;">
            Reply directly to <a href="mailto:${email}" style="color:#0E3F50; text-decoration:underline;">${email}</a>
          </p>
    `

  const html = emailLayout(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 52px;">

          ${sectionLabel(`New ${serviceLabel} Application`)}

          <p style="margin:0 0 8px; font-family:'Lexend Exa', Georgia, 'Times New Roman', serif; font-size:22px; font-weight:400; color:#0E3F50;">
            New Inquiry
          </p>

          <p style="margin:0 0 28px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8;">
            A potential client has submitted an application for <strong style="color:#0E3F50;">${serviceLabel}</strong>.
          </p>

          ${infoCard(infoRows)}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Goals
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${goals}
                </p>
              </td>
            </tr>
          </table>

          ${
            injuries
              ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px; background-color:#faf9f7; border-radius:2px; border-left:3px solid #C49B7A;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 8px; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:10px; font-weight:600; color:#a09b94; text-transform:uppercase; letter-spacing:2px;">
                  Injuries / Limitations
                </p>
                <p style="margin:0; font-family:'Lexend Deca', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; color:#5c5750; line-height:1.8; white-space:pre-wrap;">
                  ${injuries}
                </p>
              </td>
            </tr>
          </table>
          `
              : ""
          }

          ${aiSectionHtml}

        </td>
      </tr>
    </table>
  `)

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: SALES_EMAIL,
    cc: ADMIN_CC,
    replyTo: email,
    subject: `[Inquiry] New ${serviceLabel} Application — ${name}`,
    html,
  })

  if (error) {
    console.error("Failed to send inquiry email:", error)
    throw new Error("Failed to send inquiry email")
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test:run`
Expected: PASS — this file has no dedicated existing test, confirm no other suite imports/breaks on the changed signature.

- [ ] **Step 5: Commit**

```bash
git add lib/email.ts
git commit -m "feat(email): add AI priority/draft-reply section to inquiry notification"
```

---

### Task 8: Wire AI generation into `/api/inquiry`

**Files:**
- Modify: `app/api/inquiry/route.ts`

**Interfaces:**
- Consumes: `createLeadInquiry`, `updateLeadInquiryAiFields` (Task 5), `generateLeadAnalysis` (Task 4), `createGenerationLog`, `updateGenerationLog` (existing `@/lib/db/ai-generation-log`), `MODEL_SONNET` (existing `@/lib/ai/anthropic`), `recordAudit` (existing `@/lib/audit/record`), `sendInquiryEmail(..., aiAnalysis)` (Task 7).

- [ ] **Step 1: Replace the route file**

Replace the full contents of `app/api/inquiry/route.ts` with:

```ts
import { NextResponse } from "next/server"
import { inquiryFormSchema, SERVICE_LABELS } from "@/lib/validators/inquiry"
import { createServiceRoleClient } from "@/lib/supabase"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import { sendInquiryEmail, sendInquiryAutoReply } from "@/lib/email"
import { withAudit } from "@/lib/audit/with-audit"
import { recordAudit } from "@/lib/audit/record"
import { createLeadInquiry, updateLeadInquiryAiFields } from "@/lib/db/lead-inquiries"
import { generateLeadAnalysis, type LeadAnalysisResult } from "@/lib/ai/lead-analysis"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { MODEL_SONNET } from "@/lib/ai/anthropic"

export const POST = withAudit(
  { action: "contact.submitted", category: "marketing" },
  async (request) => {
  try {
    const body = await request.json()
    const result = inquiryFormSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { name, email, phone, service, sport, experience, goals, injuries, how_heard, gclid } = result.data
    const serviceLabel = SERVICE_LABELS[service]

    const supabase = createServiceRoleClient()

    // Auto-create the inquiry submitter as a lead in the Clients list
    // (same pattern as /api/contact). If they already exist, backfill phone if missing.
    const nameParts = name.trim().split(/\s+/)
    const firstName = nameParts[0] || name.trim()
    const lastName = nameParts.slice(1).join(" ")

    let leadUserId: string | null = null
    const { data: existingUser } = await supabase
      .from("users")
      .select("id, phone")
      .eq("email", email)
      .maybeSingle()

    if (existingUser) {
      leadUserId = existingUser.id
      if (phone && !existingUser.phone) {
        await supabase.from("users").update({ phone }).eq("id", existingUser.id)
      }
    } else {
      const { data: newLead, error: leadError } = await supabase
        .from("users")
        .insert({
          email,
          first_name: firstName,
          last_name: lastName,
          phone,
          role: "client",
          status: "lead",
          email_verified: false,
        })
        .select("id")
        .single()

      if (leadError) {
        console.error("Failed to create lead user from inquiry:", leadError)
      } else {
        leadUserId = newLead?.id ?? null
      }
    }

    // Notify all admins
    const { data: admins } = await supabase.from("users").select("id").eq("role", "admin")

    // Persist the raw submission — previously these fields only ever existed
    // transiently in the notification email body.
    let leadInquiryId: string | null = null
    try {
      const inquiryRow = await createLeadInquiry({
        lead_user_id: leadUserId,
        name,
        email,
        phone,
        service,
        sport,
        experience,
        goals,
        injuries,
        how_heard,
        gclid,
      })
      leadInquiryId = inquiryRow.id
    } catch (err) {
      console.error("Failed to persist lead inquiry:", err)
    }

    // Generate AI priority/summary/draft-reply (non-blocking — falls back to
    // the plain notification below if this fails, same pattern as the email
    // sends further down).
    let aiAnalysis: LeadAnalysisResult | null = null
    const firstAdminId = admins?.[0]?.id ?? null
    if (leadInquiryId && firstAdminId) {
      const startTime = Date.now()
      let logId: string | null = null
      try {
        const log = await createGenerationLog({
          program_id: null,
          client_id: leadUserId,
          requested_by: firstAdminId,
          status: "pending",
          input_params: { feature: "lead_inquiry_analysis", name, service, sport, experience, goals, injuries, how_heard },
          output_summary: null,
          error_message: null,
          model_used: MODEL_SONNET,
          tokens_used: null,
          cache_creation_tokens: null,
          cache_read_tokens: null,
          duration_ms: null,
          completed_at: null,
          current_step: 0,
          total_steps: 1,
          generation_trigger: "lead_inquiry",
        })
        logId = log.id

        const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await generateLeadAnalysis({
          name,
          serviceLabel,
          sport,
          experience,
          goals,
          injuries,
          howHeard: how_heard,
        })
        aiAnalysis = content

        await updateGenerationLog(logId, {
          status: "completed",
          output_summary: { priority: content.priority, summary: content.summary },
          tokens_used,
          cache_creation_tokens: cache_creation_tokens ?? null,
          cache_read_tokens: cache_read_tokens ?? null,
          duration_ms: Date.now() - startTime,
          completed_at: new Date().toISOString(),
        })

        await updateLeadInquiryAiFields(leadInquiryId, {
          ai_priority: content.priority,
          ai_priority_reason: content.priority_reason,
          ai_summary: content.summary,
          ai_draft_reply: content.draft_reply,
          ai_generation_log_id: logId,
          ai_generated_at: new Date().toISOString(),
        })

        await recordAudit({
          action: "lead.ai_analysis_generated",
          category: "automation",
          actor: { id: firstAdminId, role: "system" },
          target: { type: "lead_inquiry", id: leadInquiryId, label: name },
          metadata: { priority: content.priority },
        })
      } catch (err) {
        console.error("Failed to generate lead AI analysis — continuing without it:", err)
        if (logId) {
          await updateGenerationLog(logId, {
            status: "failed",
            error_message: err instanceof Error ? err.message : "Unknown error",
            duration_ms: Date.now() - startTime,
            completed_at: new Date().toISOString(),
          }).catch(() => {})
        }
        await recordAudit({
          action: "lead.ai_analysis_generated",
          category: "automation",
          outcome: "failure",
          actor: { id: firstAdminId, role: "system" },
          target: { type: "lead_inquiry", id: leadInquiryId, label: name },
          error: { message: err instanceof Error ? err.message : "Unknown error" },
        }).catch(() => {})
      }
    }

    if (admins && admins.length > 0) {
      const details = [
        `Service: ${serviceLabel}`,
        `From: ${name} (${email})`,
        phone ? `Phone: ${phone}` : null,
        sport ? `Sport: ${sport}` : null,
        experience ? `Experience: ${experience}` : null,
        `\nGoals:\n${goals}`,
        injuries ? `\nInjuries/Limitations:\n${injuries}` : null,
        how_heard ? `How they heard about us: ${how_heard}` : null,
        gclid ? `Google Ads click id: ${gclid}` : null,
      ]
        .filter(Boolean)
        .join("\n")

      const notifications = admins.map((admin) => ({
        user_id: admin.id,
        type: "info" as const,
        title: `New ${serviceLabel} Application`,
        message: details,
        is_read: false,
        link: leadUserId ? `/admin/clients/${leadUserId}` : null,
      }))

      const { error: insertError } = await supabase.from("notifications").insert(notifications)

      if (insertError) {
        console.error("Failed to create inquiry notifications:", insertError)
      }
    }

    // Send email notification to sales (non-blocking)
    try {
      await sendInquiryEmail({
        name,
        email,
        phone,
        serviceLabel,
        sport,
        experience,
        goals,
        injuries,
        how_heard,
        aiAnalysis,
      })
    } catch {
      console.error("Failed to send inquiry email — continuing")
    }

    // Auto-reply to the person with booking link (non-blocking)
    try {
      await sendInquiryAutoReply({ to: email, firstName: name.split(" ")[0], serviceLabel })
    } catch {
      console.error("Failed to send inquiry auto-reply — continuing")
    }

    // Sync to GoHighLevel (non-blocking)
    try {
      const contact = await ghlCreateContact({
        email,
        firstName: name.split(" ")[0],
        lastName: name.split(" ").slice(1).join(" ") || undefined,
        phone: phone ?? undefined,
        tags: [
          "inquiry",
          `service-${service}`,
          sport ? `sport-${sport.toLowerCase()}` : "",
          // Stored as a tag so the GHL export can join lead → Google Ads click id
          // for the qualified-conversion upload back to Google Ads.
          gclid ? `gclid:${gclid}` : "",
        ].filter(Boolean),
        source: `website-inquiry-${service}`,
      })
      if (contact?.id && process.env.GHL_WORKFLOW_NEW_INQUIRY) {
        await ghlTriggerWorkflow(contact.id, process.env.GHL_WORKFLOW_NEW_INQUIRY)
      }
    } catch {
      // GHL sync failure should not affect form submission
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
  }
  },
)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/inquiry/route.ts
git commit -m "feat(inquiry): generate AI lead analysis on submission"
```

---

### Task 9: Admin regenerate-analysis route

**Files:**
- Create: `app/api/admin/leads/[id]/regenerate-analysis/route.ts`

**Interfaces:**
- Consumes: `auth` (existing `@/lib/auth`), `generateLeadAnalysis` (Task 4), `getLeadInquiryById`, `updateLeadInquiryAiFields` (Task 5), `createGenerationLog`, `updateGenerationLog` (existing), `recordAudit` (existing), `SERVICE_LABELS`, `ServiceType` (existing `@/lib/validators/inquiry`).
- Produces: `POST /api/admin/leads/[id]/regenerate-analysis` returning the updated `LeadInquiry` JSON — consumed by Task 10.

- [ ] **Step 1: Write the route**

```ts
// app/api/admin/leads/[id]/regenerate-analysis/route.ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { generateLeadAnalysis } from "@/lib/ai/lead-analysis"
import { createGenerationLog, updateGenerationLog } from "@/lib/db/ai-generation-log"
import { getLeadInquiryById, updateLeadInquiryAiFields } from "@/lib/db/lead-inquiries"
import { recordAudit } from "@/lib/audit/record"
import { MODEL_SONNET } from "@/lib/ai/anthropic"
import { SERVICE_LABELS, type ServiceType } from "@/lib/validators/inquiry"

export const maxDuration = 30

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const { id } = await params
  const startTime = Date.now()

  let inquiry: Awaited<ReturnType<typeof getLeadInquiryById>>
  try {
    inquiry = await getLeadInquiryById(id)
  } catch {
    return NextResponse.json({ error: "Lead inquiry not found" }, { status: 404 })
  }

  let logId: string | null = null
  try {
    const log = await createGenerationLog({
      program_id: null,
      client_id: inquiry.lead_user_id,
      requested_by: session.user.id,
      status: "pending",
      input_params: { feature: "lead_inquiry_analysis", regenerate: true, name: inquiry.name },
      output_summary: null,
      error_message: null,
      model_used: MODEL_SONNET,
      tokens_used: null,
      cache_creation_tokens: null,
      cache_read_tokens: null,
      duration_ms: null,
      completed_at: null,
      current_step: 0,
      total_steps: 1,
      generation_trigger: "lead_inquiry_regenerate",
    })
    logId = log.id

    const { content, tokens_used, cache_creation_tokens, cache_read_tokens } = await generateLeadAnalysis({
      name: inquiry.name,
      serviceLabel: SERVICE_LABELS[inquiry.service as ServiceType] ?? inquiry.service,
      sport: inquiry.sport,
      experience: inquiry.experience,
      goals: inquiry.goals,
      injuries: inquiry.injuries,
      howHeard: inquiry.how_heard,
    })

    await updateGenerationLog(logId, {
      status: "completed",
      output_summary: { priority: content.priority, summary: content.summary },
      tokens_used,
      cache_creation_tokens: cache_creation_tokens ?? null,
      cache_read_tokens: cache_read_tokens ?? null,
      duration_ms: Date.now() - startTime,
      completed_at: new Date().toISOString(),
    })

    const updated = await updateLeadInquiryAiFields(id, {
      ai_priority: content.priority,
      ai_priority_reason: content.priority_reason,
      ai_summary: content.summary,
      ai_draft_reply: content.draft_reply,
      ai_generation_log_id: logId,
      ai_generated_at: new Date().toISOString(),
    })

    await recordAudit({
      action: "lead.ai_analysis_generated",
      category: "automation",
      target: { type: "lead_inquiry", id, label: inquiry.name },
      metadata: { priority: content.priority, regenerate: true },
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error("Failed to regenerate lead analysis:", err)
    if (logId) {
      await updateGenerationLog(logId, {
        status: "failed",
        error_message: err instanceof Error ? err.message : "Unknown error",
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      }).catch(() => {})
    }
    return NextResponse.json({ error: "Failed to regenerate analysis" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/leads/[id]/regenerate-analysis/route.ts"
git commit -m "feat(admin): add lead analysis regenerate route"
```

---

### Task 10: Admin `LeadInquiryPanel` component

**Files:**
- Create: `components/admin/clients/LeadInquiryPanel.tsx`

**Interfaces:**
- Consumes: `LeadInquiry` type (Task 2), `buildLeadMailtoLink`/`buildTelLink` (Task 3), `SERVICE_LABELS`/`ServiceType` (existing), `Button` (existing `@/components/ui/button`), regenerate route (Task 9).
- Produces: `<LeadInquiryPanel leadInquiry={LeadInquiry} phone={string | null} />` — consumed by Task 11.

- [ ] **Step 1: Write the component**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles, RefreshCw, Mail, Phone as PhoneIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { buildLeadMailtoLink, buildTelLink } from "@/lib/leads/build-mailto-link"
import { SERVICE_LABELS, type ServiceType } from "@/lib/validators/inquiry"
import type { LeadInquiry } from "@/types/database"

const PRIORITY_STYLES: Record<NonNullable<LeadInquiry["ai_priority"]>, string> = {
  high: "bg-success/10 text-success",
  medium: "bg-warning/10 text-warning",
  low: "bg-muted text-muted-foreground",
}

export function LeadInquiryPanel({
  leadInquiry,
  phone,
}: {
  leadInquiry: LeadInquiry
  phone: string | null
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(leadInquiry.ai_draft_reply ?? "")
  const [busy, setBusy] = useState(false)

  const serviceLabel = SERVICE_LABELS[leadInquiry.service as ServiceType] ?? leadInquiry.service
  const firstName = leadInquiry.name.split(" ")[0]

  async function regenerate() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/leads/${leadInquiry.id}/regenerate-analysis`, { method: "POST" })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      toast.error("Could not generate analysis")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-primary flex items-center gap-2">
          <Sparkles className="size-5" strokeWidth={1.5} />
          Lead Inquiry
        </h2>
        {leadInquiry.ai_priority && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PRIORITY_STYLES[leadInquiry.ai_priority]}`}
          >
            {leadInquiry.ai_priority} priority
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 mb-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Service</p>
          <p className="text-foreground">{serviceLabel}</p>
        </div>
        {leadInquiry.sport && (
          <div>
            <p className="text-xs text-muted-foreground">Sport</p>
            <p className="text-foreground">{leadInquiry.sport}</p>
          </div>
        )}
        {leadInquiry.experience && (
          <div>
            <p className="text-xs text-muted-foreground">Experience</p>
            <p className="text-foreground">{leadInquiry.experience}</p>
          </div>
        )}
        {leadInquiry.how_heard && (
          <div>
            <p className="text-xs text-muted-foreground">How they heard about us</p>
            <p className="text-foreground">{leadInquiry.how_heard}</p>
          </div>
        )}
      </div>

      <div className="mb-4">
        <p className="text-xs text-muted-foreground mb-1">Goals</p>
        <p className="text-sm text-foreground whitespace-pre-wrap">{leadInquiry.goals}</p>
      </div>

      {leadInquiry.injuries && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-1">Injuries / Limitations</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{leadInquiry.injuries}</p>
        </div>
      )}

      {leadInquiry.ai_priority_reason && (
        <p className="text-sm text-muted-foreground mb-4">{leadInquiry.ai_priority_reason}</p>
      )}

      <div className="mb-4">
        <p className="text-xs text-muted-foreground mb-1.5">
          {leadInquiry.ai_draft_reply ? "Draft Reply (editable)" : "No draft yet"}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-border p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Generate an analysis to get a draft reply…"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {draft && (
          <Button asChild>
            <a
              href={buildLeadMailtoLink({
                email: leadInquiry.email,
                subject: `Re: Your ${serviceLabel} Application`,
                body: draft,
              })}
            >
              <Mail className="size-4" /> Email {firstName}
            </a>
          </Button>
        )}
        {phone && (
          <Button asChild variant="outline">
            <a href={buildTelLink(phone)}>
              <PhoneIcon className="size-4" /> Call {firstName}
            </a>
          </Button>
        )}
        <Button type="button" variant="ghost" disabled={busy} onClick={regenerate}>
          <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          {leadInquiry.ai_draft_reply ? "Regenerate" : "Generate Analysis"}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/clients/LeadInquiryPanel.tsx
git commit -m "feat(admin): add LeadInquiryPanel component"
```

---

### Task 11: Wire the panel into the admin client page

**Files:**
- Modify: `app/(admin)/admin/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `getLeadInquiryByUserId` (Task 5), `<LeadInquiryPanel>` (Task 10).

- [ ] **Step 1: Import the DAL function and component**

Add near the top with the other `lib/db` imports (after line 55, `import { loadClientPacksView, ... } from "@/lib/services/client-packs-view"`):

```ts
import { getLeadInquiryByUserId } from "@/lib/db/lead-inquiries"
```

Add near the other component imports (after line 75, `import { ClientFavoriteExercisesPanel } from "@/components/admin/favorites/ClientFavoriteExercisesPanel"`):

```ts
import { LeadInquiryPanel } from "@/components/admin/clients/LeadInquiryPanel"
```

- [ ] **Step 2: Fetch the lead inquiry row**

In the `Promise.all([...])` call (currently lines 628-638), add `getLeadInquiryByUserId(id).catch(() => null)` as a new array entry and destructure it as `leadInquiry`:

```ts
  const [profile, assignments, payments, progressData, achievements, workoutStreak, packs, favorites, allExercises, leadInquiry] = await Promise.all([
    getProfileByUserId(id),
    getAssignments(id),
    getPayments(id),
    getProgress(id),
    getAchievements(id),
    getWorkoutStreak(id),
    loadClientPacksView(id),
    listFavoritesByClient(id).catch(() => []),
    getExercises().catch(() => []),
    getLeadInquiryByUserId(id).catch(() => null),
  ])
```

- [ ] **Step 3: Render the panel**

In the `<div className="space-y-6">` sections block (currently starting at line 848), render the panel first, before `<ClientSessionsPanel ...>`:

```tsx
      {/* Sections */}
      <div className="space-y-6">
        {leadInquiry && <LeadInquiryPanel leadInquiry={leadInquiry} phone={user.phone ?? leadInquiry.phone} />}
        <ClientSessionsPanel
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/clients/[id]/page.tsx"
git commit -m "feat(admin): show LeadInquiryPanel on the client detail page"
```

---

### Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm run test:run`
Expected: PASS. If any of the ~8-9 pre-existing unrelated reds noted in project memory (`test_baseline_not_green`) appear, confirm they're unchanged from baseline (not newly broken by this feature) rather than assuming they're fine.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this feature's files (pre-existing `.next`/test noise is out of scope per project memory).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors in the files this plan touched (project memory notes `npm run lint` is broken repo-wide on Next 16 independent of this work — do not attempt to fix that here).

- [ ] **Step 4: Manual click-through**

Start the dev server (`npm run dev`), submit a real test inquiry through `/in-person` (or POST directly to `/api/inquiry` with a realistic payload), and confirm:
- The `lead_inquiries` row was created with the AI fields populated (check via `mcp__supabase__execute_sql` or the Supabase dashboard).
- The notification email (check the Resend dashboard/log, since `RESEND_API_KEY` may not be set locally) would render the priority badge, suggested-reply card, and Email/Call buttons.
- `/admin/clients/[id]` for that lead shows the `LeadInquiryPanel` with the draft pre-filled, editable, and the Email/Call buttons produce correct `mailto:`/`tel:` hrefs (inspect via browser dev tools if Resend isn't configured locally).
- Click "Regenerate" and confirm the draft updates.

- [ ] **Step 5: Update the local journal**

Add a dated entry to `JOURNAL.md` (or create it if missing) documenting this feature per the user's global journal convention — **do not commit this file** (it should already be gitignored; if not, add it to `.gitignore` first).

- [ ] **Step 6: Final commit**

```bash
git status
```

Confirm the working tree is clean (all task commits already made). If anything is unstaged, review it before adding.

---

## Self-Review Notes

- **Spec coverage:** automatic generation on submit (Task 8), priority + reason (Task 4 schema), both email (Task 7) and admin-page (Tasks 10-11) surfaces, `mailto:`-based send (Tasks 3, 7, 10), regenerate action (Tasks 9-10), non-blocking error handling (Task 8's try/catch), no phone → Call button omitted (Tasks 7, 10) — all covered.
- **Type consistency checked:** `LeadInquiry`/`LeadPriority` (Task 2) used identically in Tasks 5, 7 (via `LeadAnalysisResult["priority"]`), 9, 10, 11. `generateLeadAnalysis` input field names (`howHeard`, not `how_heard`) are consistent between Task 4's definition and Tasks 8/9's call sites.
- **No placeholders** remain — every step has complete, runnable code.

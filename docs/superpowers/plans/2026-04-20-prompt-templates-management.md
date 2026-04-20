# Prompt Templates Management + AI Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins add, edit, and delete their own AI prompt templates from the admin UI, and use Haiku to polish drafts or generate full templates from a short seed idea.

**Architecture:** New Supabase table `prompt_templates` (global shared) with admin CRUD API. Existing 30 hardcoded templates in [lib/prompt-templates.ts](../../lib/prompt-templates.ts) remain as read-only "Built-in" defaults. The existing `TemplateSelector` dropdown merges Built-in + Custom at render time. Two AI assistance modes (`polish` and `generate`) run via Claude Haiku 4.5 against a reverse-engineered house-style system prompt.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL + RLS), NextAuth v5, Zod, shadcn/ui, `@ai-sdk/anthropic`, Vitest (DAL + validator tests).

**Spec:** [docs/superpowers/specs/2026-04-20-prompt-templates-management-design.md](../specs/2026-04-20-prompt-templates-management-design.md)

**Conventions observed in this codebase:**
- DAL in `lib/db/<entity>.ts` uses `createServiceRoleClient()` and casts results (no `Database` generic)
- API routes guard with `const session = await auth(); if (session?.user?.role !== "admin") ...`
- Data fetching in client components = plain `fetch` + `useState` + `useEffect` (no React Query / SWR)
- Zod schemas live in `lib/validators/<entity>.ts`
- Types live in `types/database.ts` with entity interface + table mapping in `Database["public"]["Tables"]`
- Migrations are numbered sequentially — the next one will be `00075_*.sql`
- UI primitives live in `components/ui/` (shadcn/ui new-york style)
- Admin pages are server components at `app/(admin)/admin/<slug>/page.tsx` with `requireAdmin()` guard

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/00075_prompt_templates.sql`

- [ ] **Step 1: Create the migration SQL**

```sql
-- supabase/migrations/00075_prompt_templates.sql
CREATE TABLE prompt_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text NOT NULL CHECK (category IN (
                  'structure', 'session', 'periodization',
                  'sport', 'rehab', 'conditioning', 'specialty'
                )),
  scope         text NOT NULL CHECK (scope IN ('week', 'day', 'both')),
  description   text NOT NULL,
  prompt        text NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prompt_templates_scope ON prompt_templates(scope);
CREATE INDEX idx_prompt_templates_category ON prompt_templates(category);
CREATE INDEX idx_prompt_templates_updated ON prompt_templates(updated_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_prompt_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prompt_templates_updated_at
  BEFORE UPDATE ON prompt_templates
  FOR EACH ROW EXECUTE FUNCTION set_prompt_templates_updated_at();

ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;
-- Note: API routes use the service-role client and bypass RLS,
-- matching the existing pattern for admin-only tables (e.g. coach_ai_policy, shop_products).
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or paste into Supabase SQL editor if using hosted DB)
Expected: migration applies cleanly; `prompt_templates` table visible in Supabase Studio.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00075_prompt_templates.sql
git commit -m "feat(db): add prompt_templates table for custom AI templates"
```

---

## Task 2: TypeScript types

**Files:**
- Modify: `types/database.ts`

- [ ] **Step 1: Add the `PromptTemplate` interface**

Insert after the `Notification` interface (around line 410):

```ts
export interface PromptTemplate {
  id: string
  name: string
  category: "structure" | "session" | "periodization" | "sport" | "rehab" | "conditioning" | "specialty"
  scope: "week" | "day" | "both"
  description: string
  prompt: string
  created_by: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Add the table entry to the `Database["public"]["Tables"]` map**

Insert after the `notifications` table entry (around line 961):

```ts
prompt_templates: {
  Row: PromptTemplate
  Insert: Omit<PromptTemplate, "id" | "created_at" | "updated_at">
  Update: Partial<Omit<PromptTemplate, "id" | "created_at" | "updated_at">>
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors related to this change.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "feat(types): add PromptTemplate type"
```

---

## Task 3: Zod validators

**Files:**
- Create: `lib/validators/prompt-template.ts`
- Create: `__tests__/lib/validators/prompt-template.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/validators/prompt-template.test.ts
import { describe, it, expect } from "vitest"
import {
  promptTemplateCreateSchema,
  promptTemplateUpdateSchema,
  enhanceRequestSchema,
} from "@/lib/validators/prompt-template"

describe("prompt-template validators", () => {
  const valid = {
    name: "My Template",
    category: "structure" as const,
    scope: "week" as const,
    description: "A description",
    prompt: "Do this and that",
  }

  it("accepts a valid create payload", () => {
    expect(promptTemplateCreateSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects unknown category", () => {
    const r = promptTemplateCreateSchema.safeParse({ ...valid, category: "nonsense" })
    expect(r.success).toBe(false)
  })

  it("rejects unknown scope", () => {
    const r = promptTemplateCreateSchema.safeParse({ ...valid, scope: "monthly" })
    expect(r.success).toBe(false)
  })

  it("rejects empty name/prompt/description", () => {
    expect(promptTemplateCreateSchema.safeParse({ ...valid, name: "" }).success).toBe(false)
    expect(promptTemplateCreateSchema.safeParse({ ...valid, prompt: "" }).success).toBe(false)
    expect(promptTemplateCreateSchema.safeParse({ ...valid, description: "" }).success).toBe(false)
  })

  it("update schema accepts partial payloads", () => {
    expect(promptTemplateUpdateSchema.safeParse({ name: "New name" }).success).toBe(true)
    expect(promptTemplateUpdateSchema.safeParse({}).success).toBe(true)
  })

  it("enhanceRequestSchema accepts polish and generate modes", () => {
    expect(enhanceRequestSchema.safeParse({ mode: "polish", input: "rough draft" }).success).toBe(true)
    expect(enhanceRequestSchema.safeParse({ mode: "generate", input: "lat width day" }).success).toBe(true)
  })

  it("enhanceRequestSchema rejects unknown mode", () => {
    expect(enhanceRequestSchema.safeParse({ mode: "evil", input: "x" }).success).toBe(false)
  })

  it("enhanceRequestSchema rejects empty input", () => {
    expect(enhanceRequestSchema.safeParse({ mode: "polish", input: "" }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:run -- __tests__/lib/validators/prompt-template.test.ts`
Expected: FAIL — cannot resolve `@/lib/validators/prompt-template`.

- [ ] **Step 3: Create the validator file**

```ts
// lib/validators/prompt-template.ts
import { z } from "zod"

export const TEMPLATE_CATEGORIES = [
  "structure",
  "session",
  "periodization",
  "sport",
  "rehab",
  "conditioning",
  "specialty",
] as const

export const TEMPLATE_SCOPES = ["week", "day", "both"] as const

export const promptTemplateCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  category: z.enum(TEMPLATE_CATEGORIES),
  scope: z.enum(TEMPLATE_SCOPES),
  description: z.string().min(1, "Description is required").max(200),
  prompt: z.string().min(1, "Prompt is required").max(4000),
})

export const promptTemplateUpdateSchema = promptTemplateCreateSchema.partial()

export const enhanceRequestSchema = z.object({
  mode: z.enum(["polish", "generate"]),
  input: z.string().min(1).max(4000),
  target_scope: z.enum(["week", "day"]).optional(),
})

export type PromptTemplateCreateInput = z.infer<typeof promptTemplateCreateSchema>
export type PromptTemplateUpdateInput = z.infer<typeof promptTemplateUpdateSchema>
export type EnhanceRequest = z.infer<typeof enhanceRequestSchema>
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm run test:run -- __tests__/lib/validators/prompt-template.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/prompt-template.ts __tests__/lib/validators/prompt-template.test.ts
git commit -m "feat(validators): add prompt-template Zod schemas"
```

---

## Task 4: DAL — `lib/db/prompt-templates.ts`

**Files:**
- Create: `lib/db/prompt-templates.ts`
- Create: `__tests__/db/prompt-templates.test.ts`

- [ ] **Step 1: Write the failing DAL tests**

```ts
// __tests__/db/prompt-templates.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest"
import {
  listPromptTemplates,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  getPromptTemplateById,
} from "@/lib/db/prompt-templates"
import { createServiceRoleClient } from "@/lib/supabase"

const TEST_TAG = "__TEST_PROMPT_TPL__"

describe("prompt-templates DAL", () => {
  const supabase = createServiceRoleClient()

  async function cleanup() {
    await supabase.from("prompt_templates").delete().like("name", `${TEST_TAG}%`)
  }

  beforeEach(cleanup)
  afterAll(cleanup)

  it("creates, reads, updates, and deletes a template", async () => {
    const created = await createPromptTemplate({
      name: `${TEST_TAG}A`,
      category: "structure",
      scope: "week",
      description: "d",
      prompt: "p",
      created_by: null,
    })
    expect(created.id).toBeTruthy()

    const fetched = await getPromptTemplateById(created.id)
    expect(fetched?.name).toBe(`${TEST_TAG}A`)

    const updated = await updatePromptTemplate(created.id, { name: `${TEST_TAG}B` })
    expect(updated.name).toBe(`${TEST_TAG}B`)

    await deletePromptTemplate(created.id)
    const gone = await getPromptTemplateById(created.id)
    expect(gone).toBeNull()
  })

  it("lists with optional scope filter", async () => {
    await createPromptTemplate({
      name: `${TEST_TAG}week-only`,
      category: "structure",
      scope: "week",
      description: "d",
      prompt: "p",
      created_by: null,
    })
    await createPromptTemplate({
      name: `${TEST_TAG}day-only`,
      category: "session",
      scope: "day",
      description: "d",
      prompt: "p",
      created_by: null,
    })
    await createPromptTemplate({
      name: `${TEST_TAG}both`,
      category: "specialty",
      scope: "both",
      description: "d",
      prompt: "p",
      created_by: null,
    })

    const weekScoped = await listPromptTemplates({ scope: "week" })
    const names = weekScoped.map((t) => t.name).filter((n) => n.startsWith(TEST_TAG))
    // week-scoped listing must include "week" and "both", exclude "day"
    expect(names).toContain(`${TEST_TAG}week-only`)
    expect(names).toContain(`${TEST_TAG}both`)
    expect(names).not.toContain(`${TEST_TAG}day-only`)
  })

  it("list without scope returns all", async () => {
    await createPromptTemplate({
      name: `${TEST_TAG}A`,
      category: "structure",
      scope: "week",
      description: "d",
      prompt: "p",
      created_by: null,
    })
    const all = await listPromptTemplates()
    const names = all.map((t) => t.name).filter((n) => n.startsWith(TEST_TAG))
    expect(names.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run tests, confirm FAIL**

Run: `npm run test:run -- __tests__/db/prompt-templates.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/prompt-templates`.

- [ ] **Step 3: Write the DAL**

```ts
// lib/db/prompt-templates.ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { PromptTemplate } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listPromptTemplates(opts?: { scope?: "week" | "day" }): Promise<PromptTemplate[]> {
  const supabase = getClient()
  let query = supabase.from("prompt_templates").select("*").order("updated_at", { ascending: false })
  if (opts?.scope) {
    // When filtering by "week", include "both"; same for "day". "both" always shows.
    query = query.in("scope", [opts.scope, "both"])
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as PromptTemplate[]
}

export async function getPromptTemplateById(id: string): Promise<PromptTemplate | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("prompt_templates").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data ?? null) as PromptTemplate | null
}

export async function createPromptTemplate(
  input: Omit<PromptTemplate, "id" | "created_at" | "updated_at">,
): Promise<PromptTemplate> {
  const supabase = getClient()
  const { data, error } = await supabase.from("prompt_templates").insert(input).select().single()
  if (error) throw error
  return data as PromptTemplate
}

export async function updatePromptTemplate(
  id: string,
  patch: Partial<Omit<PromptTemplate, "id" | "created_at" | "updated_at" | "created_by">>,
): Promise<PromptTemplate> {
  const supabase = getClient()
  const { data, error } = await supabase.from("prompt_templates").update(patch).eq("id", id).select().single()
  if (error) throw error
  return data as PromptTemplate
}

export async function deletePromptTemplate(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("prompt_templates").delete().eq("id", id)
  if (error) throw error
}
```

- [ ] **Step 4: Run tests, confirm PASS**

Run: `npm run test:run -- __tests__/db/prompt-templates.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/prompt-templates.ts __tests__/db/prompt-templates.test.ts
git commit -m "feat(db): add prompt-templates DAL"
```

---

## Task 5: AI enhancement library

**Files:**
- Create: `lib/ai/enhance-template.ts`

Claude Haiku is already set up via `MODEL_HAIKU` export in [lib/ai/anthropic.ts](../../lib/ai/anthropic.ts). The existing `callAgent` helper returns structured output via Zod — perfect fit.

- [ ] **Step 1: Create the enhancement lib**

```ts
// lib/ai/enhance-template.ts
import { z } from "zod"
import { callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"
import { TEMPLATE_CATEGORIES, TEMPLATE_SCOPES } from "@/lib/validators/prompt-template"

// ─── System prompts (house style) ────────────────────────────────────────────

const HOUSE_STYLE = `The DJP Athlete AI generates training weeks and days from coach instructions. The coach instructions you produce must be concrete and actionable — the downstream AI architect will follow them literally.

Canonical slot roles: warm_up, primary_compound, secondary_compound, accessory, isolation, cool_down, power, conditioning, activation, testing.
Canonical techniques: straight_set, superset, dropset, giant_set, circuit, rest_pause, amrap, cluster_set, complex, emom, wave_loading.

Style requirements:
- Short imperative headline (e.g., "HOTEL GYM — limited equipment (dumbbells and bodyweight only):")
- Bulleted list of specific directives with concrete sets/reps/RPE/rest/tempo numbers
- Reference canonical roles/techniques by name when prescribing structure
- State overrides explicitly ("use straight sets only", "4 power exercises", "no supersets")
- Keep under ~400 words
- No fluff, no preamble, no sign-off`

const POLISH_SYSTEM = `You polish draft coach instructions for DJP Athlete's AI program generator.

${HOUSE_STYLE}

Take the coach's rough draft and rewrite it in the house style. Preserve every concrete constraint the coach wrote — add specificity (numbers, canonical terms), do not invent new constraints the coach did not imply.`

const GENERATE_SYSTEM = `You create reusable coach-instruction templates for DJP Athlete's AI program generator library.

${HOUSE_STYLE}

Given a short seed idea from an admin, output a complete template with:
- name: short, title-case, 2-5 words (e.g., "Hotel Gym", "Lower Leg Focus Week")
- description: one-line hook under 100 chars
- category: one of ${TEMPLATE_CATEGORIES.join(", ")}
- scope: one of ${TEMPLATE_SCOPES.join(", ")} — pick "week" for multi-day themes, "day" for single-session focuses, "both" for constraints that work at either level
- prompt: the full house-style coach instructions

Choose the most specific category. If no category fits well, use "structure".`

// ─── Schemas ────────────────────────────────────────────────────────────────

const polishSchema = z.object({
  prompt: z.string().min(1).max(4000),
})

const generateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(200),
  category: z.enum(TEMPLATE_CATEGORIES),
  scope: z.enum(TEMPLATE_SCOPES),
  prompt: z.string().min(1).max(4000),
})

export type PolishResult = z.infer<typeof polishSchema>
export type GenerateResult = z.infer<typeof generateSchema>

// ─── Public API ─────────────────────────────────────────────────────────────

export async function polishPrompt(
  input: string,
  targetScope?: "week" | "day",
): Promise<PolishResult> {
  const userMessage = [
    targetScope ? `Context: this is for a generate-${targetScope} dialog.` : "",
    "Rough draft from the coach:",
    input,
    "",
    "Rewrite in the house style. Output only the polished prompt text in the JSON `prompt` field.",
  ]
    .filter(Boolean)
    .join("\n")

  const { content } = await callAgent(POLISH_SYSTEM, userMessage, polishSchema, {
    model: MODEL_HAIKU,
    maxTokens: 2000,
    cacheSystemPrompt: true,
  })
  return content
}

export async function generateTemplate(
  seed: string,
  targetScope?: "week" | "day",
): Promise<GenerateResult> {
  const userMessage = [
    targetScope ? `Hint: the admin is working in a generate-${targetScope} context (bias scope accordingly, but override if the seed clearly indicates otherwise).` : "",
    "Seed idea from admin:",
    seed,
    "",
    "Output a complete template in the JSON schema.",
  ]
    .filter(Boolean)
    .join("\n")

  const { content } = await callAgent(GENERATE_SYSTEM, userMessage, generateSchema, {
    model: MODEL_HAIKU,
    maxTokens: 2000,
    cacheSystemPrompt: true,
  })
  return content
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/enhance-template.ts
git commit -m "feat(ai): add Haiku-powered polish and generate-template helpers"
```

---

## Task 6: API — list & create (`GET`/`POST`)

**Files:**
- Create: `app/api/admin/ai-templates/route.ts`
- Create: `__tests__/api/admin/ai-templates.test.ts` (light smoke — full e2e covered manually)

- [ ] **Step 1: Create the route**

```ts
// app/api/admin/ai-templates/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listPromptTemplates, createPromptTemplate } from "@/lib/db/prompt-templates"
import { promptTemplateCreateSchema } from "@/lib/validators/prompt-template"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const rawScope = url.searchParams.get("scope")
  const scope = rawScope === "week" || rawScope === "day" ? rawScope : undefined

  const templates = await listPromptTemplates(scope ? { scope } : undefined)
  return NextResponse.json({ templates })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = promptTemplateCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }

  const created = await createPromptTemplate({
    ...parsed.data,
    created_by: session.user.id,
  })
  return NextResponse.json({ template: created }, { status: 201 })
}
```

- [ ] **Step 2: Smoke-test manually**

Run the dev server: `npm run dev`
In a separate terminal while logged in as admin:
```bash
curl http://localhost:3050/api/admin/ai-templates -b "$(cat <admin-session-cookie>)"
```
Expected: `{ "templates": [] }` (or your existing test rows from Task 4).

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/ai-templates/route.ts
git commit -m "feat(api): add GET/POST /api/admin/ai-templates"
```

---

## Task 7: API — update & delete (`PATCH`/`DELETE`)

**Files:**
- Create: `app/api/admin/ai-templates/[id]/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/admin/ai-templates/[id]/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updatePromptTemplate, deletePromptTemplate, getPromptTemplateById } from "@/lib/db/prompt-templates"
import { promptTemplateUpdateSchema } from "@/lib/validators/prompt-template"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await getPromptTemplateById(id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const parsed = promptTemplateUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }

  const updated = await updatePromptTemplate(id, parsed.data)
  return NextResponse.json({ template: updated })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await getPromptTemplateById(id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await deletePromptTemplate(id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/ai-templates/[id]/route.ts
git commit -m "feat(api): add PATCH/DELETE /api/admin/ai-templates/[id]"
```

---

## Task 8: API — AI enhance endpoint

**Files:**
- Create: `app/api/admin/ai-templates/enhance/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/admin/ai-templates/enhance/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { enhanceRequestSchema } from "@/lib/validators/prompt-template"
import { polishPrompt, generateTemplate } from "@/lib/ai/enhance-template"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = enhanceRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 })
  }

  const { mode, input, target_scope } = parsed.data

  try {
    if (mode === "polish") {
      const result = await polishPrompt(input, target_scope)
      return NextResponse.json({ mode, ...result })
    } else {
      const result = await generateTemplate(input, target_scope)
      return NextResponse.json({ mode, ...result })
    }
  } catch (err) {
    console.error("[ai-templates/enhance] error:", err)
    const message = err instanceof Error ? err.message : "Enhancement failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Manual smoke test**

With dev server running, in admin session:
```bash
curl -X POST http://localhost:3050/api/admin/ai-templates/enhance \
  -H "Content-Type: application/json" \
  -b "<admin-session-cookie>" \
  -d '{"mode":"polish","input":"make it a push day focused on shoulders"}'
```
Expected: `{ "mode": "polish", "prompt": "UPPER PUSH DAY — shoulder focus:\n- ..." }` in ~2s.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/ai-templates/enhance/route.ts
git commit -m "feat(api): add POST /api/admin/ai-templates/enhance (polish + generate)"
```

---

## Task 9: Shared component — `EnhancePreviewModal`

Used by: Enhance button in dialogs, Template editor's inline Enhance, Create-from-idea flow.

**Files:**
- Create: `components/admin/ai-templates/enhance-preview-modal.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/admin/ai-templates/enhance-preview-modal.tsx
"use client"

import { useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export type EnhanceMode = "polish" | "generate"

export interface PolishPayload {
  mode: "polish"
  prompt: string
}
export interface GeneratePayload {
  mode: "generate"
  name: string
  description: string
  category: string
  scope: string
  prompt: string
}
export type EnhancePayload = PolishPayload | GeneratePayload

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: EnhancePayload | null
  loading: boolean
  onRetry: () => void
  onUse: (payload: EnhancePayload) => void
}

export function EnhancePreviewModal({ open, onOpenChange, result, loading, onRetry, onUse }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            AI Enhancement Preview
          </DialogTitle>
          <DialogDescription>
            Review the AI&apos;s version before applying it.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="size-6 animate-spin text-accent" />
            <p className="text-sm text-muted-foreground">Enhancing...</p>
          </div>
        )}

        {!loading && result && (
          <div className="space-y-3">
            {result.mode === "generate" && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="font-medium">{result.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Category</p>
                  <p className="font-medium capitalize">{result.category}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{result.description}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Scope</p>
                  <p className="font-medium capitalize">{result.scope}</p>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-1">Prompt</p>
              <Textarea
                readOnly
                value={result.prompt}
                rows={10}
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Keep original
          </Button>
          <Button variant="outline" onClick={onRetry} disabled={loading}>
            Try again
          </Button>
          <Button onClick={() => result && onUse(result)} disabled={loading || !result}>
            Use this
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/ai-templates/enhance-preview-modal.tsx
git commit -m "feat(ui): add EnhancePreviewModal shared component"
```

---

## Task 10: Shared component — `TemplateEditorModal`

Used for both Create and Edit. Contains its own inline ✨ Enhance on the prompt field.

**Files:**
- Create: `components/admin/ai-templates/template-editor-modal.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/admin/ai-templates/template-editor-modal.tsx
"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PromptTemplate } from "@/types/database"
import { TEMPLATE_CATEGORIES, TEMPLATE_SCOPES } from "@/lib/validators/prompt-template"
import { PROMPT_TEMPLATE_CATEGORIES } from "@/lib/prompt-templates"
import { EnhancePreviewModal, type EnhancePayload } from "./enhance-preview-modal"

type Category = (typeof TEMPLATE_CATEGORIES)[number]
type Scope = (typeof TEMPLATE_SCOPES)[number]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When present = edit mode. When null = create mode. */
  template: PromptTemplate | null
  /** Optional seed values for create mode (used by the quick-save-from-dialog flow). */
  seed?: Partial<Pick<PromptTemplate, "name" | "description" | "category" | "scope" | "prompt">>
  onSaved: () => void
}

export function TemplateEditorModal({ open, onOpenChange, template, seed, onSaved }: Props) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState<Category>("structure")
  const [scope, setScope] = useState<Scope>("both")
  const [prompt, setPrompt] = useState("")
  const [saving, setSaving] = useState(false)

  const [enhanceOpen, setEnhanceOpen] = useState(false)
  const [enhanceLoading, setEnhanceLoading] = useState(false)
  const [enhanceResult, setEnhanceResult] = useState<EnhancePayload | null>(null)

  useEffect(() => {
    if (!open) return
    if (template) {
      setName(template.name)
      setDescription(template.description)
      setCategory(template.category)
      setScope(template.scope)
      setPrompt(template.prompt)
    } else {
      setName(seed?.name ?? "")
      setDescription(seed?.description ?? "")
      setCategory((seed?.category as Category) ?? "structure")
      setScope((seed?.scope as Scope) ?? "both")
      setPrompt(seed?.prompt ?? "")
    }
  }, [open, template, seed])

  async function handleEnhance() {
    if (!prompt.trim()) {
      toast.error("Write something first, then Enhance will polish it.")
      return
    }
    setEnhanceLoading(true)
    setEnhanceResult(null)
    setEnhanceOpen(true)
    try {
      const res = await fetch("/api/admin/ai-templates/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "polish", input: prompt, target_scope: scope === "both" ? undefined : scope }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Enhance failed")
      setEnhanceResult(await res.json())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enhance failed")
      setEnhanceOpen(false)
    } finally {
      setEnhanceLoading(false)
    }
  }

  function handleApplyEnhance(payload: EnhancePayload) {
    if (payload.mode === "polish") {
      setPrompt(payload.prompt)
    }
    setEnhanceOpen(false)
  }

  async function handleSave() {
    if (!name.trim() || !description.trim() || !prompt.trim()) {
      toast.error("Name, description, and prompt are required.")
      return
    }
    setSaving(true)
    try {
      const payload = { name, description, category, scope, prompt }
      const url = template ? `/api/admin/ai-templates/${template.id}` : "/api/admin/ai-templates"
      const method = template ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed")
      toast.success(template ? "Template updated." : "Template created.")
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Input
                id="tpl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {PROMPT_TEMPLATE_CATEGORIES[c] ?? c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">Week only</SelectItem>
                    <SelectItem value="day">Day only</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="tpl-prompt">Prompt</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleEnhance}
                  disabled={enhanceLoading || !prompt.trim()}
                  className="h-6 px-2 text-xs"
                >
                  <Sparkles className="size-3 mr-1" />
                  Enhance
                </Button>
              </div>
              <Textarea
                id="tpl-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                maxLength={4000}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              {template ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EnhancePreviewModal
        open={enhanceOpen}
        onOpenChange={setEnhanceOpen}
        result={enhanceResult}
        loading={enhanceLoading}
        onRetry={handleEnhance}
        onUse={handleApplyEnhance}
      />
    </>
  )
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/ai-templates/template-editor-modal.tsx
git commit -m "feat(ui): add TemplateEditorModal with inline ✨ Enhance"
```

---

## Task 11: Shared component — `CreateFromIdeaModal`

**Files:**
- Create: `components/admin/ai-templates/create-from-idea-modal.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/admin/ai-templates/create-from-idea-modal.tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Sparkles, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { EnhancePreviewModal, type EnhancePayload, type GeneratePayload } from "./enhance-preview-modal"
import { TemplateEditorModal } from "./template-editor-modal"
import type { PromptTemplate } from "@/types/database"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function CreateFromIdeaModal({ open, onOpenChange, onSaved }: Props) {
  const [seed, setSeed] = useState("")
  const [loading, setLoading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [result, setResult] = useState<EnhancePayload | null>(null)
  const [editorSeed, setEditorSeed] = useState<Partial<PromptTemplate> | null>(null)

  async function handleGenerate() {
    if (!seed.trim()) {
      toast.error("Describe your template idea first.")
      return
    }
    setLoading(true)
    setResult(null)
    setPreviewOpen(true)
    try {
      const res = await fetch("/api/admin/ai-templates/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate", input: seed }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Generation failed")
      setResult(await res.json())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed")
      setPreviewOpen(false)
    } finally {
      setLoading(false)
    }
  }

  function handleUse(payload: EnhancePayload) {
    if (payload.mode !== "generate") return
    const g = payload as GeneratePayload
    setEditorSeed({
      name: g.name,
      description: g.description,
      category: g.category as PromptTemplate["category"],
      scope: g.scope as PromptTemplate["scope"],
      prompt: g.prompt,
    })
    setPreviewOpen(false)
    onOpenChange(false) // close idea modal; editor takes over
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              Create template from idea
            </DialogTitle>
            <DialogDescription>
              Describe the template you want. AI will draft a full template you can review and save.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="idea-seed">Your idea</Label>
            <Textarea
              id="idea-seed"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="e.g., A back day focused on lat width — wide grip work, pullovers, mid-back accessories."
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={loading}>
              {loading ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Sparkles className="size-3.5 mr-1" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EnhancePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        result={result}
        loading={loading}
        onRetry={handleGenerate}
        onUse={handleUse}
      />

      <TemplateEditorModal
        open={!!editorSeed}
        onOpenChange={(o) => !o && setEditorSeed(null)}
        template={null}
        seed={editorSeed ?? undefined}
        onSaved={() => {
          setEditorSeed(null)
          onSaved()
        }}
      />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/ai-templates/create-from-idea-modal.tsx
git commit -m "feat(ui): add CreateFromIdeaModal (seed → generate → edit flow)"
```

---

## Task 12: Modify existing `TemplateSelector`

Merge Built-in + Custom sections, add `➕ Save current as template` and `⚙ Manage templates` footer, and hover edit/delete on Custom rows.

**Files:**
- Modify: `components/admin/TemplateSelector.tsx`

- [ ] **Step 1: Rewrite the component**

Replace the full contents of [components/admin/TemplateSelector.tsx](../../components/admin/TemplateSelector.tsx) with:

```tsx
"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { FileText, Pencil, Trash2, Plus, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PROMPT_TEMPLATES, PROMPT_TEMPLATE_CATEGORIES, type PromptTemplate as BuiltInTemplate } from "@/lib/prompt-templates"
import type { PromptTemplate } from "@/types/database"
import { TemplateEditorModal } from "@/components/admin/ai-templates/template-editor-modal"

interface TemplateSelectorProps {
  onSelect: (prompt: string) => void
  scope: "week" | "day"
  /** Current textarea content — used for quick-save. If empty, the Save button is disabled. */
  currentText?: string
}

export function TemplateSelector({ onSelect, scope, currentText = "" }: TemplateSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref_ = useRef<HTMLDivElement>(null)
  const [custom, setCustom] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [seedForNew, setSeedForNew] = useState<{ prompt: string; scope: "week" | "day" } | null>(null)

  const fetchCustom = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/ai-templates?scope=${scope}`)
      if (!res.ok) throw new Error("Failed to load templates")
      const data = await res.json()
      setCustom(data.templates as PromptTemplate[])
    } catch {
      // silent — dropdown still works with built-ins
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    if (open) fetchCustom()
  }, [open, fetchCustom])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref_.current && !ref_.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  function handleSelectBuiltIn(template: BuiltInTemplate) {
    onSelect(template.prompt)
    setOpen(false)
  }

  function handleSelectCustom(template: PromptTemplate) {
    onSelect(template.prompt)
    setOpen(false)
  }

  async function handleDelete(template: PromptTemplate, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete template "${template.name}"?`)) return
    try {
      const res = await fetch(`/api/admin/ai-templates/${template.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("Template deleted.")
      fetchCustom()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
  }

  function handleEdit(template: PromptTemplate, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingTemplate(template)
    setEditorOpen(true)
  }

  function handleQuickSave() {
    if (!currentText.trim()) {
      toast.error("Write something in the textarea first.")
      return
    }
    setSeedForNew({ prompt: currentText, scope })
    setEditingTemplate(null)
    setEditorOpen(true)
    setOpen(false)
  }

  const visibleBuiltIns = PROMPT_TEMPLATES.filter((t) => t.scope === scope || t.scope === "both")
  const groupedBuiltIns = Object.entries(PROMPT_TEMPLATE_CATEGORIES)
    .map(([key, label]) => ({
      key,
      label,
      templates: visibleBuiltIns.filter((t) => t.category === key),
    }))
    .filter((g) => g.templates.length > 0)

  return (
    <>
      <div className="relative" ref={ref_}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(!open)}
        >
          <FileText className="size-3 mr-1" />
          Templates
        </Button>

        {open && (
          <div className="absolute top-full right-0 mt-1 w-80 max-h-96 overflow-y-auto bg-white rounded-lg border border-border shadow-lg z-50 py-1">
            {/* Built-in section */}
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-surface/50">
              Built-in
            </p>
            {groupedBuiltIns.map((group) => (
              <div key={group.key}>
                <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {group.label}
                </p>
                {group.templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-surface/50 transition-colors"
                    onClick={() => handleSelectBuiltIn(template)}
                  >
                    <p className="text-sm font-medium">{template.name}</p>
                    <p className="text-[11px] text-muted-foreground">{template.description}</p>
                  </button>
                ))}
              </div>
            ))}

            {/* Custom section */}
            <p className="mt-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-surface/50">
              Custom
            </p>
            {loading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>}
            {!loading && custom.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground italic">No custom templates yet.</p>
            )}
            {custom.map((template) => (
              <div
                key={template.id}
                className="group flex items-start w-full px-3 py-1.5 hover:bg-surface/50 transition-colors cursor-pointer"
                onClick={() => handleSelectCustom(template)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{template.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{template.description}</p>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                  <button
                    type="button"
                    className="p-1 text-muted-foreground hover:text-foreground"
                    onClick={(e) => handleEdit(template, e)}
                    title="Edit"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    className="p-1 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDelete(template, e)}
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            ))}

            {/* Footer actions */}
            <div className="border-t mt-1 pt-1">
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface/50 transition-colors"
                onClick={handleQuickSave}
              >
                <Plus className="size-3" />
                Save current as template
              </button>
              <Link
                href="/admin/ai-templates"
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface/50 transition-colors"
                onClick={() => setOpen(false)}
              >
                <Settings className="size-3" />
                Manage templates
              </Link>
            </div>
          </div>
        )}
      </div>

      <TemplateEditorModal
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o)
          if (!o) {
            setEditingTemplate(null)
            setSeedForNew(null)
          }
        }}
        template={editingTemplate}
        seed={seedForNew ? { prompt: seedForNew.prompt, scope: seedForNew.scope } : undefined}
        onSaved={() => {
          fetchCustom()
          setEditingTemplate(null)
          setSeedForNew(null)
        }}
      />
    </>
  )
}
```

- [ ] **Step 2: Manual smoke test**

Run `npm run dev`. Open a program → AI Generate Week → click Templates. Expected:
- Built-in section shows existing hardcoded templates grouped by category
- Custom section shows "No custom templates yet." (or any you created via API in earlier tasks)
- Footer shows "Save current as template" (disabled when textarea empty) and "Manage templates"

- [ ] **Step 3: Commit**

```bash
git add components/admin/TemplateSelector.tsx
git commit -m "feat(ui): TemplateSelector — merge Built-in + Custom, add footer actions"
```

---

## Task 13: Pass `currentText` prop to `TemplateSelector`

The dropdown's quick-save needs access to the current textarea value. All 5 callers need a one-line update.

**Files:**
- Modify: `components/admin/GenerateWeekDialog.tsx`
- Modify: `components/admin/GenerateDayDialog.tsx`
- Modify: `components/admin/AiGenerateDialog.tsx`
- Modify: `components/admin/GenerationDialog.tsx`
- Modify: `components/admin/AiProgramChatDialog.tsx`

- [ ] **Step 1: GenerateWeekDialog**

Find the line in [components/admin/GenerateWeekDialog.tsx:221-224](../../components/admin/GenerateWeekDialog.tsx#L221-L224):
```tsx
<TemplateSelector
  scope="week"
  onSelect={(prompt) => setInstructions((prev) => (prev ? `${prev}\n\n${prompt}` : prompt))}
/>
```

Replace with:
```tsx
<TemplateSelector
  scope="week"
  currentText={instructions}
  onSelect={(prompt) => setInstructions((prev) => (prev ? `${prev}\n\n${prompt}` : prompt))}
/>
```

- [ ] **Step 2: GenerateDayDialog**

Grep for `TemplateSelector` in [components/admin/GenerateDayDialog.tsx](../../components/admin/GenerateDayDialog.tsx). Add `currentText={instructions}` prop the same way.

- [ ] **Step 3: AiGenerateDialog**

Same treatment — grep for `TemplateSelector`, add `currentText={<whatever the state var for the coach textarea is>}`.

- [ ] **Step 4: GenerationDialog**

Same treatment.

- [ ] **Step 5: AiProgramChatDialog**

Same treatment.

- [ ] **Step 6: Verify compile**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add components/admin/GenerateWeekDialog.tsx components/admin/GenerateDayDialog.tsx components/admin/AiGenerateDialog.tsx components/admin/GenerationDialog.tsx components/admin/AiProgramChatDialog.tsx
git commit -m "feat(ui): pass currentText to TemplateSelector for quick-save"
```

---

## Task 14: Add ✨ Enhance button to GenerateWeekDialog & GenerateDayDialog

Sits next to the coach-instructions textarea Label, opposite the Templates button.

**Files:**
- Modify: `components/admin/GenerateWeekDialog.tsx`
- Modify: `components/admin/GenerateDayDialog.tsx`
- Create: `components/admin/ai-templates/enhance-textarea-button.tsx` (shared)

- [ ] **Step 1: Create the shared enhance button**

```tsx
// components/admin/ai-templates/enhance-textarea-button.tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EnhancePreviewModal, type EnhancePayload } from "./enhance-preview-modal"

interface Props {
  value: string
  scope: "week" | "day"
  onApply: (newText: string) => void
}

export function EnhanceTextareaButton({ value, scope, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<EnhancePayload | null>(null)

  async function runEnhance() {
    if (!value.trim()) return
    setLoading(true)
    setResult(null)
    setOpen(true)
    try {
      const res = await fetch("/api/admin/ai-templates/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "polish", input: value, target_scope: scope }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Enhance failed")
      setResult(await res.json())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enhance failed")
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  function handleApply(payload: EnhancePayload) {
    if (payload.mode === "polish") onApply(payload.prompt)
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={runEnhance}
        disabled={loading || !value.trim()}
      >
        {loading ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Sparkles className="size-3 mr-1" />}
        Enhance
      </Button>

      <EnhancePreviewModal
        open={open}
        onOpenChange={setOpen}
        result={result}
        loading={loading}
        onRetry={runEnhance}
        onUse={handleApply}
      />
    </>
  )
}
```

- [ ] **Step 2: Wire into GenerateWeekDialog**

In [components/admin/GenerateWeekDialog.tsx](../../components/admin/GenerateWeekDialog.tsx), add the import:
```tsx
import { EnhanceTextareaButton } from "@/components/admin/ai-templates/enhance-textarea-button"
```

Find the Label + TemplateSelector row (around line 217-225) and wrap them together with the new button:
```tsx
<div className="flex items-center justify-between">
  <Label htmlFor="instructions">
    {ignoreProfile ? "Coach Instructions (recommended)" : "Coach Instructions (optional)"}
  </Label>
  <div className="flex items-center gap-1">
    <EnhanceTextareaButton
      value={instructions}
      scope="week"
      onApply={setInstructions}
    />
    <TemplateSelector
      scope="week"
      currentText={instructions}
      onSelect={(prompt) => setInstructions((prev) => (prev ? `${prev}\n\n${prompt}` : prompt))}
    />
  </div>
</div>
```

- [ ] **Step 3: Wire into GenerateDayDialog**

Find the equivalent Label + TemplateSelector block in [components/admin/GenerateDayDialog.tsx](../../components/admin/GenerateDayDialog.tsx). Apply the same treatment, using `scope="day"`.

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`. Open Generate Week dialog. Expected:
- Enhance button (✨) sits next to Templates dropdown
- Disabled when textarea is empty
- Click with content in textarea → loader → preview modal → Use this replaces content.

- [ ] **Step 5: Commit**

```bash
git add components/admin/ai-templates/enhance-textarea-button.tsx components/admin/GenerateWeekDialog.tsx components/admin/GenerateDayDialog.tsx
git commit -m "feat(ui): add ✨ Enhance button next to coach-instructions textarea"
```

---

## Task 15: Management page — `/admin/ai-templates`

**Files:**
- Create: `app/(admin)/admin/ai-templates/page.tsx`
- Create: `components/admin/ai-templates/templates-table.tsx`

- [ ] **Step 1: Create the page (server component)**

```tsx
// app/(admin)/admin/ai-templates/page.tsx
import { requireAdmin } from "@/lib/auth-helpers"
import { TemplatesTable } from "@/components/admin/ai-templates/templates-table"

export const metadata = { title: "AI Templates | Admin | DJP Athlete" }

export default async function AiTemplatesPage() {
  await requireAdmin()

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">AI Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage coach-instruction templates used by the AI Generate Week/Day dialogs.
          </p>
        </div>
      </div>

      <TemplatesTable />
    </div>
  )
}
```

- [ ] **Step 2: Create the table component**

```tsx
// components/admin/ai-templates/templates-table.tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Plus, Sparkles, Pencil, Trash2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PromptTemplate } from "@/types/database"
import { PROMPT_TEMPLATE_CATEGORIES } from "@/lib/prompt-templates"
import { TemplateEditorModal } from "./template-editor-modal"
import { CreateFromIdeaModal } from "./create-from-idea-modal"

const CATEGORY_OPTIONS = ["all", ...Object.keys(PROMPT_TEMPLATE_CATEGORIES)]
const SCOPE_OPTIONS = ["all", "week", "day", "both"] as const

export function TemplatesTable() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [scopeFilter, setScopeFilter] = useState<string>("all")

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [createFromIdeaOpen, setCreateFromIdeaOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/ai-templates")
      if (!res.ok) throw new Error("Failed to load")
      const data = await res.json()
      setTemplates(data.templates as PromptTemplate[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return templates.filter((t) => {
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false
      if (scopeFilter !== "all" && t.scope !== scopeFilter) return false
      if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false
      return true
    })
  }, [templates, query, categoryFilter, scopeFilter])

  async function handleDelete(template: PromptTemplate) {
    if (!confirm(`Delete template "${template.name}"?`)) return
    try {
      const res = await fetch(`/api/admin/ai-templates/${template.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("Template deleted.")
      fetchAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search templates..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {c === "all" ? "All categories" : PROMPT_TEMPLATE_CATEGORIES[c] ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All scopes" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={() => setCreateFromIdeaOpen(true)}>
          <Sparkles className="size-3.5 mr-1.5" />
          Create from idea
        </Button>

        <Button
          onClick={() => {
            setEditingTemplate(null)
            setEditorOpen(true)
          }}
        >
          <Plus className="size-3.5 mr-1.5" />
          New template
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-left px-4 py-2 font-medium">Scope</th>
              <th className="text-left px-4 py-2 font-medium">Updated</th>
              <th className="text-right px-4 py-2 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground italic">
                  No templates. Click "New template" or "Create from idea" to add one.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((t) => (
                <tr
                  key={t.id}
                  className="border-t hover:bg-surface/30 cursor-pointer"
                  onClick={() => {
                    setEditingTemplate(t)
                    setEditorOpen(true)
                  }}
                >
                  <td className="px-4 py-2">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-md">{t.description}</p>
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                      {PROMPT_TEMPLATE_CATEGORIES[t.category] ?? t.category}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs capitalize">
                      {t.scope}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {new Date(t.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingTemplate(t)
                          setEditorOpen(true)
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(t)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <TemplateEditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editingTemplate}
        onSaved={() => {
          setEditorOpen(false)
          setEditingTemplate(null)
          fetchAll()
        }}
      />

      <CreateFromIdeaModal
        open={createFromIdeaOpen}
        onOpenChange={setCreateFromIdeaOpen}
        onSaved={fetchAll}
      />
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke test**

Run `npm run dev`, navigate to `/admin/ai-templates`. Expected:
- Table loads (empty if no custom templates yet)
- "New template" opens `TemplateEditorModal` → fill + save → row appears
- "Create from idea" opens seed modal → generate → preview → Use this → editor prefilled → save
- Search, category, scope filters work
- Edit (row click or pencil) opens editor pre-filled
- Delete (trash) confirms and removes row

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/admin/ai-templates/page.tsx components/admin/ai-templates/templates-table.tsx
git commit -m "feat(admin): /admin/ai-templates management page with full CRUD"
```

---

## Task 16: Add sidebar link

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`

- [ ] **Step 1: Add the link under "AI Tools"**

In [components/admin/AdminSidebar.tsx:72-79](../../components/admin/AdminSidebar.tsx#L72-L79), add `FileText` to the import list if not present, and add an item to the AI Tools section:

```ts
{
  title: "AI Tools",
  items: [
    { label: "AI Assistant", href: "/admin/ai-assistant", icon: Bot },
    { label: "AI Usage", href: "/admin/ai-usage", icon: Brain },
    { label: "AI Insights", href: "/admin/ai-insights", icon: Lightbulb },
    { label: "AI Templates", href: "/admin/ai-templates", icon: FileText },
    { label: "AI Policy", href: "/admin/settings/ai-policy", icon: Sparkles },
  ],
},
```

(`FileText` is already imported at the top of that file per line 13.)

- [ ] **Step 2: Repeat for the mobile sidebar if it has a separate nav definition**

Check [components/admin/AdminMobileSidebar.tsx](../../components/admin/AdminMobileSidebar.tsx) — if it has its own `navSections` array, mirror the change.

- [ ] **Step 3: Manual smoke test**

Run `npm run dev`. Expected: "AI Templates" link appears in sidebar under AI Tools, navigates to the page.

- [ ] **Step 4: Commit**

```bash
git add components/admin/AdminSidebar.tsx components/admin/AdminMobileSidebar.tsx
git commit -m "feat(admin): add AI Templates sidebar link"
```

---

## Task 17: End-to-end manual verification

This is a verification checklist — don't skip it.

- [ ] **Step 1: Flow A — use a built-in template**

  1. Open a program → AI Generate Week
  2. Click Templates → click "Deload Week"
  3. Verify textarea fills with the canonical deload prompt

- [ ] **Step 2: Flow B — quick-save from dialog**

  1. Type your own instructions in the textarea
  2. Click Templates → "Save current as template" (footer)
  3. Fill in name, description, category, scope → Save
  4. Re-open the Templates dropdown → Custom section shows the new template

- [ ] **Step 3: Flow C — enhance current draft**

  1. Type a rough draft ("make it a shoulder-focused push day with supersets")
  2. Click the ✨ Enhance button next to Templates
  3. Preview modal opens → polished version appears
  4. Click "Use this" → textarea replaced with polished version
  5. Click "Try again" once to verify re-roll works

- [ ] **Step 4: Flow D — full management**

  1. Navigate to `/admin/ai-templates` via sidebar link
  2. Create, edit, delete a template → each persists / refreshes correctly
  3. Apply search + filters → results update

- [ ] **Step 5: Flow E — generate from idea**

  1. On `/admin/ai-templates`, click "Create from idea"
  2. Enter a seed ("bodybuilder back day focused on lat width")
  3. Preview modal shows generated name/category/scope/description/prompt
  4. Click "Use this" → editor modal opens pre-filled
  5. Tweak if desired → Save → row appears in the table

- [ ] **Step 6: Edge cases**

  1. Empty textarea → ✨ Enhance button is disabled
  2. Invalid API response (stop the dev server's ability to reach Anthropic by temporarily removing `ANTHROPIC_API_KEY`) → Enhance shows error toast, source untouched
  3. Delete a template currently listed in the dropdown → refetch removes it

- [ ] **Step 7: Lint + type check**

Run:
```bash
npm run lint
npx tsc --noEmit
npm run test:run
```
Expected: no errors, all tests pass.

- [ ] **Step 8: Commit (if any formatting fixes needed)**

```bash
git add -u
git commit -m "chore: post-verification formatting"
```

---

## Done

You now have:
- Admin-managed custom templates alongside the curated built-ins
- AI polish / generate from idea via Haiku
- Preview-before-apply UX across every AI-assisted entry point
- Quick-save-from-dialog for capturing one-off prompts into the library

## Self-review checklist (writer's notes)

- **Spec coverage:** All 5 flows (A–E), both AI modes (polish/generate), DB schema, RLS policy note, all 4 new modal components, the /admin/ai-templates page, and sidebar link are implemented by tasks 1–16. Task 17 covers the e2e verification flow from the spec.
- **Placeholder scan:** No TBD/TODO. Step 3 & 4 of Task 13 say "grep for `TemplateSelector` in <file>" — this is the correct instruction because the exact line number may drift; the file only imports `TemplateSelector` once and uses it once, so the pattern is unambiguous.
- **Type consistency:** `PromptTemplate` interface in Task 2 matches the `PromptTemplate` in `types/database.ts`, the DAL return types in Task 4, the API response shapes in Tasks 6–8, and the component props in Tasks 9–15. `EnhancePayload`/`PolishPayload`/`GeneratePayload` are defined in Task 9 and consumed unchanged in Tasks 10, 11, 14.
- **RLS note:** The migration enables RLS but does NOT create policies, because existing admin-only tables in this codebase (e.g., `coach_ai_policy`) follow the same pattern — all access flows through API routes that use the service-role client, which bypasses RLS. This matches the observed convention.

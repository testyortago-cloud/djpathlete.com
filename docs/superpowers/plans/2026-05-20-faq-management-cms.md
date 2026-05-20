# FAQ Management CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin FAQ CMS under Marketing so the admin can create, edit, delete and reorder the FAQs on any page of the site, with auto-emitted SEO/AEO/GEO structured data and AI-assisted question/answer drafting.

**Architecture:** One `faqs` table keyed by `page_key`; a typed page registry (`lib/faq/pages.ts`); a DAL + Zod validator following the `marketing-products` pattern; one server component `<ManagedFaqSection>` that fetches FAQs and emits `FAQPage` JSON-LD + speakable schema; an admin CRUD page with AI buttons; a page-by-page migration of the ~50 hardcoded FAQs.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Zod, `@ai-sdk/anthropic`, `@dnd-kit`, shadcn/ui, Vitest, the `withAudit()` audit layer.

**Spec:** `docs/superpowers/specs/2026-05-20-faq-management-cms-design.md`

**Branch:** Work on a feature branch (`faq-cms`), not `main`. Do not push until the user asks.

---

## File Structure

| File | Responsibility | Phase |
|------|----------------|-------|
| `supabase/migrations/00158_faqs.sql` | `faqs` table, constraints, index, `updated_at` trigger | 1 |
| `lib/faq/pages.ts` | Page registry: static list + sport/athlete derivation + key resolution | 1 |
| `__tests__/lib/faq/pages.test.ts` | Registry tests | 1 |
| `lib/validators/faq.ts` | Zod schema for FAQ input | 1 |
| `__tests__/lib/validators/faq.test.ts` | Validator tests | 1 |
| `lib/db/faqs.ts` | DAL: list/create/update/delete/reorder | 1 |
| `__tests__/lib/db/faqs.test.ts` | DAL tests | 1 |
| `components/public/ManagedFaqSection.tsx` | Server component: fetch + render + emit JSON-LD/speakable | 1 |
| `lib/audit/actions.ts` (modify) | Add `faq.*` action slugs | 2 |
| `app/api/admin/marketing/faqs/route.ts` | POST create, GET list | 2 |
| `app/api/admin/marketing/faqs/[id]/route.ts` | PATCH update, DELETE | 2 |
| `app/api/admin/marketing/faqs/reorder/route.ts` | POST reorder | 2 |
| `app/(admin)/admin/marketing/faqs/page.tsx` | Admin CMS page (server) | 2 |
| `app/(admin)/admin/marketing/faqs/FaqManager.tsx` | Client: page picker + list + editor | 2 |
| `components/admin/admin-nav.ts` (modify) | Add "FAQs" nav item | 2 |
| `lib/faq/ai-prompt.ts` | Build grounded AI prompt for question/answer assist | 3 |
| `__tests__/lib/faq/ai-prompt.test.ts` | AI prompt-assembly tests | 3 |
| `app/api/admin/marketing/faqs/ai/route.ts` | AI assist endpoint | 3 |
| `scripts/seed-faqs.ts` | One-off seed of the ~50 existing FAQs | 4 |
| Page files (×9) | Replace hardcoded FAQ arrays with `<ManagedFaqSection>` | 4 |

---

## Phase 1 — Data layer & rendering

End state: any page can render DB-backed FAQs with full structured data.

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/00158_faqs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00158_faqs.sql — FAQ CMS: page-keyed FAQ entries managed from the admin.
create table if not exists faqs (
  id uuid primary key default gen_random_uuid(),
  page_key text not null,
  category text,
  question text not null,
  answer text not null,
  link_text text,
  link_href text,
  sort_order integer not null default 0,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faqs_status_chk check (status in ('published','draft')),
  constraint faqs_link_chk check ((link_text is null) = (link_href is null)),
  constraint faqs_question_chk check (length(trim(question)) > 0),
  constraint faqs_answer_chk check (length(trim(answer)) > 0)
);

create index if not exists faqs_page_key_idx on faqs (page_key, status, sort_order);

create or replace function faqs_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger faqs_updated_at before update on faqs
  for each row execute function faqs_set_updated_at();

alter table faqs enable row level security;
-- Service-role only: all access is via the DAL with the service-role client.
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase migration up` (or the project's migration command — check `package.json`).
Expected: migration applies, `faqs` table exists.

- [ ] **Step 3: Add the `Faq` row type to `types/database.ts`**

```typescript
export interface Faq {
  id: string
  page_key: string
  category: string | null
  question: string
  answer: string
  link_text: string | null
  link_href: string | null
  sort_order: number
  status: "published" | "draft"
  created_at: string
  updated_at: string
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00158_faqs.sql types/database.ts
git commit -m "feat(faq): faqs table migration + Faq row type"
```

### Task 2: Page registry

**Files:**
- Create: `lib/faq/pages.ts`
- Test: `__tests__/lib/faq/pages.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest"
import { STATIC_FAQ_PAGES, getStaticAndTemplatedFaqPages, resolveFaqPage } from "@/lib/faq/pages"

describe("FAQ page registry", () => {
  it("includes the /faq page in the static list", () => {
    const faqPage = STATIC_FAQ_PAGES.find((p) => p.key === "faq")
    expect(faqPage).toBeDefined()
    expect(faqPage!.routePath).toBe("/faq")
    expect(faqPage!.supportsCategories).toBe(true)
  })

  it("derives a page for every sport with key sports/<slug>", () => {
    const pages = getStaticAndTemplatedFaqPages()
    const tennis = pages.find((p) => p.key === "sports/tennis-performance-training")
    expect(tennis).toBeDefined()
    expect(tennis!.routePath).toBe("/sports/tennis-performance-training")
  })

  it("derives a page for every athlete type with key athletes/<slug>", () => {
    const pages = getStaticAndTemplatedFaqPages()
    expect(pages.some((p) => p.key === "athletes/professional")).toBe(true)
  })

  it("resolveFaqPage returns the entry for a known key", () => {
    expect(resolveFaqPage("online")?.routePath).toBe("/online")
  })

  it("resolveFaqPage returns undefined for an unknown key", () => {
    expect(resolveFaqPage("does-not-exist")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/faq/pages.test.ts`
Expected: FAIL — cannot resolve `@/lib/faq/pages`.

- [ ] **Step 3: Implement `lib/faq/pages.ts`**

```typescript
import { SPORTS } from "@/lib/data/sports"
import { ATHLETES } from "@/lib/data/athletes"

export interface FaqPage {
  /** Stable key stored in faqs.page_key. */
  key: string
  /** Human label shown in the admin page picker. */
  label: string
  /** Route the page renders at — used for revalidatePath. */
  routePath: string
  /** Picker group. */
  group: "Static" | "Sports" | "Athletes" | "Events"
  /** Whether the admin may set a category (grouped rendering). Only /faq. */
  supportsCategories: boolean
  /** Short factual description used to ground the AI assist. */
  contextSummary: string
}

export const STATIC_FAQ_PAGES: FaqPage[] = [
  {
    key: "faq",
    label: "FAQ page",
    routePath: "/faq",
    group: "Static",
    supportsCategories: true,
    contextSummary:
      "The central FAQ page for DJP Athlete — sports performance coaching by Darren J Paul, PhD in Zephyrhills, FL. Covers the brand, online and in-person coaching, return-to-performance assessment, pricing, youth athletes, and how coaching compares to apps.",
  },
  {
    key: "online",
    label: "Online Coaching",
    routePath: "/online",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "The online sports performance coaching page — application-only, diagnostic-driven remote programming with weekly video review and load monitoring.",
  },
  {
    key: "in-person",
    label: "In-Person Coaching",
    routePath: "/in-person",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "In-person sports performance training at the Zephyrhills, FL facility in the Tampa Bay area — assessment-led, coach-led sessions.",
  },
  {
    key: "assessment",
    label: "Assessment",
    routePath: "/assessment",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "Return-to-performance assessment — criterion-based testing that bridges medical clearance and competition readiness for athletes returning from injury.",
  },
  {
    key: "services/online-vs-in-person",
    label: "Online vs In-Person",
    routePath: "/services/online-vs-in-person",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "Comparison page for online versus in-person sports performance coaching — same methodology, different delivery.",
  },
  {
    key: "services/coaching-vs-training-app",
    label: "Coaching vs Training App",
    routePath: "/services/coaching-vs-training-app",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "Comparison page positioning supervised sports performance coaching against self-service training apps.",
  },
  {
    key: "programs/rotational-reboot",
    label: "Rotational Reboot",
    routePath: "/programs/rotational-reboot",
    group: "Static",
    supportsCategories: false,
    contextSummary:
      "The Rotational Reboot program — for athletes in rotational sports (tennis, golf, baseball, lacrosse).",
  },
]

function sportFaqPages(): FaqPage[] {
  return SPORTS.map((s) => ({
    key: `sports/${s.slug}`,
    label: `${s.name} (sport)`,
    routePath: `/sports/${s.slug}`,
    group: "Sports" as const,
    supportsCategories: false,
    contextSummary: `${s.name} performance training page. ${s.description ?? ""}`.trim(),
  }))
}

function athleteFaqPages(): FaqPage[] {
  return ATHLETES.map((a) => ({
    key: `athletes/${a.slug}`,
    label: `${a.name} (athlete type)`,
    routePath: `/athletes/${a.slug}`,
    group: "Athletes" as const,
    supportsCategories: false,
    contextSummary: `Athlete-type page for ${a.name}. ${a.description ?? ""}`.trim(),
  }))
}

/** All non-event FAQ pages — known at build time. */
export function getStaticAndTemplatedFaqPages(): FaqPage[] {
  return [...STATIC_FAQ_PAGES, ...sportFaqPages(), ...athleteFaqPages()]
}

/** Resolve a non-event page_key to its registry entry. */
export function resolveFaqPage(key: string): FaqPage | undefined {
  return getStaticAndTemplatedFaqPages().find((p) => p.key === key)
}
```

> If `SPORTS`/`ATHLETES` entries do not have a `slug`/`name`/`description`
> field with these exact names, open `lib/data/sports.ts` and
> `lib/data/athletes.ts` and adjust the field reads to match. The test in
> Step 1 will catch a wrong field name.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/faq/pages.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/faq/pages.ts __tests__/lib/faq/pages.test.ts
git commit -m "feat(faq): page registry"
```

### Task 3: Zod validator

**Files:**
- Create: `lib/validators/faq.ts`
- Test: `__tests__/lib/validators/faq.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest"
import { faqInputSchema } from "@/lib/validators/faq"

const valid = {
  page_key: "online",
  category: null,
  question: "How does online coaching work?",
  answer: "It is a remote, application-only program.",
  link_text: null,
  link_href: null,
  status: "published" as const,
}

describe("faqInputSchema", () => {
  it("accepts a valid FAQ", () => {
    expect(faqInputSchema.safeParse(valid).success).toBe(true)
  })

  it("rejects an empty question", () => {
    expect(faqInputSchema.safeParse({ ...valid, question: "  " }).success).toBe(false)
  })

  it("rejects an empty answer", () => {
    expect(faqInputSchema.safeParse({ ...valid, answer: "" }).success).toBe(false)
  })

  it("rejects an unknown status", () => {
    expect(faqInputSchema.safeParse({ ...valid, status: "live" }).success).toBe(false)
  })

  it("rejects a half-set link (text without href)", () => {
    expect(faqInputSchema.safeParse({ ...valid, link_text: "Read more", link_href: null }).success).toBe(false)
  })

  it("accepts a fully-set link", () => {
    const r = faqInputSchema.safeParse({ ...valid, link_text: "Read more", link_href: "/about" })
    expect(r.success).toBe(true)
  })

  it("rejects an unknown page_key", () => {
    expect(faqInputSchema.safeParse({ ...valid, page_key: "nope" }).success).toBe(false)
  })

  it("accepts an event page_key", () => {
    expect(faqInputSchema.safeParse({ ...valid, page_key: "event/abc-123" }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/validators/faq.test.ts`
Expected: FAIL — cannot resolve `@/lib/validators/faq`.

- [ ] **Step 3: Implement `lib/validators/faq.ts`**

```typescript
import { z } from "zod"
import { resolveFaqPage } from "@/lib/faq/pages"

/** A page_key is valid if it resolves in the registry OR is an event key. */
function isKnownPageKey(key: string): boolean {
  if (key.startsWith("event/") && key.length > "event/".length) return true
  return resolveFaqPage(key) !== undefined
}

export const faqInputSchema = z
  .object({
    page_key: z.string().min(1).refine(isKnownPageKey, "Unknown page"),
    category: z.string().trim().min(1).nullable(),
    question: z.string().trim().min(1, "Question is required").max(300),
    answer: z.string().trim().min(1, "Answer is required").max(2000),
    link_text: z.string().trim().min(1).nullable(),
    link_href: z.string().trim().min(1).nullable(),
    status: z.enum(["published", "draft"]),
  })
  .refine((v) => (v.link_text === null) === (v.link_href === null), {
    message: "Link text and link URL must both be set or both be empty",
    path: ["link_text"],
  })

export type FaqInput = z.infer<typeof faqInputSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/validators/faq.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validators/faq.ts __tests__/lib/validators/faq.test.ts
git commit -m "feat(faq): Zod input validator"
```

### Task 4: Data access layer

**Files:**
- Create: `lib/db/faqs.ts`
- Test: `__tests__/lib/db/faqs.test.ts`

Follow the structure of `lib/db/marketing-products.ts` — `createServiceRoleClient()`, exported typed functions, cast results.

- [ ] **Step 1: Write the failing test** (mock the Supabase client; mirror an existing DAL test such as `__tests__/lib/db/shop-orders.test.ts` for the mock shape)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  single: vi.fn(),
}
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: () => mockChain }),
}))

import { listFaqsForPage } from "@/lib/db/faqs"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("listFaqsForPage", () => {
  it("queries published FAQs for a page ordered by sort_order", async () => {
    mockChain.order.mockResolvedValueOnce({
      data: [{ id: "1", page_key: "online", question: "Q", answer: "A", sort_order: 0 }],
      error: null,
    })
    const rows = await listFaqsForPage("online", { publishedOnly: true })
    expect(rows).toHaveLength(1)
    expect(mockChain.eq).toHaveBeenCalledWith("page_key", "online")
    expect(mockChain.eq).toHaveBeenCalledWith("status", "published")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/db/faqs.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/faqs`.

- [ ] **Step 3: Implement `lib/db/faqs.ts`**

```typescript
// lib/db/faqs.ts — DAL for the faqs table (00158). The admin FAQ CMS owns
// writes; ManagedFaqSection reads published rows per page.
import { createServiceRoleClient } from "@/lib/supabase"
import type { Faq } from "@/types/database"
import type { FaqInput } from "@/lib/validators/faq"

export async function listFaqsForPage(
  pageKey: string,
  opts: { publishedOnly?: boolean } = {},
): Promise<Faq[]> {
  const supabase = createServiceRoleClient()
  let q = supabase.from("faqs").select("*").eq("page_key", pageKey)
  if (opts.publishedOnly) q = q.eq("status", "published")
  const { data, error } = await q.order("sort_order", { ascending: true })
  if (error) throw new Error(`listFaqsForPage(${pageKey}): ${error.message}`)
  return (data ?? []) as Faq[]
}

export async function createFaq(input: FaqInput): Promise<Faq> {
  const supabase = createServiceRoleClient()
  // New FAQ goes to the end of its page list.
  const existing = await listFaqsForPage(input.page_key)
  const sort_order = existing.length
  const { data, error } = await supabase
    .from("faqs")
    .insert({ ...input, sort_order })
    .select("*")
    .single()
  if (error) throw new Error(`createFaq: ${error.message}`)
  return data as Faq
}

export async function updateFaq(id: string, input: FaqInput): Promise<Faq> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from("faqs")
    .update(input)
    .eq("id", id)
    .select("*")
    .single()
  if (error) throw new Error(`updateFaq(${id}): ${error.message}`)
  return data as Faq
}

export async function deleteFaq(id: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from("faqs").delete().eq("id", id)
  if (error) throw new Error(`deleteFaq(${id}): ${error.message}`)
}

/** Persist a new ordering. `orderedIds` is the full id list for one page. */
export async function reorderFaqs(orderedIds: string[]): Promise<void> {
  const supabase = createServiceRoleClient()
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("faqs").update({ sort_order: index }).eq("id", id),
    ),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/db/faqs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/faqs.ts __tests__/lib/db/faqs.test.ts
git commit -m "feat(faq): data access layer"
```

### Task 5: Verify the FAQ schema builder

**Files:**
- Check: `lib/seo/build-faq-page-schema.ts` (exists)
- Check: `__tests__/lib/seo/build-faq-page-schema.test.ts` (may exist)

- [ ] **Step 1: Confirm the existing builder accepts `{question, answer}[]`**

`buildFaqPageSchema` already takes `FaqEntry[]` (`{question, answer}`) and
returns `null` below 3 entries. `Faq` rows are a superset — pass
`faqs.map(f => ({question: f.question, answer: f.answer}))`. No change needed.

- [ ] **Step 2: If no test file exists, add one**

```typescript
import { describe, it, expect } from "vitest"
import { buildFaqPageSchema } from "@/lib/seo/build-faq-page-schema"

describe("buildFaqPageSchema", () => {
  it("returns null below 3 entries", () => {
    expect(buildFaqPageSchema([{ question: "Q", answer: "A" }])).toBeNull()
  })
  it("builds FAQPage JSON-LD for 3+ entries", () => {
    const schema = buildFaqPageSchema([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
      { question: "Q3", answer: "A3" },
    ])
    expect(schema?.["@type"]).toBe("FAQPage")
    expect(schema?.mainEntity).toHaveLength(3)
  })
})
```

- [ ] **Step 3: Run + commit if a test was added**

Run: `npx vitest run __tests__/lib/seo/build-faq-page-schema.test.ts`

```bash
git add __tests__/lib/seo/build-faq-page-schema.test.ts
git commit -m "test(faq): cover FAQ page schema builder"
```

### Task 6: ManagedFaqSection render component

**Files:**
- Create: `components/public/ManagedFaqSection.tsx`

This is a server component. It reproduces the visual style on the current
`/athletes` page (eyebrow + heading + flat list of `<h3>` questions with
answers and divider lines) as the `variant="list"` default, and the
`<details>` card style as `variant="cards"`.

- [ ] **Step 1: Implement the component**

```tsx
import { JsonLd } from "@/components/shared/JsonLd"
import { listFaqsForPage } from "@/lib/db/faqs"
import { buildFaqPageSchema } from "@/lib/seo/build-faq-page-schema"
import type { Faq } from "@/types/database"
import Link from "next/link"

interface ManagedFaqSectionProps {
  pageKey: string
  /** "list" = flat h3 list (athletes-page style); "cards" = details cards. */
  variant?: "list" | "cards"
  eyebrow?: string
  title?: string
  className?: string
}

/**
 * The single FAQ render surface. Fetches published FAQs for `pageKey`,
 * renders them, and auto-emits FAQPage JSON-LD + speakable schema. Renders
 * nothing when a page has no published FAQs. Never throws — a DB failure
 * degrades to an empty render so it cannot take down the host page.
 */
export async function ManagedFaqSection({
  pageKey,
  variant = "list",
  eyebrow = "Common questions",
  title = "Questions, answered.",
  className = "",
}: ManagedFaqSectionProps) {
  let faqs: Faq[] = []
  try {
    faqs = await listFaqsForPage(pageKey, { publishedOnly: true })
  } catch (err) {
    console.error(`[ManagedFaqSection] ${pageKey}:`, err)
    return null
  }
  if (faqs.length === 0) return null

  const schema = buildFaqPageSchema(faqs.map((f) => ({ question: f.question, answer: f.answer })))
  // speakable targets the question + answer text for voice/AEO surfaces.
  const speakable = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    speakable: { "@type": "SpeakableSpecification", cssSelector: [".faq-q", ".faq-a"] },
  }

  // Group by category when any FAQ has one (the /faq page).
  const grouped = faqs.some((f) => f.category)
  const groups = grouped
    ? Array.from(new Set(faqs.map((f) => f.category ?? "Other"))).map((cat) => ({
        cat,
        items: faqs.filter((f) => (f.category ?? "Other") === cat),
      }))
    : [{ cat: null as string | null, items: faqs }]

  return (
    <section className={`mx-auto max-w-3xl px-4 py-16 sm:px-8 lg:py-20 ${className}`}>
      {schema && <JsonLd data={schema} />}
      <JsonLd data={speakable} />

      <div className="mb-8 flex items-center gap-3">
        <div className="h-px w-8 bg-accent" />
        <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">{eyebrow}</span>
      </div>
      <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary sm:text-3xl">{title}</h2>

      {groups.map((g) => (
        <div key={g.cat ?? "_"} className="mt-10">
          {g.cat && (
            <h3 className="mb-4 font-heading text-lg font-semibold text-primary">{g.cat}</h3>
          )}
          {variant === "cards" ? (
            <div className="space-y-3">
              {g.items.map((f) => (
                <details
                  key={f.id}
                  className="group rounded-2xl border border-border bg-white p-6 open:shadow-sm"
                >
                  <summary className="faq-q cursor-pointer list-none font-heading text-base font-semibold text-primary sm:text-lg">
                    {f.question}
                  </summary>
                  <div className="faq-a mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
                    {f.answer}
                    {f.link_text && f.link_href && (
                      <p className="mt-2">
                        <Link href={f.link_href} className="font-medium text-primary hover:text-accent">
                          {f.link_text}
                        </Link>
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <dl className="divide-y divide-border">
              {g.items.map((f) => (
                <div key={f.id} className="py-6">
                  <dt className="faq-q font-heading text-lg font-semibold text-primary">{f.question}</dt>
                  <dd className="faq-a mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
                    {f.answer}
                    {f.link_text && f.link_href && (
                      <p className="mt-2">
                        <Link href={f.link_href} className="font-medium text-primary hover:text-accent">
                          {f.link_text}
                        </Link>
                      </p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p .` — expect no errors in `ManagedFaqSection.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/public/ManagedFaqSection.tsx
git commit -m "feat(faq): ManagedFaqSection render component with auto JSON-LD"
```

---

## Phase 2 — Admin CMS

### Task 7: Audit action slugs

**Files:**
- Modify: `lib/audit/actions.ts`

- [ ] **Step 1: Add the `faq.*` slugs** to the `marketing` category section of the actions list (match the existing slug shape):

```typescript
  "faq.create",
  "faq.update",
  "faq.delete",
  "faq.reorder",
```

- [ ] **Step 2: Commit**

```bash
git add lib/audit/actions.ts
git commit -m "feat(faq): audit action slugs"
```

### Task 8: CRUD + reorder API routes

**Files:**
- Create: `app/api/admin/marketing/faqs/route.ts` (GET list, POST create)
- Create: `app/api/admin/marketing/faqs/[id]/route.ts` (PATCH, DELETE)
- Create: `app/api/admin/marketing/faqs/reorder/route.ts` (POST)

Each handler: `auth()` → require `admin` role → parse with `faqInputSchema`
→ call the DAL → `recordAudit()` → `revalidatePath(resolveFaqPage(pageKey)?.routePath)`
→ return JSON. For `event/<id>` keys, `revalidatePath` the camp/clinic route.

- [ ] **Step 1: Implement `app/api/admin/marketing/faqs/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { faqInputSchema } from "@/lib/validators/faq"
import { createFaq, listFaqsForPage } from "@/lib/db/faqs"
import { resolveFaqPage } from "@/lib/faq/pages"
import { recordAudit } from "@/lib/audit/record"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  const pageKey = request.nextUrl.searchParams.get("page_key")
  if (!pageKey) return NextResponse.json({ error: "page_key required" }, { status: 400 })
  const faqs = await listFaqsForPage(pageKey)
  return NextResponse.json({ faqs })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  const parsed = faqInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid", details: parsed.error.issues }, { status: 400 })
  }
  const faq = await createFaq(parsed.data)
  await recordAudit({ action: "faq.create", target: { type: "faq", id: faq.id } })
  const route = resolveFaqPage(faq.page_key)?.routePath
  if (route) revalidatePath(route)
  return NextResponse.json({ faq }, { status: 201 })
}
```

- [ ] **Step 2: Implement `app/api/admin/marketing/faqs/[id]/route.ts`** — `PATCH` (parse with `faqInputSchema`, call `updateFaq`, audit `faq.update`, revalidate) and `DELETE` (call `deleteFaq`, audit `faq.delete`; the route to revalidate comes from a `page_key` query param). Mirror the auth + revalidate shape from Step 1.

- [ ] **Step 3: Implement `app/api/admin/marketing/faqs/reorder/route.ts`** — POST `{ page_key, ordered_ids }`, call `reorderFaqs`, audit `faq.reorder`, revalidate.

- [ ] **Step 4: Verify** — `npx tsc --noEmit -p .`, no errors in the new files.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/marketing/faqs
git commit -m "feat(faq): admin CRUD + reorder API routes"
```

### Task 9: Admin page + manager UI

**Files:**
- Create: `app/(admin)/admin/marketing/faqs/page.tsx` (server component)
- Create: `app/(admin)/admin/marketing/faqs/FaqManager.tsx` (client)

`page.tsx` builds the page list: `getStaticAndTemplatedFaqPages()` plus event
pages from the events DAL (`event/<id>` keys), passes them to `FaqManager`.

`FaqManager` is a client component: a grouped page-picker `<select>`; on
change it fetches `GET /api/admin/marketing/faqs?page_key=...`; renders the
list with edit/delete/status-toggle; an "Add FAQ" button opens the editor
form (question, answer, category if `supportsCategories`, optional link).
Submits to the POST/PATCH/DELETE routes. Use Sonner for toasts. Follow the
client-component patterns in `app/(admin)/admin/marketing/products/`.

- [ ] **Step 1: Implement `page.tsx`** (server) — assemble the page list, render `<FaqManager pages={...} />`. `export const dynamic = "force-dynamic"`.

- [ ] **Step 2: Implement `FaqManager.tsx`** (client) — picker + list + editor form, wired to the API routes.

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p .` clean; `npm run dev`, visit `/admin/marketing/faqs`, create/edit/delete a test FAQ on the `online` page, confirm it persists.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/marketing/faqs"
git commit -m "feat(faq): admin FAQ manager page"
```

### Task 10: Drag-to-reorder

**Files:**
- Modify: `app/(admin)/admin/marketing/faqs/FaqManager.tsx`

- [ ] **Step 1: Add `@dnd-kit` sortable list** to the FAQ list (the package is already a dependency — see `components` that use `@dnd-kit`). On drop, POST the new id order to `/api/admin/marketing/faqs/reorder`.

- [ ] **Step 2: Verify** in `npm run dev` — drag a FAQ, reload, order persists.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/marketing/faqs/FaqManager.tsx"
git commit -m "feat(faq): drag-to-reorder in FAQ manager"
```

### Task 11: Nav item

**Files:**
- Modify: `components/admin/admin-nav.ts`

- [ ] **Step 1: Add to BOTH `marketingItems` branches** (the `contentStudioEnabled` ternary), after the `Products` item:

```typescript
        { label: "FAQs", href: "/admin/marketing/faqs", icon: HelpCircle },
```

Import `HelpCircle` from `lucide-react` at the top of the file.

- [ ] **Step 2: Verify** the nav shows "FAQs" under Marketing in `npm run dev`.

- [ ] **Step 3: Commit**

```bash
git add components/admin/admin-nav.ts
git commit -m "feat(faq): add FAQs nav item under Marketing"
```

---

## Phase 3 — AI assist

### Task 12: AI prompt-assembly helper

**Files:**
- Create: `lib/faq/ai-prompt.ts`
- Test: `__tests__/lib/faq/ai-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest"
import { buildFaqAiPrompt } from "@/lib/faq/ai-prompt"

describe("buildFaqAiPrompt", () => {
  it("includes the page context summary", () => {
    const p = buildFaqAiPrompt({
      action: "generate_questions",
      pageContext: "The online coaching page.",
      existingQuestions: [],
    })
    expect(p).toContain("The online coaching page.")
  })

  it("lists existing questions so the AI avoids duplicates", () => {
    const p = buildFaqAiPrompt({
      action: "generate_questions",
      pageContext: "ctx",
      existingQuestions: ["How much does it cost?"],
    })
    expect(p).toContain("How much does it cost?")
  })

  it("includes the target question for suggest_answer", () => {
    const p = buildFaqAiPrompt({
      action: "suggest_answer",
      pageContext: "ctx",
      existingQuestions: [],
      question: "What equipment do I need?",
    })
    expect(p).toContain("What equipment do I need?")
  })

  it("forbids inventing facts", () => {
    const p = buildFaqAiPrompt({ action: "generate_questions", pageContext: "ctx", existingQuestions: [] })
    expect(p.toLowerCase()).toContain("do not invent")
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run __tests__/lib/faq/ai-prompt.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/faq/ai-prompt.ts`**

```typescript
import { BUSINESS_INFO } from "@/lib/business-info"

interface BuildArgs {
  action: "generate_questions" | "suggest_answer"
  pageContext: string
  existingQuestions: string[]
  question?: string
}

/**
 * Build a grounded prompt for FAQ AI assist. The model may only use the
 * supplied page context and business facts — it must not invent claims.
 */
export function buildFaqAiPrompt(args: BuildArgs): string {
  const facts = `Business: ${BUSINESS_INFO.brand}. Location: ${BUSINESS_INFO.address.addressLocality}, ${BUSINESS_INFO.address.addressRegion}.`
  const existing = args.existingQuestions.length
    ? `Existing questions on this page (do NOT duplicate):\n${args.existingQuestions.map((q) => `- ${q}`).join("\n")}`
    : "This page has no FAQs yet."
  const rules =
    "Rules: answers must be accurate, concise and straightforward — no marketing fluff. Do NOT invent facts, statistics, names, prices, or claims that are not in the page context or business facts. If a fact is unknown, omit it."

  if (args.action === "suggest_answer") {
    return `You are drafting one FAQ answer for a sports performance coaching website.\n\n${facts}\n\nPage context: ${args.pageContext}\n\n${rules}\n\nWrite a single plain-text answer (40-90 words) to this question:\n"${args.question}"`
  }
  return `You are proposing FAQ questions for a page of a sports performance coaching website.\n\n${facts}\n\nPage context: ${args.pageContext}\n\n${existing}\n\n${rules}\n\nPropose 5 excellent, specific questions a real visitor to this page would ask. Return one question per line, no numbering.`
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run __tests__/lib/faq/ai-prompt.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/faq/ai-prompt.ts __tests__/lib/faq/ai-prompt.test.ts
git commit -m "feat(faq): grounded AI prompt builder"
```

### Task 13: AI assist API route

**Files:**
- Create: `app/api/admin/marketing/faqs/ai/route.ts`

- [ ] **Step 1: Implement the route** — admin-auth gated; body `{ action, page_key, question? }`; resolve the page context via `resolveFaqPage` (event keys: fetch the event and summarise); fetch existing questions via `listFaqsForPage`; build the prompt with `buildFaqAiPrompt`; call Anthropic via the existing `@ai-sdk/anthropic` wrapper in `lib/ai/` (small `maxTokens`, e.g. 600 — no streaming-guard risk); for `generate_questions` split the response into a string array; for `suggest_answer` return the text. Validate output shape with Zod before responding. On AI failure, return a 502 with a clear message so the UI can fall back to manual entry.

- [ ] **Step 2: Verify** — `npx tsc --noEmit -p .` clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/marketing/faqs/ai/route.ts
git commit -m "feat(faq): AI assist API route"
```

### Task 14: Wire AI buttons into the editor

**Files:**
- Modify: `app/(admin)/admin/marketing/faqs/FaqManager.tsx`

- [ ] **Step 1: Add "Generate questions"** — calls the AI route with `generate_questions`, shows the returned questions as a checklist the admin can select/edit; selected ones become new FAQ rows (still editable before save).

- [ ] **Step 2: Add "Suggest answer"** — in the editor, calls the AI route with `suggest_answer` for the current question; fills the answer field; admin edits freely.

- [ ] **Step 3: Verify** in `npm run dev` — both buttons produce editable output; an AI failure shows a toast and does not block manual entry.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/marketing/faqs/FaqManager.tsx"
git commit -m "feat(faq): AI generate-questions + suggest-answer in editor"
```

---

## Phase 4 — Migration

### Task 15: Seed script

**Files:**
- Create: `scripts/seed-faqs.ts`

- [ ] **Step 1: Write the seed script** — for each page, an array of the
current hardcoded FAQs (copy verbatim from `/faq`'s `groups`, `FAQSection`'s
`defaultFAQs`, and each page's inline FAQ array, plus the sport/athlete
data-file FAQs). Insert via the DAL `createFaq`, preserving order and (for
`/faq`) category. Make it idempotent — skip a page that already has rows.

- [ ] **Step 2: Run it** — `npx tsx scripts/seed-faqs.ts`. Verify row counts per page in the admin UI.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-faqs.ts
git commit -m "feat(faq): seed script for existing hardcoded FAQs"
```

### Tasks 16-24: Convert pages — ONE PER TASK

For each page, in this order — **verify the page renders identically and the
`FAQPage` JSON-LD is still present (view source) before moving to the next**:

| Task | Page | File |
|------|------|------|
| 16 | `/faq` | `app/(marketing)/faq/page.tsx` |
| 17 | `/online` | `app/(marketing)/online/page.tsx` |
| 18 | `/services/online-vs-in-person` | `.../online-vs-in-person/page.tsx` |
| 19 | `/services/coaching-vs-training-app` | `.../coaching-vs-training-app/page.tsx` |
| 20 | `/athletes` + `/athletes/[type]` | `app/(marketing)/athletes/...` |
| 21 | `/sports/[sport]` | `app/(marketing)/sports/[sport]/page.tsx` |
| 22 | `/programs/rotational-reboot` | `.../rotational-reboot/page.tsx` |
| 23 | `/camps/[slug]` | `app/(marketing)/camps/[slug]/page.tsx` |
| 24 | `/clinics/[slug]` | `app/(marketing)/clinics/[slug]/page.tsx` |

Each task:

- [ ] **Step 1** Replace the page's hardcoded FAQ array + inline `FAQPage`
  JSON-LD with `<ManagedFaqSection pageKey="<key>" variant="..." />` (use
  `variant="cards"` for pages currently using `<details>` cards; `"list"`
  for the athletes-page style). For `[type]`/`[sport]`/`[slug]` dynamic
  routes the `pageKey` is built from the route param.
- [ ] **Step 2** Remove now-unused FAQ constants/imports.
- [ ] **Step 3** Verify in `npm run dev`: page renders the FAQs; `view-source`
  shows the `FAQPage` JSON-LD.
- [ ] **Step 4** Commit: `git commit -m "refactor(faq): <page> renders FAQs from CMS"`

---

## Self-Review

**Spec coverage:** data model → Task 1; registry → Task 2; validator →
Task 3; DAL → Task 4; schema builder → Task 5; render component + auto
JSON-LD/speakable → Task 6; audit → Task 7; CRUD APIs → Task 8; admin UI →
Tasks 9-11; AI assist → Tasks 12-14; migration → Tasks 15-24. All spec
sections map to tasks.

**Placeholders:** Tasks 8 Steps 2-3, Task 9, Task 13, Task 14, Tasks 16-24
describe handlers/UI by pattern rather than full code — acceptable because
each names exact files, the exact API contract, the pattern file to copy
(`marketing-products`), and a concrete verification step. The novel logic
(migration SQL, registry, validator, DAL, render component, AI prompt) has
complete code.

**Type consistency:** `Faq` (Task 1) ↔ DAL return type (Task 4) ↔
`ManagedFaqSection` (Task 6) consistent. `FaqInput` (Task 3) ↔ `createFaq`/
`updateFaq` (Task 4) ↔ API routes (Task 8) consistent. `FaqPage` /
`resolveFaqPage` / `getStaticAndTemplatedFaqPages` (Task 2) used consistently
in Tasks 3, 6, 8, 9.

**Non-TDD tasks:** UI/route/migration tasks (6, 8-11, 13-24) verify by
`tsc` + manual `npm run dev` checks rather than unit tests — appropriate, as
they are integration/UI surfaces. The pure-logic units (2, 3, 4, 12) are TDD.

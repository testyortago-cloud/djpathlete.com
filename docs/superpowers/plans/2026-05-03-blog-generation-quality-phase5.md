# Blog Generation Quality — Phase 5: Lead Capture in Posts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Work directly on `main` (no feature branch — solo dev preference).

**Goal:** Stop sending every blog reader to the same hardcoded "Book Free Consultation" CTA. Three changes ship together: (1) an inline newsletter-capture block server-side-spliced after the first section of every post; (2) the bottom CTA is now data-driven via the program-catalog — Comeback Code on recovery posts, Rotational Reboot on rotational-sport posts, generic consultation otherwise; (3) a new `lead_magnets` table + admin CRUD page lets the coach upload topical lead magnets that auto-render under the intro of tag-matched posts.

**Architecture:** Three threads. (a) `<InlinePostNewsletterCapture>` is a client component (handles form state) that POSTs to the existing `/api/newsletter` endpoint with `source = "blog_inline"`; the public post page splits `post.content` at the second `<h2>` and inserts the capture between the first section and the rest. (b) `<ContextualCta>` is a server component that calls a Next.js mirror of `program-catalog.ts` (mirroring the Phase 1 functions-side helper) and either renders program-specific copy + a deep link to `/programs/{slug}` or falls back to today's hardcoded consultation copy. (c) `lead_magnets` is a new Supabase table with public-read RLS for `active=true` rows; a `<LeadMagnetBlock>` server component picks the best tag/category match and renders a compact "Free download" block under the intro; a new `/admin/lead-magnets` page provides full CRUD via API routes.

**Tech Stack:** Next.js 16 App Router, NextAuth v5, Tailwind v4, shadcn/ui, Zod, Vitest. No Functions-side changes this phase. Supabase migration via `mcp__supabase__apply_migration`.

**Spec:** [docs/superpowers/specs/2026-05-03-blog-generation-quality-design.md](../specs/2026-05-03-blog-generation-quality-design.md) — D8 (inline newsletter), D9 (context-aware bottom CTA — rendering portion only; the prompt-injection portion shipped in Phase 1), D10 (lead magnets).

---

## File Structure

### New files (Next.js side)
- `supabase/migrations/00112_lead_magnets.sql` — table + RLS
- `lib/blog/program-catalog.ts` — Next.js mirror of `functions/src/blog/program-catalog.ts`
- `lib/db/lead-magnets.ts` — DAL: list, byId, create, update, delete, findRelevantLeadMagnet
- `lib/validators/lead-magnet.ts` — Zod schema
- `app/api/admin/lead-magnets/route.ts` — GET (list), POST (create)
- `app/api/admin/lead-magnets/[id]/route.ts` — GET (one), PATCH (update), DELETE
- `app/(admin)/admin/lead-magnets/page.tsx` — list view with create/edit dialog + delete
- `components/admin/lead-magnets/LeadMagnetList.tsx` — admin table client component
- `components/admin/lead-magnets/LeadMagnetFormDialog.tsx` — create/edit dialog
- `components/marketing/blog/InlinePostNewsletterCapture.tsx` — client component
- `components/marketing/blog/ContextualCta.tsx` — server component
- `components/marketing/blog/LeadMagnetBlock.tsx` — server component

### Modified files (Next.js side)
- `app/api/newsletter/route.ts` — accept optional `source: string` param; pass to GHL
- `types/database.ts` — `LeadMagnet` interface
- `app/(marketing)/blog/[slug]/page.tsx` — split content at second h2 and inject `<InlinePostNewsletterCapture>`; render `<LeadMagnetBlock>` under hero, replace hardcoded CTA with `<ContextualCta>`

### Unchanged but referenced
- `functions/src/blog/program-catalog.ts` — the source of truth for `PROGRAMS`. Phase 5 Next.js mirror copies the same data; both files stay in sync manually (small change frequency, easy to manage).
- `/api/newsletter` — the existing subscribe endpoint; we extend it minimally rather than create a new route.

---

## Task 1: Migration `00112_lead_magnets.sql`

**Files:**
- Create: `supabase/migrations/00112_lead_magnets.sql`

- [ ] **Step 1: Create the migration file** with this exact content:

```sql
-- supabase/migrations/00112_lead_magnets.sql
-- Phase 5 of blog-generation-quality rollout.
-- Coach-managed catalog of downloadable lead magnets (PDFs, checklists, etc.)
-- that auto-render under the intro of topically-matching blog posts.
-- Public-read for active=true rows; service-role-only for writes.

CREATE TABLE lead_magnets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  asset_url text NOT NULL,
  category text CHECK (category IN ('Performance', 'Recovery', 'Coaching', 'Youth Development')),
  tags text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_magnets_active ON lead_magnets(active) WHERE active = true;
CREATE INDEX idx_lead_magnets_tags ON lead_magnets USING GIN (tags);
CREATE INDEX idx_lead_magnets_category ON lead_magnets(category) WHERE category IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_lead_magnets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lead_magnets_updated_at
  BEFORE UPDATE ON lead_magnets
  FOR EACH ROW EXECUTE FUNCTION set_lead_magnets_updated_at();

ALTER TABLE lead_magnets ENABLE ROW LEVEL SECURITY;

-- Public read for active rows (rendered on public blog).
CREATE POLICY "active lead magnets are public" ON lead_magnets
  FOR SELECT USING (active = true);

-- Service role bypasses RLS for all writes; admin API routes use the
-- service-role client.

COMMENT ON COLUMN lead_magnets.slug IS 'URL-friendly unique identifier (lowercase, hyphens).';
COMMENT ON COLUMN lead_magnets.asset_url IS 'Direct URL to the downloadable asset (PDF, etc.). Coach uploads to Supabase Storage or external host.';
COMMENT ON COLUMN lead_magnets.category IS 'Optional blog category match. NULL = matches any category.';
COMMENT ON COLUMN lead_magnets.tags IS 'Tags to match against post.tags. Best match wins when multiple magnets are eligible.';
COMMENT ON COLUMN lead_magnets.active IS 'When false, magnet does not render on public posts and is hidden from default admin list.';
```

- [ ] **Step 2: Apply via MCP**

Use `mcp__supabase__apply_migration` with name `lead_magnets` and the SQL above (omit the comment header lines).

- [ ] **Step 3: Verify**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'lead_magnets'
ORDER BY ordinal_position;
```
Expected: 9 rows (id, slug, title, description, asset_url, category, tags, active, created_at, updated_at — 10 actually).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00112_lead_magnets.sql
git commit -m "feat(leads): add lead_magnets table with RLS for public read (phase 5)"
```

---

## Task 2: Validators + types + DAL for lead magnets

**Files:**
- Create: `lib/validators/lead-magnet.ts`
- Create: `lib/db/lead-magnets.ts`
- Modify: `types/database.ts`

- [ ] **Step 1: Create the Zod validator**

Create `lib/validators/lead-magnet.ts`:

```ts
import { z } from "zod"
import { BLOG_CATEGORIES } from "./blog-post"

export const leadMagnetFormSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase with hyphens only"),
  title: z.string().min(3).max(140),
  description: z.string().min(10).max(400),
  asset_url: z.string().url("Must be a valid URL"),
  category: z.enum(BLOG_CATEGORIES).nullable().optional().transform((v) => v || null),
  tags: z.array(z.string().min(1).max(60)).max(10).optional().default([]),
  active: z.boolean().optional().default(true),
})

export type LeadMagnetFormData = z.infer<typeof leadMagnetFormSchema>
```

- [ ] **Step 2: Add `LeadMagnet` to `types/database.ts`**

Open `types/database.ts`. Add the `LeadMagnet` interface near the `BlogPost` interface (after `FaqEntry` is a logical spot):

```ts
export interface LeadMagnet {
  id: string
  slug: string
  title: string
  description: string
  asset_url: string
  category: BlogCategory | null
  tags: string[]
  active: boolean
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Create the DAL**

Create `lib/db/lead-magnets.ts`:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { LeadMagnet, BlogCategory } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export async function listLeadMagnets(includeInactive = false): Promise<LeadMagnet[]> {
  const supabase = getClient()
  let query = supabase.from("lead_magnets").select("*").order("created_at", { ascending: false })
  if (!includeInactive) query = query.eq("active", true)
  const { data, error } = await query
  if (error) throw error
  return data as LeadMagnet[]
}

export async function getLeadMagnetById(id: string): Promise<LeadMagnet | null> {
  const supabase = getClient()
  const { data, error } = await supabase.from("lead_magnets").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return (data as LeadMagnet | null) ?? null
}

export async function createLeadMagnet(
  input: Omit<LeadMagnet, "id" | "created_at" | "updated_at">,
): Promise<LeadMagnet> {
  const supabase = getClient()
  const { data, error } = await supabase.from("lead_magnets").insert(input).select("*").single()
  if (error) throw error
  return data as LeadMagnet
}

export async function updateLeadMagnet(
  id: string,
  input: Partial<Omit<LeadMagnet, "id" | "created_at" | "updated_at">>,
): Promise<LeadMagnet> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_magnets")
    .update(input)
    .eq("id", id)
    .select("*")
    .single()
  if (error) throw error
  return data as LeadMagnet
}

export async function deleteLeadMagnet(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("lead_magnets").delete().eq("id", id)
  if (error) throw error
}

export interface FindLeadMagnetInput {
  tags?: string[]
  category?: BlogCategory | null
}

/**
 * Best-match selection: prefer magnets whose tag overlap is highest, ties
 * broken by category match. Inactive magnets are excluded. Returns null when
 * no eligible magnet exists.
 */
export async function findRelevantLeadMagnet(input: FindLeadMagnetInput): Promise<LeadMagnet | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("lead_magnets")
    .select("*")
    .eq("active", true)
  if (error) throw error
  const candidates = (data ?? []) as LeadMagnet[]
  if (candidates.length === 0) return null

  const targetTags = new Set((input.tags ?? []).map((t) => t.toLowerCase()))

  const scored = candidates.map((m) => {
    const overlap = m.tags.filter((t) => targetTags.has(t.toLowerCase())).length
    const categoryMatch = m.category && input.category && m.category === input.category ? 1 : 0
    return { magnet: m, score: overlap * 2 + categoryMatch }
  })

  scored.sort((a, b) => b.score - a.score)
  if (scored[0].score < 1) return null
  return scored[0].magnet
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(lead-magnet|database\\.ts)" | head -10`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/lead-magnet.ts lib/db/lead-magnets.ts types/database.ts
git commit -m "feat(leads): add LeadMagnet validators, types, and DAL (phase 5)"
```

---

## Task 3: Next.js mirror of `program-catalog.ts`

**Files:**
- Create: `lib/blog/program-catalog.ts`

This mirrors `functions/src/blog/program-catalog.ts` for Next.js consumers (the `<ContextualCta>` component). Both files share data + logic; keep in sync manually.

- [ ] **Step 1: Create the file**

```ts
// lib/blog/program-catalog.ts
// Next.js-side mirror of functions/src/blog/program-catalog.ts.
// Shares the same PROGRAMS data + matching logic. Keep these two files in
// sync — both are short and the catalog changes infrequently.

export interface DjpProgram {
  slug: string
  name: string
  url: string
  pitch: string
  match_tags: string[]
  match_keywords: string[]
}

export const PROGRAMS: DjpProgram[] = [
  {
    slug: "comeback-code",
    name: "Comeback Code",
    url: "https://www.darrenjpaul.com/programs/comeback-code",
    pitch: "Structured return-to-performance program for athletes coming back from injury, layoff, or chronic limitation.",
    match_tags: [
      "recovery",
      "rehab",
      "rehabilitation",
      "return-to-sport",
      "injury",
      "comeback",
      "post-surgery",
    ],
    match_keywords: [
      "return to sport",
      "post-injury",
      "post-surgery",
      "comeback",
      "rehab",
      "rehabilitation",
      "deload",
      "recovery program",
    ],
  },
  {
    slug: "rotational-reboot",
    name: "Rotational Reboot",
    url: "https://www.darrenjpaul.com/programs/rotational-reboot",
    pitch: "Rotational power and movement program for pitchers, golfers, throwers, and racquet-sport athletes.",
    match_tags: [
      "rotational",
      "pitching",
      "throwing",
      "golf",
      "tennis",
      "baseball",
      "softball",
      "racquet",
    ],
    match_keywords: [
      "rotational power",
      "throwing velocity",
      "pitching velocity",
      "pitch",
      "golf swing",
      "tennis serve",
      "racquet",
      "bat speed",
    ],
  },
]

export interface FindProgramInput {
  tags?: string[]
  title?: string
  excerpt?: string
  primary_keyword?: string | null
}

export function findRelevantProgram(input: FindProgramInput): DjpProgram | null {
  const tagSet = new Set((input.tags ?? []).map((t) => t.toLowerCase()))
  const text = [input.title, input.excerpt, input.primary_keyword]
    .filter((s): s is string => Boolean(s))
    .join(" ")
    .toLowerCase()
  for (const p of PROGRAMS) {
    if (p.match_tags.some((t) => tagSet.has(t))) return p
    if (p.match_keywords.some((k) => text.includes(k))) return p
  }
  return null
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "lib/blog/program-catalog"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/blog/program-catalog.ts
git commit -m "feat(blog): add Next.js mirror of program-catalog (phase 5)"
```

---

## Task 4: `<InlinePostNewsletterCapture>` client component

**Files:**
- Create: `components/marketing/blog/InlinePostNewsletterCapture.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client"

import { useState } from "react"
import { Mail, Loader2, Check, AlertCircle } from "lucide-react"

type Status = "idle" | "submitting" | "success" | "error"

export function InlinePostNewsletterCapture() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === "submitting" || status === "success") return
    setStatus("submitting")
    setErrorMsg(null)
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          consent_marketing: true,
          source: "blog_inline",
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Subscription failed")
      }
      setStatus("success")
    } catch (err) {
      setStatus("error")
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong")
    }
  }

  return (
    <aside
      aria-label="Newsletter signup"
      className="my-8 not-prose rounded-xl border border-border bg-white p-5 sm:p-6"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="shrink-0 size-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Mail className="size-4 text-primary" aria-hidden />
        </div>
        <div>
          <p className="font-heading text-primary text-base sm:text-lg leading-snug">
            Liked this? Get the next one in your inbox.
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            One email when a new post lands. No spam.
          </p>
        </div>
      </div>

      {status === "success" ? (
        <div className="flex items-center gap-2 text-sm text-success">
          <Check className="size-4" aria-hidden />
          <span>Subscribed — check your inbox to confirm.</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={status === "submitting"}
            aria-label="Email address"
            className="flex-1 px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={status === "submitting" || email.trim().length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {status === "submitting" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {status === "submitting" ? "Subscribing..." : "Subscribe"}
          </button>
        </form>
      )}

      {status === "error" && errorMsg && (
        <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
          <AlertCircle className="size-3.5" aria-hidden />
          <span>{errorMsg}</span>
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep InlinePostNewsletterCapture`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/blog/InlinePostNewsletterCapture.tsx
git commit -m "feat(blog): add InlinePostNewsletterCapture client component (phase 5)"
```

---

## Task 5: `<ContextualCta>` server component

**Files:**
- Create: `components/marketing/blog/ContextualCta.tsx`

- [ ] **Step 1: Create the component**

```tsx
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { FadeIn } from "@/components/shared/FadeIn"
import { findRelevantProgram } from "@/lib/blog/program-catalog"
import type { BlogPost } from "@/types/database"

interface ContextualCtaProps {
  post: BlogPost
}

/**
 * Renders the bottom-of-post CTA. When a program from the catalog matches
 * the post's tags / title / primary_keyword, the CTA points at the program.
 * Otherwise it falls back to the generic consultation copy.
 */
export function ContextualCta({ post }: ContextualCtaProps) {
  const program = findRelevantProgram({
    tags: post.tags,
    title: post.title,
    excerpt: post.excerpt,
    primary_keyword: post.primary_keyword,
  })

  if (program) {
    return (
      <section className="py-16 lg:py-24 px-4 sm:px-8">
        <FadeIn>
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="h-px w-8 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">{program.name}</p>
              <div className="h-px w-8 bg-accent" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
              Ready to put this into a program?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">{program.pitch}</p>
            <Link
              href={program.url}
              className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md"
            >
              Explore {program.name}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </FadeIn>
      </section>
    )
  }

  return (
    <section className="py-16 lg:py-24 px-4 sm:px-8">
      <FadeIn>
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="h-px w-8 bg-accent" />
            <p className="text-sm font-medium text-accent uppercase tracking-widest">Work With Us</p>
            <div className="h-px w-8 bg-accent" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-heading font-semibold text-primary tracking-tight mb-4">
            Ready to take your performance seriously?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            If this resonated, imagine what a coaching relationship built around your specific needs could achieve.
          </p>
          <Link
            href="/contact"
            className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all hover:shadow-md"
          >
            Book Free Consultation
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </FadeIn>
    </section>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep ContextualCta`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/blog/ContextualCta.tsx
git commit -m "feat(blog): add ContextualCta server component (phase 5)"
```

---

## Task 6: `<LeadMagnetBlock>` server component

**Files:**
- Create: `components/marketing/blog/LeadMagnetBlock.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Download } from "lucide-react"
import { findRelevantLeadMagnet } from "@/lib/db/lead-magnets"
import type { BlogPost } from "@/types/database"

interface LeadMagnetBlockProps {
  post: BlogPost
}

/**
 * Renders a compact "Free download" callout under the post intro when an
 * active lead_magnet matches the post's tags or category. Returns null when
 * no match exists.
 *
 * The asset_url is a direct link — clicking opens the asset in a new tab.
 * No email gate (intentional Phase 5 choice — gating is a future phase).
 */
export async function LeadMagnetBlock({ post }: LeadMagnetBlockProps) {
  let magnet
  try {
    magnet = await findRelevantLeadMagnet({
      tags: post.tags,
      category: post.category,
    })
  } catch (err) {
    console.warn(`[LeadMagnetBlock] lookup failed: ${(err as Error).message}`)
    return null
  }
  if (!magnet) return null

  return (
    <aside
      aria-label="Free download"
      className="not-prose rounded-xl border border-accent/30 bg-accent/5 p-5 sm:p-6 my-8"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 size-10 rounded-lg bg-accent/15 flex items-center justify-center">
          <Download className="size-5 text-accent" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent">─ Free download</p>
          <h3 className="mt-1 font-heading text-primary text-base sm:text-lg leading-snug">{magnet.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{magnet.description}</p>
          <a
            href={magnet.asset_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-4"
          >
            Download <Download className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep LeadMagnetBlock`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/blog/LeadMagnetBlock.tsx
git commit -m "feat(blog): add LeadMagnetBlock server component (phase 5)"
```

---

## Task 7: Lead-magnet API routes

**Files:**
- Create: `app/api/admin/lead-magnets/route.ts`
- Create: `app/api/admin/lead-magnets/[id]/route.ts`

- [ ] **Step 1: Create `route.ts` (list + create)**

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { leadMagnetFormSchema } from "@/lib/validators/lead-magnet"
import { listLeadMagnets, createLeadMagnet } from "@/lib/db/lead-magnets"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const magnets = await listLeadMagnets(true)
    return NextResponse.json({ magnets })
  } catch (err) {
    console.error("[GET /api/admin/lead-magnets]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  const parsed = leadMagnetFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    )
  }
  try {
    const created = await createLeadMagnet({
      slug: parsed.data.slug,
      title: parsed.data.title,
      description: parsed.data.description,
      asset_url: parsed.data.asset_url,
      category: parsed.data.category,
      tags: parsed.data.tags,
      active: parsed.data.active,
    })
    return NextResponse.json({ magnet: created }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ error: "Slug already in use" }, { status: 409 })
    }
    console.error("[POST /api/admin/lead-magnets]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create `[id]/route.ts` (get one + update + delete)**

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { leadMagnetFormSchema } from "@/lib/validators/lead-magnet"
import {
  getLeadMagnetById,
  updateLeadMagnet,
  deleteLeadMagnet,
} from "@/lib/db/lead-magnets"

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  try {
    const magnet = await getLeadMagnetById(id)
    if (!magnet) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ magnet })
  } catch (err) {
    console.error("[GET /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = leadMagnetFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    )
  }
  try {
    const updated = await updateLeadMagnet(id, parsed.data)
    return NextResponse.json({ magnet: updated })
  } catch (err) {
    console.error("[PATCH /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  try {
    await deleteLeadMagnet(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[DELETE /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "lead-magnets" | head -10`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/lead-magnets/route.ts 'app/api/admin/lead-magnets/[id]/route.ts'
git commit -m "feat(api): add lead-magnets CRUD routes (phase 5)"
```

---

## Task 8: Admin `/admin/lead-magnets` page

**Files:**
- Create: `app/(admin)/admin/lead-magnets/page.tsx`
- Create: `components/admin/lead-magnets/LeadMagnetList.tsx`
- Create: `components/admin/lead-magnets/LeadMagnetFormDialog.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { Download } from "lucide-react"
import { listLeadMagnets } from "@/lib/db/lead-magnets"
import { LeadMagnetList } from "@/components/admin/lead-magnets/LeadMagnetList"

export const metadata = { title: "Lead Magnets" }

export default async function LeadMagnetsPage() {
  const magnets = await listLeadMagnets(true)
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Lead Magnets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Downloadable assets that auto-render on tag-matched blog posts.
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-lg bg-accent/10">
          <Download className="size-5 text-accent" />
        </div>
      </div>
      <LeadMagnetList initialMagnets={magnets} />
    </div>
  )
}
```

- [ ] **Step 2: Create the list client component**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Trash2, Loader2, ExternalLink, Search } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { LeadMagnet } from "@/types/database"
import { LeadMagnetFormDialog } from "./LeadMagnetFormDialog"

interface LeadMagnetListProps {
  initialMagnets: LeadMagnet[]
}

export function LeadMagnetList({ initialMagnets }: LeadMagnetListProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<LeadMagnet | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const filtered = initialMagnets.filter((m) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      m.title.toLowerCase().includes(q) ||
      m.slug.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q))
    )
  })

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/lead-magnets/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete")
      toast.success("Lead magnet deleted")
      router.refresh()
    } catch {
      toast.error("Failed to delete lead magnet")
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, slug, tag..."
            className="pl-8 pr-3 py-2 rounded-lg border border-border bg-white text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" />
          New magnet
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">{search ? "No matches." : "No lead magnets yet. Create your first one."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Slug</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Tags</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-surface/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-primary line-clamp-1">{m.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5 md:hidden">{m.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{m.slug}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {m.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface text-muted-foreground border border-border">
                          {tag}
                        </span>
                      ))}
                      {m.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{m.tags.length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                      m.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                    )}>
                      {m.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={m.asset_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Preview asset"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setEditing(m)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {confirmId === m.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(m.id)}
                            disabled={deletingId === m.id}
                            className="px-2 py-1 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                          >
                            {deletingId === m.id ? <Loader2 className="size-3 animate-spin" /> : "Delete"}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-surface transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(m.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <LeadMagnetFormDialog
          magnet={editing}
          open={creating || !!editing}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false)
              setEditing(null)
            }
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create the form dialog**

```tsx
"use client"

import { useState, useEffect } from "react"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BLOG_CATEGORIES } from "@/lib/validators/blog-post"
import type { LeadMagnet, BlogCategory } from "@/types/database"

interface LeadMagnetFormDialogProps {
  magnet: LeadMagnet | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function LeadMagnetFormDialog({ magnet, open, onOpenChange, onSaved }: LeadMagnetFormDialogProps) {
  const [slug, setSlug] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [assetUrl, setAssetUrl] = useState("")
  const [category, setCategory] = useState<BlogCategory | "">("")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (magnet) {
      setSlug(magnet.slug)
      setTitle(magnet.title)
      setDescription(magnet.description)
      setAssetUrl(magnet.asset_url)
      setCategory(magnet.category ?? "")
      setTags(magnet.tags)
      setActive(magnet.active)
    } else {
      setSlug("")
      setTitle("")
      setDescription("")
      setAssetUrl("")
      setCategory("")
      setTags([])
      setActive(true)
    }
    setTagInput("")
    setError(null)
  }, [magnet, open])

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (!t) return
    if (tags.includes(t)) return
    if (tags.length >= 10) return
    setTags((prev) => [...prev, t])
    setTagInput("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const body = {
        slug,
        title,
        description,
        asset_url: assetUrl,
        category: category || null,
        tags,
        active,
      }
      const url = magnet ? `/api/admin/lead-magnets/${magnet.id}` : "/api/admin/lead-magnets"
      const method = magnet ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Save failed")
      }
      toast.success(magnet ? "Lead magnet updated" : "Lead magnet created")
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{magnet ? "Edit lead magnet" : "New lead magnet"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={140}
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={120}
              pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">Lowercase letters, numbers, hyphens.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={400}
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Asset URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              required
              value={assetUrl}
              onChange={(e) => setAssetUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-muted-foreground mt-1">Direct URL to the PDF or asset (Supabase Storage, S3, etc.).</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory((e.target.value as BlogCategory) || "")}
              className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="">Any</option>
              {BLOG_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Tags (max 10)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addTag()
                  }
                }}
                placeholder="add and press Enter"
                className="flex-1 px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <button
                type="button"
                onClick={addTag}
                disabled={!tagInput.trim() || tags.length >= 10}
                className="px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-surface transition-colors disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.map((t, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-border text-xs">
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-red-500"
                      aria-label={`Remove ${t}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="lead-magnet-active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 rounded border-border"
            />
            <label htmlFor="lead-magnet-active" className="text-sm text-foreground">
              Active (rendered on public posts)
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving ? "Saving..." : magnet ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "lead-magnets" | head -10`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add 'app/(admin)/admin/lead-magnets/page.tsx' components/admin/lead-magnets/
git commit -m "feat(admin): add /admin/lead-magnets CRUD page (phase 5)"
```

---

## Task 9: Newsletter route accepts `source`

**Files:**
- Modify: `app/api/newsletter/route.ts`

- [ ] **Step 1: Extend the schema and pass `source` to GHL**

Open `app/api/newsletter/route.ts`. Find the existing `newsletterSchema`:

```ts
const newsletterSchema = z.object({
  email: z.string().email("Invalid email address"),
  consent_marketing: z.boolean().optional().default(false),
})
```

Replace with:

```ts
const newsletterSchema = z.object({
  email: z.string().email("Invalid email address"),
  consent_marketing: z.boolean().optional().default(false),
  source: z.string().max(60).optional(),
})
```

Find the `ghlCreateContact` call. The current state passes `source: "website-newsletter"`. Replace with:

```ts
ghlCreateContact({
  email: result.data.email,
  tags: ["newsletter", ...(result.data.source ? [result.data.source] : [])],
  source: result.data.source ?? "website-newsletter",
}).catch((error) => console.error("[Newsletter] GHL contact creation failed:", error))
```

This way, posts coming from `source: "blog_inline"` get tagged in GHL for analytics and the source field is preserved.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "api/newsletter"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/api/newsletter/route.ts
git commit -m "feat(api): newsletter accepts optional source field for analytics differentiation (phase 5)"
```

---

## Task 10: Public post page integration

**Files:**
- Modify: `app/(marketing)/blog/[slug]/page.tsx`

- [ ] **Step 1: Read the current file**

The current ordering (after Phase 4) is:
1. Hero (title + excerpt + back link + category)
2. Cover image
3. Article body + ToC sidebar (one section)
4. FAQ section
5. Tags
6. RelatedPosts
7. Bottom CTA (hardcoded "Book Free Consultation")

Phase 5 changes:
- Insert `<LeadMagnetBlock>` between hero and cover image (or right after the cover image before the article — picks the best fit visually).
- Inside the article body, splice `<InlinePostNewsletterCapture />` after the first h2 section (i.e., right before the second `<h2>`).
- Replace the hardcoded bottom CTA with `<ContextualCta post={post} />`.

- [ ] **Step 2: Add the imports**

Open `app/(marketing)/blog/[slug]/page.tsx`. Alongside the existing component imports:

```ts
import { ContextualCta } from "@/components/marketing/blog/ContextualCta"
import { InlinePostNewsletterCapture } from "@/components/marketing/blog/InlinePostNewsletterCapture"
import { LeadMagnetBlock } from "@/components/marketing/blog/LeadMagnetBlock"
```

You can also remove the now-unused `Link` import for the hardcoded CTA if it's only used there. Check the file — `Link` may still be used by the back-to-list nav. If so, keep it.

- [ ] **Step 3: Add the content split logic**

Below the existing `tocEntries` and `faqEntries` derivations, add:

```ts
const splitAtSecondH2 = (html: string): { before: string; after: string } | null => {
  const firstH2End = html.indexOf("</h2>")
  if (firstH2End === -1) return null
  const secondH2Start = html.indexOf("<h2", firstH2End + 5)
  if (secondH2Start === -1) return null
  return { before: html.slice(0, secondH2Start), after: html.slice(secondH2Start) }
}

const splitContent = splitAtSecondH2(html)
const showInlineCapture = splitContent !== null
```

- [ ] **Step 4: Insert `<LeadMagnetBlock>` after the cover image**

Below the existing Cover Image section and before the Article Body section, add:

```tsx
{/* Lead magnet block — renders only when an active magnet matches */}
<section className="px-4 sm:px-8 -mt-4 lg:-mt-6">
  <div className="max-w-3xl mx-auto">
    <LeadMagnetBlock post={post} />
  </div>
</section>
```

(The negative top margin pulls the block close to the cover image. Adjust if visually odd.)

- [ ] **Step 5: Restructure the article body to inject `<InlinePostNewsletterCapture>`**

Find the article body section (uses ToC + `<article dangerouslySetInnerHTML>`). The current state:

```tsx
<div className="max-w-3xl mx-auto lg:mx-0">
  <article
    className="prose prose-lg max-w-none ..."
    dangerouslySetInnerHTML={{ __html: post.content }}
  />
</div>
```

Replace the `<article>` with a split rendering:

```tsx
<div className="max-w-3xl mx-auto lg:mx-0">
  <article className="prose prose-lg max-w-none text-muted-foreground prose-headings:font-heading prose-headings:text-primary prose-a:text-primary prose-strong:text-foreground prose-img:rounded-xl prose-h2:scroll-mt-24">
    {showInlineCapture && splitContent ? (
      <>
        <div dangerouslySetInnerHTML={{ __html: splitContent.before }} />
        <InlinePostNewsletterCapture />
        <div dangerouslySetInnerHTML={{ __html: splitContent.after }} />
      </>
    ) : (
      <div dangerouslySetInnerHTML={{ __html: html }} />
    )}
  </article>
</div>
```

- [ ] **Step 6: Replace the bottom CTA with `<ContextualCta>`**

Find the hardcoded bottom CTA section (the one with "Book Free Consultation"). Replace the entire `<section>...</section>` block with:

```tsx
<ContextualCta post={post} />
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "blog/\\[slug\\]" | head -10`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add 'app/(marketing)/blog/[slug]/page.tsx'
git commit -m "feat(blog): wire LeadMagnetBlock + InlineCapture + ContextualCta into post page (phase 5)"
```

---

## Task 11: Smoke verification + push

- [ ] **Step 1: Verify schema applied**

Run via `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'lead_magnets' ORDER BY ordinal_position;
```
Expected: 10 rows.

- [ ] **Step 2: Run the full functions test suite**

Run: `cd functions && npx vitest run 2>&1 | tail -5`
Expected: 209/209 pass (no functions-side changes this phase).

- [ ] **Step 3: Run Phase-5-relevant Next.js tests**

Run: `npx vitest run __tests__/api/admin/blog/ 2>&1 | tail -5`
Expected: still pass.

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^__tests__" | head -30`
Expected: no NEW errors.

- [ ] **Step 5: Push to origin**

```bash
git push origin main
```

---

## Acceptance criteria for Phase 5

- All 10 tasks committed.
- `lead_magnets` table exists with public-read RLS for `active=true`.
- `/admin/lead-magnets` page renders, list view + create/edit dialog + delete work.
- A test lead magnet manually created via the admin renders on a tag-matched blog post (manual verify).
- Posts with ≥2 h2s render an inline newsletter capture between the first and second sections.
- Posts with <2 h2s do NOT render the inline capture.
- Bottom CTA on a tag-matched post (recovery, comeback, etc.) shows program-specific copy + button to `/programs/comeback-code` or `/programs/rotational-reboot`.
- Bottom CTA on an unmatched post falls back to the generic "Book Free Consultation" copy.
- Newsletter submissions from the inline capture include `source: "blog_inline"` in GHL tags.
- No regressions in earlier phases.

## Out of scope (deferred)

- Email-gated lead magnets (currently asset_url is a direct link).
- Lead-magnet asset upload UI in the admin form (admin pastes a URL; uploads to Storage out-of-band).
- A/B testing CTA variants.
- LoRA fine-tune for hero images (Phase 6, exploratory).

---

## Execution

Proceeding directly with subagent-driven execution on `main`. Migration applied via Supabase MCP per saved memory.

# Clinics & Camps — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two public marketing pages at `/clinics` and `/camps` with static content and inquiry-form CTAs, so Darren has shareable URLs before any CMS work begins.

**Architecture:** Server-rendered Next.js App Router pages under `app/(marketing)/`, using existing shadcn/ui primitives, Tailwind v4 semantic tokens (`primary`, `accent`, `surface`, `font-heading`), Lucide icons, and the existing `InquiryForm` + `FadeIn` + `JsonLd` components. No database, no API routes, no admin UI in Phase 1. Presentational components (`FocusGrid`, `NumberedFlow`) are built generic so Phase 2 can pass real event data into them unchanged.

**Tech Stack:** Next.js 16 (App Router, server components), Tailwind v4, shadcn/ui, Framer Motion via `FadeIn`, Lucide icons, React Hook Form + Zod (existing inquiry form), Vitest + Testing Library, Playwright.

---

## Spec Reference

Source design doc: [docs/superpowers/specs/2026-04-14-clinics-and-camps-design.md](docs/superpowers/specs/2026-04-14-clinics-and-camps-design.md) — "Phase 1 — Public pages (marketing)".

## File Structure

**New files:**

| path | responsibility |
|---|---|
| `app/(marketing)/clinics/page.tsx` | Clinics landing page — metadata, JsonLd, assembled sections |
| `app/(marketing)/camps/page.tsx` | Camps landing page — metadata, JsonLd, assembled sections |
| `components/public/ClinicHero.tsx` | Hero section specific to clinics (copy + stats) |
| `components/public/CampHero.tsx` | Hero section specific to camps (copy + stats) |
| `components/public/FocusGrid.tsx` | Reusable 4-card "what gets coached" grid |
| `components/public/NumberedFlow.tsx` | Reusable numbered-steps block |
| `components/public/EventsComingSoonPanel.tsx` | Placeholder "New dates coming soon" panel for the upcoming-events section |
| `__tests__/components/public/FocusGrid.test.tsx` | Unit tests for FocusGrid |
| `__tests__/components/public/NumberedFlow.test.tsx` | Unit tests for NumberedFlow |
| `__tests__/e2e/clinics-camps.spec.ts` | Playwright smoke test for both pages |

**Modified files:**

| path | change |
|---|---|
| `lib/validators/inquiry.ts` | Add `"clinic"` and `"camp"` to `SERVICE_TYPES` + labels |
| `lib/constants.ts` | Add Clinics + Camps to `NAV_ITEMS` and `FOOTER_SECTIONS` |
| `app/sitemap.ts` | Add `/clinics` and `/camps` static entries |

## Design Tokens Reference

Use these throughout — never hardcoded hex or Darren's `bg-[#0b0b0b]`:

- **Backgrounds:** `bg-background` (white), `bg-surface` (light gray section separator), `bg-primary` (Green Azure, for dark hero), `bg-primary/5` for subtle tints
- **Text:** `text-foreground`, `text-muted-foreground`, `text-primary`, `text-primary-foreground` (on Green Azure), `text-accent` (Gray Orange highlight)
- **Buttons:** existing `Button` from `components/ui/button.tsx` — default variant uses `bg-primary`, use `variant="outline"` for secondary
- **Typography:** `font-heading` (Lexend Exa) for H1/H2, `font-body` (Lexend Deca) by default on body
- **Cards:** existing `Card` + `CardContent` from `components/ui/card.tsx`

---

## Task 1: Extend inquiry SERVICE_TYPES to include clinic and camp

**Why:** Phase 1 CTAs on both pages use `<InquiryForm defaultService="clinic" />` / `defaultService="camp"`. The Zod enum needs those values or the form will reject them.

**Files:**
- Modify: `lib/validators/inquiry.ts`

- [ ] **Step 1: Read current SERVICE_TYPES** (context only — already seen in plan prep)

- [ ] **Step 2: Add clinic and camp to the enum and labels**

Replace the `SERVICE_TYPES` and `SERVICE_LABELS` declarations in `lib/validators/inquiry.ts` with:

```typescript
export const SERVICE_TYPES = [
  "in_person",
  "online",
  "assessment",
  "clinic",
  "camp",
] as const

export type ServiceType = (typeof SERVICE_TYPES)[number]

export const SERVICE_LABELS: Record<ServiceType, string> = {
  in_person: "In-Person Coaching",
  online: "Online Coaching",
  assessment: "Assessment & Return to Performance",
  clinic: "Agility Clinic",
  camp: "Performance Camp",
}
```

- [ ] **Step 3: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/validators/inquiry.ts
git commit -m "feat(inquiry): add clinic and camp service types"
```

---

## Task 2: Build FocusGrid component with tests

**Why:** Reusable 4-card grid used in "What gets coached" (clinics) and "What gets developed" (camps). Takes an array of `{ title, body }` items and renders them as numbered cards with Lucide icons.

**Files:**
- Create: `components/public/FocusGrid.tsx`
- Test: `__tests__/components/public/FocusGrid.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/public/FocusGrid.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { FocusGrid } from "@/components/public/FocusGrid"

describe("FocusGrid", () => {
  const items = [
    { title: "Acceleration", body: "First-step intent." },
    { title: "Deceleration", body: "Braking with control." },
    { title: "Change of Direction", body: "Sharper repositioning." },
    { title: "Rotation", body: "Turning under pressure." },
  ]

  it("renders every item's title and body", () => {
    render(<FocusGrid items={items} />)
    for (const item of items) {
      expect(screen.getByText(item.title)).toBeInTheDocument()
      expect(screen.getByText(item.body)).toBeInTheDocument()
    }
  })

  it("numbers each card starting at 01", () => {
    render(<FocusGrid items={items} />)
    expect(screen.getByText("01")).toBeInTheDocument()
    expect(screen.getByText("02")).toBeInTheDocument()
    expect(screen.getByText("03")).toBeInTheDocument()
    expect(screen.getByText("04")).toBeInTheDocument()
  })

  it("renders nothing extra when given fewer items", () => {
    render(<FocusGrid items={items.slice(0, 2)} />)
    expect(screen.getByText("01")).toBeInTheDocument()
    expect(screen.getByText("02")).toBeInTheDocument()
    expect(screen.queryByText("03")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- FocusGrid`
Expected: FAIL with "Cannot find module '@/components/public/FocusGrid'".

- [ ] **Step 3: Implement FocusGrid**

Create `components/public/FocusGrid.tsx`:

```tsx
import { Zap, Timer, Target, Users, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export interface FocusItem {
  title: string
  body: string
}

interface FocusGridProps {
  items: FocusItem[]
}

const ICONS: LucideIcon[] = [Zap, Timer, Target, Users]

export function FocusGrid({ items }: FocusGridProps) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item, i) => {
        const Icon = ICONS[i % ICONS.length]
        const number = String(i + 1).padStart(2, "0")
        return (
          <Card
            key={item.title}
            className="h-full border-border bg-background rounded-2xl shadow-sm"
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  {number}
                </div>
              </div>
              <h3 className="mt-5 text-2xl font-heading font-semibold tracking-tight text-foreground">
                {item.title}
              </h3>
              <p className="mt-4 leading-7 text-muted-foreground">{item.body}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- FocusGrid`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/public/FocusGrid.tsx __tests__/components/public/FocusGrid.test.tsx
git commit -m "feat(public): add FocusGrid component for clinic/camp focus cards"
```

---

## Task 3: Build NumberedFlow component with tests

**Why:** Reusable numbered-steps block used in the "How it runs" section on clinics. Takes a `string[]` and renders each with a numbered badge.

**Files:**
- Create: `components/public/NumberedFlow.tsx`
- Test: `__tests__/components/public/NumberedFlow.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/public/NumberedFlow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { NumberedFlow } from "@/components/public/NumberedFlow"

describe("NumberedFlow", () => {
  const steps = [
    "Prep the body properly",
    "Coach the key actions clearly",
    "Build it into reactive tasks",
    "Finish with pressure and competition",
  ]

  it("renders each step text", () => {
    render(<NumberedFlow steps={steps} />)
    for (const step of steps) {
      expect(screen.getByText(step)).toBeInTheDocument()
    }
  })

  it("numbers steps starting at 1", () => {
    render(<NumberedFlow steps={steps} />)
    expect(screen.getByText("1")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- NumberedFlow`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement NumberedFlow**

Create `components/public/NumberedFlow.tsx`:

```tsx
interface NumberedFlowProps {
  steps: string[]
}

export function NumberedFlow({ steps }: NumberedFlowProps) {
  return (
    <div className="grid gap-4">
      {steps.map((step, i) => (
        <div
          key={step}
          className="flex items-start gap-4 rounded-2xl border border-border bg-background p-5 shadow-sm"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {i + 1}
          </div>
          <div className="pt-1 text-lg text-foreground">{step}</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- NumberedFlow`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/public/NumberedFlow.tsx __tests__/components/public/NumberedFlow.test.tsx
git commit -m "feat(public): add NumberedFlow component for step-by-step sections"
```

---

## Task 4: Build EventsComingSoonPanel component

**Why:** Phase 1 placeholder for the "Upcoming dates" section. Explains that dates are rolling out and points visitors to the inquiry form below. Takes a `type: 'clinic' | 'camp'` prop so copy can differ.

**Files:**
- Create: `components/public/EventsComingSoonPanel.tsx`

No tests — this is pure presentational copy that'll be replaced entirely in Phase 2.

- [ ] **Step 1: Implement EventsComingSoonPanel**

Create `components/public/EventsComingSoonPanel.tsx`:

```tsx
import { CalendarClock } from "lucide-react"

interface EventsComingSoonPanelProps {
  type: "clinic" | "camp"
}

const COPY: Record<EventsComingSoonPanelProps["type"], { title: string; body: string }> = {
  clinic: {
    title: "New clinic dates rolling out soon",
    body: "We're confirming locations and dates across the community. Register your interest below and we'll get in touch as soon as a clinic is scheduled near you.",
  },
  camp: {
    title: "Next camp block being scheduled",
    body: "Off-season and pre-season camp dates are being locked in. Register your interest below and we'll let you know as soon as the next block opens for enrolment.",
  },
}

export function EventsComingSoonPanel({ type }: EventsComingSoonPanelProps) {
  const copy = COPY[type]
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/10 p-8 md:p-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent">
          <CalendarClock className="h-6 w-6" strokeWidth={1.8} />
        </div>
        <div>
          <h3 className="text-2xl font-heading font-semibold tracking-tight text-foreground md:text-3xl">
            {copy.title}
          </h3>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
            {copy.body}
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/public/EventsComingSoonPanel.tsx
git commit -m "feat(public): add EventsComingSoonPanel placeholder for upcoming dates"
```

---

## Task 5: Build ClinicHero component

**Why:** Hero section for `/clinics`. Green Azure background, Lexend Exa headline, right-side pitch card, three-stat row. Content lifted from Darren's mockup.

**Files:**
- Create: `components/public/ClinicHero.tsx`

- [ ] **Step 1: Implement ClinicHero**

Create `components/public/ClinicHero.tsx`:

```tsx
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FadeIn } from "@/components/shared/FadeIn"

const STATS = [
  { label: "Format", value: "2 Hours" },
  { label: "Age Group", value: "12–18" },
  { label: "Numbers", value: "8–12 Max", accent: true },
]

export function ClinicHero() {
  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at top right, oklch(0.70 0.08 60 / 0.25), transparent 35%), radial-gradient(circle at bottom left, oklch(1 0 0 / 0.08), transparent 30%)",
        }}
      />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-20 md:px-6 md:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <FadeIn>
          <div className="inline-flex items-center rounded-full border border-primary-foreground/20 bg-primary-foreground/5 px-4 py-2 text-sm text-primary-foreground/80">
            Agility Clinics · Ages 12–18 · 8–12 athletes
          </div>
          <h1 className="mt-5 max-w-4xl font-heading text-5xl font-semibold tracking-tight md:text-7xl">
            Get quicker where the game actually changes.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-primary-foreground/80 md:text-xl">
            A 2-hour coaching session for athletes who want to move better, react faster, and
            look more in control when the game gets chaotic. The focus is agility through
            acceleration, deceleration, change of direction, and rotation.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button
              asChild
              size="lg"
              className="rounded-full bg-accent text-primary hover:bg-accent/90"
            >
              <Link href="#register-interest">
                Register Your Interest
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/10"
            >
              <Link href="#what-gets-coached">View Details</Link>
            </Button>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {STATS.map((stat) => (
              <div
                key={stat.label}
                className={`rounded-2xl border p-4 ${
                  stat.accent
                    ? "border-accent/40 bg-accent/15"
                    : "border-primary-foreground/15 bg-primary-foreground/5"
                }`}
              >
                <div className="text-sm text-primary-foreground/60">{stat.label}</div>
                <div className="mt-1 text-lg font-semibold">{stat.value}</div>
              </div>
            ))}
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card className="rounded-3xl border-primary-foreground/15 bg-primary-foreground/[0.06] shadow-2xl backdrop-blur">
            <CardContent className="p-6 md:p-8">
              <div className="text-xs uppercase tracking-[0.3em] text-primary-foreground/50">
                The pitch
              </div>
              <div className="mt-4 font-heading text-2xl font-medium leading-9 md:text-3xl">
                Not cone drills for the sake of cone drills.
              </div>
              <div className="mt-5 space-y-4 text-sm leading-7 text-primary-foreground/75 md:text-base">
                <p>
                  Athletes are coached through the actions that decide real moments in sport:
                  starting, stopping, redirecting, and re-organising under pressure.
                </p>
                <p>
                  Smaller group numbers mean better feedback, better reps, and a better
                  standard of coaching throughout.
                </p>
              </div>
              <div className="mt-7 rounded-2xl border border-accent/40 bg-accent/15 p-4 text-sm text-primary-foreground">
                Designed for athletes who want their movement to stand out, not just their
                effort.
              </div>
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/public/ClinicHero.tsx
git commit -m "feat(public): add ClinicHero section for /clinics landing page"
```

---

## Task 6: Build CampHero component

**Why:** Hero section for `/camps`. Same structural pattern as ClinicHero but with camp-specific copy, stats, and CTA labels.

**Files:**
- Create: `components/public/CampHero.tsx`

- [ ] **Step 1: Implement CampHero**

Create `components/public/CampHero.tsx`:

```tsx
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FadeIn } from "@/components/shared/FadeIn"

const STATS = [
  { label: "Focus", value: "Overall Performance" },
  { label: "Block", value: "Off / Pre-Season" },
  { label: "Added Value", value: "Insight + Reporting", accent: true },
]

export function CampHero() {
  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at top left, oklch(0.70 0.08 60 / 0.22), transparent 35%), radial-gradient(circle at bottom right, oklch(1 0 0 / 0.08), transparent 30%)",
        }}
      />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-20 md:px-6 md:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <FadeIn>
          <div className="inline-flex items-center rounded-full border border-primary-foreground/20 bg-primary-foreground/5 px-4 py-2 text-sm text-primary-foreground/80">
            Performance Camps · Off-Season + Pre-Season · Ages 12–18
          </div>
          <h1 className="mt-5 max-w-4xl font-heading text-5xl font-semibold tracking-tight md:text-7xl">
            Build more before the season takes over.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-primary-foreground/80 md:text-xl">
            Camps built to develop the physical base behind performance: speed, power,
            movement quality, conditioning, and robustness. In selected settings, athletes
            also get testing, insight, and reporting.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button
              asChild
              size="lg"
              className="rounded-full bg-accent text-primary hover:bg-accent/90"
            >
              <Link href="#register-interest">
                Register Your Interest
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/10"
            >
              <Link href="#what-gets-developed">See The Details</Link>
            </Button>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {STATS.map((stat) => (
              <div
                key={stat.label}
                className={`rounded-2xl border p-4 ${
                  stat.accent
                    ? "border-accent/40 bg-accent/15"
                    : "border-primary-foreground/15 bg-primary-foreground/5"
                }`}
              >
                <div className="text-sm text-primary-foreground/60">{stat.label}</div>
                <div className="mt-1 text-lg font-semibold">{stat.value}</div>
              </div>
            ))}
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card className="rounded-3xl border-primary-foreground/15 bg-primary-foreground/[0.06] shadow-2xl backdrop-blur">
            <CardContent className="p-6 md:p-8">
              <div className="text-xs uppercase tracking-[0.3em] text-primary-foreground/50">
                The difference
              </div>
              <div className="mt-4 font-heading text-2xl font-medium leading-9 md:text-3xl">
                More than sessions that just leave athletes tired.
              </div>
              <div className="mt-5 space-y-4 text-sm leading-7 text-primary-foreground/75 md:text-base">
                <p>
                  The aim is to build real physical qualities with more structure, more
                  purpose, and better feedback around progress.
                </p>
                <p>
                  In some environments that also means using selected technology to give
                  athletes clearer performance insight.
                </p>
              </div>
              <div className="mt-7 rounded-2xl border border-accent/40 bg-accent/15 p-4 text-sm text-primary-foreground">
                Prepare properly now so the season does not expose what was missed.
              </div>
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/public/CampHero.tsx
git commit -m "feat(public): add CampHero section for /camps landing page"
```

---

## Task 7: Assemble /clinics landing page

**Why:** Combines the components from Tasks 2–5 into the complete clinic landing page with metadata, JsonLd, and an anchored inquiry form at the bottom.

**Files:**
- Create: `app/(marketing)/clinics/page.tsx`

- [ ] **Step 1: Implement /clinics page**

Create `app/(marketing)/clinics/page.tsx`:

```tsx
import type { Metadata } from "next"
import { ChevronRight } from "lucide-react"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ClinicHero } from "@/components/public/ClinicHero"
import { FocusGrid, type FocusItem } from "@/components/public/FocusGrid"
import { NumberedFlow } from "@/components/public/NumberedFlow"
import { EventsComingSoonPanel } from "@/components/public/EventsComingSoonPanel"
import { InquiryForm } from "@/components/public/InquiryForm"

export const metadata: Metadata = {
  title: "Agility Clinics",
  description:
    "2-hour agility coaching clinics for athletes aged 12–18. Acceleration, deceleration, change of direction, and rotation — coached in small groups for serious feedback.",
  openGraph: {
    title: "Agility Clinics | DJP Athlete",
    description:
      "2-hour agility coaching clinics for athletes aged 12–18. Small groups, proper coaching, real transfer to sport.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agility Clinics | DJP Athlete",
    description:
      "2-hour agility coaching clinics for athletes aged 12–18. Small groups, proper coaching, real transfer to sport.",
  },
}

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  provider: {
    "@type": "Person",
    name: "Darren J Paul",
    worksFor: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://djpathlete.com",
    },
  },
  serviceType: "Youth Agility Clinic",
  description:
    "2-hour agility coaching clinics for youth athletes aged 12–18, focused on acceleration, deceleration, change of direction, and rotation.",
  url: "https://djpathlete.com/clinics",
  audience: { "@type": "Audience", audienceType: "Youth Athletes, 12–18" },
}

const FOCUS_ITEMS: FocusItem[] = [
  {
    title: "Acceleration",
    body: "First-step intent, projection, and creating a better start when space opens up.",
  },
  {
    title: "Deceleration",
    body: "Learning to brake with control so the next action is cleaner, quicker, and more usable.",
  },
  {
    title: "Change of Direction",
    body: "Sharper repositioning, better angles, and more efficient redirection under pressure.",
  },
  {
    title: "Rotation",
    body: "Turning, re-orienting, and organising the body better in the moments that matter.",
  },
]

const FLOW_STEPS = [
  "Prep the body properly",
  "Coach the key actions clearly",
  "Build it into reactive tasks",
  "Finish with pressure and competition",
]

const WHO_ITS_FOR = [
  "Field and court sport athletes aged 12–18",
  "Players who want sharper movement and more confidence in open play",
  "Parents looking for better athletic development, not generic hard work",
]

export default function ClinicsPage() {
  return (
    <>
      <JsonLd data={serviceSchema} />

      <ClinicHero />

      <section id="what-gets-coached" className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">
              What gets coached
            </div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              Agility work with proper coaching behind it.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              Built around the movement actions that show up again and again in competitive
              sport. Less filler. More transfer.
            </p>
          </div>
          <div className="mt-10">
            <FocusGrid items={FOCUS_ITEMS} />
          </div>
        </FadeIn>
      </section>

      <section className="bg-surface border-y border-border">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:px-6 md:py-20 lg:grid-cols-[0.95fr_1.05fr]">
          <FadeIn>
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">
              How it runs
            </div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              Coach first. Then challenge it.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              A clear progression so quality comes before pressure. The session builds
              understanding, then asks athletes to use it.
            </p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <NumberedFlow steps={FLOW_STEPS} />
          </FadeIn>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">
              Upcoming dates
            </div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              When and where
            </h2>
          </div>
          <div className="mt-10">
            <EventsComingSoonPanel type="clinic" />
          </div>
        </FadeIn>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr]">
          <FadeIn>
            <Card className="rounded-3xl border-border bg-background">
              <CardContent className="p-8">
                <div className="text-sm uppercase tracking-[0.25em] text-accent">
                  Who it is for
                </div>
                <h3 className="mt-3 font-heading text-3xl font-semibold tracking-tight">
                  Athletes who want to look and feel more effective in sport.
                </h3>
                <div className="mt-7 space-y-4 text-muted-foreground">
                  {WHO_ITS_FOR.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <ChevronRight className="mt-1 h-5 w-5 text-accent" />
                      <div>{item}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </FadeIn>

          <FadeIn delay={0.1}>
            <Card className="rounded-3xl border-border bg-gradient-to-br from-accent/10 to-surface">
              <CardContent className="p-8">
                <div className="text-sm uppercase tracking-[0.25em] text-muted-foreground">
                  Outcome
                </div>
                <div className="mt-4 font-heading text-3xl font-semibold tracking-tight">
                  Better movement. Better control. Better transfer.
                </div>
                <p className="mt-5 leading-8 text-muted-foreground">
                  Athletes leave with clearer movement understanding, sharper agility
                  mechanics, and better confidence when the game becomes less predictable.
                </p>
                <Button asChild className="mt-8 rounded-full">
                  <Link href="#register-interest">Register Your Interest</Link>
                </Button>
              </CardContent>
            </Card>
          </FadeIn>
        </div>
      </section>

      <section id="register-interest" className="bg-surface border-t border-border">
        <div className="mx-auto max-w-3xl px-4 py-16 md:px-6 md:py-20">
          <FadeIn>
            <InquiryForm
              defaultService="clinic"
              heading="Register interest in the next clinic"
              description="Leave your details and we'll get in touch as soon as a clinic is scheduled."
            />
          </FadeIn>
        </div>
      </section>
    </>
  )
}
```

- [ ] **Step 2: Start dev server and verify page renders**

Run: `npm run dev` (port 3050 per CLAUDE.md).

Navigate to `http://localhost:3050/clinics`.

Expected:
- Hero renders on Green Azure background with Lexend Exa headline
- Four focus cards show Acceleration / Deceleration / Change of Direction / Rotation
- Numbered flow shows 4 steps
- "New clinic dates rolling out soon" panel shows with accent styling
- "Who it's for" + "Outcome" two-card row renders
- Inquiry form at bottom has `clinic` pre-selected in the service dropdown
- Clicking "Register Your Interest" in the hero scrolls to the form

Stop the dev server.

- [ ] **Step 3: Verify type check and lint pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/(marketing)/clinics/page.tsx
git commit -m "feat(clinics): add /clinics landing page with static content and inquiry CTA"
```

---

## Task 8: Assemble /camps landing page

**Why:** Camp equivalent of Task 7. Structurally parallel but with camp-specific copy, a "Technology + feedback" section (cards grid) in place of the numbered flow, and camp inquiry.

**Files:**
- Create: `app/(marketing)/camps/page.tsx`

- [ ] **Step 1: Implement /camps page**

Create `app/(marketing)/camps/page.tsx`:

```tsx
import type { Metadata } from "next"
import { ChevronRight, Radar } from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"
import { FadeIn } from "@/components/shared/FadeIn"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CampHero } from "@/components/public/CampHero"
import { FocusGrid, type FocusItem } from "@/components/public/FocusGrid"
import { EventsComingSoonPanel } from "@/components/public/EventsComingSoonPanel"
import { InquiryForm } from "@/components/public/InquiryForm"

export const metadata: Metadata = {
  title: "Performance Camps",
  description:
    "Off-season and pre-season performance camps for athletes aged 12–18. Speed, power, movement quality, conditioning, plus testing and reporting where included.",
  openGraph: {
    title: "Performance Camps | DJP Athlete",
    description:
      "Off-season and pre-season performance camps for athletes aged 12–18. Build a stronger base before the season takes over.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Performance Camps | DJP Athlete",
    description:
      "Off-season and pre-season performance camps for athletes aged 12–18. Build a stronger base before the season takes over.",
  },
}

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  provider: {
    "@type": "Person",
    name: "Darren J Paul",
    worksFor: {
      "@type": "Organization",
      name: "DJP Athlete",
      url: "https://djpathlete.com",
    },
  },
  serviceType: "Off-Season / Pre-Season Performance Camp",
  description:
    "Multi-week off-season and pre-season athletic performance camps for youth athletes aged 12–18.",
  url: "https://djpathlete.com/camps",
  audience: { "@type": "Audience", audienceType: "Youth Athletes, 12–18" },
}

const FOCUS_ITEMS: FocusItem[] = [
  {
    title: "Speed + Power",
    body: "Acceleration, sprint mechanics, jumping, explosive outputs, and force expression.",
  },
  {
    title: "Strength Qualities",
    body: "Physical qualities that support robustness, force transfer, and repeatable performance.",
  },
  {
    title: "Movement Quality",
    body: "Better rhythm, posture, coordination, and control through athletic actions.",
  },
  {
    title: "Conditioning",
    body: "Capacity to train, recover, and compete without turning sessions into random suffering.",
  },
]

const TECH_ITEMS = [
  "Selected testing where appropriate",
  "Useful performance insight",
  "Clear summary reporting",
  "Feedback athletes can act on",
]

const WHO_ITS_FOR = [
  "Athletes aged 12–18 in an off-season or pre-season block",
  "Players who want better physical preparation before competition ramps up",
  "Parents and teams who value both training quality and measurable feedback",
]

export default function CampsPage() {
  return (
    <>
      <JsonLd data={serviceSchema} />

      <CampHero />

      <section id="what-gets-developed" className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">
              What gets developed
            </div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              A stronger, more complete performance base.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              Wider than agility alone. Built to help athletes develop the qualities that
              support performance before the competitive period ramps up.
            </p>
          </div>
          <div className="mt-10">
            <FocusGrid items={FOCUS_ITEMS} />
          </div>
        </FadeIn>
      </section>

      <section className="bg-surface border-y border-border">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:px-6 md:py-20 lg:grid-cols-[0.95fr_1.05fr]">
          <FadeIn>
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">
              Technology + feedback
            </div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              Train with more visibility on progress.
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              Where appropriate, selected testing and reporting add another layer to the camp
              experience. Not to overcomplicate it — to make progress more visible and useful.
            </p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="grid gap-4 md:grid-cols-2">
              {TECH_ITEMS.map((item) => (
                <Card key={item} className="rounded-2xl border-border bg-background">
                  <CardContent className="flex items-start gap-3 p-5 text-foreground">
                    <Radar className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" />
                    <div>{item}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <FadeIn>
          <div className="max-w-3xl">
            <div className="text-sm font-medium uppercase tracking-[0.25em] text-accent">
              Upcoming blocks
            </div>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-5xl">
              When the next camp runs
            </h2>
          </div>
          <div className="mt-10">
            <EventsComingSoonPanel type="camp" />
          </div>
        </FadeIn>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr]">
          <FadeIn>
            <Card className="rounded-3xl border-border bg-background">
              <CardContent className="p-8">
                <div className="text-sm uppercase tracking-[0.25em] text-accent">
                  Who it is for
                </div>
                <h3 className="mt-3 font-heading text-3xl font-semibold tracking-tight">
                  Athletes building toward the next level.
                </h3>
                <div className="mt-7 space-y-4 text-muted-foreground">
                  {WHO_ITS_FOR.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <ChevronRight className="mt-1 h-5 w-5 text-accent" />
                      <div>{item}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </FadeIn>

          <FadeIn delay={0.1}>
            <Card className="rounded-3xl border-border bg-gradient-to-br from-accent/10 to-surface">
              <CardContent className="p-8">
                <div className="text-sm uppercase tracking-[0.25em] text-muted-foreground">
                  Outcome
                </div>
                <div className="mt-4 font-heading text-3xl font-semibold tracking-tight">
                  Better prepared. Better built. Better informed.
                </div>
                <p className="mt-5 leading-8 text-muted-foreground">
                  Athletes leave with a stronger performance base and, where included, a
                  clearer view of what is improving and what still needs work.
                </p>
                <Button asChild className="mt-8 rounded-full">
                  <Link href="#register-interest">Register Your Interest</Link>
                </Button>
              </CardContent>
            </Card>
          </FadeIn>
        </div>
      </section>

      <section id="register-interest" className="bg-surface border-t border-border">
        <div className="mx-auto max-w-3xl px-4 py-16 md:px-6 md:py-20">
          <FadeIn>
            <InquiryForm
              defaultService="camp"
              heading="Register interest in the next camp"
              description="Leave your details and we'll get in touch as soon as camp dates are confirmed."
            />
          </FadeIn>
        </div>
      </section>
    </>
  )
}
```

- [ ] **Step 2: Start dev server and verify page renders**

Run: `npm run dev`.

Navigate to `http://localhost:3050/camps`.

Expected:
- Hero renders with camp copy and stats
- Four focus cards show Speed + Power / Strength Qualities / Movement Quality / Conditioning
- Tech + feedback section shows 4 radar-icon cards
- "Next camp block being scheduled" panel shows
- "Who it's for" + "Outcome" renders
- Inquiry form at bottom has `camp` pre-selected
- Hero CTA scrolls to the form

Stop the dev server.

- [ ] **Step 3: Verify type check and lint pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/(marketing)/camps/page.tsx
git commit -m "feat(camps): add /camps landing page with static content and inquiry CTA"
```

---

## Task 9: Add Clinics and Camps to site navigation and footer

**Why:** Users need a way to find these pages from other pages on the site.

**Files:**
- Modify: `lib/constants.ts`

- [ ] **Step 1: Extend the Services nav group and add to footer**

Replace the `NAV_ITEMS` and `FOOTER_SECTIONS` declarations in `lib/constants.ts` with:

```typescript
export const NAV_ITEMS: NavGroup[] = [
  {
    label: "Services",
    children: [
      { label: "In-Person Coaching", href: "/in-person", description: "Assessment-led, hands-on training" },
      { label: "Online Coaching", href: "/online", description: "A complete performance system" },
      { label: "Assessment", href: "/assessment", description: "Return-to-performance testing" },
      { label: "Agility Clinics", href: "/clinics", description: "2-hour youth agility workshops" },
      { label: "Performance Camps", href: "/camps", description: "Off-season & pre-season blocks" },
    ],
  },
  { label: "Resources", href: "/resources" },
  { label: "Education", href: "/education" },
  { label: "Blog", href: "/blog" },
  { label: "Coming Soon", href: "/coming-soon" },
]
```

And update the Services footer section:

```typescript
export const FOOTER_SECTIONS = [
  {
    title: "Services",
    links: [
      { label: "In-Person Coaching", href: "/in-person" },
      { label: "Online Coaching", href: "/online" },
      { label: "Assessment", href: "/assessment" },
      { label: "Agility Clinics", href: "/clinics" },
      { label: "Performance Camps", href: "/camps" },
      { label: "Education", href: "/education" },
      { label: "Coming Soon", href: "/coming-soon" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Workshop Clinic", href: "/resources" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Testimonials", href: "/testimonials" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Service", href: "/terms-of-service" },
    ],
  },
]
```

- [ ] **Step 2: Start dev server and verify nav + footer show both links**

Run: `npm run dev`.

On the homepage:
- Hover "Services" in the top nav → dropdown shows Agility Clinics and Performance Camps with descriptions
- Scroll to footer → Services column shows Agility Clinics and Performance Camps
- Click each link → page loads correctly

Stop the dev server.

- [ ] **Step 3: Verify type check and lint pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/constants.ts
git commit -m "feat(nav): add Agility Clinics and Performance Camps to nav and footer"
```

---

## Task 10: Add /clinics and /camps to sitemap

**Why:** SEO — both pages need to be discoverable by search engines via the generated sitemap.

**Files:**
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Add two static entries**

In `app/sitemap.ts`, insert these entries into the `staticPages` array (placement: between `/services` and `/contact`):

```typescript
    {
      url: `${BASE_URL}/clinics`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/camps`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
```

- [ ] **Step 2: Verify sitemap builds**

Run: `npm run dev`.

Navigate to `http://localhost:3050/sitemap.xml`.

Expected: XML response includes `<loc>https://djpathlete.com/clinics</loc>` and `<loc>https://djpathlete.com/camps</loc>`.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/sitemap.ts
git commit -m "feat(seo): add /clinics and /camps to sitemap"
```

---

## Task 11: Playwright smoke test for both pages

**Why:** Catch regressions if someone breaks a component or the marketing layout later. Smoke-level only in Phase 1 — full interaction testing comes in Phase 2 when there are actual signup flows to verify.

**Files:**
- Create: `__tests__/e2e/clinics-camps.spec.ts`

- [ ] **Step 1: Write the e2e smoke test**

Create `__tests__/e2e/clinics-camps.spec.ts`:

```typescript
import { test, expect } from "@playwright/test"

test.describe("Clinics landing page", () => {
  test("renders hero, focus cards, flow, coming-soon panel, and inquiry form", async ({ page }) => {
    await page.goto("/clinics")

    await expect(
      page.getByRole("heading", { level: 1, name: /get quicker where the game actually changes/i })
    ).toBeVisible()

    await expect(page.getByText("Acceleration")).toBeVisible()
    await expect(page.getByText("Deceleration")).toBeVisible()
    await expect(page.getByText("Change of Direction")).toBeVisible()
    await expect(page.getByText("Rotation")).toBeVisible()

    await expect(page.getByText(/new clinic dates rolling out soon/i)).toBeVisible()

    const serviceSelect = page.locator("select[name='service']")
    await expect(serviceSelect).toHaveValue("clinic")
  })

  test("hero CTA scrolls to the inquiry form", async ({ page }) => {
    await page.goto("/clinics")
    await page.getByRole("link", { name: /register your interest/i }).first().click()
    await expect(page).toHaveURL(/#register-interest$/)
  })
})

test.describe("Camps landing page", () => {
  test("renders hero, focus cards, tech section, coming-soon panel, and inquiry form", async ({ page }) => {
    await page.goto("/camps")

    await expect(
      page.getByRole("heading", { level: 1, name: /build more before the season takes over/i })
    ).toBeVisible()

    await expect(page.getByText("Speed + Power")).toBeVisible()
    await expect(page.getByText("Strength Qualities")).toBeVisible()
    await expect(page.getByText("Movement Quality")).toBeVisible()
    await expect(page.getByText("Conditioning")).toBeVisible()

    await expect(page.getByText(/next camp block being scheduled/i)).toBeVisible()

    const serviceSelect = page.locator("select[name='service']")
    await expect(serviceSelect).toHaveValue("camp")
  })
})
```

**Note on `select[name='service']`:** this assumes [components/public/InquiryForm.tsx](components/public/InquiryForm.tsx) renders the service field as a native `<select>` with `name="service"`. The Read of that file during plan prep confirmed `formData.get("service")` is used, which requires a named form element. If the service field is actually a custom Radix Select that does not render `name` on a native element, update the assertion to `await expect(page.getByText("Agility Clinic")).toBeVisible()` instead (verifying the pre-selected label text is shown).

- [ ] **Step 2: Note on playwright baseURL**

The `playwright.config.ts` has `baseURL: "http://localhost:3000"` and starts `npm run dev` as its web server. Your dev server actually listens on 3050 per [CLAUDE.md](CLAUDE.md). Playwright uses its own webServer block so the baseURL + `reuseExistingServer: true` usually sorts itself out, but if the test fails with a connection error, update `playwright.config.ts` `baseURL` and `webServer.url` to `http://localhost:3050` as a separate one-line change (not part of this task).

- [ ] **Step 3: Run the test**

Run: `npm run test:e2e -- clinics-camps`
Expected: 3 tests PASS across chromium/firefox/webkit projects (9 total assertions).

If only chromium is installed locally, running `npx playwright test --project=chromium clinics-camps` is acceptable — CI runs all three browsers.

- [ ] **Step 4: Commit**

```bash
git add __tests__/e2e/clinics-camps.spec.ts
git commit -m "test(e2e): add smoke tests for /clinics and /camps landing pages"
```

---

## Task 12: Final verification and Phase 1 close-out

**Why:** Before handing Phase 1 off, make sure the whole test suite, lint, format, and build all pass together — catches any unintended interactions between the changes.

**Files:** none new — verification only.

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test:run`
Expected: all tests pass. New `FocusGrid` and `NumberedFlow` tests are included; no prior tests broken.

- [ ] **Step 2: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: no errors.

If format:check fails, run `npm run format` and commit the formatting fix as a separate commit:
```bash
git add -A
git commit -m "style: prettier format clinics/camps phase 1 files"
```

- [ ] **Step 3: Run a production build**

Run: `npm run build`
Expected: build completes without errors. Both `/clinics` and `/camps` appear in the build output as static routes.

- [ ] **Step 4: Manual browser smoke-check**

Run: `npm run dev`.

Walk through, in one session:
1. `/` → header nav hover → Services dropdown shows Clinics + Camps
2. Click Clinics → full page renders, scroll through every section
3. Hero CTA → scrolls to form → form shows "Agility Clinic" pre-selected
4. Back to header → navigate to Camps → full page renders
5. Footer → Services column shows both links → clicking returns you correctly
6. `/sitemap.xml` → both URLs listed

Stop the dev server.

- [ ] **Step 5: Tag the phase boundary**

```bash
git tag phase-1-clinics-camps-complete
```

---

## Self-Review Checklist (performed during plan authoring)

**Spec coverage:**

| Spec requirement (Phase 1 scope) | Task |
|---|---|
| Two server-rendered pages at `/clinics` and `/camps` | Tasks 7, 8 |
| Hero with Green Azure bg, Lexend Exa, pitch card, stat row | Tasks 5, 6 |
| 4-card "what gets coached/developed" grid | Tasks 2, 7, 8 |
| Numbered 4-step "How it runs" (clinics) | Tasks 3, 7 |
| 4-card "Technology + feedback" block (camps) | Task 8 |
| "Coming soon" panel as upcoming-dates placeholder | Tasks 4, 7, 8 |
| "Who it's for" + "Outcome" two-card split | Tasks 7, 8 |
| Inline inquiry form with pre-filled service | Tasks 1, 7, 8 |
| Per-page metadata + Service JsonLd | Tasks 7, 8 |
| Navigation entry for both pages | Task 9 |
| Sitemap entries | Task 10 |
| Smoke-level component tests | Tasks 2, 3 |
| E2E smoke test | Task 11 |

No Phase 1 spec requirement is uncovered.

**Phase boundary:** EventCard and the DAL function `getPublishedEvents()` are correctly out of scope per the updated spec — they arrive in Phase 2 along with the migration.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "add validation" placeholders in any task. Every code step has complete code, every run step has an explicit command and expected output.

**Type consistency:** `FocusItem` interface is defined in Task 2 and imported by Tasks 7 and 8. `SERVICE_TYPES` is extended in Task 1 and the new `"clinic"` / `"camp"` values are used as `defaultService` in Tasks 7 and 8. `NumberedFlow` prop is `steps: string[]` — consistent between Task 3 and Task 7. `EventsComingSoonPanel` prop is `type: "clinic" | "camp"` — consistent between Task 4 and Tasks 7/8.

**Assumption risk:** The Playwright selector `select[name='service']` relies on `InquiryForm` using a native `<select>`. Task 11 Step 1 has a fallback assertion documented for the case where it's a Radix Select.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server on port 3050 (Turbopack)
npm run build        # Production build
npm run lint         # Next.js linter
npm run format       # Prettier format
npm run format:check # Check formatting

npm run test         # Vitest watch mode
npm run test:run     # Vitest single run
npm run test:coverage # Coverage report (v8)
npm run test:e2e     # Playwright e2e (Chromium, Firefox, WebKit)
```

Test files live in `__tests__/` with setup in `__tests__/setup.tsx`. E2E tests in `__tests__/e2e/`.

## Architecture

**Next.js 16 App Router** with route groups:

- `(marketing)/` — Public pages (landing, services, programs, blog)
- `(auth)/` — Login, register, password reset, email verification
- `(admin)/admin/` — Admin dashboard, client management, exercises, programs, AI tools
- `(client)/client/` — Client dashboard, workouts, progress, profile, assessments
- `api/` — REST endpoints for auth, stripe, AI jobs, webhooks, uploads, etc.

**Middleware** (`middleware.ts`) protects `/admin/*` (requires admin role) and `/client/*` (requires auth), redirecting to `/login` with callback URL.

**Path alias:** `@/*` maps to project root (no `src/` directory).

## Data Layer

- **Supabase PostgreSQL** with three client types in `lib/supabase.ts`: browser (public), server (SSR with cookies), service-role (admin ops)
- **Data access layer** in `lib/db/` — one file per table (28 files). All DB queries go through these files.
- **Validators** in `lib/validators/` — Zod schemas for all entities (21 files)
- **Auth:** NextAuth v5 with Credentials provider, JWT strategy, 24-hour sessions. Session includes `id`, `email`, `name`, `role` (admin | client).

## AI System

`lib/ai/` uses Anthropic Claude via `@ai-sdk/anthropic` with a 4-agent orchestration pipeline for program generation:

1. **Profile Analyzer** — Recommends split/periodization from client profile
2. **Program Architect** — Creates training split structure with exercise slots
3. **Exercise Selector** — Assigns exercises from library to slots
4. **Validation Agent** — Validates program for consistency/safety

Embeddings use Hugging Face transformers for exercise matching. Token tracking and retry logic included.

## Design System

- **Tailwind CSS v4** — CSS-based config via `@theme inline` in `app/globals.css`. No `tailwind.config.ts`.
- **Colors:** oklch color space. Primary: Green Azure `oklch(0.30 0.04 220)`, Accent: Gray Orange `oklch(0.70 0.08 60)`. Use semantic classes (`text-primary`, `bg-accent`), never hardcoded hex.
- **Fonts:** Lexend Exa (headings, `font-heading`), Lexend Deca (body, `font-body`), JetBrains Mono (mono, `font-mono`). Applied via CSS `@layer base` rules — no inline `fontFamily` styles.
- **Components:** shadcn/ui (new-york style) in `components/ui/`. Icons from Lucide.
- **Custom CSS vars:** `--success`, `--error`, `--warning`, `--surface` defined in globals.css.

## Key Patterns

- Supabase client: Remove `Database` generic to avoid type conflicts; cast results in DAL instead
- Component organization: `components/{ui,public,client,admin,forms,auth,shared,providers}/`
- Types in `types/database.ts` define comprehensive enums (UserRole, ExerciseCategory, TrainingIntent, SplitType, MovementPattern, etc.)
- Forms use React Hook Form with Zod resolvers
- Rich text editing via TipTap
- Drag-and-drop via @dnd-kit
- Charts via Recharts
- Notifications via Sonner
- Animations via Framer Motion

## Strategy Team Agents

Four agents coordinate through a weekly brief: Chief (Sun 10:00 UTC) → SEO / Ads / Social specialists. Each persists a memo row in its own `*_agent_memos` table.

- **Brief consumption.** Specialists call `latestApprovedBrief(supabase)` from `lib/db/strategy-briefs.ts` and stamp `brief_id`, `brief_alignment_score` (1-10), `ran_without_brief` on every memo. `brief.dont_do[]` is a hard guardrail (word-boundary regex in `scoreBlogVsBrief`; `brief_dont_do` rejection in SEO + Ads execute steps).
- **Calibrated confidence + dissent.** Every memo has `agent_confidence` (1-10) and `dissents_from_brief` + `dissent_reason`. Treat `agent_confidence ≤ 4` as actionable for human review. Chief memo uses `confidence` + `dissents_from_critic`.
- **Outcome scoring.** Outcome trackers compute `impact_score` (-100..100) per measured memo against the `agent_tool_baselines` running P95. `n_measured < 5` yields warm-up score `±50`. Updated on every batch.
- **Self-critique.** Chief, SEO, Ads run a cheap Haiku second pass via `runSelfCritique` after the main Sonnet call. If `shouldReRunAfterCritique(critique, confidence)` returns true (=== `should_revise` AND confidence ≤ 7), the main reason runs once more with objections appended. Notes persist on `*.self_critique_notes`. Social skips this — already has writer→reviewer. Feature flag: `agent_self_critique_enabled` in `system_settings` (default true).
- **Few-shot examples.** Read from `prompt_templates` via `readFewShots(supabase, scope, category)`. Scopes: `(global, chief_strategist)`, `(global, seo_agent)`, `(global, ads_agent)`, `(social, <platform>)`. `performance-learning-loop` writes the column; agents read it through `fewShotsBlock(examples)`.
- **functions/ ↔ lib/ boundary.** `functions/` has `rootDir: "src"` and cannot import from `lib/`. Helpers used in both runtimes (self-critique, few-shots, outcome-scoring) exist as twin copies: `functions/src/lib/*.ts` + `lib/agents/*.ts` or `lib/social/*.ts`.

## Environment Variables

See `.env.example` for required variables: Supabase, NextAuth, Stripe, Anthropic, GoHighLevel, Resend, Firebase credentials.

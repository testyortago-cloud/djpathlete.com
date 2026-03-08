# DJP Athlete — Implementation Guide

> Complete phase-by-phase plan for the DJP Athlete platform.
> Single source of truth for what's built, what's next, and how everything connects.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| UI | React 19, Tailwind CSS v4 (CSS config, no tailwind.config.ts), shadcn/ui (new-york) |
| Animation | Framer Motion |
| Icons | Lucide |
| Database | Supabase (PostgreSQL) |
| Auth | NextAuth v5 (beta), Credentials provider |
| Payments | Stripe (checkout sessions + webhooks) |
| AI | Anthropic Claude Sonnet (4-agent pipeline) |
| CRM | GoHighLevel (optional) |
| Email | Resend |
| Validation | Zod |
| Testing | Vitest + Testing Library + Playwright |

## Project Structure

```
app/
  (marketing)/          — Public pages (landing, services, programs, blog)
  (auth)/               — Login, register, forgot/reset password, verify email
  (admin)/admin/        — Admin dashboard (clients, exercises, programs, payments, settings)
  (client)/client/      — Client portal (dashboard, workouts, progress, profile, questionnaire)
  api/                  — API routes (auth, stripe, questionnaire, admin, client)

components/
  ui/                   — shadcn/ui primitives
  public/               — Marketing site components
  client/               — Client portal components
  admin/                — Admin dashboard components
  forms/                — Shared form components
  auth/                 — Auth-related components
  shared/               — Cross-cutting components
  providers/            — Context providers

lib/
  db/                   — Data access layer (one file per table)
  ai/                   — AI pipeline (anthropic, orchestrator, prompts, schemas, types)
  validators/           — Zod schemas
  utils.ts, constants.ts, supabase.ts, auth.ts, auth-helpers.ts, stripe.ts, ghl.ts

hooks/                  — Custom React hooks
types/                  — TypeScript types (database.ts, next-auth.d.ts)
supabase/migrations/    — SQL migration files
scripts/                — Seed scripts, utilities
```

## Brand

| Token | Value |
|-------|-------|
| Primary | Green Azure `#0E3F50` (oklch 0.30 0.04 220) |
| Accent | Gray Orange `#C49B7A` (oklch 0.70 0.08 60) |
| Heading Font | Lexend Exa (600-700) |
| Body Font | Lexend Deca (300-500) |
| Mono Font | JetBrains Mono |

---

## Phase 1: Foundation — COMPLETE

All 6 steps implemented.

### 1.1 Project Scaffolding
- Vitest, Playwright, Prettier configs
- PWA manifest, directory structure, npm scripts
- `.env.example` with all environment variables

### 1.2 Database Setup
- 12 Supabase migrations (users, client_profiles, exercises, programs, program_exercises, program_assignments, exercise_progress, payments, reviews, testimonials, notifications + RLS)
- TypeScript types in `types/database.ts`
- Supabase clients (browser, server, service-role) in `lib/supabase.ts`
- Data access layer: 10 files in `lib/db/`
- Seed data: 1 admin, 3 clients, 20 exercises, 2 programs

### 1.3 Authentication
- NextAuth v5 with Credentials provider + Supabase adapter
- Middleware protecting `/admin/*`, `/client/*`, `/api/admin/*`
- Login + Register forms wired to NextAuth
- Extended session with `role` + `userId`
- Auth hooks and helpers

### 1.4 Theme & Rebranding
- Lexend Exa/Deca/JetBrains Mono fonts via CSS variables
- Green Azure / Gray Orange brand colors in `@theme inline`
- Replaced ~83 hardcoded hex colors with semantic classes
- Removed ~99 inline `fontFamily` styles
- Custom shadcn primitives (empty-state, spinner)

### 1.5 Admin Dashboard Shell
- Admin layout with Green Azure sidebar, accent active state
- 8 placeholder admin pages
- Client list with search, filters, pagination

### 1.6 Client Portal Shell
- Client layout with bottom tabs (mobile) + sidebar (desktop)
- Dashboard, workouts, progress, profile, settings pages

---

## Phase 2: Feature Expansion — COMPLETE

### 2.1 Admin Exercise Library
- Exercise CRUD with form dialog
- YouTube video preview in form
- CSV import with bulk operations
- AI metadata fields (movement_pattern, force_type, laterality, muscles, is_bodyweight, is_compound)

### 2.2 Program Store + Stripe Checkout
- Public `/programs` page with program cards
- Program detail page with "Buy Now" button
- Stripe checkout session creation → hosted checkout → webhook
- Webhook creates payment record + program assignment
- GoHighLevel CRM sync on purchase
- Success page with "Start Training" CTA
- Admin payments dashboard with revenue metrics

**Purchase Flow:**
```
/programs → /programs/[id] → "Buy Now" → Stripe Checkout
  → Webhook: createPayment() + createAssignment()
  → /programs/success → /client/workouts
```

### 2.3 Program Builder
- Admin program form with split type, periodization, AI generation params
- Exercise scheduling by day/week with sets, reps, rest, RPE target, intensity %, tempo, group tags
- Drag-and-drop exercise ordering

### 2.4 Client Registration & Dashboard
- Registration with email verification (Resend)
- Forgot/reset password flow
- Client dashboard with stats overview
- Profile editing
- Welcome email after verification

### 2.5 Client Questionnaire (Static)
- 8-step linear form: goals, fitness level, training history, injuries, equipment, schedule, preferences, review
- Saves to `client_profiles` table
- Admin can view responses on client detail page
- Pre-fills if client already has a profile

### 2.6 AI Exercise Assignment Engine
- 4-agent Claude Sonnet pipeline:
  - Agent 1: Profile Analyzer (recommended split, volume targets, constraints)
  - Agent 2: Program Architect (program skeleton with weeks/days/slots)
  - Agent 3: Exercise Selector (assigns specific exercises to slots)
  - Agent 4: Validation (checks equipment, injury, difficulty, balance)
- Retry loop (max 2x) if validation fails
- Admin "AI Generate" dialog with client selector, goal config, split/periodization
- Generation log tracking tokens, duration, retries
- Cost: ~$0.12-0.36 per generation

### 2.7 PWA Polish
- Service worker (`public/sw.js`): cache-first for static, stale-while-revalidate for API
- "Add to Home Screen" install prompt banner
- Pull-to-refresh gesture handler
- Skeleton loading states for all client pages

### 2.8 Workout Logging & Recommendations
- Interactive workout logging from `/client/workouts`
- Progressive overload algorithm (`lib/weight-recommendation.ts`):
  - Epley 1RM estimation
  - RPE-based progression (≤7 increase, 8 maintain, 9 hold, 10 decrease)
  - Intensity-percentage-based computation
  - Trend detection (increasing/decreasing/stable)
- Expandable exercise cards with:
  - Recommended weight badges
  - Pre-filled log form (weight, sets, reps)
  - RPE slider (1-10)
  - Collapsible duration + notes fields
- AI Coach button → Claude analysis dialog (plateau detection, deload recommendations, key observations)
- Batch progress DAL function (avoids N+1 queries)

---

## Phase 3: Assessment Engine & AI Program Delivery — PLANNED

> Transforms the static questionnaire into a conditional assessment that identifies ability, auto-generates programs, and reassesses periodically.

**End-state vision:** Client signs up → completes conditional assessment → system determines ability level → AI auto-generates a personalized program pulling exercises matched to their level/equipment/goals → program is delivered weekly → after 4 weeks, reassessment triggers → AI adjusts difficulty based on logged performance + feedback → new program generated → cycle repeats.

### Dependency Graph
```
3A: Exercise Tagging
  │
  ├──→ 3B: Conditional Assessment
  │     │
  │     ├──→ 3C: Auto AI Program Generation
  │     │     │
  │     │     ├──→ 3D: Weekly Progressive Programs
  │     │     │     │
  │     │     │     └──→ 3E: Periodic Reassessment
  │     │     │
  │     │     └──→ 3F: Coach Dashboard & Oversight
  │     │
  │     └── Can be built in parallel with 3C
  │
  └── Can start immediately
```

### 3A — Exercise Categorization & Tagging

**Goal:** Every exercise gets a granular difficulty score and progression chain so AI can match exercises to client ability.

**Database Changes:**
```sql
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS difficulty_score integer CHECK (difficulty_score >= 1 AND difficulty_score <= 10),
  ADD COLUMN IF NOT EXISTS prerequisite_exercises uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS progression_order integer;

UPDATE exercises SET difficulty_score = CASE
  WHEN difficulty = 'beginner' THEN 3
  WHEN difficulty = 'intermediate' THEN 6
  WHEN difficulty = 'advanced' THEN 9
  ELSE 5
END WHERE difficulty_score IS NULL;
```

**Difficulty Scale:**
| Score | Label | Who it's for | Example |
|-------|-------|-------------|---------|
| 1-2 | Foundational | Complete beginners, rehab | Bodyweight squat, wall push-up |
| 3-4 | Beginner | New to gym, < 6 months | Goblet squat, push-up, lat pulldown |
| 5-6 | Intermediate | 6 months - 2 years | Back squat, bench press, barbell row |
| 7-8 | Advanced | 2+ years, strong base | Bulgarian SS, weighted pull-up, front squat |
| 9-10 | Elite | Competitive athletes | Snatch, muscle-up, pistol squat |

**Admin UI:** Add difficulty slider (1-10), progression order, prerequisite selector to exercise form.

**Files:**
| Action | File |
|--------|------|
| Migration | `supabase/migrations/00017_exercise_difficulty_scoring.sql` |
| Type | `types/database.ts` — add `difficulty_score`, `prerequisite_exercises`, `progression_order` |
| Validator | `lib/validators/exercise.ts` — add new fields |
| Admin UI | `components/admin/ExerciseFormDialog.tsx` — difficulty slider, prerequisites |
| Seed | `scripts/seed.ts` — update exercise data |

---

### 3B — Conditional Assessment Questionnaire

**Goal:** Replace static form with branching assessment that objectively determines ability per movement pattern — like a solar system selector where early answers determine follow-up questions.

**Assessment Flow:**
```
Section 1: Background & Goals (always shown)
  ├─ Training goals (multi-select)
  ├─ Sport (if sport_specific selected)
  └─ Available equipment (checkbox grid)

Section 2: Movement Screen (conditional branching)
  ├─ Squat: "Can you squat to parallel?"
  │   ├─ Yes → "Can you back squat your bodyweight?"
  │   │   ├─ Yes → "Can you squat 1.5x bodyweight?" → advanced/intermediate
  │   │   └─ No → beginner+
  │   └─ No → beginner
  │
  ├─ Push: "Can you do 5 push-ups?"
  │   ├─ Yes → "Can you bench your bodyweight?" → advanced/intermediate
  │   └─ No → beginner
  │
  ├─ Pull: "Can you do 1 strict pull-up?"
  │   ├─ Yes → "Can you do 10?" → advanced/intermediate
  │   └─ No → beginner
  │
  └─ Hinge: "Can you hip hinge with flat back?"
      ├─ Yes → "Can you deadlift your bodyweight?" → intermediate+/beginner+
      └─ No → beginner

Section 3: Training Context (always shown)
  ├─ Days per week, session duration
  └─ Injuries + injury detail builder

Section 4: Preferences (optional)
  └─ Likes, dislikes, notes

RESULT → Computed ability profile:
  ├─ Per-pattern levels (squat, push, pull, hinge)
  ├─ Overall level (beginner/intermediate/advanced/elite)
  └─ max_difficulty_score (drives exercise selection)
```

**Database:**
```sql
CREATE TABLE assessment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL CHECK (section IN ('movement_screen', 'background', 'context', 'preferences')),
  movement_pattern text,
  question_text text NOT NULL,
  question_type text NOT NULL CHECK (question_type IN ('yes_no', 'single_select', 'multi_select', 'number', 'text')),
  options jsonb,
  parent_question_id uuid REFERENCES assessment_questions(id),
  parent_answer text,
  level_impact jsonb,
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assessment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  assessment_type text NOT NULL CHECK (assessment_type IN ('initial', 'reassessment')),
  answers jsonb NOT NULL,
  computed_levels jsonb NOT NULL,
  max_difficulty_score integer NOT NULL,
  triggered_program_id uuid REFERENCES programs(id),
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Scoring:**
| Total Score | Level | Max Exercise Difficulty |
|-------------|-------|------------------------|
| 0-2 | Beginner | 1-4 |
| 3-5 | Intermediate | 4-7 |
| 6-8 | Advanced | 7-9 |
| 9+ | Elite | 8-10 |

**Files:**
| Action | File |
|--------|------|
| Migration | `supabase/migrations/00018_assessment_engine.sql` |
| Types | `types/database.ts` — `AssessmentQuestion`, `AssessmentResult` |
| DAL | `lib/db/assessments.ts` — CRUD for questions + results |
| Validator | `lib/validators/assessment.ts` |
| Scoring | `lib/assessment-scoring.ts` — pure function: answers → levels |
| API | `app/api/assessment/questions/route.ts` — GET active questions |
| API | `app/api/assessment/submit/route.ts` — POST answers → compute → save |
| API | `app/api/admin/assessments/questions/route.ts` — admin CRUD |
| API | `app/api/admin/assessments/results/route.ts` — admin view results |
| Component | `components/client/AssessmentForm.tsx` — branching form UI |
| Component | `components/admin/AssessmentQuestionBuilder.tsx` — question editor |
| Page | `app/(client)/client/questionnaire/page.tsx` — swap to AssessmentForm |
| Page | `app/(admin)/admin/assessments/page.tsx` — question builder |

---

### 3C — Auto-Triggered AI Program Generation

**Goal:** Assessment completion auto-triggers AI program generation using ability levels to filter exercises.

**Flow:**
```
Client submits assessment
  → Compute ability levels (max_difficulty_score)
  → Save assessment_result
  → Call AI orchestrator with ability constraints
    → Agent 1 receives: client profile + assessment levels
    → Agent 3 filters: exercises WHERE difficulty_score <= max_difficulty_score
    → Agent 4 validates: no exercises above client's level
  → Program created + auto-assigned (status: active)
  → Client redirected to /client/workouts
```

**Changes to AI pipeline:**
- `lib/ai/orchestrator.ts` — accept `assessment_result` as input
- `lib/ai/exercise-context.ts` — filter by `difficulty_score`
- `lib/ai/prompts.ts` — Agent 1 + Agent 4 prompts include ability levels
- Add `generation_trigger` to `ai_generation_log`: `'admin_manual' | 'initial_assessment' | 'reassessment'`

**Auto-assignment:** Complete existing active assignment → create new one → send notification.

**Files:**
| Action | File |
|--------|------|
| Modify | `lib/ai/orchestrator.ts`, `exercise-context.ts`, `prompts.ts` |
| Migration | `supabase/migrations/00019_generation_trigger.sql` |
| API | `app/api/assessment/submit/route.ts` — trigger generation after save |
| Component | `components/client/AssessmentForm.tsx` — add generation loading state |

---

### 3D — Weekly Progressive Programs

**Goal:** Track weekly progression within a program cycle. Client sees only the current week's exercises and advances after completing them.

**Database:**
```sql
ALTER TABLE program_assignments
  ADD COLUMN IF NOT EXISTS current_week integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_weeks integer;
```

**Behavior:**
- Workouts page filters `program_exercises` by `week_number = assignment.current_week`
- "Complete Week" button appears when all exercises for the week are logged
- Advancing to next week shows progressively harder programming
- Progress page shows week-over-week history

**Files:**
| Action | File |
|--------|------|
| Migration | `supabase/migrations/00020_assignment_week_tracking.sql` |
| Modify | `app/(client)/client/workouts/page.tsx` — filter by `current_week` |
| Modify | `lib/db/assignments.ts` — add `advanceWeek()` |
| API | `app/api/client/workouts/complete-week/route.ts` |
| Component | `components/client/WorkoutDay.tsx` — "Complete Week" button |

---

### 3E — Periodic Reassessment

**Goal:** After completing a program cycle (e.g., 4 weeks), prompt a shorter reassessment that adjusts difficulty based on 3 signals: client feedback, RPE data, and movement re-screen.

**Reassessment Form:**
```
Section 1: Performance Feedback
  ├─ "How did the program feel?" (too easy / just right / too hard)
  ├─ "Which exercises felt too easy?" (multi-select from their program)
  ├─ "Which exercises felt too hard?" (multi-select)
  └─ "Any new injuries?"

Section 2: Movement Re-Screen (only borderline patterns)
  └─ Re-test movements that were at beginner level

RESULT → Adjusted difficulty
```

**3-Signal Difficulty Adjustment:**
```
adjustment = 0
if feedback == "too_easy":  adjustment += 1
if avg_rpe < 6:             adjustment += 1   // workouts too light
if feedback == "too_hard":  adjustment -= 1
if avg_rpe > 9:             adjustment -= 1   // workouts too heavy
if movement_improved:       adjustment += 1

new_max_difficulty = clamp(old + adjustment, 1, 10)
```

**Database:**
```sql
ALTER TABLE assessment_results
  ADD COLUMN IF NOT EXISTS previous_assessment_id uuid REFERENCES assessment_results(id),
  ADD COLUMN IF NOT EXISTS feedback jsonb;
```

**Trigger:** When `current_week > total_weeks` → assignment status = completed → reassessment banner on dashboard.

**Files:**
| Action | File |
|--------|------|
| Migration | `supabase/migrations/00021_reassessment_fields.sql` |
| Scoring | `lib/assessment-scoring.ts` — `computeReassessmentAdjustment()` |
| API | `app/api/assessment/reassess/route.ts` |
| Component | `components/client/ReassessmentForm.tsx` |
| Component | `components/client/ReassessmentBanner.tsx` |
| Page | `app/(client)/client/reassessment/page.tsx` |
| Modify | `app/(client)/client/dashboard/page.tsx` — check for pending reassessments |

---

### 3F — Coach Dashboard & Oversight

**Goal:** Admin tools for managing the assessment → program → reassessment lifecycle.

**Features:**
1. **Assessment Question Builder** — CRUD, drag-and-drop ordering, branching logic, flow preview
2. **Client Assessment History** — timeline of all assessments per client, computed levels, generated programs, manual override
3. **Program Generation Log** — filter by trigger (manual / initial / reassessment)
4. **Exercise Progression Viewer** — progression chains per movement pattern, client positions

**Files:**
| Action | File |
|--------|------|
| Page | `app/(admin)/admin/assessments/page.tsx` |
| Page | `app/(admin)/admin/clients/[id]/assessments/page.tsx` |
| Component | `components/admin/AssessmentQuestionBuilder.tsx` |
| Component | `components/admin/ClientAssessmentTimeline.tsx` |
| Component | `components/admin/ExerciseProgressionViewer.tsx` |

---

## Phase 4: Content Pages & Service Expansion — PLANNED

### 4.1 Dedicated Service Pages
- [ ] `/services/in-person` — comprehensive assessment, strategic blueprint, structured development
- [ ] `/services/online` — individualized programming, video feedback, load monitoring
- [ ] `/services/return-to-perform` — clearance vs readiness, performance framework
- [ ] Application/inquiry form component (shared across services)

### 4.2 Homepage Content Refresh
- [ ] Hero: "Elite Performance is Not Trained. It is Engineered."
- [ ] Services section with 3 core offerings
- [ ] Real athlete testimonials with sport badges (WTA, Pro Pickleball)
- [ ] Updated about section

### 4.3 Coaching Philosophy / Five Pillar Framework
- [ ] `/philosophy` page with "The Grey Zone" content
- [ ] Visual framework diagram
- [ ] Integration with service pages

### 4.4 Resources Section
- [ ] `/resources` page structure
- [ ] Blog/article support

---

## Phase 5: Platform Polish & Advanced Features — PLANNED

### 5.1 Email Integration Expansion
- [ ] Contact form sends actual emails
- [ ] Payment receipt emails
- [ ] Program assignment notification emails
- [ ] Reassessment reminder emails

### 5.2 Video Analysis Integration
- [ ] File upload infrastructure (Vercel Blob or S3)
- [ ] Exercise instruction videos (admin uploads)
- [ ] Client video submission for form checks

### 5.3 Application/Intake Forms
- [ ] Selective application for in-person coaching
- [ ] Online coaching inquiry form
- [ ] RTP assessment inquiry form
- [ ] Admin view of applications

### 5.4 Notifications System UI
- [ ] Client notification bell/dropdown
- [ ] Mark as read
- [ ] Real-time updates (SSE or polling)

### 5.5 Advanced Client Dashboard
- [ ] Progress charts (weight over time, volume trends)
- [ ] Streak tracking
- [ ] Calendar view of scheduled workouts

---

## Phase 6: Launch Preparation — PLANNED

### 6.1 Production Setup
- [ ] Stripe live keys
- [ ] Domain and DNS
- [ ] Production environment variables
- [ ] Error monitoring (Sentry)

### 6.2 SEO & Performance
- [ ] Metadata and JSON-LD on all pages
- [ ] Image optimization
- [ ] Sitemap includes all pages
- [ ] Core Web Vitals optimization

### 6.3 Content Population
- [ ] All testimonials with real athlete data
- [ ] Programs created with pricing
- [ ] Exercise library fully populated with difficulty scores
- [ ] Final copy on all pages

### 6.4 End-to-End Testing
- [ ] Register → assessment → AI program → workouts → log → reassessment flow
- [ ] Purchase flow: browse → buy → checkout → access
- [ ] Mobile responsive testing
- [ ] Cross-browser testing

---

## Current Status

| Phase | Status | Key Deliverables |
|-------|--------|-----------------|
| **Phase 1: Foundation** | COMPLETE | Auth, DB, theme, admin shell, client portal |
| **Phase 2: Feature Expansion** | COMPLETE | Exercises, programs, Stripe, AI pipeline, questionnaire, PWA, workout logging |
| **Phase 3: Assessment Engine** | NEXT | Conditional assessment, auto AI programs, weekly progression, reassessments |
| **Phase 4: Content Pages** | PLANNED | Service pages, homepage refresh, philosophy |
| **Phase 5: Platform Polish** | PLANNED | Video, notifications, advanced dashboard |
| **Phase 6: Launch** | PLANNED | Production, SEO, testing |

---

## Test Accounts

```
Admin:  admin@darrenjpaul.com  (see seed script for credentials)
Client: marcus@test.com       (has 2 programs + exercise history)
Client: sarah@test.com        (has 1 program)
Client: james@test.com        (has 1 program)
```

Reseed: `npx tsx scripts/seed.ts`

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# NextAuth
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000

# AI
ANTHROPIC_API_KEY=

# Email
RESEND_API_KEY=

# CRM (optional)
GHL_API_KEY=
GHL_LOCATION_ID=
GHL_WORKFLOW_NEW_PURCHASE=
```

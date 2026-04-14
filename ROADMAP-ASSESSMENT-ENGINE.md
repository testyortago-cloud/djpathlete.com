# Assessment Engine & AI Program Delivery — Roadmap

> Transforming the static questionnaire into a conditional assessment engine that identifies client ability, auto-generates personalized programs via AI, and reassesses periodically to keep training progressive.

---

## Current State

- 8-step linear questionnaire saves to `client_profiles` (goals, self-reported level, equipment, schedule, preferences)
- 30 exercises in DB with full AI metadata (`movement_pattern`, `is_compound`, `difficulty`, `primary_muscles`, etc.)
- AI 4-agent pipeline exists (`lib/ai/orchestrator.ts`) — generates full programs but only triggered manually from admin panel
- Workout logging + weight recommendations implemented
- No conditional logic, no ability assessment, no auto-generation, no reassessments

## End-State Vision

Client signs up → completes conditional assessment → system determines ability level → AI auto-generates a personalized program pulling exercises matched to their level/equipment/goals → program is delivered weekly → after 4 weeks, reassessment questionnaire triggers → AI adjusts difficulty based on logged performance + feedback → new program generated → cycle repeats.

---

## Phase 3A: Exercise Categorization & Tagging

**Goal:** Every exercise has proper difficulty tags and level-appropriate alternatives so AI can pull the right exercises for each client.

### Database Changes

- Add `difficulty_score` (1-10 numeric) to `exercises` table — more granular than the current beginner/intermediate/advanced enum
- Add `prerequisite_exercises` (uuid[]) — e.g., Bulgarian Split Squat requires mastery of bodyweight lunge
- Add `progression_order` (integer) within each movement pattern — so AI knows step-ups → lunges → Bulgarian SS → pistol squat

### Migration

```sql
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS difficulty_score integer CHECK (difficulty_score >= 1 AND difficulty_score <= 10),
  ADD COLUMN IF NOT EXISTS prerequisite_exercises uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS progression_order integer;

-- Map existing difficulty enum to numeric scores
UPDATE exercises SET difficulty_score = CASE
  WHEN difficulty = 'beginner' THEN 3
  WHEN difficulty = 'intermediate' THEN 6
  WHEN difficulty = 'advanced' THEN 9
  ELSE 5
END WHERE difficulty_score IS NULL;
```

### Admin UI Changes

- Add `difficulty_score` slider (1-10) to exercise form
- Add `progression_order` field per movement pattern
- Add prerequisite exercise selector (search + multi-select)
- Bulk action: "Auto-tag difficulty scores" button — uses exercise metadata to suggest scores

### Exercise Tagging Guidelines (for Darren to populate)

| Score | Label        | Who it's for              | Example                                     |
| ----- | ------------ | ------------------------- | ------------------------------------------- |
| 1-2   | Foundational | Complete beginners, rehab | Bodyweight squat, wall push-up              |
| 3-4   | Beginner     | New to gym, < 6 months    | Goblet squat, push-up, lat pulldown         |
| 5-6   | Intermediate | 6 months - 2 years        | Back squat, bench press, barbell row        |
| 7-8   | Advanced     | 2+ years, strong base     | Bulgarian SS, weighted pull-up, front squat |
| 9-10  | Elite        | Competitive athletes      | Snatch, muscle-up, pistol squat             |

### Seed Update

- Update all 30 exercises with proper `difficulty_score` and `progression_order`
- Create exercise relationships: progression chains for each movement pattern

### Files

| Action    | File                                                        | Change                                                                              |
| --------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Migration | `supabase/migrations/00017_exercise_difficulty_scoring.sql` | Add columns                                                                         |
| Type      | `types/database.ts`                                         | Add `difficulty_score`, `prerequisite_exercises`, `progression_order` to `Exercise` |
| Validator | `lib/validators/exercise.ts`                                | Add new fields to schema                                                            |
| Admin UI  | `components/admin/ExerciseFormDialog.tsx`                   | Add difficulty slider, progression order, prerequisites                             |
| Seed      | `scripts/seed.ts`                                           | Update exercise data                                                                |

### Verification

- [ ] Every exercise has a `difficulty_score` 1-10
- [ ] Movement patterns have logical progression chains (e.g., push: wall push-up → push-up → bench press → incline DB press)
- [ ] Admin can edit difficulty scores and see progression order

---

## Phase 3B: Conditional Assessment Questionnaire

**Goal:** Replace the static form with a branching assessment that objectively determines client ability level — not self-reported. Think of it like your solar industry system selector: answers to early questions determine which follow-up questions appear.

### Assessment Flow Design

```
START
  │
  ├─ Section 1: Background & Goals (always shown)
  │   ├─ What are your training goals? (multi-select)
  │   ├─ What sport do you play? (if sport_specific selected)
  │   └─ What equipment do you have access to? (checkbox grid)
  │
  ├─ Section 2: Movement Screen (conditional branching)
  │   ├─ Q: "Can you perform a bodyweight squat to parallel?"
  │   │   ├─ Yes → Q: "Can you back squat your bodyweight?"
  │   │   │   ├─ Yes → Q: "Can you back squat 1.5x bodyweight?"
  │   │   │   │   ├─ Yes → squat_level = advanced
  │   │   │   │   └─ No  → squat_level = intermediate
  │   │   │   └─ No  → squat_level = beginner+
  │   │   └─ No  → squat_level = beginner
  │   │
  │   ├─ Q: "Can you do 5 push-ups with good form?"
  │   │   ├─ Yes → Q: "Can you bench press your bodyweight?"
  │   │   │   ├─ Yes → push_level = advanced
  │   │   │   └─ No  → push_level = intermediate
  │   │   └─ No  → push_level = beginner
  │   │
  │   ├─ Q: "Can you do 1 strict pull-up?"
  │   │   ├─ Yes → Q: "Can you do 10 strict pull-ups?"
  │   │   │   ├─ Yes → pull_level = advanced
  │   │   │   └─ No  → pull_level = intermediate
  │   │   └─ No  → pull_level = beginner
  │   │
  │   ├─ Q: "Can you hip hinge with a flat back?" (deadlift pattern)
  │   │   ├─ Yes → Q: "Can you deadlift your bodyweight?"
  │   │   │   ├─ Yes → hinge_level = intermediate+
  │   │   │   └─ No  → hinge_level = beginner+
  │   │   └─ No  → hinge_level = beginner
  │   │
  │   └─ (Coach can add/edit these questions from admin panel)
  │
  ├─ Section 3: Training Context
  │   ├─ How many days per week can you train?
  │   ├─ How long per session?
  │   ├─ Any injuries or limitations?
  │   └─ Injury detail builder (same as current)
  │
  ├─ Section 4: Preferences (optional, always shown)
  │   ├─ Exercise likes/dislikes
  │   └─ Additional notes
  │
  └─ RESULT: Computed ability profile
      ├─ overall_level: beginner | intermediate | advanced | elite
      ├─ squat_level, push_level, pull_level, hinge_level (per pattern)
      ├─ max_difficulty_score: 3-4 (beginner) | 5-7 (intermediate) | 7-9 (advanced) | 9-10 (elite)
      └─ This drives AI exercise selection
```

### Database Changes

```sql
-- Assessment questions (coach-editable from admin)
CREATE TABLE assessment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL CHECK (section IN ('movement_screen', 'background', 'context', 'preferences')),
  movement_pattern text, -- links to exercise movement_pattern for scoring
  question_text text NOT NULL,
  question_type text NOT NULL CHECK (question_type IN ('yes_no', 'single_select', 'multi_select', 'number', 'text')),
  options jsonb, -- for select types: [{value, label}]
  parent_question_id uuid REFERENCES assessment_questions(id), -- branching
  parent_answer text, -- show this question only if parent answered this value
  level_impact jsonb, -- how each answer maps to ability score: {"yes": 2, "no": 0}
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Assessment results (one per client per assessment)
CREATE TABLE assessment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  assessment_type text NOT NULL CHECK (assessment_type IN ('initial', 'reassessment')),
  answers jsonb NOT NULL, -- {question_id: answer_value}
  computed_levels jsonb NOT NULL, -- {overall: "intermediate", squat: "beginner", push: "intermediate", ...}
  max_difficulty_score integer NOT NULL, -- drives exercise selection
  triggered_program_id uuid REFERENCES programs(id), -- the program AI generated from this
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### How the Scoring Works

Each movement screen question has a `level_impact` value. The system walks the branching tree, sums scores per movement pattern, and maps to difficulty ranges:

| Total Score | Level        | Max Exercise Difficulty |
| ----------- | ------------ | ----------------------- |
| 0-2         | Beginner     | 1-4                     |
| 3-5         | Intermediate | 4-7                     |
| 6-8         | Advanced     | 7-9                     |
| 9+          | Elite        | 8-10                    |

### Admin Panel: Question Builder

- CRUD for assessment questions
- Drag-and-drop ordering
- Set parent question + parent answer for branching
- Preview the assessment flow as a tree diagram
- Default questions seeded (the movement screen above), but coach can customize

### Client-Side Assessment UI

- Replace current `QuestionnaireForm.tsx` with `AssessmentForm.tsx`
- Dynamic rendering based on `assessment_questions` table
- Branching: when user answers a question, check for child questions where `parent_answer` matches
- Progress bar adapts to actual path length (not fixed 8 steps)
- Animated transitions between questions (keep existing Framer Motion pattern)
- At end: show computed ability profile before submitting

### Files

| Action    | File                                              | Change                                                                   |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Migration | `supabase/migrations/00018_assessment_engine.sql` | Create `assessment_questions` + `assessment_results` tables              |
| Types     | `types/database.ts`                               | Add `AssessmentQuestion`, `AssessmentResult` interfaces                  |
| DAL       | `lib/db/assessments.ts`                           | CRUD for questions + results                                             |
| Validator | `lib/validators/assessment.ts`                    | Schemas for questions and answers                                        |
| Scoring   | `lib/assessment-scoring.ts`                       | Pure function: answers → computed levels + max difficulty                |
| API       | `app/api/assessment/questions/route.ts`           | GET active questions (client-facing)                                     |
| API       | `app/api/assessment/submit/route.ts`              | POST answers → compute scores → save result → trigger program generation |
| API       | `app/api/admin/assessments/questions/route.ts`    | Admin CRUD for questions                                                 |
| API       | `app/api/admin/assessments/results/route.ts`      | Admin view of client results                                             |
| Component | `components/client/AssessmentForm.tsx`            | Conditional branching assessment UI                                      |
| Component | `components/admin/AssessmentQuestionBuilder.tsx`  | Admin question management                                                |
| Page      | `app/(client)/client/questionnaire/page.tsx`      | Swap to AssessmentForm                                                   |
| Page      | `app/(admin)/admin/assessments/page.tsx`          | Admin question builder page                                              |

### Verification

- [ ] Coach can create/edit/reorder assessment questions from admin
- [ ] Client sees branching questions (answering "No" to push-up skips bench press question)
- [ ] System computes ability levels per movement pattern
- [ ] Results saved to `assessment_results` table
- [ ] Admin can view any client's assessment results and computed levels

---

## Phase 3C: Auto-Triggered AI Program Generation

**Goal:** When a client completes their assessment, AI automatically generates a personalized program using their computed ability levels to select appropriately-tagged exercises.

### Flow

```
Client submits assessment
  → POST /api/assessment/submit
    → Compute ability levels (max_difficulty_score)
    → Save assessment_result
    → Call AI orchestrator with ability constraints
      → Agent 1 (Profile Analyzer) receives: client profile + assessment levels
      → Agent 3 (Exercise Selector) filters: exercises WHERE difficulty_score <= max_difficulty_score
      → Agent 4 (Validation) checks: no exercises above client's level
    → Program created + assigned to client (status: active)
    → Client redirected to /client/workouts with their new program
```

### Changes to AI Pipeline

- Modify `lib/ai/orchestrator.ts` — accept `assessment_result` as input
- Modify `lib/ai/exercise-context.ts` — filter exercises by `difficulty_score <= max_difficulty_score`
- Modify Agent 1 prompt — include per-pattern ability levels so it can structure the program appropriately (e.g., beginner squat pattern → goblet squats, not back squats)
- Modify Agent 4 validation — reject any exercise with `difficulty_score` above the client's `max_difficulty_score`
- Add `generation_trigger` field to `ai_generation_log`: `'admin_manual' | 'initial_assessment' | 'reassessment'`

### Auto-Assignment

After AI generates the program:

1. If client has an existing active assignment → set status to `completed`
2. Create new assignment with start_date = today
3. Send notification: "Your personalized training program is ready!"

### Client Experience

```
Assessment complete → Loading screen: "Building your personalized program..."
  → Progress animation (reuse AiGenerateDialog progress pattern)
  → Success: "Your program is ready!" → CTA: "Start Training"
  → Redirect to /client/workouts
```

### Files

| Action    | File                                               | Change                                               |
| --------- | -------------------------------------------------- | ---------------------------------------------------- |
| Modify    | `lib/ai/orchestrator.ts`                           | Accept assessment result, pass to agents             |
| Modify    | `lib/ai/exercise-context.ts`                       | Filter by `difficulty_score`                         |
| Modify    | `lib/ai/prompts.ts`                                | Update Agent 1 + Agent 4 prompts with ability levels |
| Migration | `supabase/migrations/00019_generation_trigger.sql` | Add `generation_trigger` to `ai_generation_log`      |
| API       | `app/api/assessment/submit/route.ts`               | After saving result, trigger AI generation           |
| Component | `components/client/AssessmentForm.tsx`             | Add generation loading state after submit            |

### Verification

- [ ] Client completes assessment → AI program auto-generates (no admin intervention)
- [ ] Generated program only contains exercises at or below client's difficulty level
- [ ] Beginner client gets beginner exercises (goblet squat, not back squat)
- [ ] Program is auto-assigned to client
- [ ] Client sees their program on /client/workouts immediately

---

## Phase 3D: Weekly Progressive Programs

**Goal:** Instead of one static program forever, AI generates new weekly programming that progresses over time. Each week is logged so the coach can see the full training history.

### Concept

- A "program cycle" spans N weeks (e.g., 4 weeks)
- Each week's programming is a snapshot stored in `program_exercises` with the `week_number` field
- After a cycle ends, reassessment is triggered (Phase 3E)
- Between reassessments, weekly progression follows the periodization model:
  - **Linear:** weight/volume increases each week
  - **Undulating:** heavy/light/moderate rotation
  - **Block:** accumulation → intensification → realization

### How It Works

The AI orchestrator already generates multi-week programs with `week_number` on each `program_exercise`. The workouts page currently only shows week 1. Changes needed:

1. **Track current week** — Add `current_week` to `program_assignments`
2. **Show correct week** — Workouts page filters exercises by `week_number = assignment.current_week`
3. **Week advancement** — Automatic or manual:
   - Auto: When all exercises for the current week are logged, advance to next week
   - Manual: Coach advances from admin, or client clicks "Complete Week"
4. **Week history** — `/client/progress` shows completed weeks with logged data

### Database Changes

```sql
ALTER TABLE program_assignments
  ADD COLUMN IF NOT EXISTS current_week integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_weeks integer; -- denormalized from programs.duration_weeks
```

### Files

| Action    | File                                                     | Change                                               |
| --------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Migration | `supabase/migrations/00020_assignment_week_tracking.sql` | Add `current_week`                                   |
| Modify    | `app/(client)/client/workouts/page.tsx`                  | Filter exercises by `current_week`                   |
| Modify    | `lib/db/assignments.ts`                                  | Add `advanceWeek()` function                         |
| API       | `app/api/client/workouts/complete-week/route.ts`         | POST to advance week                                 |
| Component | `components/client/WorkoutDay.tsx`                       | Add "Complete Week" button when all exercises logged |

### Verification

- [ ] Client sees only current week's exercises
- [ ] Completing all exercises in a week shows "Complete Week" option
- [ ] Advancing shows next week's (potentially harder) programming
- [ ] Progress page shows week-over-week history

---

## Phase 3E: Periodic Reassessment

**Goal:** After completing a program cycle (e.g., 4 weeks), the client is prompted to take a reassessment. The reassessment is shorter than the initial assessment — it focuses on performance feedback and re-tests key movements. AI then generates a new program at the appropriate level.

### Reassessment Flow

```
Client completes week 4 (final week of cycle)
  → Banner appears: "Time for your reassessment!"
  → /client/reassessment (shorter form)
    │
    ├─ Section 1: Performance Feedback
    │   ├─ "How did the program feel overall?" (too easy / just right / too hard)
    │   ├─ "Which exercises felt too easy?" (multi-select from their program)
    │   ├─ "Which exercises felt too hard?" (multi-select from their program)
    │   └─ "Any new injuries or limitations?"
    │
    ├─ Section 2: Movement Re-Screen (only patterns that scored borderline)
    │   ├─ If squat_level was beginner: "Can you now squat to parallel with good form?"
    │   ├─ If push_level was beginner: "Can you now do 5 push-ups?"
    │   └─ (Skip patterns where client was already advanced)
    │
    └─ RESULT: Updated ability profile
        ├─ If "too easy" → increase max_difficulty_score by 1-2
        ├─ If "too hard" → decrease max_difficulty_score by 1
        ├─ If movement screen improved → upgrade that pattern's level
        ├─ Merge with logged performance data (RPE trends, weight progression)
        └─ Trigger new AI program generation at updated level
```

### Smart Difficulty Adjustment

The system combines three signals:

1. **Client feedback** — "too easy" / "too hard" (subjective)
2. **RPE data** — average RPE from logged workouts (objective)
3. **Movement re-screen** — can they now do things they couldn't before? (assessment)

```
adjustment = 0
if feedback == "too_easy": adjustment += 1
if avg_rpe < 6: adjustment += 1  // workouts were too light
if feedback == "too_hard": adjustment -= 1
if avg_rpe > 9: adjustment -= 1  // workouts were too heavy
if movement_screen_improved: adjustment += 1

new_max_difficulty = clamp(old_max_difficulty + adjustment, 1, 10)
```

### Database Changes

```sql
-- Reassessment extends assessment_results (assessment_type = 'reassessment')
-- Add fields for performance feedback
ALTER TABLE assessment_results
  ADD COLUMN IF NOT EXISTS previous_assessment_id uuid REFERENCES assessment_results(id),
  ADD COLUMN IF NOT EXISTS feedback jsonb; -- {overall_feeling, exercises_too_easy[], exercises_too_hard[], rpe_average}
```

### Trigger Logic

- When `current_week > total_weeks` on assignment → set assignment status to `completed`
- Show reassessment banner on client dashboard
- Client dashboard checks: any completed assignments without a follow-up reassessment?

### Files

| Action    | File                                                | Change                                                       |
| --------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Migration | `supabase/migrations/00021_reassessment_fields.sql` | Add feedback columns                                         |
| Scoring   | `lib/assessment-scoring.ts`                         | Add `computeReassessmentAdjustment()` using 3-signal formula |
| API       | `app/api/assessment/reassess/route.ts`              | POST reassessment → compute adjustment → trigger new program |
| Component | `components/client/ReassessmentForm.tsx`            | Shorter reassessment form                                    |
| Component | `components/client/ReassessmentBanner.tsx`          | Dashboard banner prompting reassessment                      |
| Page      | `app/(client)/client/reassessment/page.tsx`         | Reassessment page                                            |
| Modify    | `app/(client)/client/dashboard/page.tsx`            | Check for pending reassessments                              |

### Verification

- [ ] After completing final week, client sees reassessment banner
- [ ] Reassessment form is shorter (only performance feedback + borderline movement re-tests)
- [ ] "Too easy" feedback → new program has harder exercises
- [ ] "Too hard" feedback → new program has easier exercises
- [ ] Movement screen improvements are reflected in new level
- [ ] RPE data from logged workouts factors into adjustment
- [ ] New program auto-generated and assigned after reassessment

---

## Phase 3F: Coach Dashboard & Oversight

**Goal:** Darren (admin) can see the full assessment → program → reassessment lifecycle for every client, override AI decisions, and customize assessment questions.

### Admin Features

1. **Assessment Question Builder** (from Phase 3B)
   - Add/edit/reorder/deactivate questions
   - Set branching logic visually
   - Preview assessment flow

2. **Client Assessment History**
   - `/admin/clients/[id]/assessments` — timeline of all assessments
   - See initial assessment → computed levels → generated program → logged performance → reassessment → level changes
   - Override: manually adjust a client's difficulty level

3. **Program Generation Log**
   - Already exists (`ai_generation_log` table)
   - Add filter by `generation_trigger` (manual / initial_assessment / reassessment)
   - Show which assessment triggered each program

4. **Exercise Progression Viewer**
   - For each movement pattern, see the progression chain
   - See which clients are at which level on each chain
   - Identify clients ready to progress

### Files

| Action    | File                                                  | Change                        |
| --------- | ----------------------------------------------------- | ----------------------------- |
| Page      | `app/(admin)/admin/assessments/page.tsx`              | Question builder              |
| Page      | `app/(admin)/admin/clients/[id]/assessments/page.tsx` | Client assessment history     |
| Component | `components/admin/AssessmentQuestionBuilder.tsx`      | Drag-and-drop question editor |
| Component | `components/admin/ClientAssessmentTimeline.tsx`       | Timeline view                 |
| Component | `components/admin/ExerciseProgressionViewer.tsx`      | Movement pattern chains       |

---

## Phase Summary & Dependencies

```
Phase 3A: Exercise Categorization & Tagging
  │  (exercises get difficulty_score, progression_order)
  │
  ├──→ Phase 3B: Conditional Assessment Questionnaire
  │     │  (branching questions, computed ability levels)
  │     │
  │     ├──→ Phase 3C: Auto-Triggered AI Program Generation
  │     │     │  (assessment → AI → program → assigned)
  │     │     │
  │     │     ├──→ Phase 3D: Weekly Progressive Programs
  │     │     │     │  (week tracking, advancement)
  │     │     │     │
  │     │     │     └──→ Phase 3E: Periodic Reassessment
  │     │     │           (feedback + re-screen → difficulty adjustment → new program)
  │     │     │
  │     │     └──→ Phase 3F: Coach Dashboard & Oversight
  │     │           (question builder, assessment history, overrides)
  │     │
  │     └── Can be built in parallel with 3C
  │
  └── Can start immediately (no dependencies)
```

### Estimated Scope

| Phase | Complexity | New Files   | Modified Files                    |
| ----- | ---------- | ----------- | --------------------------------- |
| 3A    | Small      | 1 migration | 3 (types, validator, form) + seed |
| 3B    | Large      | ~10         | 2                                 |
| 3C    | Medium     | 2           | 4                                 |
| 3D    | Small      | 2           | 3                                 |
| 3E    | Medium     | ~6          | 3                                 |
| 3F    | Medium     | ~5          | 1                                 |

### Priority Order

1. **Phase 3A** first — quick win, required by everything else
2. **Phase 3B** next — the core assessment engine
3. **Phase 3C** next — connects assessment to AI (this is where magic happens)
4. **Phase 3D** — weekly progression (enhances experience but not blocking)
5. **Phase 3E** — reassessment loop (the cycle that keeps clients engaged)
6. **Phase 3F** — coach tools (can be built alongside any phase)

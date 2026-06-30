# Exercise Favorites — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design); ready for planning
**Author:** Claude (autonomous build session)

## Summary

Let clients **favorite exercises** so that (a) the AI program generator biases future
programs toward those exercises, (b) coaches can see/manage a client's favorites on the
admin client-detail page, and (c) clients can review their favorites on a dedicated page.

Favoriting is a lightweight toggle (insert-or-delete), keyed on `(client_user_id,
exercise_id)`. It is a **soft signal**: it never overrides the AI's hard safety filters
(injury / equipment / difficulty / assessment ceiling) and never mutates already-assigned
programs.

## Decisions (from brainstorming)

1. **Client surface** — a heart toggle on each exercise inside the client's assigned
   workout, **plus** a `/client/favorites` page that lists everything they've favorited.
   (Clients have no exercise-browsing library today, so favoriting happens from within
   their workouts.)
2. **AI learning** — a **soft scoring boost** applied during *future* program generation.
   Mirrors the existing coach-pool "preferred" boost. Never overrides hard filters; never
   touches existing programs.
3. **Admin powers** — coach can **view, add, and remove** a client's favorites on the
   admin client-detail page (`/admin/clients/[id]`). Adds are stamped `source='admin'`.

## Non-goals (YAGNI)

- No new client-facing browsable exercise catalog/library.
- No hard cap on number of favorites.
- No retroactive change to already-assigned programs.
- No per-favorite notes/reason field (the row records who added it and when; that's enough).

---

## 1. Data model — migration `00174_exercise_favorites.sql`

Mirrors the `athlete_goals` (`00134`) / `form_reviews` (`00042`) conventions: UUID PK,
FK with `ON DELETE CASCADE`, index, RLS (client manages own, admin manages all).

```sql
CREATE TABLE IF NOT EXISTS exercise_favorites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id     UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT 'client' CHECK (source IN ('client','admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_user_id, exercise_id)
);

CREATE INDEX idx_exercise_favorites_client ON exercise_favorites(client_user_id);

ALTER TABLE exercise_favorites ENABLE ROW LEVEL SECURITY;

-- Clients manage their own favorites
CREATE POLICY "Clients view own favorites"   ON exercise_favorites FOR SELECT USING (client_user_id = auth.uid());
CREATE POLICY "Clients insert own favorites" ON exercise_favorites FOR INSERT WITH CHECK (client_user_id = auth.uid());
CREATE POLICY "Clients delete own favorites" ON exercise_favorites FOR DELETE USING (client_user_id = auth.uid());

-- Admins manage all (mirror the athlete_goals admin policy expression exactly)
CREATE POLICY "Admins manage all favorites"  ON exercise_favorites FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
```

- **No `updated_at` / trigger** — favorites are insert-or-delete only; there is no update
  path. (Toggling off = delete; re-favoriting = insert.)
- The DAL uses the **service-role** client (bypasses RLS) like every other DAL file; RLS is
  defense-in-depth, matching the project convention.
- **Feature flag seed:** insert/upsert `exercise_favorites_ai_enabled = 'true'` into
  `system_settings` in the same migration (DB-backed flag per project rule — never env-var).
  This gates only the AI scoring boost — the favorites UI is always on. Follows the same
  convention as the client-pack flags (`lib/packs/flags.ts`): read via `getSetting`, flipped
  via the DB; **no dedicated admin toggle page in v1** (none exists for the client-pack flags
  either). Default `true` (favorites are the point), with the DB flip available as a kill
  switch.

### Migration deployment
Additive (new table + one settings row). Apply to prod via
`mcp__supabase__apply_migration` (per project convention). Harmless until the unpushed code
references it — same posture as `00172`/`00173`.

---

## 2. Types — `types/database.ts`

```ts
export type ExerciseFavoriteSource = "client" | "admin"

export interface ExerciseFavorite {
  id: string
  client_user_id: string
  exercise_id: string
  created_by: string | null
  source: ExerciseFavoriteSource
  created_at: string
}

// Returned by listFavoritesByClient (joined with exercises for display)
export interface ExerciseFavoriteWithExercise extends ExerciseFavorite {
  exercise: Pick<
    Exercise,
    "id" | "name" | "category" | "muscle_group" | "video_url" | "thumbnail_url" | "difficulty"
  > | null
}
```

---

## 3. Validation — `lib/validators/exercise-favorite.ts`

```ts
export const exerciseFavoriteToggleSchema = z.object({
  exerciseId: z.string().uuid(),
  favorited: z.boolean(), // desired end state: true = add, false = remove
})
export type ExerciseFavoriteToggleInput = z.infer<typeof exerciseFavoriteToggleSchema>

// Admin on-behalf add/remove (the [id] route param carries the client)
export const adminExerciseFavoriteSchema = z.object({
  exerciseId: z.string().uuid(),
})
```

---

## 4. App-side DAL — `lib/db/exercise-favorites.ts`

Follows the `athlete-goals.ts` pattern (service-role client, throw on error, return typed
data). Functions:

- `getFavoriteExerciseIds(clientUserId: string): Promise<Set<string>>`
  Lightweight `select("exercise_id")`; used by the client workouts page to mark hearts.
- `listFavoritesByClient(clientUserId: string): Promise<ExerciseFavoriteWithExercise[]>`
  `select("*, exercise:exercises(id,name,category,muscle_group,video_url,thumbnail_url,difficulty)")`
  ordered by `created_at DESC`. Used by `/client/favorites` and the admin panel.
- `addFavorite(clientUserId, exerciseId, opts: { createdBy: string; source: ExerciseFavoriteSource }): Promise<void>`
  Idempotent — `upsert(..., { onConflict: "client_user_id,exercise_id", ignoreDuplicates: true })`.
- `removeFavorite(clientUserId, exerciseId): Promise<void>`
  `delete().eq(client_user_id).eq(exercise_id)`.

---

## 5. AI integration — soft scoring boost (`functions/`)

The AI runs in `functions/src/ai/`. The cleanest, lowest-risk hook **mirrors the existing
coach-pool "preferred" mechanism**, which is already threaded through both filter paths and
loaded in the orchestrator's `Promise.all`.

### 5a. Functions-side reader
New `getClientFavoriteExerciseIds(clientId: string): Promise<Set<string>>` in
**`functions/src/ai/usage-history.ts`** (next to `getClientRecentUsageFromFn`). Direct
Supabase `select("exercise_id")` on `exercise_favorites`. Respects the `functions/ ↔ lib/`
boundary (no `lib/` import). Returns an empty Set on error (best-effort, like the usage
readers).

### 5b. Flag gate
Read with the existing helper:
`getSetting<boolean>("exercise_favorites_ai_enabled", true)` from
**`functions/src/lib/system-settings.ts`** (fail-open default `true`). When disabled, pass
an empty `favoriteIds` Set so the boost is inert.

### 5c. Orchestrator wiring — BOTH orchestrators
There are **two** generators and **two** filter call sites; favorites must be wired into
both, identically:
- `functions/src/ai/orchestrator.ts` — full-program gen. `Promise.all` at ~line 340
  (`[agent1Result, allExercises, coachUsage, clientUsage]`); filter calls at lines 541
  (`semanticFilterExercises`) & 548 (`scoreAndFilterExercises`).
- `functions/src/ai/week-orchestrator.ts` — per-week "AI Fill Week". `Promise.all` at ~line
  350 (`[program, existingExercises, fullLibrary, coachPolicy, coachUsage, clientUsage]`);
  filter calls at lines 796 & 805.

In each, add a favorites entry to the `Promise.all` that loads **only when the flag is on
and `request.client_id` is set**, else an empty `Set`:

```ts
(await getSetting<boolean>("exercise_favorites_ai_enabled", true)) && request.client_id
  ? getClientFavoriteExerciseIds(request.client_id).catch(() => new Set<string>())
  : Promise.resolve(new Set<string>())
```

(Read the flag once before/at the `Promise.all`; the boolean can be resolved as its own
parallel promise or awaited just prior.) Then add `favoriteIds` to the `FilterOptions`
object at each of the four filter call sites — **exactly alongside `preferredIds` /
`coachUsage` / `clientUsage`**.

### 5d. Filter changes — `functions/src/ai/exercise-filter.ts`
- Add `const FAVORITE_BOOST = 30` (between `DIVERSITY_BOOST = 10` and
  `POOL_PREFERENCE_BOOST = 40`; comparable magnitude to the usage penalties).
- Add `favoriteIds?: Set<string>` to `FilterOptions`.
- In **`scoreAndFilterExercises`**: after the `preferredIds` boost block, add a symmetric
  block that adds `FAVORITE_BOOST` to each `exerciseMaxScores` entry whose id is in
  `favoriteIds`.
- In **`semanticFilterExercises`**: add `FAVORITE_BOOST` in the same three places
  `POOL_PREFERENCE_BOOST` is applied — the usage-aware re-ranking block, the heuristic
  fallback recursion (pass `favoriteIds` through), and the MMR `scoredFiltered` block.
- **Do NOT force-inject** favorites that semantic search ranked out (unlike the coach pool,
  which is an explicit per-generation curation). Favorites are a *soft* boost applied only
  within the already-matched candidate set — this keeps the signal soft and avoids
  surfacing a favorite the embeddings judged irrelevant to a slot.

### Why scoring-boost over prompt-injection
- **Safety always wins** — injury/equipment/difficulty/assessment-ceiling are hard filters
  applied *before* scoring; a boost can never resurrect a filtered-out exercise.
- **Rotation still applies** — a favorite used last week nets `+30 − 50 = −20`, so the
  weekly-rotation rule isn't broken; favorites bias *which* exercises get chosen across the
  pool, not "the same favorite every week."
- **Proven pattern** — identical to the already-tested `preferredIds` boost; deterministic
  and tunable, no reliance on model prompt-following.

---

## 6. Client UI

### 6a. Heart toggle on the exercise card
`components/client/WorkoutDay.tsx` → `ExerciseCard` (collapsed row, placed before the
expand chevron). Behavior:
- Seeded by an `isFavorited` boolean that **rides inside the existing
  `ExerciseWithRecommendation` item** (same mechanism as `videoSubmission`), so it threads
  through the existing `{...item}` spread down the `page → WorkoutViewToggle → WorkoutTabs →
  WorkoutDay → ExerciseCard` chain.
- Optimistic: flips local state immediately, `POST /api/client/exercise-favorites`
  `{ exerciseId, favorited }`, reverts + `toast.error` on failure. (Optimistic rather than
  `router.refresh()` because a heart should feel instant.)
- Favorites key on `exercise_id` only, so the week-template-repeat gotcha
  (`pe.week_number` ≠ display week) **does not apply** — the same exercise is favorited
  regardless of which week it appears in.

### 6b. Workouts page data-load
`app/(client)/client/workouts/page.tsx` loads `getFavoriteExerciseIds(userId)` into a Set
during its existing data-gathering, then sets `isFavorited` on each exercise item it builds.

### 6c. `/client/favorites` page + nav
- `app/(client)/client/favorites/page.tsx` — server component, `listFavoritesByClient`,
  renders name / category / difficulty / a "Watch" link (when `video_url`) and a remove
  (unfavorite) button per row. Empty state when none. Mirrors the `/client/sessions`
  pattern.
- Add a "Favorites" nav item in the client layout/nav (mirror how "My Sessions" was added).

---

## 7. Admin UI — `/admin/clients/[id]`

### 7a. Panel
New `components/admin/favorites/ClientFavoriteExercisesPanel.tsx`, rendered after
`ProgramsSection` in `app/(admin)/admin/clients/[id]/page.tsx`. Mirrors
`ClientPackagesPanel`: white card, server-seeded `initialFavorites`, `router.refresh()`
after mutations, `sonner` toasts. Each row shows the exercise name + a "added by coach"
badge when `source === 'admin'`, with a remove button.

### 7b. Add-on-behalf
A searchable exercise picker using the existing `components/ui/combobox.tsx`. Selecting an
exercise `POST`s to the admin route with `source='admin'`. The page's `Promise.all` gains:
- `listFavoritesByClient(id)` → `initialFavorites`
- the exercise list for the combobox (`getExercises()`), passed to the panel.

---

## 8. API routes (all self-gate — `/api/*` is NOT in middleware)

- **`POST /api/client/exercise-favorites`** — identity from `auth()`; **ignores any client
  id in the body** (self-only, like `/api/checkin/self`). Body
  `{ exerciseId, favorited }` → `addFavorite(me, exerciseId, {createdBy: me, source:'client'})`
  or `removeFavorite(me, exerciseId)`. 401 if unauthenticated.
- **`POST /api/admin/clients/[id]/exercise-favorites`** — gate `session.user.role !== 'admin'`
  → 403. Body `{ exerciseId }` → `addFavorite(id, exerciseId, {createdBy: me, source:'admin'})`.
- **`DELETE /api/admin/clients/[id]/exercise-favorites`** — admin gate; body `{ exerciseId }`
  → `removeFavorite(id, exerciseId)`.
- Client list page reads via the server component directly (no GET endpoint).

---

## 9. Audit (project convention — append-only trail)

Add slugs to `lib/audit/actions.ts`:
- `exercise_favorite.added` / `exercise_favorite.removed` — client writes → category
  `client_action`; admin on-behalf writes → category `admin_write`.

Record via fire-and-forget `recordAudit()` in the route handlers after the DB write
(metadata `{ exercise_id, client_user_id, source }`). Follows the existing inline-`recordAudit`
pattern for payload-dependent slugs.

---

## 10. Tests (TDD)

- **DAL** (`__tests__/lib/db/exercise-favorites.test.ts`): idempotent add (no error on
  duplicate), remove, `getFavoriteExerciseIds` returns a Set, `listFavoritesByClient` shape.
- **Validator**: accepts valid uuid + boolean; rejects bad uuid.
- **AI boost** (`__tests__/.../exercise-filter` favorites): a favorited id gains
  `FAVORITE_BOOST` in `scoreAndFilterExercises`; a favorited id that is hard-filtered
  (injury/equipment) is **still excluded** (boost cannot resurrect it); favorites + usage
  penalty combine arithmetically.
- **Heart toggle** (component): optimistic flip + revert-on-error.
- **API auth**: client route is self-only (ignores body client id); admin routes 403 for
  non-admins.

---

## 11. File touch list

**New:**
- `supabase/migrations/00174_exercise_favorites.sql`
- `lib/db/exercise-favorites.ts`
- `lib/validators/exercise-favorite.ts`
- `getClientFavoriteExerciseIds` in `functions/src/ai/usage-history.ts`
- `app/api/client/exercise-favorites/route.ts`
- `app/api/admin/clients/[id]/exercise-favorites/route.ts`
- `app/(client)/client/favorites/page.tsx`
- `components/admin/favorites/ClientFavoriteExercisesPanel.tsx`
- client heart-button component (or inline in `ExerciseCard`)
- test files (above)

**Modified:**
- `types/database.ts` (types)
- `functions/src/ai/exercise-filter.ts` (`FAVORITE_BOOST`, `favoriteIds` in both paths)
- `functions/src/ai/orchestrator.ts` (load favorites in `Promise.all` + flag + thread into filter calls 541/548)
- `functions/src/ai/week-orchestrator.ts` (same: `Promise.all` ~350 + flag + thread into filter calls 796/805)
- `app/(client)/client/workouts/page.tsx` (load favorites Set, set `isFavorited` on items)
- `components/client/WorkoutDay.tsx` (`ExerciseWithRecommendation.isFavorited` + heart in card)
- client workout component chain (`WorkoutViewToggle`/`WorkoutTabs`) only if the item spread
  doesn't already carry the field (it should, via `{...item}`)
- `app/(admin)/admin/clients/[id]/page.tsx` (Promise.all + render panel)
- client nav (add "Favorites" item)
- `lib/audit/actions.ts` (two slugs)

---

## 12. Rollout

- App changes deploy via Vercel on push to `main`.
- `functions/**` (AI boost + reader) deploys via the deploy-functions GitHub Action on push
  touching `functions/**`; takes effect on the next generation.
- Migration applied to prod up front (additive, inert until code is live).
- `exercise_favorites_ai_enabled` defaults **ON**; flip off in admin settings to disable the
  AI influence without touching the UI.
- **Push is held** for owner go-ahead (autonomous-mode rule): everything committed on
  `main` locally, green, reviewed — a one-word "push" ships it.

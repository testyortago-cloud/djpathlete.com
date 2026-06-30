# Exercise Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let clients favorite exercises so the AI program generator biases future programs toward them, with a coach-managed admin view and a client favorites page.

**Architecture:** A new `exercise_favorites` table (per-client, per-exercise toggle). Clients toggle a heart on each exercise in their assigned workout and review favorites on `/client/favorites`. Coaches view/add/remove on `/admin/clients/[id]`. The AI generator applies a soft `FAVORITE_BOOST` to favorited exercises — mirroring the existing coach-pool `preferredIds`/`POOL_PREFERENCE_BOOST` mechanism in both the heuristic and semantic filter paths — gated by a DB-backed flag.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role DAL), Zod, NextAuth v5, Vitest + Testing Library, Firebase Functions (the AI runtime), TypeScript strict.

## Global Constraints

- **No `git add -A`** — this repo always has stray untracked files (`step-up-for-students.html`, `exercise-library-match.csv`, a reel plan). Stage explicit paths only. Never stage `JOURNAL.md`.
- **`/api/*` is NOT in middleware** — every API route MUST self-gate (`session.user.role !== "admin"` for admin routes; `auth()` identity for client routes).
- **`functions/` cannot import from `lib/`** (`rootDir: "src"`). Functions-side helpers query Supabase directly via `functions/src/lib/supabase.ts`'s `getSupabase()`.
- **DAL uses the service-role client** (`createServiceRoleClient()` from `@/lib/supabase`); RLS is defense-in-depth.
- **Feature flags are DB-backed** (`system_settings`), never env-var. Read via `getSetting`.
- **Migrations apply via `mcp__supabase__apply_migration`** (done by the orchestrator, not the task implementer). CLI `db push` is not wired.
- **Commit after every task.** Conventional commits: `feat(exercise-favorites): …`.
- **App tests:** run from repo root: `npx vitest run <pattern>`. **Functions tests:** run from `functions/`: `cd functions && npx vitest run <pattern>`.
- **tsc check (app):** `npx tsc --noEmit` (expect a ~160-line *pre-existing* baseline of errors in `__tests__`/`.next` only; your changed prod files must add zero). **tsc (functions):** `cd functions && npx tsc --noEmit` must be exit 0.

---

### Task 1: Migration + types + validator

**Files:**
- Create: `supabase/migrations/00174_exercise_favorites.sql`
- Modify: `types/database.ts` (append new types near the `FormReview` block)
- Create: `lib/validators/exercise-favorite.ts`
- Test: `__tests__/lib/validators/exercise-favorite.test.ts`

**Interfaces:**
- Produces: `ExerciseFavorite`, `ExerciseFavoriteSource`, `ExerciseFavoriteWithExercise` types; `exerciseFavoriteToggleSchema`, `adminExerciseFavoriteSchema`, `ExerciseFavoriteToggleInput`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/00174_exercise_favorites.sql`:

```sql
-- 00174_exercise_favorites.sql
-- Per-client exercise favorites. Clients toggle a heart on exercises; the AI
-- program generator applies a soft scoring boost to favorited exercises.

CREATE TABLE IF NOT EXISTS exercise_favorites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id     UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT 'client' CHECK (source IN ('client','admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_user_id, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_exercise_favorites_client ON exercise_favorites(client_user_id);

ALTER TABLE exercise_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients view own favorites"   ON exercise_favorites FOR SELECT USING (client_user_id = auth.uid());
CREATE POLICY "Clients insert own favorites" ON exercise_favorites FOR INSERT WITH CHECK (client_user_id = auth.uid());
CREATE POLICY "Clients delete own favorites" ON exercise_favorites FOR DELETE USING (client_user_id = auth.uid());
CREATE POLICY "Admins manage all favorites"  ON exercise_favorites FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);

-- AI scoring-boost kill switch (DB-backed flag, default ON). Flip to 'false' in
-- system_settings to disable favorites' influence on AI generation.
INSERT INTO system_settings (key, value)
VALUES ('exercise_favorites_ai_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
```

> NOTE: confirm the `system_settings.value` column type by skimming an earlier migration that inserts a setting (e.g. grep `INSERT INTO system_settings`). If `value` is `jsonb`, the `'true'::jsonb` cast above is correct; if it is plain `text`, use `'true'`. Match the existing convention exactly.

- [ ] **Step 2: Add types to `types/database.ts`**

Append after the `FormReview` interface block:

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

export interface ExerciseFavoriteWithExercise extends ExerciseFavorite {
  exercise: Pick<
    Exercise,
    "id" | "name" | "category" | "muscle_group" | "video_url" | "thumbnail_url" | "difficulty"
  > | null
}
```

- [ ] **Step 3: Write the validator + failing test**

Create `lib/validators/exercise-favorite.ts`:

```ts
import { z } from "zod"

export const exerciseFavoriteToggleSchema = z.object({
  exerciseId: z.string().uuid(),
  favorited: z.boolean(),
})
export type ExerciseFavoriteToggleInput = z.infer<typeof exerciseFavoriteToggleSchema>

export const adminExerciseFavoriteSchema = z.object({
  exerciseId: z.string().uuid(),
})
```

Create `__tests__/lib/validators/exercise-favorite.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { exerciseFavoriteToggleSchema, adminExerciseFavoriteSchema } from "@/lib/validators/exercise-favorite"

const UUID = "11111111-1111-1111-1111-111111111111"

describe("exerciseFavoriteToggleSchema", () => {
  it("accepts a valid uuid + boolean", () => {
    expect(exerciseFavoriteToggleSchema.parse({ exerciseId: UUID, favorited: true })).toEqual({
      exerciseId: UUID,
      favorited: true,
    })
  })
  it("rejects a non-uuid exerciseId", () => {
    expect(exerciseFavoriteToggleSchema.safeParse({ exerciseId: "nope", favorited: true }).success).toBe(false)
  })
  it("rejects a missing favorited flag", () => {
    expect(exerciseFavoriteToggleSchema.safeParse({ exerciseId: UUID }).success).toBe(false)
  })
})

describe("adminExerciseFavoriteSchema", () => {
  it("accepts a valid uuid", () => {
    expect(adminExerciseFavoriteSchema.parse({ exerciseId: UUID })).toEqual({ exerciseId: UUID })
  })
})
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/lib/validators/exercise-favorite.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: tsc check**

Run: `npx tsc --noEmit` — confirm no NEW errors reference `types/database.ts` or `lib/validators/exercise-favorite.ts`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00174_exercise_favorites.sql types/database.ts lib/validators/exercise-favorite.ts __tests__/lib/validators/exercise-favorite.test.ts
git commit -m "feat(exercise-favorites): migration, types, validator"
```

---

### Task 2: App-side DAL

**Files:**
- Create: `lib/db/exercise-favorites.ts`
- Test: `__tests__/lib/db/exercise-favorites.test.ts`

**Interfaces:**
- Consumes: `createServiceRoleClient` from `@/lib/supabase`; types from Task 1.
- Produces:
  - `getFavoriteExerciseIds(clientUserId: string): Promise<Set<string>>`
  - `listFavoritesByClient(clientUserId: string): Promise<ExerciseFavoriteWithExercise[]>`
  - `addFavorite(clientUserId: string, exerciseId: string, opts: { createdBy: string; source: ExerciseFavoriteSource }): Promise<void>`
  - `removeFavorite(clientUserId: string, exerciseId: string): Promise<void>`

- [ ] **Step 1: Write the DAL**

Create `lib/db/exercise-favorites.ts` (mirrors `lib/db/athlete-goals.ts` conventions):

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { ExerciseFavoriteSource, ExerciseFavoriteWithExercise } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

const EXERCISE_COLS = "id,name,category,muscle_group,video_url,thumbnail_url,difficulty"

export async function getFavoriteExerciseIds(clientUserId: string): Promise<Set<string>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_favorites")
    .select("exercise_id")
    .eq("client_user_id", clientUserId)
  if (error) throw error
  return new Set((data ?? []).map((r: { exercise_id: string }) => r.exercise_id))
}

export async function listFavoritesByClient(clientUserId: string): Promise<ExerciseFavoriteWithExercise[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("exercise_favorites")
    .select(`*, exercise:exercises(${EXERCISE_COLS})`)
    .eq("client_user_id", clientUserId)
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as ExerciseFavoriteWithExercise[]
}

export async function addFavorite(
  clientUserId: string,
  exerciseId: string,
  opts: { createdBy: string; source: ExerciseFavoriteSource },
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("exercise_favorites")
    .upsert(
      {
        client_user_id: clientUserId,
        exercise_id: exerciseId,
        created_by: opts.createdBy,
        source: opts.source,
      },
      { onConflict: "client_user_id,exercise_id", ignoreDuplicates: true },
    )
  if (error) throw error
}

export async function removeFavorite(clientUserId: string, exerciseId: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("exercise_favorites")
    .delete()
    .eq("client_user_id", clientUserId)
    .eq("exercise_id", exerciseId)
  if (error) throw error
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/db/exercise-favorites.test.ts`. This mocks `@/lib/supabase` with a chainable query builder:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable mock. Each terminal method (.order / .eq-leaf) resolves to { data, error }.
const state: { result: { data: unknown; error: unknown }; lastUpsert?: unknown; lastDelete?: boolean } = {
  result: { data: [], error: null },
}

function makeBuilder() {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(() => ({
    ...builder,
    // when awaited directly (getFavoriteExerciseIds: select().eq().eq()? no — select().eq())
    then: (res: (v: unknown) => void) => res(state.result),
  }))
  builder.order = vi.fn(() => Promise.resolve(state.result))
  builder.upsert = vi.fn((payload: unknown) => {
    state.lastUpsert = payload
    return Promise.resolve({ data: null, error: state.result.error })
  })
  builder.delete = vi.fn(() => {
    state.lastDelete = true
    return {
      eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: state.result.error })) })),
    }
  })
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: vi.fn(() => makeBuilder()) }),
}))

import {
  getFavoriteExerciseIds,
  listFavoritesByClient,
  addFavorite,
  removeFavorite,
} from "@/lib/db/exercise-favorites"

beforeEach(() => {
  state.result = { data: [], error: null }
  state.lastUpsert = undefined
  state.lastDelete = false
})

describe("getFavoriteExerciseIds", () => {
  it("returns a Set of exercise ids", async () => {
    state.result = { data: [{ exercise_id: "a" }, { exercise_id: "b" }], error: null }
    const ids = await getFavoriteExerciseIds("client-1")
    expect(ids).toBeInstanceOf(Set)
    expect([...ids].sort()).toEqual(["a", "b"])
  })
  it("throws on error", async () => {
    state.result = { data: null, error: { message: "boom" } }
    await expect(getFavoriteExerciseIds("client-1")).rejects.toBeTruthy()
  })
})

describe("listFavoritesByClient", () => {
  it("returns the joined rows", async () => {
    state.result = { data: [{ id: "f1", exercise: { id: "a", name: "Squat" } }], error: null }
    const rows = await listFavoritesByClient("client-1")
    expect(rows).toHaveLength(1)
    expect(rows[0].exercise?.name).toBe("Squat")
  })
})

describe("addFavorite", () => {
  it("upserts with ignoreDuplicates and the given source", async () => {
    await addFavorite("client-1", "ex-1", { createdBy: "client-1", source: "client" })
    expect(state.lastUpsert).toMatchObject({ client_user_id: "client-1", exercise_id: "ex-1", source: "client" })
  })
})

describe("removeFavorite", () => {
  it("issues a delete", async () => {
    await removeFavorite("client-1", "ex-1")
    expect(state.lastDelete).toBe(true)
  })
})
```

> NOTE: the chainable mock is finicky. If `getFavoriteExerciseIds` (uses `select().eq()` then awaits) doesn't resolve with the thenable above, simplify by making `.eq()` return a thenable that resolves `state.result` on the FIRST `.eq()` for selects and chains for deletes — adjust the mock until the four tests pass. The contract being tested matters more than the mock's exact shape; match the actual query chains in `lib/db/exercise-favorites.ts`.

- [ ] **Step 3: Run the test**

Run: `npx vitest run __tests__/lib/db/exercise-favorites.test.ts`
Expected: FAIL first (adjust mock), then PASS (all tests).

- [ ] **Step 4: tsc check** — `npx tsc --noEmit`, no new errors in `lib/db/exercise-favorites.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/db/exercise-favorites.ts __tests__/lib/db/exercise-favorites.test.ts
git commit -m "feat(exercise-favorites): app-side DAL (list/ids/add/remove)"
```

---

### Task 3: Client API route + audit slugs

**Files:**
- Modify: `lib/audit/actions.ts` (add two slugs)
- Create: `app/api/client/exercise-favorites/route.ts`
- Test: `__tests__/api/client/exercise-favorites.test.ts`

**Interfaces:**
- Consumes: `addFavorite`/`removeFavorite` (Task 2); `exerciseFavoriteToggleSchema` (Task 1); `auth` from `@/lib/auth`; `recordAudit` from `@/lib/audit/record`.
- Produces: `POST` handler returning `{ ok: true, favorited: boolean }` or an error.

- [ ] **Step 1: Add audit slugs**

In `lib/audit/actions.ts`, add to the `AUDIT_ACTIONS` array (in the `client_action — profile + preferences` group):

```ts
  { slug: "exercise_favorite.added", category: "client_action", description: "Exercise favorited" },
  { slug: "exercise_favorite.removed", category: "client_action", description: "Exercise unfavorited" },
```

> The admin-on-behalf route (Task 4) reuses these same slugs but records them under category `admin_write` via the `recordAudit` call's `category` field (the slug's default category in this table is informational; `recordAudit` takes an explicit `category`).

- [ ] **Step 2: Write the route**

Create `app/api/client/exercise-favorites/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { exerciseFavoriteToggleSchema } from "@/lib/validators/exercise-favorite"
import { addFavorite, removeFavorite } from "@/lib/db/exercise-favorites"
import { recordAudit } from "@/lib/audit/record"

export async function POST(request: Request) {
  const session = await auth()
  const userId = session?.user?.id as string | undefined
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = exerciseFavoriteToggleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const { exerciseId, favorited } = parsed.data
  try {
    if (favorited) {
      await addFavorite(userId, exerciseId, { createdBy: userId, source: "client" })
    } else {
      await removeFavorite(userId, exerciseId)
    }
  } catch {
    return NextResponse.json({ error: "Could not update favorite" }, { status: 500 })
  }

  recordAudit({
    action: favorited ? "exercise_favorite.added" : "exercise_favorite.removed",
    category: "client_action",
    target: { type: "exercise", id: exerciseId },
    metadata: { exercise_id: exerciseId, client_user_id: userId, source: "client" },
    request,
  })

  return NextResponse.json({ ok: true, favorited })
}
```

- [ ] **Step 3: Write the failing test**

Create `__tests__/api/client/exercise-favorites.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const addFavorite = vi.fn()
const removeFavorite = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/exercise-favorites", () => ({
  addFavorite: (...a: unknown[]) => addFavorite(...a),
  removeFavorite: (...a: unknown[]) => removeFavorite(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/client/exercise-favorites/route"

const UUID = "11111111-1111-1111-1111-111111111111"
function req(body: unknown) {
  return new Request("http://localhost/api/client/exercise-favorites", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockReset()
  addFavorite.mockReset()
  removeFavorite.mockReset()
})

describe("POST /api/client/exercise-favorites", () => {
  it("401s when unauthenticated", async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(req({ exerciseId: UUID, favorited: true }))
    expect(res.status).toBe(401)
  })

  it("adds a favorite for the authed user, ignoring any body client id", async () => {
    authMock.mockResolvedValue({ user: { id: "me" } })
    const res = await POST(req({ exerciseId: UUID, favorited: true, clientUserId: "someone-else" }))
    expect(res.status).toBe(200)
    expect(addFavorite).toHaveBeenCalledWith("me", UUID, { createdBy: "me", source: "client" })
    expect(removeFavorite).not.toHaveBeenCalled()
  })

  it("removes a favorite when favorited=false", async () => {
    authMock.mockResolvedValue({ user: { id: "me" } })
    const res = await POST(req({ exerciseId: UUID, favorited: false }))
    expect(res.status).toBe(200)
    expect(removeFavorite).toHaveBeenCalledWith("me", UUID)
  })

  it("400s on a bad payload", async () => {
    authMock.mockResolvedValue({ user: { id: "me" } })
    const res = await POST(req({ exerciseId: "nope", favorited: true }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/api/client/exercise-favorites.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/audit/actions.ts app/api/client/exercise-favorites/route.ts __tests__/api/client/exercise-favorites.test.ts
git commit -m "feat(exercise-favorites): client toggle API + audit slugs"
```

---

### Task 4: Admin on-behalf API route

**Files:**
- Create: `app/api/admin/clients/[id]/exercise-favorites/route.ts`
- Test: `__tests__/api/admin/client-exercise-favorites.test.ts`

**Interfaces:**
- Consumes: `addFavorite`/`removeFavorite` (Task 2); `adminExerciseFavoriteSchema` (Task 1); `auth`; `recordAudit`.
- Produces: `POST` (add on behalf) + `DELETE` (remove on behalf), both keyed by the `[id]` client route param.

- [ ] **Step 1: Write the route**

Create `app/api/admin/clients/[id]/exercise-favorites/route.ts`. Note Next.js 16 async `params`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { adminExerciseFavoriteSchema } from "@/lib/validators/exercise-favorite"
import { addFavorite, removeFavorite } from "@/lib/db/exercise-favorites"
import { recordAudit } from "@/lib/audit/record"

async function requireAdmin() {
  const session = await auth()
  const role = session?.user?.role as string | undefined
  const adminId = session?.user?.id as string | undefined
  if (role !== "admin" || !adminId) return null
  return adminId
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id: clientUserId } = await params

  const parsed = adminExerciseFavoriteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  try {
    await addFavorite(clientUserId, parsed.data.exerciseId, { createdBy: adminId, source: "admin" })
  } catch {
    return NextResponse.json({ error: "Could not add favorite" }, { status: 500 })
  }

  recordAudit({
    action: "exercise_favorite.added",
    category: "admin_write",
    target: { type: "user", id: clientUserId },
    metadata: { exercise_id: parsed.data.exerciseId, client_user_id: clientUserId, source: "admin" },
    request,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id: clientUserId } = await params

  const parsed = adminExerciseFavoriteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  try {
    await removeFavorite(clientUserId, parsed.data.exerciseId)
  } catch {
    return NextResponse.json({ error: "Could not remove favorite" }, { status: 500 })
  }

  recordAudit({
    action: "exercise_favorite.removed",
    category: "admin_write",
    target: { type: "user", id: clientUserId },
    metadata: { exercise_id: parsed.data.exerciseId, client_user_id: clientUserId, source: "admin" },
    request,
  })
  return NextResponse.json({ ok: true })
}
```

> NOTE: verify the `target.type` allowed values in `lib/audit/types.ts` (`AuditTarget`). If `"exercise"`/`"user"` aren't valid target types there, either add them or use the closest existing one. Match the existing taxonomy.

- [ ] **Step 2: Write the failing test**

Create `__tests__/api/admin/client-exercise-favorites.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const addFavorite = vi.fn()
const removeFavorite = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }))
vi.mock("@/lib/db/exercise-favorites", () => ({
  addFavorite: (...a: unknown[]) => addFavorite(...a),
  removeFavorite: (...a: unknown[]) => removeFavorite(...a),
}))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST, DELETE } from "@/app/api/admin/clients/[id]/exercise-favorites/route"

const UUID = "11111111-1111-1111-1111-111111111111"
const params = Promise.resolve({ id: "client-9" })
function req(body: unknown) {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) })
}

beforeEach(() => {
  authMock.mockReset()
  addFavorite.mockReset()
  removeFavorite.mockReset()
})

describe("admin exercise-favorites route", () => {
  it("403s for non-admins on POST", async () => {
    authMock.mockResolvedValue({ user: { id: "u", role: "client" } })
    const res = await POST(req({ exerciseId: UUID }), { params })
    expect(res.status).toBe(403)
  })

  it("adds on behalf with source=admin and createdBy=admin", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    const res = await POST(req({ exerciseId: UUID }), { params })
    expect(res.status).toBe(200)
    expect(addFavorite).toHaveBeenCalledWith("client-9", UUID, { createdBy: "admin-1", source: "admin" })
  })

  it("removes on behalf", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    const res = await DELETE(req({ exerciseId: UUID }), { params })
    expect(res.status).toBe(200)
    expect(removeFavorite).toHaveBeenCalledWith("client-9", UUID)
  })

  it("403s for non-admins on DELETE", async () => {
    authMock.mockResolvedValue(null)
    const res = await DELETE(req({ exerciseId: UUID }), { params })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run __tests__/api/admin/client-exercise-favorites.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/clients/[id]/exercise-favorites/route.ts __tests__/api/admin/client-exercise-favorites.test.ts
git commit -m "feat(exercise-favorites): admin add/remove on-behalf API"
```

---

### Task 5: AI scoring boost — `exercise-filter.ts` (functions)

**Files:**
- Modify: `functions/src/ai/exercise-filter.ts`
- Test: `functions/src/ai/__tests__/exercise-filter.test.ts` (append cases)

**Interfaces:**
- Produces: `FilterOptions.favoriteIds?: Set<string>`; favorited exercises gain `FAVORITE_BOOST` (=30) in both `scoreAndFilterExercises` and `semanticFilterExercises`.

- [ ] **Step 1: Add the constant + option**

In `functions/src/ai/exercise-filter.ts`, after `const POOL_PREFERENCE_BOOST = 40` (~line 10):

```ts
/** Soft boost for a client's favorited exercises. Between DIVERSITY_BOOST (10)
 *  and POOL_PREFERENCE_BOOST (40): meaningful but won't override hard filters
 *  (injury/equipment/difficulty run BEFORE scoring) or weekly rotation
 *  (clientUsage penalty is 50). */
const FAVORITE_BOOST = 30
```

In the `FilterOptions` interface, add:

```ts
  /** Exercise IDs the CLIENT has favorited — a soft scoring boost (FAVORITE_BOOST). */
  favoriteIds?: Set<string>
```

- [ ] **Step 2: Apply the boost in `scoreAndFilterExercises`**

Immediately after the `preferredIds` boost block (the `if (preferredIds && preferredIds.size > 0) { ... }` near line 352-357), add:

```ts
  const favoriteIds = options?.favoriteIds
  if (favoriteIds && favoriteIds.size > 0) {
    for (const [id, score] of exerciseMaxScores) {
      if (favoriteIds.has(id)) exerciseMaxScores.set(id, score + FAVORITE_BOOST)
    }
  }
```

- [ ] **Step 3: Apply the boost in `semanticFilterExercises`**

In `semanticFilterExercises`, mirror `POOL_PREFERENCE_BOOST` in the three places it's used:

(a) the heuristic-fallback recursion (~line 458) — add `favoriteIds: options?.favoriteIds` to the options object passed to `scoreAndFilterExercises`.

(b) the usage-aware re-ranking block (~line 478-493) — extend:

```ts
  const favoriteIds = options?.favoriteIds
  const hasFavorites = favoriteIds && favoriteIds.size > 0
  if (coachUsage.size > 0 || clientUsage.size > 0 || hasPreferred || hasFavorites) {
    const scored = filtered.map((ex) => {
      let score = applyUsagePenalty(50, ex.id, coachUsage, clientUsage)
      if (hasPreferred && preferredIds!.has(ex.id)) score += POOL_PREFERENCE_BOOST
      if (hasFavorites && favoriteIds!.has(ex.id)) score += FAVORITE_BOOST
      return { ex, score }
    })
    scored.sort((a, b) => b.score - a.score)
    filtered = scored.map((s) => s.ex)
  }
```

(c) the MMR `scoredFiltered` block (~line 514-520) — add `+ (hasFavorites && favoriteIds!.has(e.id) ? FAVORITE_BOOST : 0)` to the score expression.

**Do NOT add a favorites equivalent of the "inject missing preferred-pool exercises" block** (~line 498-505). Favorites are a soft boost applied only within the matched set — never force-injected.

- [ ] **Step 4: Append failing tests**

In `functions/src/ai/__tests__/exercise-filter.test.ts`, add (reuse the file's existing `exercises`, `SKELETON`, `ANALYSIS` fixtures — read them first):

```ts
describe("favoriteIds soft boost", () => {
  it("ranks a favorited exercise ahead of an identical non-favorite", () => {
    // Pick two exercises that score similarly for the skeleton's slots.
    const all = /* the test file's exercise fixtures */ exercises
    const favId = all[all.length - 1].id // an exercise that would normally rank low
    const result = scoreAndFilterExercises(exercises, SKELETON, [], ANALYSIS, {
      favoriteIds: new Set([favId]),
    })
    const resultNoFav = scoreAndFilterExercises(exercises, SKELETON, [], ANALYSIS, {})
    // The favorite should not rank LOWER than it did without the boost.
    expect(result.findIndex((e) => e.id === favId)).toBeLessThanOrEqual(
      resultNoFav.findIndex((e) => e.id === favId),
    )
  })

  it("does not resurrect an exercise removed by a hard filter (favorites are post-filter)", () => {
    // A favorited id that isn't in the candidate `exercises` array can never appear.
    const result = scoreAndFilterExercises(exercises, SKELETON, [], ANALYSIS, {
      favoriteIds: new Set(["not-in-library"]),
    })
    expect(result.some((e) => e.id === "not-in-library")).toBe(false)
  })
})
```

> NOTE: read the top of the existing test file to use its real fixture names and import style. The first test asserts the boost helps (rank not worse); if the chosen `favId` already ranks #1 without the boost, pick a lower-ranked fixture id so the assertion is meaningful.

- [ ] **Step 5: Run functions tests + tsc**

Run: `cd functions && npx vitest run exercise-filter`
Expected: PASS (existing + new).
Run: `cd functions && npx tsc --noEmit` — exit 0.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/exercise-filter.ts functions/src/ai/__tests__/exercise-filter.test.ts
git commit -m "feat(exercise-favorites): FAVORITE_BOOST in heuristic + semantic filters"
```

---

### Task 6: AI wiring — functions reader + both orchestrators

**Files:**
- Modify: `functions/src/ai/usage-history.ts` (add reader)
- Modify: `functions/src/ai/orchestrator.ts` (load + thread into filter calls 541/548)
- Modify: `functions/src/ai/week-orchestrator.ts` (load + thread into filter calls 796/805)
- Test: `functions/src/ai/__tests__/usage-history.test.ts` (create if absent, or append)

**Interfaces:**
- Consumes: `getSetting` from `functions/src/lib/system-settings.ts`; `FilterOptions.favoriteIds` (Task 5); `getSupabase` from `functions/src/lib/supabase.ts`.
- Produces: `getClientFavoriteExerciseIds(clientId: string | null): Promise<Set<string>>`.

- [ ] **Step 1: Add the reader to `usage-history.ts`**

Append to `functions/src/ai/usage-history.ts`:

```ts
export async function getClientFavoriteExerciseIds(clientId: string | null): Promise<Set<string>> {
  if (!clientId) return new Set()
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("exercise_favorites")
    .select("exercise_id")
    .eq("client_user_id", clientId)
  if (error) {
    console.warn("[usage-history] getClientFavoriteExerciseIds failed:", error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r: { exercise_id: string }) => r.exercise_id))
}
```

- [ ] **Step 2: Wire `orchestrator.ts`**

At the top of `orchestrator.ts`, ensure imports include `getClientFavoriteExerciseIds` (extend the existing `usage-history.js` import) and `getSetting` from `../lib/system-settings.js`.

Just before the Agent-1 `Promise.all` (~line 340), resolve the flag, then add a 5th promise:

```ts
const favoritesEnabled = await getSetting<boolean>("exercise_favorites_ai_enabled", true)
```

Change the destructure to `const [agent1Result, allExercises, coachUsage, clientUsage, favoriteIds] = await Promise.all([` and add as the 5th entry:

```ts
      favoritesEnabled && request.client_id
        ? getClientFavoriteExerciseIds(request.client_id).catch(() => new Set<string>())
        : Promise.resolve(new Set<string>()),
```

Then at the filter call sites (lines 541 & 548), add `favoriteIds,` to each options object (alongside `preferredIds`).

- [ ] **Step 3: Wire `week-orchestrator.ts`**

Same pattern: extend the `usage-history.js` import with `getClientFavoriteExerciseIds`, import `getSetting`. Before the `Promise.all` at ~line 350 resolve `favoritesEnabled`; add the favorites promise as a new entry and destructure it as `favoriteIds`; add `favoriteIds,` to the two filter options objects at lines 796 & 805.

- [ ] **Step 4: Add a reader test**

Create/append `functions/src/ai/__tests__/usage-history.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const selectEq = vi.fn()
vi.mock("../../lib/supabase.js", () => ({
  getSupabase: () => ({
    from: () => ({ select: () => ({ eq: selectEq }) }),
  }),
}))

import { getClientFavoriteExerciseIds } from "../usage-history.js"

beforeEach(() => selectEq.mockReset())

describe("getClientFavoriteExerciseIds", () => {
  it("returns an empty Set for a null client", async () => {
    const ids = await getClientFavoriteExerciseIds(null)
    expect(ids.size).toBe(0)
  })
  it("maps rows to a Set of exercise ids", async () => {
    selectEq.mockResolvedValue({ data: [{ exercise_id: "a" }, { exercise_id: "b" }], error: null })
    const ids = await getClientFavoriteExerciseIds("c1")
    expect([...ids].sort()).toEqual(["a", "b"])
  })
  it("returns an empty Set on error (best-effort)", async () => {
    selectEq.mockResolvedValue({ data: null, error: { message: "x" } })
    const ids = await getClientFavoriteExerciseIds("c1")
    expect(ids.size).toBe(0)
  })
})
```

> NOTE: confirm the mock path matches how the existing functions tests mock supabase (relative `../../lib/supabase.js` vs an alias). Match the sibling test files in `functions/src/ai/__tests__/`.

- [ ] **Step 5: Run functions tests + tsc**

Run: `cd functions && npx vitest run usage-history`
Run: `cd functions && npx vitest run` (full functions suite — confirm no regression in orchestrator tests)
Run: `cd functions && npx tsc --noEmit` — exit 0.

- [ ] **Step 6: Commit**

```bash
git add functions/src/ai/usage-history.ts functions/src/ai/orchestrator.ts functions/src/ai/week-orchestrator.ts functions/src/ai/__tests__/usage-history.test.ts
git commit -m "feat(exercise-favorites): load client favorites + thread into both AI orchestrators (flag-gated)"
```

---

### Task 7: Client heart toggle on the exercise card

**Files:**
- Create: `components/client/FavoriteExerciseButton.tsx`
- Modify: `components/client/WorkoutDay.tsx` (add `isFavorited` to `ExerciseWithRecommendation`; render the button in the collapsed row)
- Modify: `app/(client)/client/workouts/page.tsx` (load favorites Set; set `isFavorited` per item)
- Test: `__tests__/components/client/FavoriteExerciseButton.test.tsx`

**Interfaces:**
- Consumes: `POST /api/client/exercise-favorites` (Task 3).
- Produces: `<FavoriteExerciseButton exerciseId initialFavorited />` (self-contained optimistic toggle); `ExerciseWithRecommendation.isFavorited?: boolean`.

- [ ] **Step 1: Write the failing component test**

Create `__tests__/components/client/FavoriteExerciseButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { FavoriteExerciseButton } from "@/components/client/FavoriteExerciseButton"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe("FavoriteExerciseButton", () => {
  it("optimistically toggles on click and POSTs the desired state", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, favorited: true }) })
    render(<FavoriteExerciseButton exerciseId="ex-1" initialFavorited={false} />)
    const btn = screen.getByRole("button", { name: /favorite/i })
    expect(btn).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(btn)
    expect(btn).toHaveAttribute("aria-pressed", "true") // optimistic
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/client/exercise-favorites",
        expect.objectContaining({ method: "POST" }),
      ),
    )
  })

  it("reverts on a failed request", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) })
    render(<FavoriteExerciseButton exerciseId="ex-1" initialFavorited={false} />)
    const btn = screen.getByRole("button", { name: /favorite/i })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "false"))
  })
})
```

- [ ] **Step 2: Write the component**

Create `components/client/FavoriteExerciseButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Heart } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export function FavoriteExerciseButton({
  exerciseId,
  initialFavorited,
}: {
  exerciseId: string
  initialFavorited: boolean
}) {
  const [favorited, setFavorited] = useState(initialFavorited)
  const [busy, setBusy] = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation() // don't expand/collapse the card
    if (busy) return
    const next = !favorited
    setFavorited(next) // optimistic
    setBusy(true)
    try {
      const res = await fetch("/api/client/exercise-favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exerciseId, favorited: next }),
      })
      if (!res.ok) throw new Error("failed")
    } catch {
      setFavorited(!next) // revert
      toast.error("Couldn't update favorite")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove favorite" : "Add favorite"}
      title={favorited ? "Favorited" : "Add to favorites"}
      className="rounded-full p-1.5 text-muted-foreground transition hover:bg-accent/40 disabled:opacity-50"
    >
      <Heart className={cn("size-5", favorited && "fill-accent text-accent")} strokeWidth={1.5} />
    </button>
  )
}
```

- [ ] **Step 3: Run the component test**

Run: `npx vitest run __tests__/components/client/FavoriteExerciseButton.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 4: Thread `isFavorited` into the type + card**

In `components/client/WorkoutDay.tsx`, add to the `ExerciseWithRecommendation` interface:

```ts
  isFavorited?: boolean
```

In the **collapsed row** of `ExerciseCard` (the row that shows the prescription grid, before the expand chevron — around lines 491-577), render the button (it carries its own `stopPropagation`):

```tsx
<FavoriteExerciseButton exerciseId={exercise.id} initialFavorited={!!isFavorited} />
```

Add the import at the top of `WorkoutDay.tsx`:

```ts
import { FavoriteExerciseButton } from "@/components/client/FavoriteExerciseButton"
```

Ensure `isFavorited` is destructured from the item where the card reads its props (it rides in via the `{...item}` spread already used for `videoSubmission`).

- [ ] **Step 5: Load favorites on the workouts page**

In `app/(client)/client/workouts/page.tsx`:

Add the import:

```ts
import { getFavoriteExerciseIds } from "@/lib/db/exercise-favorites"
```

Load the set defensively (near where `formReviewStatusByPe` is built, ~line 123-132):

```ts
let favoriteExerciseIds = new Set<string>()
try {
  favoriteExerciseIds = await getFavoriteExerciseIds(userId)
} catch {
  // table may not exist yet — render without hearts filled
}
```

In `buildExerciseData`'s returned object (the block ending ~line 259 with `videoSubmission`), add:

```ts
          isFavorited: favoriteExerciseIds.has(exercise.id),
```

- [ ] **Step 6: Verify + commit**

Run: `npx vitest run __tests__/components/client/FavoriteExerciseButton.test.tsx`
Run: `npx tsc --noEmit` — no new errors in the three changed files.
Run: `npx next build` is NOT required per-task; defer to final verification.

```bash
git add components/client/FavoriteExerciseButton.tsx components/client/WorkoutDay.tsx "app/(client)/client/workouts/page.tsx" __tests__/components/client/FavoriteExerciseButton.test.tsx
git commit -m "feat(exercise-favorites): heart toggle on the client exercise card"
```

---

### Task 8: Client `/client/favorites` page + nav

**Files:**
- Create: `app/(client)/client/favorites/page.tsx`
- Create: `components/client/MyFavoritesList.tsx`
- Modify: the client nav (find it — likely `components/client/ClientNav*.tsx` or the `(client)` layout; grep for the "My Sessions" / "Workouts" nav item added for session packs)
- Test: `__tests__/components/client/MyFavoritesList.test.tsx`

**Interfaces:**
- Consumes: `listFavoritesByClient` (Task 2); the client API route (Task 3) for the remove button.
- Produces: a server page + a client list component with per-row unfavorite.

- [ ] **Step 1: Write the failing list test**

Create `__tests__/components/client/MyFavoritesList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MyFavoritesList } from "@/components/client/MyFavoritesList"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const rows = [
  {
    id: "f1",
    client_user_id: "c1",
    exercise_id: "e1",
    created_by: "c1",
    source: "client" as const,
    created_at: "2026-06-30T00:00:00Z",
    exercise: { id: "e1", name: "Back Squat", category: ["strength"], muscle_group: "legs", video_url: null, thumbnail_url: null, difficulty: "intermediate" },
  },
]

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch
})

describe("MyFavoritesList", () => {
  it("renders favorite exercise names", () => {
    render(<MyFavoritesList favorites={rows} />)
    expect(screen.getByText("Back Squat")).toBeInTheDocument()
  })
  it("shows an empty state when there are none", () => {
    render(<MyFavoritesList favorites={[]} />)
    expect(screen.getByText(/no favorite/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Write the list component**

Create `components/client/MyFavoritesList.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Heart, Play } from "lucide-react"
import { toast } from "sonner"
import type { ExerciseFavoriteWithExercise } from "@/types/database"

export function MyFavoritesList({ favorites }: { favorites: ExerciseFavoriteWithExercise[] }) {
  const router = useRouter()
  const [removingId, setRemovingId] = useState<string | null>(null)

  if (favorites.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-white p-6 text-sm text-muted-foreground">
        No favorite exercises yet. Tap the heart on any exercise in your workout to save it here.
      </p>
    )
  }

  async function remove(exerciseId: string) {
    setRemovingId(exerciseId)
    try {
      const res = await fetch("/api/client/exercise-favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exerciseId, favorited: false }),
      })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      toast.error("Couldn't remove favorite")
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <ul className="space-y-2">
      {favorites.map((f) => (
        <li key={f.id} className="flex items-center justify-between rounded-xl border border-border bg-white p-4">
          <div className="min-w-0">
            <p className="truncate font-medium text-primary">{f.exercise?.name ?? "Exercise"}</p>
            <p className="text-xs text-muted-foreground">
              {f.exercise?.muscle_group ?? ""}
              {f.source === "admin" ? " · added by coach" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {f.exercise?.video_url && (
              <a
                href={f.exercise.video_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-success"
              >
                <Play className="size-4" /> Watch
              </a>
            )}
            <button
              type="button"
              onClick={() => remove(f.exercise_id)}
              disabled={removingId === f.exercise_id}
              aria-label="Remove favorite"
              className="rounded-full p-1.5 text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <Heart className="size-5 fill-accent" strokeWidth={1.5} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Write the page**

Create `app/(client)/client/favorites/page.tsx` (match the auth/redirect pattern of a sibling client page like `app/(client)/client/sessions/page.tsx` — read it first):

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { listFavoritesByClient } from "@/lib/db/exercise-favorites"
import { MyFavoritesList } from "@/components/client/MyFavoritesList"

export default async function FavoritesPage() {
  const session = await auth()
  const userId = session?.user?.id as string | undefined
  if (!userId) redirect("/login")

  let favorites: Awaited<ReturnType<typeof listFavoritesByClient>> = []
  try {
    favorites = await listFavoritesByClient(userId)
  } catch {
    favorites = []
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-1 font-heading text-2xl text-primary">Favorite Exercises</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Exercises you love. Your coach&apos;s AI uses these to shape your future programs.
      </p>
      <MyFavoritesList favorites={favorites} />
    </div>
  )
}
```

- [ ] **Step 4: Add the nav item**

Grep for the existing client nav (how "Workouts"/"My Sessions" appear): `grep -rn "My Sessions\|/client/workouts" components app/(client)`. Add a "Favorites" item linking to `/client/favorites` with the `Heart` icon, matching the existing nav item shape exactly.

- [ ] **Step 5: Run tests + verify**

Run: `npx vitest run __tests__/components/client/MyFavoritesList.test.tsx`
Expected: PASS (2 tests).
Run: `npx tsc --noEmit` — no new errors in the new files.

- [ ] **Step 6: Commit**

```bash
git add "app/(client)/client/favorites/page.tsx" components/client/MyFavoritesList.tsx __tests__/components/client/MyFavoritesList.test.tsx <client-nav-file>
git commit -m "feat(exercise-favorites): client My Favorites page + nav"
```

---

### Task 9: Admin panel on the client detail page

**Files:**
- Create: `components/admin/favorites/ClientFavoriteExercisesPanel.tsx`
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` (load data in `Promise.all`; render the panel after `ProgramsSection`)
- Test: `__tests__/components/admin/ClientFavoriteExercisesPanel.test.tsx`

**Interfaces:**
- Consumes: `listFavoritesByClient` (Task 2); `getExercises` from `@/lib/db/exercises`; the admin route (Task 4); `Combobox` from `@/components/ui/combobox`.
- Produces: `<ClientFavoriteExercisesPanel clientId initialFavorites exerciseOptions />`.

- [ ] **Step 1: Write the failing panel test**

Create `__tests__/components/admin/ClientFavoriteExercisesPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ClientFavoriteExercisesPanel } from "@/components/admin/favorites/ClientFavoriteExercisesPanel"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const fav = {
  id: "f1",
  client_user_id: "c1",
  exercise_id: "e1",
  created_by: "c1",
  source: "client" as const,
  created_at: "2026-06-30T00:00:00Z",
  exercise: { id: "e1", name: "Deadlift", category: ["strength"], muscle_group: "posterior", video_url: null, thumbnail_url: null, difficulty: "advanced" },
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as unknown as typeof fetch
})

describe("ClientFavoriteExercisesPanel", () => {
  it("renders existing favorites", () => {
    render(<ClientFavoriteExercisesPanel clientId="c1" initialFavorites={[fav]} exerciseOptions={[{ value: "e2", label: "Bench" }]} />)
    expect(screen.getByText("Deadlift")).toBeInTheDocument()
  })
  it("shows empty state when none", () => {
    render(<ClientFavoriteExercisesPanel clientId="c1" initialFavorites={[]} exerciseOptions={[]} />)
    expect(screen.getByText(/no favorite/i)).toBeInTheDocument()
  })
  it("DELETEs when removing a favorite", async () => {
    render(<ClientFavoriteExercisesPanel clientId="c1" initialFavorites={[fav]} exerciseOptions={[]} />)
    fireEvent.click(screen.getByLabelText(/remove favorite/i))
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/clients/c1/exercise-favorites",
        expect.objectContaining({ method: "DELETE" }),
      ),
    )
  })
})
```

- [ ] **Step 2: Write the panel**

Create `components/admin/favorites/ClientFavoriteExercisesPanel.tsx` (mirror `components/admin/packs/ClientPackagesPanel.tsx` card shell + `router.refresh()` pattern):

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Heart, Plus } from "lucide-react"
import { toast } from "sonner"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Button } from "@/components/ui/button"
import type { ExerciseFavoriteWithExercise } from "@/types/database"

export function ClientFavoriteExercisesPanel({
  clientId,
  initialFavorites,
  exerciseOptions,
}: {
  clientId: string
  initialFavorites: ExerciseFavoriteWithExercise[]
  exerciseOptions: ComboboxOption[]
}) {
  const router = useRouter()
  const [picked, setPicked] = useState("")
  const [busy, setBusy] = useState(false)

  async function call(method: "POST" | "DELETE", exerciseId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/exercise-favorites`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exerciseId }),
      })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      toast.error("Could not update favorites")
    } finally {
      setBusy(false)
    }
  }

  const favoritedIds = new Set(initialFavorites.map((f) => f.exercise_id))
  const addable = exerciseOptions.filter((o) => !favoritedIds.has(o.value))

  return (
    <div className="rounded-xl border border-border bg-white p-6">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-primary">
        <Heart className="size-5" strokeWidth={1.5} /> Favorite Exercises
      </h2>

      <div className="mb-4 flex items-end gap-2">
        <div className="flex-1">
          <Combobox
            options={addable}
            value={picked}
            onChange={setPicked}
            placeholder="Add a favorite for this client…"
            searchPlaceholder="Search exercises…"
          />
        </div>
        <Button
          type="button"
          disabled={!picked || busy}
          onClick={async () => {
            await call("POST", picked)
            setPicked("")
          }}
        >
          <Plus className="size-4" /> Add
        </Button>
      </div>

      {initialFavorites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No favorite exercises yet.</p>
      ) : (
        <ul className="space-y-2">
          {initialFavorites.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-2">
              <span className="min-w-0 truncate">
                <span className="font-medium text-primary">{f.exercise?.name ?? "Exercise"}</span>
                {f.source === "admin" && <span className="ml-2 text-xs text-muted-foreground">added by coach</span>}
              </span>
              <button
                type="button"
                aria-label="Remove favorite"
                disabled={busy}
                onClick={() => call("DELETE", f.exercise_id)}
                className="rounded-full p-1.5 text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                <Heart className="size-5 fill-accent" strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run the panel test**

Run: `npx vitest run __tests__/components/admin/ClientFavoriteExercisesPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 4: Wire into the admin client detail page**

In `app/(admin)/admin/clients/[id]/page.tsx`:

Add imports:

```ts
import { listFavoritesByClient } from "@/lib/db/exercise-favorites"
import { getExercises } from "@/lib/db/exercises"
import { ClientFavoriteExercisesPanel } from "@/components/admin/favorites/ClientFavoriteExercisesPanel"
```

Add two entries to the existing `Promise.all` (the `[profile, assignments, payments, progressData, achievements, workoutStreak, packs]` block ~line 607-615):

```ts
    listFavoritesByClient(id).catch(() => []),
    getExercises().catch(() => []),
```

Destructure them (e.g. `favorites`, `allExercises`). Build combobox options:

```ts
  const exerciseOptions = allExercises.map((e) => ({ value: e.id, label: e.name }))
```

Render the panel right after `<ProgramsSection .../>` (~line 752):

```tsx
      <ClientFavoriteExercisesPanel clientId={id} initialFavorites={favorites} exerciseOptions={exerciseOptions} />
```

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run __tests__/components/admin/ClientFavoriteExercisesPanel.test.tsx`
Run: `npx tsc --noEmit` — no new errors in the changed files.

```bash
git add components/admin/favorites/ClientFavoriteExercisesPanel.tsx "app/(admin)/admin/clients/[id]/page.tsx" __tests__/components/admin/ClientFavoriteExercisesPanel.test.tsx
git commit -m "feat(exercise-favorites): admin client-page favorites panel (view/add/remove)"
```

---

### Task 10: Final integration verification

**Files:** none (verification only).

- [ ] **Step 1: Full app test suite**

Run: `npx vitest run`
Expected: all new tests pass; only the documented pre-existing baseline reds remain (stripe `webhook-external` ×2, `uploads/shop` ×4, occasional content-studio flakes). If a NEW failure appears, fix it before proceeding. Snapshot the baseline by `git stash` + re-run if causation is unclear.

- [ ] **Step 2: Functions test suite**

Run: `cd functions && npx vitest run`
Expected: green (exercise-filter + usage-history + orchestrator tests).

- [ ] **Step 3: tsc (app + functions)**

Run: `npx tsc --noEmit` — zero NEW errors in touched prod files (baseline test/.next noise is expected).
Run: `cd functions && npx tsc --noEmit` — exit 0.

- [ ] **Step 4: Production build**

Run: `npx next build`
Expected: exit 0; `/client/favorites` route generated.

- [ ] **Step 5: Commit any verification fixups** (if needed), else proceed to holistic review.

---

## Self-Review (completed during planning)

- **Spec coverage:** §1 migration → T1. §2 types → T1. §3 validator → T1. §4 DAL → T2. §5 AI (reader/flag/orchestrators/filter) → T5+T6. §6 client UI → T7+T8. §7 admin UI → T9. §8 API routes → T3+T4. §9 audit → T3. §10 tests → every task + T10. ✅ all sections covered.
- **Type consistency:** `getFavoriteExerciseIds`/`listFavoritesByClient`/`addFavorite`/`removeFavorite` used identically across T2→T3/T4/T7/T8/T9. `FAVORITE_BOOST`/`favoriteIds` consistent T5↔T6. `ExerciseFavoriteWithExercise` consistent T1→T8/T9. `favorited` boolean payload consistent client route ↔ button ↔ list.
- **Open confirmations flagged inline** (NOTE blocks): `system_settings.value` cast, `AuditTarget.type` allowed values, functions test mock path, the client nav file location, the favorite-fixture choice in the filter test. These are "read the neighbor and match" confirmations, not design gaps.
```

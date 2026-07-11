# Shareable Athlete Profile Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public, token-shared, FIBA-style athlete profile page (`/athlete/<token>`) with DJP branding — hero + stats, records, radar, program + career, badges — plus admin share dialog, dynamic OG image, and print support.

**Architecture:** Stateless HMAC token (`ap.` prefix, mirrors `lib/qr/checkin-token.ts`) resolves to a client user id; a server-component page assembles data through existing DAL helpers (new `lib/profile-share/` module) and renders public components; coach generates link+QR inline on the admin client page. DB-flag-gated, default OFF. Zero migrations.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 semantic tokens, Recharts (radar), Framer Motion (reveals), `next/og` ImageResponse, `qrcode`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-11-athlete-profile-share-design.md`

## Global Constraints

- Semantic color classes only (`bg-primary`, `text-accent`, …); hardcoded brand hex (`#0E3F50`, `#C49B7A`) allowed ONLY inside SVG/Recharts/OG-image contexts (established exception zone).
- Fonts via `font-heading` / `font-body` / `font-mono` classes — never inline `fontFamily` (OG image excepted; it renders outside the CSS system).
- Feature flag DB-backed via `system_settings`, key `client_profile_share_enabled`, default **false**.
- Never exposed on the public page: injuries, readiness values, payments, email/phone, raw DOB, guardian fields, internal notes.
- 404 semantics: invalid token, flag off, user missing / not `role="client"` / not `status="active"`, or `is_minor` → `notFound()`. No distinguishing error messages.
- All DB reads via `lib/db/*` DAL files (service-role client); any unbounded row read must paginate (`.range()`) past the PostgREST ~1000-row cap.
- Tests: Vitest jsdom, `describe/it/expect` from `vitest`, setup at `__tests__/setup.tsx` (mocks `next/image`, `next/navigation`, `next/cache`, `resend` globally).
- Run targeted test files only (`npx vitest run <file>`); the full suite has known pre-existing reds/flakes.
- Commit after each task; **do not push** (user away; push requires explicit go-ahead).

---

### Task 1: HMAC token helper

**Files:**
- Create: `lib/profile-share/token.ts`
- Test: `__tests__/lib/profile-share-token.test.ts`

**Interfaces:**
- Consumes: `crypto` (node), `NEXTAUTH_SECRET` env.
- Produces: `signAthleteProfileToken(clientUserId: string): string`, `verifyAthleteProfileToken(token: string): { valid: true; clientUserId: string } | { valid: false }` — used by Tasks 5, 6, 7.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/profile-share-token.test.ts
import { describe, it, expect } from "vitest"
import { signAthleteProfileToken, verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { signPersonalCheckinToken } from "@/lib/qr/checkin-token"

describe("athlete profile token", () => {
  const uid = "3f9a2b6c-1d4e-4f7a-9b0c-8d5e6f7a8b9c"

  it("round-trips a client user id", () => {
    const token = signAthleteProfileToken(uid)
    expect(verifyAthleteProfileToken(token)).toEqual({ valid: true, clientUserId: uid })
  })

  it("rejects a tampered signature", () => {
    const token = signAthleteProfileToken(uid)
    const [b64] = token.split(".")
    expect(verifyAthleteProfileToken(`${b64}.AAAA${"B".repeat(39)}`)).toEqual({ valid: false })
  })

  it("rejects a tampered payload", () => {
    const token = signAthleteProfileToken(uid)
    const [, sig] = token.split(".")
    const forged = Buffer.from(`ap.someone-else`).toString("base64url")
    expect(verifyAthleteProfileToken(`${forged}.${sig}`)).toEqual({ valid: false })
  })

  it("rejects a personal check-in token (pc. prefix) even though HMAC construction matches", () => {
    const checkin = signPersonalCheckinToken(uid)
    expect(verifyAthleteProfileToken(checkin)).toEqual({ valid: false })
  })

  it("rejects garbage", () => {
    expect(verifyAthleteProfileToken("")).toEqual({ valid: false })
    expect(verifyAthleteProfileToken("abc")).toEqual({ valid: false })
    expect(verifyAthleteProfileToken("a.b.c")).toEqual({ valid: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/profile-share-token.test.ts`
Expected: FAIL — cannot resolve `@/lib/profile-share/token`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/profile-share/token.ts
import { createHmac, timingSafeEqual } from "crypto"

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? "dev-insecure-secret"
}

// Public athlete-profile share link. Same HMAC construction as the personal
// check-in token; the `ap.` prefix keeps the two token families from
// cross-validating. Permanent by design (revocation = rotate NEXTAUTH_SECRET).

/** token = base64url("ap.<clientUserId>").hmac — permanent public athlete-profile link. */
export function signAthleteProfileToken(clientUserId: string): string {
  const b64 = Buffer.from(`ap.${clientUserId}`).toString("base64url")
  const sig = createHmac("sha256", secret()).update(b64).digest("base64url")
  return `${b64}.${sig}`
}

export type AthleteProfileVerifyResult = { valid: true; clientUserId: string } | { valid: false }

/** Verifies signature + the `ap.` marker. No expiry (permanent link). */
export function verifyAthleteProfileToken(token: string): AthleteProfileVerifyResult {
  const parts = token.split(".")
  if (parts.length !== 2) return { valid: false }
  const [b64, sig] = parts
  const expected = createHmac("sha256", secret()).update(b64).digest("base64url")
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false }
  const segs = Buffer.from(b64, "base64url").toString().split(".")
  if (segs[0] !== "ap" || segs.length < 2) return { valid: false }
  const clientUserId = segs.slice(1).join(".")
  if (!clientUserId) return { valid: false }
  return { valid: true, clientUserId }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/profile-share-token.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/profile-share/token.ts __tests__/lib/profile-share-token.test.ts
git commit -m "feat(profile-share): HMAC athlete-profile share token (ap. prefix)"
```

---

### Task 2: Feature flag + admin toggle row

**Files:**
- Create: `lib/profile-share/flags.ts`
- Modify: `lib/feature-flag-catalog.ts` (append one row to `FEATURE_FLAG_CATALOG`)
- Test: `__tests__/lib/profile-share-flags.test.ts`

**Interfaces:**
- Consumes: `getSetting<T>(key, fallback)` from `@/lib/db/system-settings`.
- Produces: `CLIENT_PROFILE_SHARE_KEY = "client_profile_share_enabled"`, `clientProfileShareEnabled(): Promise<boolean>` — used by Tasks 5, 6, 7.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/profile-share-flags.test.ts
import { describe, it, expect } from "vitest"
import { CLIENT_PROFILE_SHARE_KEY } from "@/lib/profile-share/flags"
import { FEATURE_FLAG_CATALOG, isFeatureFlagKey } from "@/lib/feature-flag-catalog"

describe("profile share flag", () => {
  it("is registered in the admin feature-flag catalog, default OFF", () => {
    const row = FEATURE_FLAG_CATALOG.find((f) => f.key === CLIENT_PROFILE_SHARE_KEY)
    expect(row).toBeDefined()
    expect(row!.defaultEnabled).toBe(false)
    expect(isFeatureFlagKey(CLIENT_PROFILE_SHARE_KEY)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/profile-share-flags.test.ts`
Expected: FAIL — cannot resolve `@/lib/profile-share/flags`.

- [ ] **Step 3: Implement**

```ts
// lib/profile-share/flags.ts
import { getSetting } from "@/lib/db/system-settings"

// Public shareable athlete-profile links (coach-generated, permanent HMAC).
export const CLIENT_PROFILE_SHARE_KEY = "client_profile_share_enabled"

export const clientProfileShareEnabled = () => getSetting<boolean>(CLIENT_PROFILE_SHARE_KEY, false)
```

Append to `FEATURE_FLAG_CATALOG` in `lib/feature-flag-catalog.ts` (before the closing `] as const`):

```ts
  {
    key: "client_profile_share_enabled",
    label: "Shareable athlete profile links",
    description:
      "Adds a 'Share profile' action on client pages that links to a public FIBA-style athlete profile card (stats, PRs, program, badges). Links are permanent while this is on; minors are excluded. Off by default.",
    defaultEnabled: false,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/profile-share-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/profile-share/flags.ts lib/feature-flag-catalog.ts __tests__/lib/profile-share-flags.test.ts
git commit -m "feat(profile-share): client_profile_share_enabled flag + admin toggle row"
```

---

### Task 3: DAL additions (volume sum, program joins, exercise names)

**Files:**
- Modify: `lib/db/workout-sessions.ts` (add `getTotalVolumeKg`)
- Modify: `lib/db/assignments.ts` (add `getActiveAssignmentWithProgram`, `getCompletedAssignments`)
- Modify: `lib/db/exercises.ts` (add `getExerciseNamesByIds`)
- Test: `__tests__/lib/profile-share-dal.test.ts`

**Interfaces:**
- Consumes: each file's existing local `getClient()` (service-role Supabase).
- Produces (used by Task 4):
  - `getTotalVolumeKg(userId: string): Promise<number>`
  - `getActiveAssignmentWithProgram(userId: string): Promise<(ProgramAssignment & { programs: Program | null }) | null>`
  - `getCompletedAssignments(userId: string): Promise<(ProgramAssignment & { programs: Program | null })[]>`
  - `getExerciseNamesByIds(ids: string[]): Promise<Record<string, string>>`

- [ ] **Step 1: Write the failing test** (mock `@/lib/supabase`'s `createServiceRoleClient` with a chainable stub)

```ts
// __tests__/lib/profile-share-dal.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const rangeMock = vi.fn()
const inMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          neq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          range: rangeMock,
          in: inMock,
        }
        return chain
      },
    }),
  }),
}))

import { getTotalVolumeKg } from "@/lib/db/workout-sessions"
import { getExerciseNamesByIds } from "@/lib/db/exercises"

describe("getTotalVolumeKg", () => {
  beforeEach(() => rangeMock.mockReset())

  it("sums volume_load_kg and treats nulls as 0", async () => {
    rangeMock.mockResolvedValueOnce({
      data: [{ volume_load_kg: 100.5 }, { volume_load_kg: null }, { volume_load_kg: 200 }],
      error: null,
    })
    expect(await getTotalVolumeKg("u1")).toBeCloseTo(300.5)
    expect(rangeMock).toHaveBeenCalledTimes(1)
  })

  it("paginates past the 1000-row page", async () => {
    const page = Array.from({ length: 1000 }, () => ({ volume_load_kg: 1 }))
    rangeMock
      .mockResolvedValueOnce({ data: page, error: null })
      .mockResolvedValueOnce({ data: [{ volume_load_kg: 5 }], error: null })
    expect(await getTotalVolumeKg("u1")).toBe(1005)
    expect(rangeMock).toHaveBeenCalledTimes(2)
    expect(rangeMock).toHaveBeenNthCalledWith(1, 0, 999)
    expect(rangeMock).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it("returns partial total on error", async () => {
    rangeMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    expect(await getTotalVolumeKg("u1")).toBe(0)
  })
})

describe("getExerciseNamesByIds", () => {
  beforeEach(() => inMock.mockReset())

  it("returns an empty map for no ids without querying", async () => {
    expect(await getExerciseNamesByIds([])).toEqual({})
    expect(inMock).not.toHaveBeenCalled()
  })

  it("maps id → name", async () => {
    inMock.mockResolvedValueOnce({ data: [{ id: "e1", name: "Back Squat" }], error: null })
    expect(await getExerciseNamesByIds(["e1"])).toEqual({ e1: "Back Squat" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/profile-share-dal.test.ts`
Expected: FAIL — `getTotalVolumeKg` / `getExerciseNamesByIds` not exported.

- [ ] **Step 3: Implement the three DAL additions**

Append to `lib/db/workout-sessions.ts`:

```ts
/** Lifetime volume (kg) across completed sessions. Paginates past the PostgREST ~1000-row cap. */
export async function getTotalVolumeKg(userId: string): Promise<number> {
  const supabase = getClient()
  const PAGE = 1000
  let from = 0
  let total = 0
  for (;;) {
    const { data, error } = await supabase
      .from("workout_sessions")
      .select("volume_load_kg")
      .eq("user_id", userId)
      .eq("status", "completed")
      .range(from, from + PAGE - 1)
    if (error) return total
    for (const row of (data ?? []) as { volume_load_kg: number | null }[]) {
      total += row.volume_load_kg ?? 0
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return total
}
```

Append to `lib/db/assignments.ts` (add `Program` to the existing `types/database` import):

```ts
/** Active assignment joined with its program row (public profile card). */
export async function getActiveAssignmentWithProgram(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("*, programs(*)")
    .eq("user_id", userId)
    .eq("status", "active")
    .neq("payment_status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as (ProgramAssignment & { programs: Program | null }) | null
}

/** Completed assignments, newest first, joined with program rows — the athlete's "career". */
export async function getCompletedAssignments(userId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("program_assignments")
    .select("*, programs(*)")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("updated_at", { ascending: false })
  if (error) throw error
  return data as (ProgramAssignment & { programs: Program | null })[]
}
```

Append to `lib/db/exercises.ts`:

```ts
/** Batch-resolve exercise names. Missing ids are absent from the map. */
export async function getExerciseNamesByIds(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const supabase = getClient()
  const { data, error } = await supabase.from("exercises").select("id, name").in("id", ids)
  if (error) return {}
  const map: Record<string, string> = {}
  for (const row of (data ?? []) as { id: string; name: string }[]) map[row.id] = row.name
  return map
}
```

Note: `lib/db/exercises.ts` and `lib/db/assignments.ts` may name their client helper differently (`getClient()` vs inline `createServiceRoleClient()`) — read each file first and match its local convention.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/profile-share-dal.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/db/workout-sessions.ts lib/db/assignments.ts lib/db/exercises.ts __tests__/lib/profile-share-dal.test.ts
git commit -m "feat(profile-share): DAL helpers - volume sum, program joins, exercise name batch"
```

---

### Task 4: Data assembler

**Files:**
- Create: `lib/profile-share/data.ts`
- Test: `__tests__/lib/profile-share-data.test.ts`

**Interfaces:**
- Consumes: Task 1/3 helpers + existing DAL (`getUserById`, `getProfileByUserId`, `getCompletedSessionCount`, `getWorkoutStreak`, `getAchievements`, `getAchievementsByType`, `getPRsByUser`, `listByUser` from performance-tests / training-sessions / daily-readiness, `effectiveTotalWeeks`, `dailyLoads`, `computeBadges`, `TEST_TYPE_LABELS`).
- Produces (used by Tasks 5, 6): `AthleteProfileData` interface + `getAthleteProfileData(clientUserId): Promise<AthleteProfileData | null>` + `computeAge(dobIso, now?)`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/profile-share-data.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getProfileByUserId: vi.fn(),
  getCompletedSessionCount: vi.fn(),
  getTotalVolumeKg: vi.fn(),
  getWorkoutStreak: vi.fn(),
  getAchievements: vi.fn(),
  getAchievementsByType: vi.fn(),
  getPRsByUser: vi.fn(),
  listTests: vi.fn(),
  listTrainingSessions: vi.fn(),
  listReadiness: vi.fn(),
  getActiveAssignmentWithProgram: vi.fn(),
  getCompletedAssignments: vi.fn(),
  getExerciseNamesByIds: vi.fn(),
}))

vi.mock("@/lib/db/users", () => ({ getUserById: mocks.getUserById }))
vi.mock("@/lib/db/client-profiles", () => ({ getProfileByUserId: mocks.getProfileByUserId }))
vi.mock("@/lib/db/workout-sessions", () => ({
  getCompletedSessionCount: mocks.getCompletedSessionCount,
  getTotalVolumeKg: mocks.getTotalVolumeKg,
}))
vi.mock("@/lib/db/progress", () => ({ getWorkoutStreak: mocks.getWorkoutStreak }))
vi.mock("@/lib/db/achievements", () => ({
  getAchievements: mocks.getAchievements,
  getAchievementsByType: mocks.getAchievementsByType,
}))
vi.mock("@/lib/db/performance-tests", () => ({
  getPRsByUser: mocks.getPRsByUser,
  listByUser: mocks.listTests,
}))
vi.mock("@/lib/db/training-sessions", () => ({ listByUser: mocks.listTrainingSessions }))
vi.mock("@/lib/db/daily-readiness", () => ({ listByUser: mocks.listReadiness }))
vi.mock("@/lib/db/assignments", () => ({
  getActiveAssignmentWithProgram: mocks.getActiveAssignmentWithProgram,
  getCompletedAssignments: mocks.getCompletedAssignments,
}))
vi.mock("@/lib/db/exercises", () => ({ getExerciseNamesByIds: mocks.getExerciseNamesByIds }))

import { getAthleteProfileData, computeAge } from "@/lib/profile-share/data"

const activeClient = {
  id: "u1", role: "client", status: "active",
  first_name: "Marcus", last_name: "Johnson",
  avatar_url: null, created_at: "2024-03-10T00:00:00Z",
}
const fullProfile = {
  user_id: "u1", is_minor: false, sport: "Basketball", position: "Point Guard",
  experience_level: "advanced", height_cm: 188, weight_kg: 84, weight_unit: "kg",
  date_of_birth: "2002-01-15", training_years: 4,
}

function armHappyPath() {
  mocks.getUserById.mockResolvedValue(activeClient)
  mocks.getProfileByUserId.mockResolvedValue(fullProfile)
  mocks.getCompletedSessionCount.mockResolvedValue(247)
  mocks.getTotalVolumeKg.mockResolvedValue(412300)
  mocks.getWorkoutStreak.mockResolvedValue(18)
  mocks.getAchievements.mockResolvedValue([
    { id: "m1", achievement_type: "milestone", title: "100 Workouts", description: null, earned_at: "2026-02-01T00:00:00Z" },
    { id: "p9", achievement_type: "pr", title: "Weight PR!", earned_at: "2026-01-01T00:00:00Z" },
  ])
  mocks.getAchievementsByType.mockResolvedValue([
    { id: "a1", title: "Weight PR!", exercise_id: "e1", metric_value: 140, earned_at: "2026-05-01T00:00:00Z" },
    { id: "a2", title: "Weight PR!", exercise_id: "e1", metric_value: 135, earned_at: "2026-03-01T00:00:00Z" },
    { id: "a3", title: "Rep PR!", exercise_id: "e1", metric_value: 12, earned_at: "2026-04-01T00:00:00Z" },
    { id: "a4", title: "Weight PR!", exercise_id: null, metric_value: 90, earned_at: "2026-04-01T00:00:00Z" },
  ])
  mocks.getPRsByUser.mockResolvedValue([
    { test_type: "cmj", custom_name: null, result_value: 48, result_unit: "cm", test_date: "2026-06-01", best_method: "highest" },
    { test_type: "custom", custom_name: "Med Ball Throw", result_value: 12.5, result_unit: "m", test_date: "2026-05-20", best_method: "highest" },
  ])
  mocks.listTests.mockResolvedValue([{ test_type: "cmj", result_value: 48, test_date: "2026-06-01", body_weight_kg: null }])
  mocks.listTrainingSessions.mockResolvedValue([])
  mocks.listReadiness.mockResolvedValue([])
  mocks.getActiveAssignmentWithProgram.mockResolvedValue({
    current_week: 6, total_weeks: 10, start_date: "2026-06-01",
    programs: { name: "Off-Season Power Block", duration_weeks: 12, difficulty: "advanced", category: ["strength"], split_type: "upper_lower" },
  })
  mocks.getCompletedAssignments.mockResolvedValue([
    { updated_at: "2026-04-15T00:00:00Z", programs: { name: "Pre-Season Speed" } },
  ])
  mocks.getExerciseNamesByIds.mockResolvedValue({ e1: "Back Squat" })
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
})

describe("computeAge", () => {
  it("computes age from an ISO date", () => {
    expect(computeAge("2002-01-15", new Date("2026-07-11T00:00:00Z"))).toBe(24)
  })
  it("handles pre-birthday", () => {
    expect(computeAge("2002-12-31", new Date("2026-07-11T00:00:00Z"))).toBe(23)
  })
  it("returns null for null/invalid", () => {
    expect(computeAge(null)).toBeNull()
    expect(computeAge("not-a-date")).toBeNull()
  })
})

describe("getAthleteProfileData", () => {
  it("assembles the full card", async () => {
    armHappyPath()
    const d = await getAthleteProfileData("u1")
    expect(d).not.toBeNull()
    expect(d!.name).toEqual({ first: "Marcus", last: "Johnson" })
    expect(d!.age).toBe(24) // as of 2026 vs 2002-01-15 (post-birthday)
    expect(d!.stats.workouts).toBe(247)
    expect(d!.stats.totalVolumeKg).toBe(412300)
    // gym records: best weight PR per exercise, name resolved, rep PR + null-exercise excluded
    expect(d!.gymRecords).toEqual([{ exercise: "Back Squat", valueKg: 140, date: "2026-05-01T00:00:00Z" }])
    // field records: custom tests labeled by custom_name
    expect(d!.fieldRecords.map((r) => r.label)).toEqual(expect.arrayContaining(["Med Ball Throw"]))
    // program uses effectiveTotalWeeks(10, 12) = 12
    expect(d!.program).toMatchObject({ name: "Off-Season Power Block", currentWeek: 6, totalWeeks: 12 })
    expect(d!.career).toEqual([{ name: "Pre-Season Speed", completedAt: "2026-04-15T00:00:00Z" }])
    // milestones exclude PR-type achievements
    expect(d!.milestones.map((m) => m.title)).toEqual(["100 Workouts"])
    // prCount = gym PR achievements (4) + field PR rows (2)
    expect(d!.stats.prCount).toBe(6)
  })

  it("returns null for non-clients, inactive users, minors, and missing users", async () => {
    armHappyPath()
    mocks.getUserById.mockResolvedValue({ ...activeClient, role: "admin" })
    expect(await getAthleteProfileData("u1")).toBeNull()

    armHappyPath()
    mocks.getUserById.mockResolvedValue({ ...activeClient, status: "inactive" })
    expect(await getAthleteProfileData("u1")).toBeNull()

    armHappyPath()
    mocks.getProfileByUserId.mockResolvedValue({ ...fullProfile, is_minor: true })
    expect(await getAthleteProfileData("u1")).toBeNull()

    armHappyPath()
    mocks.getUserById.mockRejectedValue(new Error("no row"))
    expect(await getAthleteProfileData("u1")).toBeNull()
  })

  it("degrades failed sources to empty sections instead of throwing", async () => {
    armHappyPath()
    mocks.getPRsByUser.mockRejectedValue(new Error("view missing"))
    mocks.getAchievementsByType.mockRejectedValue(new Error("boom"))
    mocks.getActiveAssignmentWithProgram.mockRejectedValue(new Error("boom"))
    const d = await getAthleteProfileData("u1")
    expect(d).not.toBeNull()
    expect(d!.gymRecords).toEqual([])
    expect(d!.fieldRecords).toEqual([])
    expect(d!.program).toBeNull()
  })

  it("renders with a missing client_profiles row (nulled physicals)", async () => {
    armHappyPath()
    mocks.getProfileByUserId.mockResolvedValue(null)
    const d = await getAthleteProfileData("u1")
    expect(d).not.toBeNull()
    expect(d!.age).toBeNull()
    expect(d!.heightCm).toBeNull()
    expect(d!.sport).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/profile-share-data.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// lib/profile-share/data.ts
import { getUserById } from "@/lib/db/users"
import { getProfileByUserId } from "@/lib/db/client-profiles"
import { getCompletedSessionCount, getTotalVolumeKg } from "@/lib/db/workout-sessions"
import { getWorkoutStreak } from "@/lib/db/progress"
import { getAchievements, getAchievementsByType } from "@/lib/db/achievements"
import { getPRsByUser, listByUser as listTests } from "@/lib/db/performance-tests"
import { listByUser as listTrainingSessions } from "@/lib/db/training-sessions"
import { listByUser as listReadiness } from "@/lib/db/daily-readiness"
import { getActiveAssignmentWithProgram, getCompletedAssignments } from "@/lib/db/assignments"
import { getExerciseNamesByIds } from "@/lib/db/exercises"
import { effectiveTotalWeeks } from "@/lib/program-weeks"
import { dailyLoads } from "@/lib/coach-intel/load"
import { computeBadges, type Badge } from "@/lib/badges"
import { TEST_TYPE_LABELS } from "@/lib/validators/performance-test"
import type { Achievement, PerformanceTest, TestType, WeightUnit } from "@/types/database"

export interface GymRecord {
  exercise: string
  valueKg: number
  date: string
}

export interface FieldRecord {
  label: string
  value: number
  unit: string
  date: string
}

export interface AthleteProfileData {
  name: { first: string; last: string }
  avatarUrl: string | null
  sport: string | null
  position: string | null
  experienceLevel: string | null
  heightCm: number | null
  weightKg: number | null
  weightUnit: WeightUnit
  age: number | null
  memberSince: string
  stats: { workouts: number; streakDays: number; totalVolumeKg: number; prCount: number }
  gymRecords: GymRecord[]
  fieldRecords: FieldRecord[]
  radarTests: PerformanceTest[]
  program: {
    name: string
    currentWeek: number
    totalWeeks: number
    difficulty: string | null
    categories: string[]
    splitType: string | null
  } | null
  career: { name: string; completedAt: string }[]
  badges: Badge[]
  milestones: { title: string; description: string | null; type: string; earnedAt: string }[]
}

/** Age in whole years from an ISO date (public card shows age, never the DOB). */
export function computeAge(dobIso: string | null, now = new Date()): number | null {
  if (!dobIso) return null
  const dob = new Date(dobIso.length === 10 ? `${dobIso}T00:00:00Z` : dobIso)
  if (isNaN(dob.getTime())) return null
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const m = now.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--
  return age >= 0 && age < 130 ? age : null
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function settle<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback
}

const MAX_RECORDS = 6
const MAX_MILESTONES = 8
const MAX_CAREER = 8

/**
 * Assembles everything the public card shows. Returns null when the user must
 * not have a public card (missing, not a client, not active, or a minor);
 * individual data sources fail soft to empty sections.
 */
export async function getAthleteProfileData(clientUserId: string): Promise<AthleteProfileData | null> {
  let user
  try {
    user = await getUserById(clientUserId)
  } catch {
    return null
  }
  if (!user || user.role !== "client" || user.status !== "active") return null

  const profile = await getProfileByUserId(clientUserId).catch(() => null)
  if (profile?.is_minor) return null

  const today = new Date().toISOString().slice(0, 10)
  const from = addDays(today, -90)

  const [
    workoutsR, streakR, volumeR, prAchievementsR, fieldPRsR, testsR,
    trainingSessionsR, readinessR, assignmentR, completedR, allAchievementsR,
  ] = await Promise.allSettled([
    getCompletedSessionCount(clientUserId),
    getWorkoutStreak(clientUserId),
    getTotalVolumeKg(clientUserId),
    getAchievementsByType(clientUserId, "pr"),
    getPRsByUser(clientUserId),
    listTests(clientUserId),
    listTrainingSessions(clientUserId, { from, to: today }),
    listReadiness(clientUserId, { from, to: today }),
    getActiveAssignmentWithProgram(clientUserId),
    getCompletedAssignments(clientUserId),
    getAchievements(clientUserId),
  ])

  const prAchievements = settle(prAchievementsR, [] as Achievement[])
  const fieldPRs = settle(fieldPRsR, [])
  const tests = settle(testsR, [] as PerformanceTest[])
  const assignment = settle(assignmentR, null)
  const completed = settle(completedR, [])
  const allAchievements = settle(allAchievementsR, [] as Achievement[])

  // Best weight PR per exercise (titles are generic; the exercise lives behind exercise_id).
  const bestByExercise = new Map<string, Achievement>()
  for (const a of prAchievements) {
    if (a.title !== "Weight PR!" || !a.exercise_id || a.metric_value == null) continue
    const cur = bestByExercise.get(a.exercise_id)
    if (!cur || a.metric_value > (cur.metric_value ?? 0)) bestByExercise.set(a.exercise_id, a)
  }
  const names = await getExerciseNamesByIds([...bestByExercise.keys()]).catch(() => ({}) as Record<string, string>)
  const gymRecords: GymRecord[] = [...bestByExercise.values()]
    .map((a) => ({ exercise: names[a.exercise_id!] ?? "", valueKg: a.metric_value!, date: a.earned_at }))
    .filter((r) => r.exercise)
    .sort((a, b) => b.valueKg - a.valueKg)
    .slice(0, MAX_RECORDS)

  const fieldRecords: FieldRecord[] = [...fieldPRs]
    .sort((a, b) => b.test_date.localeCompare(a.test_date))
    .slice(0, MAX_RECORDS)
    .map((p) => ({
      label: p.test_type === "custom" ? (p.custom_name ?? "Custom") : TEST_TYPE_LABELS[p.test_type as TestType],
      value: p.result_value,
      unit: p.result_unit,
      date: p.test_date,
    }))

  const badges = computeBadges({
    asOf: today,
    dailyLoads: dailyLoads(settle(trainingSessionsR, []), from, today),
    tests,
    readiness: settle(readinessR, []),
    monthlyCompliancePct: null,
  })

  const milestones = allAchievements
    .filter((a) => a.achievement_type !== "pr")
    .slice(0, MAX_MILESTONES)
    .map((a) => ({ title: a.title, description: a.description, type: a.achievement_type, earnedAt: a.earned_at }))

  return {
    name: { first: user.first_name, last: user.last_name },
    avatarUrl: user.avatar_url,
    sport: profile?.sport ?? null,
    position: profile?.position ?? null,
    experienceLevel: profile?.experience_level ?? null,
    heightCm: profile?.height_cm ?? null,
    weightKg: profile?.weight_kg ?? null,
    weightUnit: profile?.weight_unit ?? "kg",
    age: computeAge(profile?.date_of_birth ?? null),
    memberSince: user.created_at,
    stats: {
      workouts: settle(workoutsR, 0),
      streakDays: settle(streakR, 0),
      totalVolumeKg: settle(volumeR, 0),
      prCount: prAchievements.length + fieldPRs.length,
    },
    gymRecords,
    fieldRecords,
    radarTests: tests,
    program:
      assignment && assignment.programs
        ? {
            name: assignment.programs.name,
            currentWeek: assignment.current_week,
            totalWeeks: effectiveTotalWeeks(assignment.total_weeks, assignment.programs.duration_weeks),
            difficulty: assignment.programs.difficulty ?? null,
            categories: assignment.programs.category ?? [],
            splitType: assignment.programs.split_type ?? null,
          }
        : null,
    career: completed
      .slice(0, MAX_CAREER)
      .map((c) => ({ name: c.programs?.name ?? "Program", completedAt: c.updated_at })),
    badges,
    milestones,
  }
}
```

Note: check the actual `programs` field names before finishing (`difficulty`, `category`, `split_type`, `duration_weeks` on the `Program` interface in `types/database.ts`) and adjust the mapping if any differ.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/profile-share-data.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add lib/profile-share/data.ts __tests__/lib/profile-share-data.test.ts
git commit -m "feat(profile-share): athlete profile data assembler (fail-soft sections)"
```

---

### Task 5: Public page + Dark Arena UI (frontend-design pass)

**Files:**
- Create: `app/athlete/[token]/page.tsx`
- Create: `components/public/athlete/AthleteProfileCard.tsx` (composition root)
- Create: `components/public/athlete/AthleteHero.tsx`
- Create: `components/public/athlete/StatTiles.tsx` (client: count-up)
- Create: `components/public/athlete/RecordsSection.tsx`
- Create: `components/public/athlete/AthleteRadarSection.tsx` (client: Recharts)
- Create: `components/public/athlete/ProgramSection.tsx`
- Create: `components/public/athlete/BadgesSection.tsx`
- Create: `components/public/athlete/ProfilePrintButton.tsx` (client)
- Create: `components/public/athlete/FooterCta.tsx`
- Test: `__tests__/components/athlete/athlete-profile-card.test.tsx`

**Interfaces:**
- Consumes: `AthleteProfileData` (Task 4), `verifyAthleteProfileToken` (Task 1), `clientProfileShareEnabled` (Task 2), `TIER_RING`/`TIER_BG` styling ideas from `components/client/profile/badge-shelf-card.tsx`, radar normalization from `lib/coach-intel/test-normalization` (`RADAR_CATEGORIES`, `normalize`), `FadeIn` from `components/shared/FadeIn`.
- Produces: `<AthleteProfileCard data={AthleteProfileData} />`.

**IMPORTANT — this task is executed in the main session with the `frontend-design` skill invoked first.** The mockup to match is `.superpowers/brainstorm/1895-1783782202/content/full-page-layout.html` (Dark Arena, user-approved). The code below is the structural contract (props, section order, hide rules, guard logic); the design pass owns polish (spacing, glows, motion) within brand tokens.

- [ ] **Step 1: Page route with guards** (exact):

```tsx
// app/athlete/[token]/page.tsx
import { cache } from "react"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { clientProfileShareEnabled } from "@/lib/profile-share/flags"
import { getAthleteProfileData, type AthleteProfileData } from "@/lib/profile-share/data"
import { AthleteProfileCard } from "@/components/public/athlete/AthleteProfileCard"

export const dynamic = "force-dynamic"

// cache() dedupes between generateMetadata and the page render within a request.
const resolveData = cache(async (token: string): Promise<AthleteProfileData | null> => {
  if (!(await clientProfileShareEnabled())) return null
  const v = verifyAthleteProfileToken(token)
  if (!v.valid) return null
  return getAthleteProfileData(v.clientUserId)
})

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const data = await resolveData(token)
  const robots = { index: false, follow: false }
  if (!data) return { title: "Athlete Profile", robots }
  const name = `${data.name.first} ${data.name.last}`.trim()
  const description =
    [data.sport, data.position].filter(Boolean).join(" · ") || "Training with DJP Athlete"
  return {
    title: `${name} — Athlete Profile`,
    description,
    robots,
    openGraph: { title: `${name} — DJP Athlete Profile`, description, type: "profile" },
    twitter: { card: "summary_large_image", title: `${name} — DJP Athlete Profile`, description },
  }
}

export default async function AthleteProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await resolveData(token)
  if (!data) notFound()
  return <AthleteProfileCard data={data} />
}
```

- [ ] **Step 2: Write the component test** (structure + hide rules, not pixels):

```tsx
// __tests__/components/athlete/athlete-profile-card.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { AthleteProfileCard } from "@/components/public/athlete/AthleteProfileCard"
import type { AthleteProfileData } from "@/lib/profile-share/data"

const base: AthleteProfileData = {
  name: { first: "Marcus", last: "Johnson" },
  avatarUrl: null,
  sport: "Basketball",
  position: "Point Guard",
  experienceLevel: "advanced",
  heightCm: 188,
  weightKg: 84,
  weightUnit: "kg",
  age: 24,
  memberSince: "2024-03-10T00:00:00Z",
  stats: { workouts: 247, streakDays: 18, totalVolumeKg: 412300, prCount: 31 },
  gymRecords: [{ exercise: "Back Squat", valueKg: 140, date: "2026-05-01T00:00:00Z" }],
  fieldRecords: [{ label: "CMJ", value: 48, unit: "cm", date: "2026-06-01" }],
  radarTests: [],
  program: { name: "Off-Season Power Block", currentWeek: 6, totalWeeks: 12, difficulty: "advanced", categories: ["strength"], splitType: "upper_lower" },
  career: [{ name: "Pre-Season Speed", completedAt: "2026-04-15T00:00:00Z" }],
  badges: [{ id: "iron_streak", name: "Iron Streak", description: "18 consecutive training days", icon: "Flame", tier: "gold" }],
  milestones: [{ title: "100 Workouts", description: null, type: "milestone", earnedAt: "2026-02-01T00:00:00Z" }],
}

describe("AthleteProfileCard", () => {
  it("renders hero identity, physicals, records, program, badges", () => {
    render(<AthleteProfileCard data={base} />)
    expect(screen.getByText(/Marcus/)).toBeInTheDocument()
    expect(screen.getByText(/Point Guard/)).toBeInTheDocument()
    expect(screen.getByText(/188/)).toBeInTheDocument()
    expect(screen.getByText(/Back Squat/)).toBeInTheDocument()
    expect(screen.getByText(/Off-Season Power Block/)).toBeInTheDocument()
    expect(screen.getByText(/Iron Streak/)).toBeInTheDocument()
    expect(screen.getByText(/100 Workouts/)).toBeInTheDocument()
  })

  it("hides empty sections but always renders hero + stats", () => {
    render(
      <AthleteProfileCard
        data={{ ...base, gymRecords: [], fieldRecords: [], radarTests: [], program: null, career: [], badges: [], milestones: [] }}
      />,
    )
    expect(screen.getByText(/Marcus/)).toBeInTheDocument()
    expect(screen.queryByText(/Personal Records/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current Program/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Achievements/i)).not.toBeInTheDocument()
  })

  it("omits physical pills that are null", () => {
    render(<AthleteProfileCard data={{ ...base, heightCm: null, weightKg: null, age: null }} />)
    expect(screen.queryByText(/CM/)).not.toBeInTheDocument()
    expect(screen.queryByText(/AGE/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**, then build the components (frontend-design pass).

Structural contract for the composition root — section order and hide rules are non-negotiable; internals are the design pass's to own:

```tsx
// components/public/athlete/AthleteProfileCard.tsx (server component)
import { AthleteHero } from "./AthleteHero"
import { StatTiles } from "./StatTiles"
import { RecordsSection } from "./RecordsSection"
import { AthleteRadarSection } from "./AthleteRadarSection"
import { ProgramSection } from "./ProgramSection"
import { BadgesSection } from "./BadgesSection"
import { ProfilePrintButton } from "./ProfilePrintButton"
import { FooterCta } from "./FooterCta"
import type { AthleteProfileData } from "@/lib/profile-share/data"

export function AthleteProfileCard({ data }: { data: AthleteProfileData }) {
  const hasRecords = data.gymRecords.length > 0 || data.fieldRecords.length > 0
  const hasBadges = data.badges.length > 0 || data.milestones.length > 0
  return (
    <main className="print-document min-h-screen bg-background font-body">
      <ProfilePrintButton />
      <AthleteHero data={data} />
      <StatTiles stats={data.stats} />
      {hasRecords && <RecordsSection gym={data.gymRecords} field={data.fieldRecords} />}
      <AthleteRadarSection tests={data.radarTests} /> {/* self-hides when no category scores */}
      {(data.program || data.career.length > 0) && <ProgramSection program={data.program} career={data.career} />}
      {hasBadges && <BadgesSection badges={data.badges} milestones={data.milestones} />}
      <FooterCta />
    </main>
  )
}
```

Component notes (design pass fills in the rest, matching the approved mockup):
- **AthleteHero** (server): `bg-primary text-primary-foreground` with dual radial accent glows (background-image gradient recipe from `components/public/EventDetailHero.tsx`); `djp-eyebrow`-style overline "DJP ATHLETE PROFILE"; `Avatar`+`AvatarImage`+`AvatarFallback` (initials, `size-16`+); `font-heading` name with **surname in `text-accent`**; sport · position · experienceLevel line; mono glass pills (`font-mono bg-white/10 border border-white/20 rounded-full`) for `{heightCm} CM` / `{weightKg} {weightUnit.toUpperCase()}` / `AGE {age}` — each pill only when its value is non-null; "Training with DJP since {Month Year}" from `memberSince`.
- **StatTiles** (client): 4 tiles overlapping the hero bottom edge (negative margin), white cards `rounded-xl border border-border shadow`, count-up on scroll-into-view (adapt the `Counter` pattern from `components/public/AnimatedStats.tsx`); volume formatted compactly (`412300` → `412K`, `<1000` → raw; helper `formatCompact(n)` local to the component); labels: Workouts / Day Streak / PRs / KG Lifted.
- **RecordsSection** (server): two-column responsive grid "IN THE GYM" (`{valueKg} kg`) / "ON THE FIELD" (`{value} {unit}`); each row shows date (`Intl.DateTimeFormat en-GB month short + year`); accent ↑ chip when date within 30 days of now; a column with no rows collapses (grid becomes single column).
- **AthleteRadarSection** (client): compute per-category scores exactly like `components/client/profile/athlete-radar-card.tsx` (import `RADAR_CATEGORIES`, `normalize` from `@/lib/coach-intel/test-normalization`); render `null` (self-hide) when every category score is 0; Recharts `RadarChart` with `stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.3}`, `PolarGrid stroke="var(--border)"`.
- **ProgramSection** (server): current program card (`bg-surface rounded-xl`) with name, `WEEK {currentWeek} / {totalWeeks}` mono tag, gradient progress bar (`bg-gradient-to-r from-primary to-accent`, width `${Math.min(100, Math.round((currentWeek / totalWeeks) * 100))}%`), difficulty/categories/splitType caption (prettify snake_case → Title Case); "Career" list of completed programs with ✓ accent check + completed Month Year. Renders whichever of the two blocks has data.
- **BadgesSection** (server): tier shelf — circular medal per badge with tier ring (`gold: ring-yellow-500/70`, `silver: ring-zinc-400/60`, `bronze: ring-orange-700/40` — reuse the maps from `badge-shelf-card.tsx`), dynamic Lucide icon lookup (`(Icons as Record<string, ...>)[b.icon] ?? Icons.Award`); milestone rows below with the `AchievementCard` type→icon map (milestone→Star emerald, streak→Flame orange, completion→CheckCircle2 primary).
- **ProfilePrintButton** (client): fixed top-right, `print:hidden`, outline button → `window.print()`. NO auto-print (public page).
- **FooterCta** (server): dark `bg-primary` band, `public/logos/logo-icon-light.png` via `next/image`, "Train with Darren J Paul" link to `https://www.darrenjpaul.com/`.
- Mobile-first: single column below `md`; hero pills wrap; stat tiles 2×2 on mobile (`grid-cols-2 md:grid-cols-4`).
- Motion: `FadeIn` from `components/shared/FadeIn` around sections (staggered `delay`), never blocking first paint of the hero.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/athlete/athlete-profile-card.test.tsx`
Expected: 3 passed. (Recharts renders nothing measurable in jsdom — the radar's self-hide-on-empty makes these tests independent of it.)

- [ ] **Step 5: Commit**

```bash
git add app/athlete components/public/athlete __tests__/components/athlete
git commit -m "feat(profile-share): public Dark Arena athlete profile page at /athlete/[token]"
```

---

### Task 6: Dynamic OG share image

**Files:**
- Create: `app/athlete/[token]/opengraph-image.tsx`

**Interfaces:**
- Consumes: `resolve` logic pieces (Tasks 1/2/4).
- Produces: 1200×630 PNG for link unfurls; Next auto-wires it into the page metadata for the same route segment.

- [ ] **Step 1: Implement** (OG images live outside the CSS system — inline styles + brand hex are correct here; default font, no remote font fetch to keep unfurls reliable):

```tsx
// app/athlete/[token]/opengraph-image.tsx
import { ImageResponse } from "next/og"
import { verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { clientProfileShareEnabled } from "@/lib/profile-share/flags"
import { getAthleteProfileData } from "@/lib/profile-share/data"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const alt = "DJP Athlete Profile"

const PRIMARY = "#0E3F50"
const ACCENT = "#C49B7A"

export default async function OgImage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let data = null
  try {
    if (await clientProfileShareEnabled()) {
      const v = verifyAthleteProfileToken(token)
      if (v.valid) data = await getAthleteProfileData(v.clientUserId)
    }
  } catch {
    data = null
  }

  const name = data ? `${data.name.first} ${data.name.last}`.trim().toUpperCase() : "DJP ATHLETE"
  const subtitle = data
    ? [data.sport, data.position].filter(Boolean).join(" · ") || "Athlete Profile"
    : "Elite Sports Performance Coaching"
  const stats = data
    ? [
        { v: String(data.stats.workouts), l: "WORKOUTS" },
        { v: String(data.stats.prCount), l: "PRS" },
        { v: `${data.stats.streakDays}D`, l: "STREAK" },
      ]
    : []

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          backgroundColor: PRIMARY,
          backgroundImage: `radial-gradient(ellipse 55% 45% at 88% 0%, ${ACCENT}55, transparent 60%), radial-gradient(ellipse 45% 35% at 0% 100%, ${ACCENT}2e, transparent 60%)`,
          color: "#f2f6f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, color: ACCENT }}>
          DJP ATHLETE PROFILE
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.05 }}>{name}</div>
          <div style={{ display: "flex", fontSize: 34, color: "#ffffffbb" }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 40 }}>
            {stats.map((s) => (
              <div key={s.l} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: ACCENT }}>{s.v}</div>
                <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: "#ffffff99" }}>{s.l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#ffffff99" }}>darrenjpaul.com</div>
        </div>
      </div>
    ),
    size,
  )
}
```

- [ ] **Step 2: Verify via build** (no unit test — ImageResponse needs the edge/node runtime):

Run: `npm run build` (or defer to the Task 8 build) and hit `/athlete/<valid-token>/opengraph-image` on the dev server during Task 8 verification; expect a PNG.

- [ ] **Step 3: Commit**

```bash
git add "app/athlete/[token]/opengraph-image.tsx"
git commit -m "feat(profile-share): dynamic branded OG image for athlete profile links"
```

---

### Task 7: Admin "Share profile" dialog + wiring

**Files:**
- Create: `components/admin/profile-share/AthleteProfileLinkDialog.tsx`
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` (imports + generation block + Quick Actions row)
- Test: `__tests__/components/athlete/athlete-profile-link-dialog.test.tsx`

**Interfaces:**
- Consumes: `signAthleteProfileToken` (Task 1), `clientProfileShareEnabled` (Task 2), `QRCode.toDataURL` (existing `qrcode` dep), shadcn `Dialog`/`Button`.
- Produces: `<AthleteProfileLinkDialog qrDataUrl profileUrl clientName />`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/athlete/athlete-profile-link-dialog.test.tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { AthleteProfileLinkDialog } from "@/components/admin/profile-share/AthleteProfileLinkDialog"

describe("AthleteProfileLinkDialog", () => {
  it("opens and shows the share URL + QR", () => {
    render(
      <AthleteProfileLinkDialog
        qrDataUrl="data:image/png;base64,AAAA"
        profileUrl="https://www.darrenjpaul.com/athlete/tok123"
        clientName="Marcus Johnson"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share profile/i }))
    expect(screen.getByText(/darrenjpaul\.com\/athlete\/tok123/)).toBeInTheDocument()
    expect(screen.getByAltText(/athlete profile QR/i)).toBeInTheDocument()
  })

  it("copies the link", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <AthleteProfileLinkDialog qrDataUrl="data:image/png;base64,AAAA" profileUrl="https://x/athlete/t" clientName="M J" />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share profile/i }))
    fireEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith("https://x/athlete/t")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/athlete/athlete-profile-link-dialog.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the dialog** (model: `components/admin/packs/PersonalCheckinLinkDialog.tsx` — same Dialog/Image/copy patterns, `"use client"`, trigger `<Button variant="outline" size="sm"><Share2 className="size-4 mr-1.5" />Share profile</Button>`, body: QR `next/image` `unoptimized` 240×240 alt `Athlete profile QR for {first}`, mono URL line, Copy button with `toast.success("Link copied")`, caption "Anyone with this link can view {first}'s public athlete card. Links stay live while the feature is enabled.").

- [ ] **Step 4: Wire into the admin client page.** In `app/(admin)/admin/clients/[id]/page.tsx`:

Imports:

```tsx
import { signAthleteProfileToken } from "@/lib/profile-share/token"
import { clientProfileShareEnabled } from "@/lib/profile-share/flags"
import { AthleteProfileLinkDialog } from "@/components/admin/profile-share/AthleteProfileLinkDialog"
```

Generation block, directly below the existing personal check-in block (~line 652). The page already loads the client profile — find the existing `getProfileByUserId` result variable in this page and use its `is_minor`; if the page doesn't already load it, add `const shareProfile = await getProfileByUserId(id)` alongside:

```tsx
  // Public athlete-profile share link + QR (permanent HMAC, minors excluded).
  let athleteProfileUrl: string | null = null
  let athleteProfileQr: string | null = null
  if ((await clientProfileShareEnabled()) && !profileRow?.is_minor) {
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "https://www.darrenjpaul.com"
      athleteProfileUrl = `${base}/athlete/${signAthleteProfileToken(id)}`
      athleteProfileQr = await QRCode.toDataURL(athleteProfileUrl, { width: 320, margin: 1 })
    } catch (err) {
      console.error("Athlete profile link generation failed:", err)
      athleteProfileUrl = null
      athleteProfileQr = null
    }
  }
```

Quick Actions row (after the `PersonalCheckinLinkDialog` block, ~line 161 of the row):

```tsx
        {athleteProfileQr && athleteProfileUrl && (
          <AthleteProfileLinkDialog
            qrDataUrl={athleteProfileQr}
            profileUrl={athleteProfileUrl}
            clientName={`${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email}
          />
        )}
```

(`base64url` and `.` are URL-safe — no `encodeURIComponent` needed for a path segment.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/components/athlete/athlete-profile-link-dialog.test.tsx`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add components/admin/profile-share "app/(admin)/admin/clients/[id]/page.tsx" __tests__/components/athlete/athlete-profile-link-dialog.test.tsx
git commit -m "feat(profile-share): admin Share profile dialog with QR on client page"
```

---

### Task 8: Verification (build, targeted tests, live click-through)

- [ ] **Step 1: Targeted test sweep**

Run: `npx vitest run __tests__/lib/profile-share-token.test.ts __tests__/lib/profile-share-flags.test.ts __tests__/lib/profile-share-dal.test.ts __tests__/lib/profile-share-data.test.ts __tests__/components/athlete/`
Expected: all green.

- [ ] **Step 2: Type/build check**

Run: `npm run build`
Expected: compiles; grep output for `app/athlete` route + `opengraph-image` registration. (tsc noise from `.next`/tests is pre-existing — judge only new-file errors.)

- [ ] **Step 3: Live click-through** (dev server on :3050; Playwright MCP)
  1. Enable flag: `system_settings` upsert `client_profile_share_enabled = true` (prod DB — safe pre-deploy: prod build has no `/athlete` route yet; set back to `false` after).
  2. Log into `/admin`, open a real client, verify the **Share profile** button renders; open dialog; copy link.
  3. Open the copied `/athlete/<token>` URL logged-out: hero, stats count-up, records, program, badges render; empty sections absent.
  4. Tamper one char of the token → 404. Flip flag off → 404 (then back on for remaining checks, off at the end).
  5. Hit `/athlete/<token>/opengraph-image` → PNG renders.
  6. Print preview (`window.print()` via button) → card content visible, button hidden.
  7. Mobile viewport (390×844) pass — no horizontal scroll.
  8. **Set the flag back to `false`** when done.

- [ ] **Step 4: Commit any fixes; leave everything committed on main, NOT pushed.**

---

## Self-review notes (spec ↔ plan)

- Spec sections → tasks: token/flag/404s (T1/T2/T5), data table incl. corrections (T3/T4), UI section order + empty states + units (T5), OG (T6), print (T5 button + existing `.print-document` CSS), admin dialog + minors (T7), testing (T1-T5, T7, T8). Attribution/audit: no code — `captureAttribution` already runs on all non-gated routes; audit intentionally dropped (spec correction).
- `weightUnit` is display-only (`weight_kg` shown with the client's preferred unit label — values are stored in kg; if `weight_unit === "lbs"`, convert for display in `AthleteHero`: `Math.round(weight_kg * 2.20462)` LBS).
- Types cross-checked: `Achievement.metric_value: number | null`, `PerformanceTestPR.test_date: string`, `Badge.icon` is a Lucide name string, `ProgramAssignment.current_week: number`.

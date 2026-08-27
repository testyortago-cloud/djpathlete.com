# Exercise blocklist for AI generation — design

**Date:** 2026-08-28
**Branch:** `worktree-exercise-blocklist` (off `origin/main` at `45beffb4`)
**Status:** approved in chat, ready for an implementation plan

## 1. The report

From the coach, over WhatsApp:

> the ai exercise day generator just ain't producing the goods mate. Regardless of the
> instructions I give or who I give it to. Suitcase carry, weighted Deadbug, reverse
> shoulder plank and a good few more just always appear in all of them

Two fixes were proposed in that thread — a blocklist ("adding a blocked exercise is better
since it won't repeat it again when generating") and better categorising the library. This
spec builds the blocklist. §8 records why the second one is still needed and is not this
feature.

## 2. What the data says

Measured against the dev clone (917 exercises, usage log through 2026-07-16). Structure
matches prod; the row counts will differ slightly.

```
movement_pattern counts (917 exercises)
  rotation 177 · isometric 166 · lunge 138 · push 133 · pull 93
  hinge 77 · squat 67 · locomotion 55 · (null) 7 · carry 4
```

**The three named exercises fail for two different reasons.**

*Suitcase carry is scarcity.* The four `carry` rows are `Offset cable steps_Core`,
`Barbell shoulder take outs_Shoulder`, `Cable rear hip abduction_Hip`, and
`Suitcase carry-Core`. Three of those four are mis-tagged — a cable rear hip abduction is
not a carry. So the moment the architect plans a slot with `movement_pattern: carry`, the
library holds exactly one sensible answer. It is the single most-assigned exercise in the
usage log.

*Weighted deadbug and reverse shoulder plank are ranking.* Both are `isometric`, competing
against 165 others. They win on score, every run.

**The mechanism behind both: nothing in the pipeline hard-removes an exercise.**

- [`applyUsagePenalty`](../../../functions/src/ai/exercise-filter.ts) docks −30 (coach used
  in 60d) / −50 (client used in 90d). That only *reorders* a shortlist of 111–137 out of
  917. A penalised exercise still reaches the Exercise Selector agent, which still picks it.
- `ensurePatternBalance` then re-injects exercises for under-filled patterns scoring **only
  equipment and difficulty** — no usage penalty, no jitter. A carry slot pulls all four
  carries back in, unpenalised, every run.
- `seededJitter` is ±8 against similarity scaled 0–100. It breaks ties; it cannot dislodge
  a leader.
- Coach instructions reach exclusion only via `extractInstructionIntent`, which produces a
  ban when the coach *names an exercise as an exclusion* — and it lasts one generation.
  "Make it varied" resolves to nothing. This is why "regardless of the instructions I give".

Net effect: a 1000-row sample of the usage log contains just 290 distinct exercises. The
generator works from a narrow slice of a 917-exercise library.

## 3. Scope decisions

| Question | Decision |
|---|---|
| Block scope | Studio-wide **and** per-client, unioned at generation |
| Where blocks are added | The ⊘ on an exercise row in a generated day/week |
| Where blocks are reviewed / undone | AI Policy page (studio-wide) + client detail screen (per-client) |
| Starvation behaviour | Warn at block time, re-route the slot at generation |
| Integration depth | Generation only — manual picking and existing programs untouched |

Rejected: greying blocked exercises out of manual pickers (takes a control away from the
coach on screens that have nothing to do with AI), and a retroactive sweep of live programs
(writes to workouts clients are actively doing — a much larger, separate piece).

**Two consequences, confirmed with the owner:**

- A block never touches an existing program. Block Suitcase carry today and Monday's
  already-generated day still has it. Only the next generation changes.
- Blocking is not deleting. The exercise stays in the library, stays manually pickable,
  stays visible in old programs.

## 4. Data model

New table, migration `00232_exercise_blocks.sql`:

```sql
CREATE TABLE exercise_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES users(id) ON DELETE CASCADE,   -- NULL = studio-wide
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  reason      TEXT,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ux_exercise_blocks_studio
  ON exercise_blocks (coach_id, exercise_id) WHERE client_id IS NULL;
CREATE UNIQUE INDEX ux_exercise_blocks_client
  ON exercise_blocks (coach_id, client_id, exercise_id) WHERE client_id IS NOT NULL;

CREATE INDEX idx_exercise_blocks_lookup ON exercise_blocks (coach_id, client_id);
```

**Two partial unique indexes, not one constraint.** `UNIQUE (coach_id, client_id,
exercise_id)` does not stop duplicate studio-wide blocks, because NULL never equals NULL in
a unique index. Every studio-wide press of ⊘ would insert another row.

**`exercise_id` is a real FK with cascade.** Delete an exercise and its blocks go with it.
This is the reason not to bolt a `blocked_exercise_ids JSONB` array onto `coach_ai_policy`:
an array of UUIDs accumulates dangling ids silently and cannot carry a reason or a date.

No RLS, matching `coach_ai_policy` — every read goes through the service-role DAL. Keyed on
`coach_id` rather than a singleton so it survives the multi-coach direction.

> **Migration number check.** `00232` is next as of this branch point. Numbers collide
> silently across branches and git merges the collision clean. Re-verify before merge;
> renumbering is free only before the push.

## 5. Generation integration

A twin helper, per the `functions/` ↔ `lib/` boundary rule in CLAUDE.md (`functions/` has
`rootDir: "src"` and cannot import from `lib/`):

- `lib/db/exercise-blocks.ts`
- `functions/src/lib/exercise-blocks.ts`

Both expose:

```ts
getBlockedExerciseIds(coachId: string, clientId: string | null): Promise<Set<string>>
```

One query returning studio-wide rows (`client_id IS NULL`) unioned with that client's. When
`clientId` is null, studio-wide only. A failed read returns an empty set and logs — a
blocklist outage must degrade to today's behaviour, never fail a generation.

It joins the existing `Promise.all` context fetch in both orchestrators and unions into the
set they already build:

```ts
// functions/src/ai/week-orchestrator.ts (~:911) and functions/src/ai/orchestrator.ts (~:619)
const excludeIds = new Set([
  ...resolveCrossDayExcludeIds(priorContext, VARIETY_ROLES, poolActive),
  ...intentResolution.bannedIds,
  ...blockedIds,          // never relaxed
])
```

`excludeIds` is the right hook because it is already honoured by every path that could
resurrect an exercise: the semantic filter, the heuristic fallback, the preferred/strict
pool rescue injection, and the `ensurePatternBalance` backfill.

### 5.1 Three edges that will break if handled naively

**Blocks are never relaxed for strict pool mode.** `resolveCrossDayExcludeIds` is
deliberately relaxed when `poolActive`, so a small curated pool can recur across days.
Blocks must not be — a block is an explicit coach instruction and outranks the pool.

**Which means the pool can be emptied by blocks.** The "Exercise Pool matched no usable
exercises" guard at `week-orchestrator.ts:891` runs *before* `excludeIds` is built at
`:911`. A five-exercise pool that is entirely blocked passes that check and dies later with
a worse error. The guard moves below the union, and its message gains blocks as a named
cause alongside removed exercises and the injury filter.

**The starvation re-route needs its input changed, not just its condition.**
`remapUncoveredSlotPatterns` today runs only `if (poolActive)` and receives
`exercisesForSelection` — the library *before* `excludeIds` is applied — so it cannot see
that `carry` just went empty. Both need fixing:

- run it when `poolActive || blockedIds.size > 0`
- hand it the block-pruned candidate set

`ensurePatternBalance` is already safe: it receives the exclude-pruned pool, so its backfill
cannot resurrect a blocked exercise. This gets a test anyway — it is the one path in the
filter that ignores usage penalties, and it would otherwise be the leak.

## 6. Surfaces

### 6.1 The ⊘ on the exercise card

`components/admin/ExerciseCard.tsx` already renders a Trash2 remove button in a control row
(~:134). The block sits beside it as a `Ban` icon, opening a dialog:

> **Block Suitcase carry-Core?**
> The AI won't program this again. It stays in your library and stays in programs you've
> already built.
> ◉ For every client  ○ For Marcus only
> Reason (optional): ______
> `[Cancel] [Block]`

"For *name* only" renders only when the program has an assigned client. On confirm the row
stays exactly where it is — the copy says so, so nobody expects it to vanish.

The starvation warning appears inline, before the coach commits:

> ⚠ This is the last usable *carry* in your library. Days that ask for a carry will fall
> back to a related movement.

### 6.2 Studio-wide list — `/admin/settings/ai-policy`

A "Blocked exercises" card under the existing disallowed-techniques control, built with
`components/ui/data-table.tsx` per the house standard. Columns: exercise, movement pattern,
reason, blocked on, Unblock. The page's summary strip already holds four tiles in a
`lg:grid-cols-4` grid; it gains a fifth counting blocks, and the grid widens to
`lg:grid-cols-5`.

### 6.3 Per-client list — client detail screen

Same table, that client's rows only, directly under "Injuries & Limitations"
(`app/(admin)/admin/clients/[id]/page.tsx` ~:452) — it reads as the continuation of the
injury data that usually motivated the block.

Both lists are read-and-remove only. Adding stays on the ⊘.

## 7. Routes, audit, testing

**Routes**, both wrapped in `withAudit()`:

- `POST /api/admin/exercises/blocks` — `{ exercise_id, client_id?, reason? }`. Idempotent:
  re-blocking something already blocked returns the existing row, not a 409, because the ⊘
  is a one-click control and a double press should not read as an error. The response
  carries the starvation flag so the dialog can warn.
- `DELETE /api/admin/exercises/blocks/[id]`

**Audit.** Two new slugs in the closed taxonomy at `lib/audit/actions.ts`:
`exercise_block.added` and `exercise_block.removed`, category `admin_write`, following the
`exercise.*` rows at lines 38–40.

**Starvation check.** Given an exercise, count exercises sharing its `movement_pattern` that
are not already blocked for the target scope. Zero remaining ⇒ warn. Runs on dialog open
(to show the warning) and again in the POST (so the answer reflects the moment of writing).

**Tests.**

- The union: a studio-wide block and a per-client block both reach `excludeIds`.
- A block survives `poolActive` when cross-day exclusion is relaxed.
- The empty-pool guard fires *after* the union and names blocks.
- `ensurePatternBalance` cannot backfill a blocked exercise.
- `remapUncoveredSlotPatterns` fires on a block-emptied pattern with no pool active.
- Route: idempotent re-block; scope split; a client-scoped block does not leak to another
  client.
- DAL read failure degrades to an empty set rather than throwing.

Targeted runs plus `tsc --noEmit`. Not the full suite — the change is not cross-cutting.

**Verification.** Annotated screenshots driven through the real app: the ⊘ dialog on a real
generated day, the starvation warning on a real carry, and both review lists with real rows.
Admin is light-only, so light only. Deliverable in `screenshots/exercise-blocks/`.

## 8. Explicitly out of scope

**This does not fix Suitcase carry.** Blocking it leaves three mis-tagged carries behind,
and the re-route then sends carry slots to a neighbouring pattern. Getting a real carry back
means re-tagging `Cable rear hip abduction_Hip` and the other two — a library data job, not
a code one. `movement_pattern` is already editable in
`components/admin/ExerciseFormDialog.tsx` (~:1082).

Also out of scope: retroactively replacing blocked exercises in live programs (§3), and
raising `seededJitter` or reweighting `applyUsagePenalty` — both are real contributors to
the repetition, but tuning them is a separate change with its own evidence needs.

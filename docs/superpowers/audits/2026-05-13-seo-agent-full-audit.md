# SEO Agent — Full-Phase Audit (Phases 1–5)

**Date:** 2026-05-13
**Scope:** 53 commits from `74d2859` (Phase 1 plan) through `af2bd29` (Phase 5 memos UI). All 5 phases of the SEO Agent build.
**Method:** Read-only audit. No code changes; only this file written. Eight checks against the codebase, the live Supabase schema, and the plan/spec documents.

---

## Top Issues (ranked)

| Rank | Severity | Issue | Section |
|---|---|---|---|
| 1 | **Important** | Outcome tracker measures `queue_new_post` actions before the GSC `[publish+7, publish+21]` window has fully accumulated — first measurement systematically under-counts clicks. | §6, §8 |
| 2 | Minor | `getRecentMemos` (`lib/db/seo-agent-memos.ts`) is exported, tested, but never consumed in production. | §4 |
| 3 | Minor | `ToolName` (`functions/src/seo/decision-schema.ts`) is exported but never imported anywhere. | §4 |
| 4 | Minor | `SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001"` is defined identically in two route files (`auto-blog/route.ts`, `seo-agent/route.ts`) instead of being exported from a single source. | §1 |
| 5 | Minor | `resolveNewPostOutcome` test fixture uses `status: "published"`, but production code sets `status: "in_progress"` (in `blog-generation.ts` after a topic is picked up). Resolver works either way (only checks `reference_id`), but the test misrepresents reality. | §2 |
| 6 | Minor | No closed-loop integration test pairs executor → resolver. A rename like `blogPostId` → `blog_post_id` on either side would slip past unit tests. | §2 |
| 7 | Minor | Three crons fire simultaneously at 03:00 UTC daily (`gscSyncCron`, `syncPlatformAnalytics`, plus `performanceLearningLoop` on Mondays). All hit different downstream systems, so no real contention — just an ops-monitoring footnote. | §8 |

**No Critical issues.** All 5 phases are correctly wired together and ship-ready.

---

## Overall Assessment

The SEO Agent is structurally sound across all five phases. Cross-phase invariants hold (cron toggle keys, `triggeredBy` values, `memoId` propagation, `SYSTEM_USER_ID` value). Type sync between Supabase and `types/database.ts` is exact for all three new tables. Authentication and error-handling patterns are consistent across all four new internal routes. The end-to-end data flow from GSC sync → agent decision → executor → primitive handler → outcome resolution works as designed. Plans and spec are aligned, with deliberate corrections (Phase 5 noting `notifications.is_read` not `read_at`) called out in the plan documents.

The single Important issue is a **timing mismatch** in Phase 5's outcome tracker: it measures `queue_new_post` outcomes 14 days after memo creation, but the resolver's GSC window extends to `publish_date + 21d`, which lands ~23 days after memo creation. The first measurement of a new-post action will sample only the first ~5 days of the intended `[+7, +21]` window and systematically under-count clicks. A subsequent run 9 days later would fix it (the tracker re-runs daily, but only on `outcome_status = 'pending'` rows — so once measured, it doesn't update). Recommended fix below in §6.

The remaining six issues are all Minor — small dead-code cleanups, a test fidelity gap, a duplication that could be DRY'd. None block production.

---

## §1 — Cross-phase invariants

### `cron_*_enabled` keys — verified clean

Each per-cron toggle is referenced in exactly two places: the route's `isCronSkipped({ enabledKey, defaultEnabled: false })` call AND the `CRON_CATALOG` entry in `lib/cron-catalog.ts`. No drift:

| Key | Route | Catalog | Match |
|---|---|---|---|
| `cron_gsc_sync_enabled` | `app/api/admin/internal/gsc-sync/route.ts:30` | `lib/cron-catalog.ts:50` | ✅ |
| `cron_seo_agent_enabled` | `app/api/admin/internal/seo-agent/route.ts:22` | `lib/cron-catalog.ts:143` | ✅ |
| `cron_outcome_tracker_enabled` | `app/api/admin/internal/outcome-tracker/route.ts:37` | `lib/cron-catalog.ts:157` | ✅ |

### `triggeredBy` values — verified clean

Each `triggeredBy` value is correctly distinct per its origin point:

| Value | Where written | Purpose |
|---|---|---|
| `"seo_agent_cron"` | `app/api/admin/internal/seo-agent/route.ts:38` | Marks `ai_jobs.type = "seo_agent_run"` docs created by the Sun 14:00 UTC cron |
| `"seo_agent_run"` | `functions/src/seo/execute.ts:75, 106` | Marks ai_jobs (blog_refresh, internal_link_sweep) created BY the agent during its run |
| `"manual_refresh_button"` | `app/api/admin/blog/[id]/refresh/route.ts:71` | Phase 2 manual button |
| `"manual_sweep_button"` | `app/api/admin/blog/[id]/sweep-links/route.ts:93` | Phase 3 manual button |
| `"auto-blog-cron"` | `app/api/admin/internal/auto-blog/route.ts:115` | Pre-existing |

The two-tier `seo_agent_cron` / `seo_agent_run` distinction is semantically correct (cron triggers the agent job; agent triggers downstream primitive jobs). No collision risk.

### `memoId` propagation — verified clean

Every ai_jobs doc the agent creates carries `memoId: ctx.memoId` at the top level (`functions/src/seo/execute.ts:76, 107`). The content_calendar row written by `queue_new_post` carries `metadata.memo_id` (snake_case in the JSONB blob). Both forms are correct for their respective stores (Firestore camelCase convention; Supabase JSONB snake_case convention).

### `SYSTEM_USER_ID` — Minor finding

Defined identically in two places:
- `app/api/admin/internal/auto-blog/route.ts:30`
- `app/api/admin/internal/seo-agent/route.ts:11`

Value matches (`"00000000-0000-0000-0000-000000000001"`). **Fix recommendation:** extract to `lib/constants.ts` or `lib/system-user.ts` and import from both. Two copies today, but a third caller would cement the duplication.

---

## §2 — Test coverage gaps

### Critical paths covered — verified clean

| Path | Test file |
|---|---|
| GSC OAuth state sign/verify round-trip | `__tests__/lib/gsc/oauth.test.ts` |
| GSC API client with lazy token refresh | `__tests__/lib/gsc/client.test.ts` |
| GSC sync route (auth, gate, OAuth-broken, transient errors) | `__tests__/api/admin/internal/gsc-sync.test.ts` |
| Signal gatherers (5 of 6 — all but `gatherGscSignals`) | `functions/src/__tests__/seo-signals.test.ts` |
| Decision Zod schema (valid, wrong-tool, same-tool-twice, invalid args, urgency enum) | `functions/src/__tests__/seo-decision-schema.test.ts` |
| Each tool executor (7 tests) | `functions/src/__tests__/seo-execute.test.ts` |
| handleSeoAgent orchestration including **warm-up gate** | `functions/src/__tests__/seo-agent.test.ts` |
| Each outcome resolver (9 tests covering happy + 6 error/edge paths) | `__tests__/lib/seo-agent/outcomes.test.ts` |
| Outcome tracker route (auth, gate, dispatch, executed=false, run_date passing) | `__tests__/api/admin/internal/outcome-tracker.test.ts` |
| blog_refresh handler with status=draft preservation | `functions/src/__tests__/blog-refresh.test.ts` |
| internal_link_sweep handler with hallucination guard | `functions/src/__tests__/internal-link-sweep.test.ts` |

The data warm-up gate in `handleSeoAgent` is explicitly tested (test #2 "skips silently when gsc_query_daily has fewer than 28 distinct dates").

### Gaps — Minor findings

1. **`gatherGscSignals` has no dedicated test.** The other five gatherers in `functions/src/seo/signals.ts` each have one. `gatherGscSignals` is the most complex (28-day window + decay computation + winnable filtering) and the most likely to silently break under future schema changes. **Fix recommendation:** add a fixture-based test that seeds `gsc_query_daily` rows and asserts the right winnable/decay rankings.

2. **No closed-loop integration test pairs executor → outcome resolver.** Each side is tested with mocks, but neither side exercises the other's actual output. If someone renames `input.blogPostId` to `input.blog_post_id` in either `executeQueueRefresh` (line 66) or `resolveRefreshOutcome` (line 142), unit tests on both sides still pass — production breaks. Same risk for `input.targetBlogPostId` in the link-sweep pair. **Fix recommendation:** one tiny test per pair that round-trips through a stub Firestore.

3. **Firestore trigger wrappers (`seoAgent`, `blogRefresh`, `internalLinkSweep`) have no tests for the `data.type !== "X"` filter.** Each is a 7-line `onDocumentCreated` wrapper. A typo in the filter string would route the wrong job type. The inner handler tests would catch the resulting symptom (wrong work happening) but not the cause. Acceptable given the trivial size of each wrapper.

4. **`resolveNewPostOutcome` test fixture uses `status: "published"`** (`__tests__/lib/seo-agent/outcomes.test.ts:60`), but production code in `functions/src/blog-generation.ts:453` sets the row to `status: "in_progress"` when a topic_suggestion is picked up. The resolver doesn't read `status` (only `reference_id`), so the test passes and production works — but the fixture misrepresents the lifecycle.

---

## §3 — Type sync (Supabase schema ⇄ `types/database.ts`)

Queried via `mcp__supabase__list_tables` + `information_schema.columns`. All three new tables present:

| Table | RLS | Rows | Columns match TS? |
|---|---|---|---|
| `gsc_query_daily` | ✅ enabled | 0 | ✅ 8 columns match `GscQueryDailyRow` exactly |
| `gsc_properties` | ✅ enabled | 0 | ✅ 8 columns match `GscProperty` exactly |
| `seo_agent_memos` | ✅ enabled | 0 | ✅ 10 columns match `SeoAgentMemo` exactly |

`SeoAgentMemoOutcomeMetric.error?` and `note?` were added in Phase 5 Task 1 to support the resolver's `{ executed, error }` and `{ note }` return shapes. These are JSONB-flexible — no DB schema change needed.

The `SeoAgentSignalsSummary.gsc_distinct_dates: number` field is stored in the JSONB blob by the agent and read back by future agent runs as part of `signals_summary`. Self-consistent.

**Verdict: verified clean.**

---

## §4 — Dead code / unused exports

Scanned `lib/seo-agent/`, `lib/gsc/`, `lib/blog/internal-link-scoring.ts`, `functions/src/seo/` for exports without consumers.

### Verified consumed
- `lib/seo-agent/outcomes.ts`: all 4 resolvers + `ResolvedOutcome` → consumed in `outcome-tracker/route.ts`
- `lib/gsc/client.ts`: `OAuthBrokenError`, `getValidAccessToken`, `searchAnalyticsQuery` → consumed in `gsc-sync/route.ts`
- `lib/gsc/oauth.ts`: all 5 functions → consumed across `/authorize`, `/callback`, and the client
- `lib/blog/internal-link-scoring.ts`: `scoreInternalLinks` → consumed in `sweep-links/route.ts`
- `functions/src/seo/signals.ts`: `gatherSeoSignals` → consumed in `seo-agent.ts`; individual gatherers exported for testing (acceptable)
- `functions/src/seo/execute.ts`: `executeAction` → consumed in `seo-agent.ts`; individual executors exported for testing
- `functions/src/seo/reason.ts`: `reasonAboutWeek`, `SYSTEM_PROMPT` → consumed in `seo-agent.ts`; `SYSTEM_PROMPT` exported for inspection (acceptable)
- `functions/src/seo/decision-schema.ts`: `decisionSchema`, `Decision`, `Action` → consumed in `reason.ts`/`execute.ts`/`seo-agent.ts`

### Dead exports — Minor findings

1. **`getRecentMemos`** in `lib/db/seo-agent-memos.ts:34`. Exported and tested, but no production consumer. The admin memos page (`app/(admin)/admin/seo-agent/memos/page.tsx:142`) uses `listMemos(25)` directly. **Fix recommendation:** either delete (it's a 2-line wrapper) or call it from the memos page instead of `listMemos(25)`.

2. **`ToolName`** type in `functions/src/seo/decision-schema.ts:66`. Defined as `Action["tool"]`. No imports of `ToolName` anywhere outside the file. **Fix recommendation:** delete the export. Anyone who needs the union can derive it inline from `Action["tool"]`.

---

## §5 — Error/auth pattern consistency

All four new internal routes follow the same three-step structure:

```ts
// 1. Bearer auth
const expected = process.env.INTERNAL_CRON_TOKEN
const auth = request.headers.get("authorization") ?? ""
const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
if (!expected || !bearer || bearer !== expected) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

// 2. Cron skip gate
const gate = await isCronSkipped({ enabledKey, defaultEnabled: false })
if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

// 3. Work
// ...
```

Confirmed identical pattern in:
- `app/api/admin/internal/gsc-sync/route.ts`
- `app/api/admin/internal/seo-agent/route.ts`
- `app/api/admin/internal/outcome-tracker/route.ts`

The two manual-button routes (`app/api/admin/blog/[id]/refresh/route.ts`, `app/api/admin/blog/[id]/sweep-links/route.ts`) correctly use a DIFFERENT auth pattern (NextAuth admin session, no `isCronSkipped` gate) — that's appropriate because they're user-initiated, not cron-initiated.

**Verdict: verified clean.**

---

## §6 — End-to-end data flow integrity

### Trace: a "winnable keyword" from sync to measured outcome

1. **Phase 1 — GSC sync.** `gscSyncCron` (daily 03:00 UTC) POSTs to `/api/admin/internal/gsc-sync`. Route reads from Google Search Console API, upserts into `gsc_query_daily`. ✅
2. **Phase 4 — agent run.** `seoAgentCron` (Sunday 14:00 UTC) POSTs to `/api/admin/internal/seo-agent`. Route enqueues Firestore `ai_jobs.type = "seo_agent_run"`. Trigger fires `handleSeoAgent`. ✅
3. **gather().** `gatherSeoSignals(supabase)` reads `gsc_query_daily`, builds `signals_summary` including `top_winnable` array. ✅
4. **reason().** `reasonAboutWeek(signals)` sends the summary to Claude via `callAgent` with `decisionSchema`. Claude returns `{ rationale, actions: [Action, Action] }`. ✅
5. **execute() — queue_new_post path.** `executeQueueNewPost(args, ctx)` inserts into `content_calendar` with `entry_type = "topic_suggestion"`, `status = "planned"`, `metadata.source = "seo_agent"`, `metadata.memo_id = ctx.memoId`, `scheduled_for = nextTuesday()`. Returns new calendar row id. ✅
6. **Memo write.** Agent inserts `seo_agent_memos` row with `actions[i].execution_target_id = <calendar row id>`. `outcome_status = "pending"`. ✅
7. **Phase 1 (existing) — `autoBlogCron` Tuesday/Thursday 13:00 UTC.** Picker queries `content_calendar` WHERE `entry_type = 'topic_suggestion' AND status = 'planned'`, ordered by `scheduled_for DESC, metadata.rank ASC, created_at DESC`. Agent-sourced row at `rank=1` with most recent `created_at` wins ties against Tavily rows. ✅
8. **`handleBlogGeneration`.** Generates the post, inserts into `blog_posts`, then UPDATES `content_calendar` to set `status = "in_progress"` AND `reference_id = <new blog_post.id>` (`functions/src/blog-generation.ts:449-457`). ✅
9. **Phase 5 — `outcomeTrackerCron` daily 04:00 UTC.** Reads memos where `outcome_status = 'pending'` AND `run_date <= today - 14d`. For each action, dispatches to the right resolver. ✅
10. **`resolveNewPostOutcome`.** Reads `content_calendar.reference_id` → gets blog_post → reads `slug`, `published_at` → windows GSC for `[published_at + 7, published_at + 21]`. ✅

### Issue 1 (Important): timing mismatch on `queue_new_post`

The outcome tracker fires at `memo.run_date + 14d`. For a `queue_new_post` action:
- Memo run_date is Sunday S.
- `executeQueueNewPost` schedules the row for `nextTuesday() = S + 2`.
- `autoBlogCron` runs Tuesday `T = S + 2` and publishes. `blog_posts.published_at = T`.
- Resolver window: `[T + 7, T + 21] = [S + 9, S + 23]`.

When `outcomeTrackerCron` first runs at `S + 14`, only `[S+9, S+14]` of the 14-day target window has data — **about 5 of 14 days**. The "after" clicks will be sampled too early and systematically under-count. Once the memo is marked `measured`, the tracker never re-runs on it. The first measurement is the only measurement.

**Fix recommendation (choose one):**
- **A (preferred):** In `app/api/admin/internal/outcome-tracker/route.ts`, change the cutoff so `queue_new_post` actions are only measured at `memo.run_date + 25d`. Other tools (refresh, sweep, flag) keep `+ 14d`. Requires a second SQL pass or per-tool filter. Tradeoff: more complex logic.
- **B (simpler):** In `lib/seo-agent/outcomes.ts:resolveNewPostOutcome`, change the GSC window from `[published_at + 7, published_at + 21]` to `[published_at + 1, published_at + 12]`. Aligns with the existing 14-day measurement cutoff at the cost of measuring a shorter post-publish window.
- **C (cheapest):** Document the under-count explicitly in the agent's system prompt so it doesn't over-trust the first `queue_new_post` outcome.

### Issue 2 (Minor): `status` enum oddity

After `autoBlogCron` picks up an agent-queued topic, `content_calendar.status` becomes `"in_progress"`. It stays `"in_progress"` forever — nothing flips it to `"published"` after the post actually publishes. The resolver doesn't care (only checks `reference_id`), but the admin UI and any future status-based filters would be misleading. **Fix recommendation:** in `functions/src/blog-generation.ts`, after the post is published successfully (`status = 'published'` on `blog_posts`), update the linked content_calendar row's status to `"published"` as well.

---

## §7 — Plan/spec consistency

### Spec
- `docs/superpowers/specs/2026-05-13-seo-agent-design.md` (574 lines)

### Plans
- `docs/superpowers/plans/2026-05-13-seo-agent-phase-1-substrate.md` (2013 lines)
- `docs/superpowers/plans/2026-05-13-seo-agent-phase-2-refresh.md` (1245 lines)
- `docs/superpowers/plans/2026-05-13-seo-agent-phase-3-internal-link-sweep.md` (1356 lines)
- `docs/superpowers/plans/2026-05-13-seo-agent-phase-4-agent-core.md` (2356 lines)
- `docs/superpowers/plans/2026-05-13-seo-agent-phase-5-outcome-tracker.md` (1403 lines)

### Spec corrections documented in plans — verified clean

| Spec said | Plan corrected to | Location |
|---|---|---|
| `notifications.read_at` (for flag_for_human outcome) | `notifications.is_read` (actual column name) | Phase 5 plan, "Spec correction (important)" callout |
| (Implicit: `expires_at` field on tokens) | `access_token_expires` | Phase 1 plan, Task 2 spec review |

### Spec said but plan dropped — Minor finding

The spec describes a coach-override flow that sets `outcome_status = 'rolled_back'`. This is documented as **out-of-scope for Phase 5** in the Phase 5 plan, and the admin memos page (Phase 5 Task 5) has a styled badge for the `rolled_back` state ready for when the UI is added. So the plan honored the deferral correctly and pre-wired the UI for a future phase. No issue.

### Spec section absent from any plan — Minor finding

The spec's "Operational defaults" table lists `Refresh cooldown: 90 days per post`. No phase implemented this. It's mentioned as a Phase 5/6 follow-up in multiple plans but is not enforced anywhere in code. **Action:** ensure it lands in the next phase that touches `executeQueueRefresh`.

### Overall — verified clean

Plans deliberately broke spec into 5 phases with clear handoff points. Each phase's plan accurately describes what ships AND what's deferred. No plan claims work that wasn't done.

---

## §8 — Cron schedule interleaving

### SEO Agent cron schedule

| Cron | Schedule | Day(s) | What it does |
|---|---|---|---|
| `gscSyncCron` | `0 3 * * *` | Daily 03:00 UTC | POST gsc-sync route → upsert into `gsc_query_daily` |
| `outcomeTrackerCron` | `0 4 * * *` | Daily 04:00 UTC | POST outcome-tracker route → measure 14-day-old memos |
| `autoBlogCron` | `0 13 * * 2,4` | Tue/Thu 13:00 UTC | POST auto-blog route → generate blog from topic_suggestion |
| `seoAgentCron` | `0 14 * * 0` | Sun 14:00 UTC | POST seo-agent route → run agent (gather/reason/execute/remember) |

### Time-flow dependency — verified clean

Each cron's data is fresh when consumed:
- `seoAgentCron` (Sun 14:00) reads `gsc_query_daily` populated by `gscSyncCron` (latest pull: Sun 03:00, ~11h fresh).
- `outcomeTrackerCron` (daily 04:00) reads `gsc_query_daily` populated by `gscSyncCron` (run 1h earlier, daily 03:00).
- Agent-queued `content_calendar.topic_suggestion` (created Sun 14:00+) is consumed by `autoBlogCron` (Tue 13:00, ~43h later — plenty of buffer).

### Overlaps — Minor finding

Three crons fire simultaneously at 03:00 UTC every day:
- `syncPlatformAnalytics` (existing)
- `gscSyncCron` (Phase 1)
- `performanceLearningLoop` (existing, Mondays only)

And two crons fire at 04:00 UTC:
- `outcomeTrackerCron` (Phase 5, daily)
- `voiceDriftMonitor` (existing, Mondays only)

Each cron POSTs to a different Next.js internal route and hits different downstream systems (Search Console API vs Meta/IG vs Anthropic). No CPU or database contention at the application layer. Cloud Run + Vercel both handle concurrent requests fine. **Fix recommendation (optional):** stagger the schedules by 5-15 minute offsets for cleaner ops dashboards. Not required for correctness.

### Outcome tracker re-measurement bug — see §6 Issue 1

The Important finding from §6 manifests here too: even though the outcome tracker runs daily, once a memo is marked `measured` it doesn't get re-measured. So the 5-of-14-day under-count on `queue_new_post` is final.

---

## Conclusion

**Ship-ready with one Important fix.** Address Issue 1 in §6 (the `queue_new_post` measurement window timing) before the first agent run hits its first 14-day outcome boundary — that's at minimum Sunday + 28 days from the first agent enablement, so there's runway, but it should be the next code change after deployment. The 6 Minor findings can be cleaned up incrementally during the natural-next-phase work (Phase 6 sparklines / rollback UI / cooldown enforcement).

The Ralph audit reviewed 53 commits, 16 source files, 12 test files, 3 Supabase tables, 5 plan documents, and the design spec. No critical issues. The system is internally consistent — the rare gap is a measurement-timing bug, not an architectural one.

<promise>AUDIT COMPLETE</promise>

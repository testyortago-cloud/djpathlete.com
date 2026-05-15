# Social Agent Multi-Platform — Design

**Date:** 2026-05-16
**Status:** Design (pre-plan). Solo-dev project; commits land on `main`.
**Related:**
- [2026-05-15-closing-the-learning-loop-design.md](2026-05-15-closing-the-learning-loop-design.md) — confidence/dissent/dont_do/trending substrate this builds on
- [2026-04-20-starter-ai-automation-phase3a-video-upload-fanout.md](../plans/2026-04-20-starter-ai-automation-phase3a-video-upload-fanout.md) — the fanout pattern this borrows
- [2026-04-20-starter-ai-automation-phase3b-scheduled-publishing.md](../plans/2026-04-20-starter-ai-automation-phase3b-scheduled-publishing.md) — the publish runner this hands off to

## Goal

The autonomous Social agent currently picks a blog post on Tuesdays/Thursdays and drafts a **LinkedIn-only** caption. The codebase already has full multi-platform plugin support (Facebook, Instagram, TikTok, YouTube, YouTube Shorts, LinkedIn), all six per-platform writer prompts in `prompt_templates`, a working publish runner, and OAuth token storage in `platform_connections`. The only thing blocking multi-platform autonomous drafting is the hardcoded `SUPPORTED_PLATFORMS = ["linkedin"]` gate at `functions/src/social-agent.ts:26`.

This spec opens that gate. The agent generates one draft per **connected** platform each run, keeping every other piece of the closing-the-learning-loop substrate intact (brief consumption, dont_do enforcement, trending injection, few-shots, tool_performance, confidence, dissent, memo audit trail).

## Why now

- The substrate is fully built — plugins, fanout pattern, publish runner, OAuth, prompts.
- The hardcoded LinkedIn gate is a literal one-line constant, not an architectural constraint.
- Without this, Darren is leaving 5 platforms of organic reach on the table every Tuesday and Thursday.

## What this spec is and is not

**Is:**
- Generate one caption per connected platform per agent run (writer + reviewer two-pass, same shape as social-fanout).
- One `social_posts` row per platform, all `approval_status='draft'`.
- One `social_agent_memos` row per run aggregating all platforms (single audit row, multiple `actions[]` entries).
- Filter to only platforms that have `platform_connections.status='connected'`. Skip disconnected ones silently with a log line.
- Preserve every existing prompt block (brief context, dont_do guardrail, trending topics, few-shots, tool_performance).

**Is not:**
- Auto-approve or auto-publish — drafts still wait for coach approval (defer until confidence is calibrated).
- Per-platform optimal-time picking — that's a separate spec when analytics history is deeper.
- Auto-detecting that a platform got disconnected mid-run — connection refreshes are out of scope.
- Comment/DM response automation.
- Per-platform A/B testing of hook variants.
- Schema changes — `social_posts.platform` already accepts all six values (via the existing CHECK constraint from `00076_social_posts_and_captions`).

## Design

### Current shape

`handleSocialAgentRun(jobId)` flow today (LinkedIn-only):

1. Pick blog topic via `pickTopicWithBrief` (already brief-aware, already enforces `dont_do`).
2. Load three prompt rows: `voice_profile`, `social_caption[linkedin]`, `social_caption_reviewer`.
3. Writer pass — one Sonnet call with `voice_profile + linkedin_writer_rules`.
4. Reviewer pass — one Sonnet call against the reviewer prompt.
5. Insert one `social_posts` row (platform=linkedin) + one `social_captions` row.
6. Insert one `social_agent_memos` row with one action.

### New shape

Same topic-pick step. Same brief/trending/tool_performance/few-shots prompt blocks. Then for each **connected** platform:

1. Load `social_caption[platform]` writer rules.
2. Writer pass (per platform).
3. Reviewer pass (per platform — uses the single global `social_caption_reviewer` prompt).
4. Insert `social_posts` + `social_captions` per platform.

Finally, one aggregate `social_agent_memos` row with one action per platform.

### Platform filter

```ts
// Pseudocode
const ALL_PLATFORMS = ["linkedin", "facebook", "instagram", "tiktok", "youtube", "youtube_shorts"] as const

async function listConnectedPlatforms(supabase): Promise<AgentPlatform[]> {
  const { data } = await supabase
    .from("platform_connections")
    .select("platform_key, status")
    .in("platform_key", ALL_PLATFORMS)
    .eq("status", "connected")
  return (data ?? []).map((r) => r.platform_key).filter((p): p is AgentPlatform => ALL_PLATFORMS.includes(p))
}
```

If the caller passes `input.platform`, honor it (single-platform manual trigger still works).
If the caller doesn't, run all connected platforms.
If zero platforms are connected, `failJob` with a clear message.

### Memo aggregation

One row per run, regardless of platform count. Shape:

```ts
{
  brief_id: brief?.id ?? null,
  brief_alignment_score: alignmentScore,
  ran_without_brief: brief === null,
  signals_summary: { topic_slug, platforms: ["linkedin", "tiktok", ...] },
  actions: [
    { kind: "drafted_social_post", payload: { platform: "linkedin", social_post_id, blog_post_id }, rationale: notes },
    { kind: "drafted_social_post", payload: { platform: "tiktok", social_post_id, blog_post_id }, rationale: notes },
    // one per platform
  ],
  rationale: "drafted N platforms",
  agent_confidence: Math.round(avg(reviewerScores)),  // average across platforms
  dissents_from_brief: false,
  dissent_reason: null,
  social_post_id: null,  // no single "primary" post anymore — see below
  platform: null,        // ditto
  outcome_status: "pending",
}
```

**Schema note:** the `social_post_id` and `platform` columns on `social_agent_memos` were designed assuming one post per memo. With multi-platform we set both to `null`; per-post linkage lives in `actions[].payload.social_post_id`. The outcome tracker already iterates `actions[].kind === "drafted_social_post"` (Task C5) — it just needs to know to look in `actions[i].payload.social_post_id` instead of `memo.social_post_id`. Update C5's tracker accordingly.

### Failure handling

A platform-specific writer or reviewer call may fail (rate limit, model error, etc.). Per-platform try/catch:

- If a platform fails, log it, skip the persistence step for that platform, continue with the others.
- The memo's `actions[]` only contains successfully-drafted platforms.
- If ALL platforms fail, fail the job with a clear error message.
- If at least one platform succeeds, the job completes — partial success is better than nothing.

## Data model

No new tables. No schema changes. The only schema-adjacent concern is the legacy `social_agent_memos.social_post_id` and `platform` columns — we set both to null going forward and update the outcome tracker to read from `actions[].payload.social_post_id`.

If we want stricter integrity, a follow-up could add `chief_strategist_memos`-style multi-row design (one memo row per platform per run). Deferred — current shape is queryable enough via `actions` JSONB.

## Components

| File | Change |
|---|---|
| `functions/src/social-agent.ts` | Loop over connected platforms; per-platform writer+reviewer; per-platform persistence; aggregate memo |
| `functions/src/social-outcome-tracker.ts` | Read `actions[i].payload.social_post_id` to find the linked post, not `memo.social_post_id` |

That's it. Two files.

## Feature flag

Reuse the existing master kill switch `automation_paused`. No new flag needed — disconnecting a platform in `platform_connections` is the per-platform off-switch.

If we want a softer rollout, a feature flag `cron_social_agent_multi_platform` (default `true`) could gate the loop and fall back to LinkedIn-only when off. Not required for this spec.

## Testing strategy

- **Unit:** `listConnectedPlatforms` filters by `status='connected'`.
- **Unit:** if `input.platform` is set, honor it (override path).
- **Integration:** with 3 platforms connected, agent generates 3 captions, 3 social_posts rows, 1 memo with 3 actions, agent_confidence = average of 3 scores.
- **Integration:** with 0 platforms connected, agent fails the job with a clear error.
- **Integration:** when one platform's writer call throws, the others still succeed and memo has 2 actions.
- **Integration:** `social-outcome-tracker` reads `actions[i].payload.social_post_id` correctly.

## Out of scope (explicit)

- Auto-approve high-confidence drafts (defer until confidence is calibrated)
- Optimal-time scheduling (need per-platform analytics history)
- Per-platform A/B test of hooks
- Comment/DM automation
- Re-engagement of high-performing posts
- Multi-row memo per platform (one row per run is simpler)
- Refreshing expired OAuth tokens mid-run

## Risks & mitigations

- **Risk:** Token expiry on one platform breaks the run. **Mitigation:** per-platform try/catch — failures are logged, run continues.
- **Risk:** Reviewer scores vary wildly across platforms — averaging is misleading. **Mitigation:** average is a reasonable rollup for a single run; per-action scores are still inspectable in `actions[i].payload` if we want to surface them.
- **Risk:** Generating 6 drafts × 2 Sonnet calls × Tuesday + Thursday = 24 calls/week. **Mitigation:** Cost is small (each call <2k tokens). If a platform isn't connected we skip it. If cost becomes a concern, add per-platform-per-day rate limit later.
- **Risk:** Schema mismatch — `social_agent_memos.platform` and `social_post_id` will be null going forward. **Mitigation:** Outcome tracker is the only consumer; update it in the same PR.

## Success criteria

- Connecting a new platform in `platform_connections` causes the next agent run to start generating drafts for it — no code change required.
- Disconnecting a platform causes the next run to skip it silently.
- Each run produces N drafts where N = number of connected platforms.
- One memo row per run, `actions[]` has N entries, `agent_confidence` is the average reviewer score.
- Outcome tracker correctly resolves linked posts via `actions[].payload.social_post_id`.

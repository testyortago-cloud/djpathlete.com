# Starter AI Automation — Phase 5b: Analytics Tabs (Plan)

**Spec:** [2026-04-21-starter-ai-automation-phase5b-analytics-tabs-design.md](../specs/2026-04-21-starter-ai-automation-phase5b-analytics-tabs-design.md)

## Steps

1. **types/analytics.ts** — append `SocialMetrics`, `ContentMetrics` interfaces (and `SocialAnalyticsSnapshot` if needed).
2. **lib/analytics/compute.ts** — add `export` to `inRange` and `capitalize`. No behavior change.
3. **lib/db/social-analytics.ts** — add `listSocialAnalyticsInRange(from, to)`.
4. **lib/analytics/social.ts** (NEW) — `computeSocialMetrics(posts, analytics, range, previousRange)`.
5. **lib/analytics/content.ts** (NEW) — `computeContentMetrics(blogs, newsletters, subscriberCount, range, previousRange)`.
6. **lib/db/newsletter.ts** — check whether a `countActiveSubscribers()` helper exists; if not, add one.
7. **components/admin/analytics/SocialTab.tsx** (NEW) — mirror `ShopTab` layout.
8. **components/admin/analytics/ContentTab.tsx** (NEW) — mirror `ShopTab` layout.
9. **components/admin/analytics/AnalyticsDashboard.tsx** — register Social + Content tabs.
10. **app/(admin)/admin/analytics/page.tsx** — fetch new data; call new computes; pass to dashboard.
11. **Tests** — five files per spec §Testing strategy.
12. **Verification gate:**
    - `npx tsc --noEmit` — no new errors in Phase 5b files
    - `npx prettier --check` — all new files clean
    - `npx vitest run` — new unit tests pass

## Out of scope (explicit reminders)

- No changes to existing analytics tabs.
- No new Firebase Functions.
- No new migrations.
- Don't try to retrofit the learning loop — that's 5f.

# Blog Image Quality Overhaul — Smoke Test Runbook

> Task 7 of `docs/superpowers/plans/2026-05-19-blog-image-quality-overhaul.md`. Tasks 1-6 are merged to `main`; migration `00155_blog_post_cover_meta.sql` is live in Supabase. This runbook walks the deploy + single-post regeneration + A/B compare against one real post.

---

## What changed (recap, so you know what to look for)

- **Hero model** → `fal-ai/flux-pro/v1.1-ultra` (was `fal-ai/flux-pro/v1.1`)
- **Inline model** → `fal-ai/flux-pro/v1.1` (was `fal-ai/flux/schnell` — biggest visible jump)
- **Render** → 2× target dimensions then Sharp `lanczos3` downscale
- **WebP quality** → 90 hero / 86 inline (was flat 82)
- **System prompt** → photographer/lens/film-stock grammar + anti-AI list
- **Per-category style modules** in `functions/src/ai/category-style-modules.ts`
  - *Note:* `BLOG_CATEGORIES` currently restricts new posts to **Performance / Recovery / Coaching / Youth Development**, so only the `recovery` and `youth` modules fire via the formal category field today. Everything else falls through to GENERIC (see the comment block at the top of that file).
- **Quality judge** — Haiku Vision rates each image 1-10; hero auto-retries once if score < 7 and the judge itself didn't fail. Inline images judged but never retried (cost control).
- **Per-image metadata** persisted: `seed`, `model`, `prompt_version`, `quality_score`, `judge_failed`, `attempts`. Hero → new `cover_image_meta` JSONB column. Inline → existing `inline_images` JSONB array.

---

## Step 1 — Candidate post

A live Supabase query against `blog_posts` where `cover_image_url IS NOT NULL` returned **one** candidate, and it is a `draft` (no `published` rows with covers exist yet):

```text
id:            7fcccc20-e33e-40c0-8e4c-0fb1c7b722eb
title:         Velocity Based Training: Equal Power Gains, 40% Less Volume
slug:          velocity-based-training-power-gains-less-volume
category:      Performance
status:        draft
cover_image_url (BEFORE):
  https://epzuvzkokzqtzomeyoha.supabase.co/storage/v1/object/public/blog-images/velocity-based-training-power-gains-less-volume-hero.webp
```

**Heads-up:** `Performance` is not one of the six keyword-matched categories — it will fall through to GENERIC. That still exercises the model upgrade, the 2× render, the SYSTEM_PROMPT, the judge, and the meta persistence — so the smoke test remains valid. It just won't exercise a category module. If you want a Recovery/Youth-Development run later, publish a post in one of those categories with a current cover, then re-run this runbook against that post.

Re-run the candidate query at any time via Supabase MCP or the dashboard SQL editor:

```sql
SELECT id, title, slug, category, status, cover_image_url, published_at
FROM blog_posts
WHERE cover_image_url IS NOT NULL
ORDER BY COALESCE(published_at, created_at) DESC
LIMIT 15;
```

---

## Step 2 — Save the BEFORE state

Paste this block into your scratch notes so the A/B compare in Step 6 is unambiguous:

```text
BEFORE (pre-overhaul cover, captured 2026-05-19)
  id:    7fcccc20-e33e-40c0-8e4c-0fb1c7b722eb
  slug:  velocity-based-training-power-gains-less-volume
  cover: https://epzuvzkokzqtzomeyoha.supabase.co/storage/v1/object/public/blog-images/velocity-based-training-power-gains-less-volume-hero.webp
```

Also right-click that image in a browser and "Save image as…" to your desktop. Once the new run completes, the storage object at the same path gets overwritten (same slug → same key) so the URL above will then resolve to the NEW image. The local copy is your only A/B reference.

If you want the inline images in the BEFORE state too, query them now:

```sql
SELECT inline_images
FROM blog_posts
WHERE id = '7fcccc20-e33e-40c0-8e4c-0fb1c7b722eb';
```

…and download each `url` from the returned JSON array.

---

## Step 3 — Deploy the upgraded Firebase function

The function that processes `blog_image_generation` ai_jobs docs is `blogImageGeneration` (exported from `functions/src/index.ts`). `firebase.json` declares the codebase as `default`, and per memory `firebase_deploy_codebase_prefix.md` multi-function deploys must use the `functions:default:<name>` prefix.

```bash
firebase deploy --only functions:default:blogImageGeneration
```

Watch for: build succeeds, function shows `Successful update operation`, runtime is Node 22.

*(Optional)* If you also want the `on-ai-job-completed` fanout listener redeployed (it's untouched by this overhaul, so this isn't required), it's exported as `onAiJobCompleted`:

```bash
firebase deploy --only functions:default:onAiJobCompleted
```

---

## Step 4 — Enqueue the regeneration job

Create `scripts/smoke-test-blog-image.ts`:

```typescript
// scripts/smoke-test-blog-image.ts
// One-off: enqueue a blog_image_generation ai_jobs doc for a given blog_post_id.
// Usage:
//   npx tsx scripts/smoke-test-blog-image.ts <blog_post_id>
//
// Reads GOOGLE_APPLICATION_CREDENTIALS from .env.local (path to a Firebase
// service-account JSON) and writes one Firestore doc. The deployed
// blogImageGeneration function trigger fires within ~1s.

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })
loadEnv()

import { initializeApp, applicationDefault, getApps } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"

async function main() {
  const blogPostId = process.argv[2]?.trim()
  if (!blogPostId) {
    console.error("usage: npx tsx scripts/smoke-test-blog-image.ts <blog_post_id>")
    process.exit(1)
  }

  if (!getApps().length) {
    initializeApp({ credential: applicationDefault() })
  }
  const fs = getFirestore()

  const ref = await fs.collection("ai_jobs").add({
    type: "blog_image_generation",
    status: "queued",
    input: { blog_post_id: blogPostId },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  console.log("enqueued blog_image_generation job:", ref.id)
  console.log("watch logs with: firebase functions:log --only blogImageGeneration -n 80")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

Run it:

```bash
npx tsx scripts/smoke-test-blog-image.ts 7fcccc20-e33e-40c0-8e4c-0fb1c7b722eb
```

`npx tsx` is the established invocation pattern in this repo (see `scripts/apply-rec.ts` header for an example). `GOOGLE_APPLICATION_CREDENTIALS` must point at a Firebase service-account JSON — same one used by every other admin script in `scripts/`.

The script prints the enqueued doc id. Copy that — you'll want it for the log filter and the post-run inspection in Step 6.

---

## Step 5 — Watch logs

```bash
firebase functions:log --only blogImageGeneration -n 80
```

Expected progression (in order):

1. Function cold-start / invocation banner for the new ai_jobs doc.
2. `processing` status set on the ai_jobs doc (one Firestore write).
3. **Hero generation** — one fal.ai call (`flux-pro/v1.1-ultra`), then a Haiku Vision judge call.
   - If hero `quality_score >= 7` (or judge throws and we accept): proceed.
   - If hero `quality_score < 7` AND judge didn't fail: **second** fal.ai call (retry, fresh seed), second judge call. `attempts: 2` lands in `cover_image_meta`.
4. **Inline images** — one fal.ai call per qualifying H2 section (`flux-pro/v1.1`), each followed by a Haiku Vision judge call. **No retries** for inline (cost control).
5. Per-image alt-text generation (Haiku, cheap).
6. Sharp transcode + Supabase Storage upload for each image. Same slug → same key → overwrites the old WebPs.
7. `completed` status with `cover_image_meta` populated. HTML rewritten with new `<img>` tags inline. `inline_images` JSONB array repopulated with `seed`/`model`/`prompt_version`/`quality_score`/`judge_failed`/`attempts` for each section.

**Watch for warnings of the form** `[blog-image-generation] judge threw for hero|inline-N: ...` — those indicate the Vision judge crashed (we treat as score 7 and accept, so the post still completes; but if it happens consistently the judge prompt or model has drifted).

---

## Step 6 — Visual A/B compare

1. Open the post on production (or admin preview if still draft):
   `https://www.darrenjpaul.com/blog/velocity-based-training-power-gains-less-volume`
2. Place your saved BEFORE image (Step 2 download) next to the live page hero.
3. Inspect the inline images section-by-section.

Then verify the persisted metadata:

```sql
SELECT
  cover_image_meta,
  jsonb_pretty(inline_images) AS inline_images
FROM blog_posts
WHERE id = '7fcccc20-e33e-40c0-8e4c-0fb1c7b722eb';
```

**Acceptance bar:**

- [ ] Hero is **noticeably sharper** than BEFORE — visible texture in skin, fabric, equipment; clean micro-contrast.
- [ ] No plastic/wax skin. No mangled hands. No floating equipment. No nonsense gym signage.
- [ ] Hero setting + equipment match the post topic (for this post: real strength gym, barbells/dumbbells, athletic adults, mid-rep action).
- [ ] Inline images **vary in framing/lens** — not three near-identical wide shots. Mix of medium, close, and wide is the goal.
- [ ] `cover_image_meta.quality_score >= 7` (or `judge_failed = true` — acceptable).
- [ ] Every entry in `inline_images[].quality_score >= 7` (or `judge_failed = true`).
- [ ] `cover_image_meta.attempts` is 1 (ideal) or 2 (one retry fired — fine).
- [ ] `cover_image_meta.model = "fal-ai/flux-pro/v1.1-ultra"` and every inline `model = "fal-ai/flux-pro/v1.1"`.
- [ ] `prompt_version` matches the constant in `functions/src/ai/image-prompts.ts` (`"v2"` as of this overhaul).

**If a hero is bad:** bump `PROMPT_VERSION` to `"v3"` in `functions/src/ai/image-prompts.ts`, tweak `BRAND_TREATMENT` (or the relevant category module in `functions/src/ai/category-style-modules.ts`), then redeploy (Step 3) and re-enqueue (Step 4).

---

## Step 7 — Cost expectations

| Item | Unit cost | Per post | Notes |
|---|---|---|---|
| Hero | $0.06 (Ultra) | $0.06 - $0.12 | × 1-2 attempts |
| Inline | $0.04 (Pro v1.1) | $0.12 | × ~3 sections typical |
| Vision judge (Haiku) | ~$0.0003 | ~$0.001 | × (hero attempts + inline count) |
| Alt-text (Haiku) | ~$0.0003 | ~$0.001 | × (hero + inline count) |
| **Total** | — | **~$0.18 - $0.25** | vs ~$0.05 before |

At 5 posts/week that's ~$50/year extra spend for the quality jump — well within the ROI bar.

---

## Done when

- [ ] `firebase deploy --only functions:default:blogImageGeneration` completed cleanly.
- [ ] `scripts/smoke-test-blog-image.ts` enqueued a job and printed the doc id.
- [ ] `firebase functions:log` shows the full progression (processing → fal → judge → upload → completed) with no thrown errors.
- [ ] `blog_posts.cover_image_meta` populated with `seed`, `model = "fal-ai/flux-pro/v1.1-ultra"`, `prompt_version`, `quality_score`, `judge_failed`, `attempts`.
- [ ] Every row in `blog_posts.inline_images[]` populated with the same six keys (`model = "fal-ai/flux-pro/v1.1"`).
- [ ] Visual A/B confirms the hero is sharper, no obvious AI tells, no mangled anatomy.
- [ ] Inline images vary in framing/lens, not three near-identical shots.
- [ ] All `quality_score` values are `>= 7` (or `judge_failed = true` — acceptable).
- [ ] Total fal.ai + Anthropic spend for the post is in the $0.18 - $0.25 band.

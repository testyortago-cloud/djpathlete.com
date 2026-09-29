# Share to LinkedIn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click on a published blog post or a sent/scheduled newsletter issue drafts a LinkedIn post in Darren's voice, in `/admin/social`, that publishes with a link card back to darrenjpaul.com; plus a Text option in the manual post box.

**Architecture:** A new `POST /api/admin/social/share` route dedupes and enqueues the EXISTING Firebase `social_agent_run` job with a source id and `siteUrl`. The agent writes the draft plus six new `social_posts` columns (source + link card). The one shared publish path (`buildPluginInput`) passes the link to the LinkedIn plugin, which posts a `content.article` card and now escapes LinkedIn's reserved "little text" characters.

**Tech Stack:** Next.js 16 route handlers, Supabase Postgres (migration + DAL), Firebase Functions (`functions/`, cannot import `lib/`), LinkedIn Posts API `/rest` (`LinkedIn-Version: 202604`), Vitest, React client components, `hooks/use-ai-job.ts`.

**Spec:** `docs/superpowers/specs/2026-09-29-share-to-linkedin-design.md` — read it before any task.

## Global Constraints

- Worktree: `.claude/worktrees/share-to-linkedin`, branch `worktree-share-to-linkedin`. Never `cd` to the main checkout.
- Root vitest needs Node 24: prefix every root test command with `PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"`. Do NOT `source nvm.sh` (the worktree guard refuses it).
- Functions tests: `PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npm --prefix functions run test -- <path relative to functions/>`.
- Run ONLY the named test files. Never a whole directory, never the full suite.
- Typecheck: `npx tsc --noEmit -p .` and grep the output for files you touched (repo baseline is ~238 pre-existing errors; do not chase them). Functions: `npx tsc --noEmit -p functions` likewise.
- NO `Co-Authored-By` trailer and no "Generated with Claude" line in commits. Commit messages as the user would write them.
- Never add a `SINGLETON_BUSINESS_ID` reference. A new caller of `platformBusinessId()` must be added to the inventory comment in `lib/tenancy/platform.ts`.
- Migration number: `00283`. Site URL comes from `SITE_URL` in `lib/constants.ts` (`https://www.darrenjpaul.com`) — never hard-code it in `app/`/`lib/`; the agent receives it as `input.siteUrl`.
- Default share image path: `/images/gym-training-01.jpg`.
- Admin UI is light-only; use semantic classes (`text-primary`, `bg-surface`, …), never hex.
- Do not format whole existing files with Prettier (many are not Prettier-clean; it bloats the diff). Format only files you create.

## Review Focus

1. A caption containing `(`, `)`, `_`, `*`, `[`, `@` (e.g. "ACL (anterior cruciate ligament)") must reach LinkedIn intact — pinned in Task 2 (`escapeLittleText`).
2. A hashtag like `#strengthtraining` must stay a hashtag after escaping — Task 2.
3. A blog whose cover image is missing, non-https, or 404s must still publish, as a card without an image — Task 2 (thumbnail failure fallback) and Task 4 (`buildShareLink` non-https cover → default image).
4. Newsletter bodies are HTML with entities (`&amp;`, `&nbsp;`, `&#39;`) — the writer must get readable text — Task 4 (`htmlToText`).
5. A job enqueued by older code (no `siteUrl`) must still draft, just without a card — Task 4.

---

### Task 1: Schema, types and DAL

**Files:**
- Create: `supabase/migrations/00283_social_posts_share_links.sql`
- Modify: `types/database.ts` (the `SocialPost` interface, ~line 1765)
- Modify: `lib/db/social-posts.ts` (`createSocialPost` input type; new `findOpenShareDraft`)
- Test: `__tests__/lib/db/social-posts-share.test.ts` (create)

**Interfaces:**
- Produces: `SocialPost` gains OPTIONAL fields `source_blog_post_id?: string | null; source_newsletter_id?: string | null; link_url?: string | null; link_title?: string | null; link_description?: string | null; link_image_url?: string | null`.
- Produces: `export type ShareSource = { blogPostId: string } | { newsletterId: string }` and `export async function findOpenShareDraft(source: ShareSource): Promise<SocialPost | null>` in `lib/db/social-posts.ts`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00283_social_posts_share_links.sql
-- Share to LinkedIn (spec docs/superpowers/specs/2026-09-29-share-to-linkedin-design.md).
--
-- WRITER: the social agent (functions/src/social-agent.ts), when it inserts a draft.
-- READERS: source_* -> findOpenShareDraft (lib/db/social-posts.ts), which the share route
--          uses to avoid drafting the same article twice;
--          link_*   -> buildPluginInput (lib/social/publish-runner.ts), which hands the
--          LinkedIn plugin a link card (LinkedIn's API never scrapes URLs itself).
--
-- SET NULL, not CASCADE: deleting a blog post or an issue must not delete the record of
-- what was published about it. Nullable, no default, no backfill.
--
-- social_posts still has no business_id: this sits in the platform seam the social agent
-- already uses (lib/tenancy/platform.ts). Flagged in the spec, not fixed here.
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS source_blog_post_id uuid REFERENCES public.blog_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_newsletter_id uuid REFERENCES public.newsletters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_url text,
  ADD COLUMN IF NOT EXISTS link_title text,
  ADD COLUMN IF NOT EXISTS link_description text,
  ADD COLUMN IF NOT EXISTS link_image_url text;

ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_link_url_https
    CHECK (link_url IS NULL OR link_url LIKE 'https://%'),
  ADD CONSTRAINT social_posts_link_image_url_https
    CHECK (link_image_url IS NULL OR link_image_url LIKE 'https://%'),
  ADD CONSTRAINT social_posts_one_share_source
    CHECK (source_blog_post_id IS NULL OR source_newsletter_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_social_posts_source_blog_post
  ON public.social_posts(source_blog_post_id) WHERE source_blog_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_source_newsletter
  ON public.social_posts(source_newsletter_id) WHERE source_newsletter_id IS NOT NULL;
```

- [ ] **Step 2: Apply it to the dev clone** (standing instruction: dev migrations are applied automatically). Use the `mcp__supabase__apply_migration` tool with `project_id: "anjvztjiokcgiyhobknq"`, `name: "00283_social_posts_share_links"` and the SQL above. NEVER apply to production (`supabase-prod`) — that is the owner's call.

- [ ] **Step 3: Add the optional fields to `SocialPost`** in `types/database.ts`, after `created_by`:

```ts
  /** Share to LinkedIn (00283). Optional: DB-defaulted null, and older rows/fakes omit them. */
  source_blog_post_id?: string | null
  source_newsletter_id?: string | null
  link_url?: string | null
  link_title?: string | null
  link_description?: string | null
  link_image_url?: string | null
```

- [ ] **Step 4: Write the failing DAL test** `__tests__/lib/db/social-posts-share.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const calls: Array<[string, ...unknown[]]> = []
let result: { data: unknown; error: unknown } = { data: null, error: null }
const builder: Record<string, (...args: unknown[]) => unknown> = {}
for (const m of ["select", "eq", "not", "order", "limit"]) {
  builder[m] = (...args: unknown[]) => {
    calls.push([m, ...args])
    return builder
  }
}
builder.maybeSingle = () => Promise.resolve(result)
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (t: string) => {
      calls.push(["from", t])
      return builder
    },
  }),
}))

import { findOpenShareDraft } from "@/lib/db/social-posts"

beforeEach(() => {
  calls.length = 0
  result = { data: null, error: null }
})

describe("findOpenShareDraft", () => {
  it("looks for an un-posted LinkedIn draft from the same blog post", async () => {
    result = { data: { id: "sp-1" }, error: null }
    const found = await findOpenShareDraft({ blogPostId: "blog-1" })
    expect(found).toEqual({ id: "sp-1" })
    expect(calls).toContainEqual(["from", "social_posts"])
    expect(calls).toContainEqual(["eq", "platform", "linkedin"])
    expect(calls).toContainEqual(["eq", "source_blog_post_id", "blog-1"])
    expect(calls).toContainEqual(["not", "approval_status", "in", "(published,rejected)"])
  })

  it("keys a newsletter share on source_newsletter_id, not the blog column", async () => {
    await findOpenShareDraft({ newsletterId: "nl-1" })
    expect(calls).toContainEqual(["eq", "source_newsletter_id", "nl-1"])
    expect(calls.some((c) => c[1] === "source_blog_post_id")).toBe(false)
  })

  it("rethrows a database error instead of reporting 'no draft'", async () => {
    result = { data: null, error: { code: "42703", message: "column does not exist" } }
    await expect(findOpenShareDraft({ blogPostId: "blog-1" })).rejects.toMatchObject({ code: "42703" })
  })
})
```

- [ ] **Step 5: Run it, expect FAIL** (`findOpenShareDraft` is not exported):
`PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npx vitest run __tests__/lib/db/social-posts-share.test.ts`

- [ ] **Step 6: Implement in `lib/db/social-posts.ts`.** Change `createSocialPost`'s input so the six new fields stay optional (they are already optional on `SocialPost`, so the existing `Omit<…>` works unchanged — confirm with tsc). Add:

```ts
export type ShareSource = { blogPostId: string } | { newsletterId: string }

/**
 * The newest LinkedIn draft made from this blog post / issue that has not been
 * posted or rejected. The share route returns it instead of drafting a second one.
 * A `failed` draft counts as open on purpose: retry it rather than write another.
 */
export async function findOpenShareDraft(source: ShareSource): Promise<SocialPost | null> {
  const supabase = getClient()
  const [column, id] =
    "blogPostId" in source
      ? (["source_blog_post_id", source.blogPostId] as const)
      : (["source_newsletter_id", source.newsletterId] as const)
  const { data, error } = await supabase
    .from("social_posts")
    .select("*")
    .eq("platform", "linkedin")
    .eq(column, id)
    .not("approval_status", "in", "(published,rejected)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as SocialPost | null) ?? null
}
```

- [ ] **Step 7: Run the test, expect PASS.** Then run the live checks against the dev clone:
`PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npm run test:integration:selects` and `PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npm run test:integration:drift` — both green. (The selects contract collects the new `.eq("source_blog_post_id")` filter; it fails if the migration is not on the clone.) If `drift` needs `SUPABASE_ACCESS_TOKEN` and it is absent, report that rather than skipping silently.

- [ ] **Step 8: tsc** — `npx tsc --noEmit -p . 2>&1 | grep -E "social-posts|types/database"` → no output.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/00283_social_posts_share_links.sql types/database.ts lib/db/social-posts.ts __tests__/lib/db/social-posts-share.test.ts
git commit -m "feat(social): social_posts source + link-card columns, findOpenShareDraft"
```

---

### Task 2: LinkedIn plugin — escape little text, post link cards

**Files:**
- Create: `lib/social/linkedin-little-text.ts`
- Modify: `lib/social/plugins/types.ts` (`PublishInput`)
- Modify: `lib/social/plugins/linkedin.ts`
- Test: `__tests__/lib/social/linkedin-little-text.test.ts` (create), `__tests__/lib/social/linkedin-article.test.ts` (create)
- Re-run (must stay green): `__tests__/lib/social/linkedin.test.ts`, `__tests__/lib/social/linkedin-multiimage.test.ts`, `__tests__/lib/social/linkedin-video.test.ts`

**Interfaces:**
- Produces: `export function escapeLittleText(text: string): string`.
- Produces: `PublishInput.link?: PublishLink` where `export interface PublishLink { url: string; title: string; description: string | null; imageUrl: string | null }` (exported from `lib/social/plugins/types.ts`).

- [ ] **Step 1: Failing test for the escaper** `__tests__/lib/social/linkedin-little-text.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { escapeLittleText } from "@/lib/social/linkedin-little-text"

describe("escapeLittleText", () => {
  it("escapes every reserved character LinkedIn would otherwise parse", () => {
    expect(escapeLittleText("ACL (anterior cruciate) [1] {x} <y> a_b *c* ~d~ e|f @g \\h")).toBe(
      "ACL \\(anterior cruciate\\) \\[1\\] \\{x\\} \\<y\\> a\\_b \\*c\\* \\~d\\~ e\\|f \\@g \\\\h",
    )
  })

  it("leaves a hashtag a hashtag", () => {
    expect(escapeLittleText("Train smart #strengthtraining #ACL2026")).toBe(
      "Train smart #strengthtraining #ACL2026",
    )
  })

  it("escapes a # that does not start a hashtag", () => {
    expect(escapeLittleText("Rule # one, and # ")).toBe("Rule \\# one, and \\# ")
  })

  it("leaves plain text, emoji and line breaks alone", () => {
    const plain = "Three cues for a better squat.\n\nKnees out. 💪"
    expect(escapeLittleText(plain)).toBe(plain)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** `lib/social/linkedin-little-text.ts`:

```ts
// LinkedIn's `commentary` is "little" text, where | { } @ [ ] ( ) < > # \ * _ ~
// are markup. Unescaped, "ACL (anterior cruciate)" can be mangled or cut short.
// https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
// `#` is left alone when it starts a hashtag (followed by a letter or digit),
// because LinkedIn turns "#word" into a hashtag and escaping it would kill that.
const ALWAYS = /[\\|{}@[\]()<>*_~]/g

export function escapeLittleText(text: string): string {
  return text.replace(ALWAYS, (c) => `\\${c}`).replace(/#(?![\p{L}\p{N}])/gu, "\\#")
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Add the link to `PublishInput`** in `lib/social/plugins/types.ts`:

```ts
/** A link card (LinkedIn "article" content). LinkedIn's API never scrapes a URL itself. */
export interface PublishLink {
  url: string
  title: string
  description: string | null
  /** https image for the card; uploaded as the thumbnail. Null → card without image. */
  imageUrl: string | null
}
```
and inside `PublishInput`: `link?: PublishLink`.

- [ ] **Step 6: Failing plugin tests** `__tests__/lib/social/linkedin-article.test.ts`. Reuse the `mockResponse` helper shape from `__tests__/lib/social/linkedin.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createLinkedInPlugin } from "@/lib/social/plugins/linkedin"

function mockResponse(opts: { status: number; body?: unknown; headers?: Record<string, string>; arrayBuffer?: ArrayBuffer }) {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    text: async () => (opts.body ? JSON.stringify(opts.body) : ""),
    json: async () => opts.body ?? {},
    arrayBuffer: async () => opts.arrayBuffer ?? new ArrayBuffer(4),
    headers: new Headers(opts.headers ?? {}),
  } as Response
}

const LINK = {
  url: "https://www.darrenjpaul.com/blog/acl-return",
  title: "Returning to sport after ACL",
  description: "What the research says.",
  imageUrl: "https://cdn.example.com/cover.jpg",
}

function postBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([u, init]) => u === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
  return JSON.parse(call![1].body as string)
}

describe("LinkedIn article (link card) posts", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("uploads the card image and posts content.article with it as the thumbnail", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === LINK.imageUrl) return mockResponse({ status: 200 })
      if (url.includes("/rest/images?action=initializeUpload"))
        return mockResponse({ status: 200, body: { value: { uploadUrl: "https://upload.test/x", image: "urn:li:image:C1" } } })
      if (url === "https://upload.test/x") return mockResponse({ status: 201 })
      if (url.includes("/rest/images/")) return mockResponse({ status: 200, body: { status: "AVAILABLE" } })
      if (url === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
        return mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:1" } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    const res = await plugin.publish({ content: "Read this (really).", mediaUrl: null, scheduledAt: null, link: LINK })

    expect(res).toEqual({ success: true, platform_post_id: "urn:li:share:1" })
    const body = postBody(fetchMock)
    expect(body.commentary).toBe("Read this \\(really\\).")
    expect(body.content).toEqual({
      article: { source: LINK.url, title: LINK.title, description: LINK.description, thumbnail: "urn:li:image:C1" },
    })
  })

  it("still posts the card, without a thumbnail, when the image cannot be fetched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === LINK.imageUrl) return mockResponse({ status: 404 })
      if (url === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
        return mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:2" } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    const res = await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: LINK })

    expect(res.success).toBe(true)
    expect(postBody(fetchMock).content).toEqual({
      article: { source: LINK.url, title: LINK.title, description: LINK.description },
    })
  })

  it("omits description and thumbnail when the link has neither", async () => {
    const fetchMock = vi.fn(async () => mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:3" } }))
    vi.stubGlobal("fetch", fetchMock)
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    await plugin.publish({ content: "x", mediaUrl: null, scheduledAt: null, link: { ...LINK, description: null, imageUrl: null } })
    expect(postBody(fetchMock).content).toEqual({ article: { source: LINK.url, title: LINK.title } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("lets media win over a link: an image post carries no article", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://cdn.example.com/photo.jpg") return mockResponse({ status: 200 })
      if (url.includes("/rest/images?action=initializeUpload"))
        return mockResponse({ status: 200, body: { value: { uploadUrl: "https://upload.test/p", image: "urn:li:image:P1" } } })
      if (url === "https://upload.test/p") return mockResponse({ status: 201 })
      if (url.includes("/rest/images/")) return mockResponse({ status: 200, body: { status: "AVAILABLE" } })
      if (url === "https://api.linkedin.com/rest/posts" && init?.method === "POST")
        return mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:4" } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    await plugin.publish({ content: "x", mediaUrl: "https://cdn.example.com/photo.jpg", scheduledAt: null, link: LINK })
    expect(postBody(fetchMock).content.media.id).toBe("urn:li:image:P1")
    expect(postBody(fetchMock).content.article).toBeUndefined()
  })

  it("escapes the commentary of a plain text post too", async () => {
    const fetchMock = vi.fn(async () => mockResponse({ status: 201, headers: { "x-restli-id": "urn:li:share:5" } }))
    vi.stubGlobal("fetch", fetchMock)
    const plugin = createLinkedInPlugin({ access_token: "tok", organization_id: "123" })
    await plugin.publish({ content: "Squat_depth (tips) #coaching", mediaUrl: null, scheduledAt: null })
    expect(postBody(fetchMock).commentary).toBe("Squat\\_depth \\(tips\\) #coaching")
  })
})
```

- [ ] **Step 7: Run, expect FAIL.**

- [ ] **Step 8: Implement in `lib/social/plugins/linkedin.ts`:**
  - Import `escapeLittleText` and type `PublishLink`.
  - In `publish()`, destructure `link`; AFTER the carousel / video / image branches and BEFORE `publishTextPost`, add: `if (link) return publishArticlePost({ accessToken: access_token, organizationId: organization_id, caption: content, link })`.
  - Wrap `commentary` with `escapeLittleText(...)` in ALL FIVE post bodies (text, image, multi-image, video, article). `altText` / `title` fields are plain strings, NOT little text — do not escape them.
  - Add:

```ts
// ──────────────────────────────────────────────────────────────────────────
// Article (link card) post. LinkedIn's API does not scrape URLs, so the card's
// title, description and thumbnail are supplied here. A thumbnail that cannot
// be fetched or uploaded degrades to a card without an image, never a failed post.
// ──────────────────────────────────────────────────────────────────────────

interface ArticlePostArgs {
  accessToken: string
  organizationId: string
  caption: string
  link: PublishLink
}

async function uploadThumbnail(args: ArticlePostArgs): Promise<string | null> {
  if (!args.link.imageUrl) return null
  const binary = await fetchBinary(args.link.imageUrl)
  if (!binary.ok) {
    console.warn(`[linkedin] card image fetch failed (${binary.error}); posting the card without it`)
    return null
  }
  const init = await initializeImageUpload(args.accessToken, args.organizationId)
  if (!init.ok) {
    console.warn(`[linkedin] card image init failed (${init.error}); posting the card without it`)
    return null
  }
  const put = await putImageBytes(args.accessToken, init.uploadUrl, binary.data)
  if (!put.ok) {
    console.warn(`[linkedin] card image upload failed (${put.error}); posting the card without it`)
    return null
  }
  const ready = await waitForImageReady(args.accessToken, init.imageUrn)
  if (!ready.ok) {
    console.warn(`[linkedin] card image not ready (${ready.error}); posting the card without it`)
    return null
  }
  return init.imageUrn
}

async function publishArticlePost(args: ArticlePostArgs): Promise<PublishResult> {
  const thumbnail = await uploadThumbnail(args)
  const article: Record<string, string> = { source: args.link.url, title: args.link.title }
  if (args.link.description) article.description = args.link.description
  if (thumbnail) article.thumbnail = thumbnail

  const response = await fetch(POSTS_URL, {
    method: "POST",
    headers: versionedHeaders(args.accessToken),
    body: JSON.stringify({
      author: `urn:li:organization:${args.organizationId}`,
      commentary: escapeLittleText(args.caption),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      content: { article },
    }),
  })
  return extractPostResult(response)
}
```
  - Update the file header comment: text, image, multi-image, video and article (link card) posts are supported.

- [ ] **Step 9: Run the new tests AND the three existing LinkedIn suites, expect all PASS.** If an existing test asserted an unescaped commentary that contains a reserved character, update that expectation to the escaped form (that test was pinning the bug) and say so in the commit message.

- [ ] **Step 10: tsc** grep for `linkedin|plugins/types` → no output.

- [ ] **Step 11: Commit**

```bash
git add lib/social/linkedin-little-text.ts lib/social/plugins/types.ts lib/social/plugins/linkedin.ts __tests__/lib/social/linkedin-little-text.test.ts __tests__/lib/social/linkedin-article.test.ts
git commit -m "feat(linkedin): link-card (article) posts, and escape reserved little-text characters"
```

---

### Task 3: Publish runner passes the link card

**Files:**
- Modify: `lib/social/publish-runner.ts` (`buildPluginInput`, ~line 121)
- Test: find the existing suite with `git grep -ln "buildPluginInput" -- __tests__` and add cases there; if none exists, create `__tests__/lib/social/build-plugin-input-link.test.ts`.

**Interfaces:**
- Consumes: `SocialPost.link_*` (Task 1), `PublishLink` (Task 2).
- Produces: `buildPluginInput(post)` returns `input.link` when `post.link_url && post.link_title` are set; otherwise no `link` key.

- [ ] **Step 1: Failing tests** (mock `@/lib/db/social-posts`'s `getSocialPostWithMedia` → `{ media: [] }` and `@/lib/social/resolve-media-url`'s `resolveMediaUrl` → `null`, following the existing suite's pattern):

```ts
it("hands the plugin the post's link card", async () => {
  const built = await buildPluginInput(post({
    link_url: "https://www.darrenjpaul.com/blog/acl",
    link_title: "ACL return",
    link_description: "What the research says.",
    link_image_url: "https://cdn.example.com/c.jpg",
  }))
  expect("input" in built && built.input.link).toEqual({
    url: "https://www.darrenjpaul.com/blog/acl",
    title: "ACL return",
    description: "What the research says.",
    imageUrl: "https://cdn.example.com/c.jpg",
  })
})

it("sends no link for a post without one", async () => {
  const built = await buildPluginInput(post({}))
  expect("input" in built && "link" in built.input).toBe(false)
})

it("sends no link when the url is set but the title is missing (a card needs both)", async () => {
  const built = await buildPluginInput(post({ link_url: "https://www.darrenjpaul.com/x", link_title: null }))
  expect("input" in built && "link" in built.input).toBe(false)
})
```
where `post(overrides)` builds a `SocialPost` with `post_type: "text"`, `media_url: null`, `source_video_id: null`, `content: "hi"` and the overrides.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — in the returned `input` object:

```ts
      ...(post.link_url && post.link_title
        ? {
            link: {
              url: post.link_url,
              title: post.link_title,
              description: post.link_description ?? null,
              imageUrl: post.link_image_url ?? null,
            },
          }
        : {}),
```

- [ ] **Step 4: Run, expect PASS.** Also re-run every existing suite that imports `publish-runner` (`git grep -ln "publish-runner" -- __tests__`), by file name.

- [ ] **Step 5: Commit**

```bash
git add lib/social/publish-runner.ts <test file>
git commit -m "feat(social): publish runner hands the plugin a post's link card"
```

---

### Task 4: Social agent — newsletter topics, link fields, siteUrl

**Files:**
- Create: `functions/src/social-share-link.ts` (pure helpers)
- Modify: `functions/src/social-agent.ts`
- Modify: `app/api/admin/internal/social-agent-cron/route.ts` (pass `siteUrl`)
- Test: `functions/src/__tests__/social-share-link.test.ts` (create); `functions/src/__tests__/social-agent.test.ts` (extend); the cron route's existing test (`__tests__/api/admin/internal/social-agent-cron.test.ts`, extend)

**Interfaces:**
- Consumes: `social_posts` columns (Task 1).
- Produces (in `functions/src/social-share-link.ts`):
  - `export const DEFAULT_SHARE_IMAGE_PATH = "/images/gym-training-01.jpg"`
  - `export const NEWSLETTER_CARD_DESCRIPTION = "Free newsletter from Darren Paul. Sign up to get the next issue."`
  - `export interface ShareTopic { kind: "blog" | "newsletter"; id: string; title: string; slug: string; excerpt: string | null; content: string | null; cover_image_url: string | null }`
  - `export interface ShareLinkFields { source_blog_post_id: string | null; source_newsletter_id: string | null; link_url: string | null; link_title: string | null; link_description: string | null; link_image_url: string | null }`
  - `export function buildShareLink(topic: ShareTopic, siteUrl: string | undefined): ShareLinkFields`
  - `export function htmlToText(html: string): string`
- Produces: `SocialAgentInput` gains `newsletterId?: string; siteUrl?: string`. `BlogTopic` gains `kind: "blog" | "newsletter"` and `cover_image_url: string | null` (make `BlogTopic` an alias of `ShareTopic`).
- The Next app enqueues `{ platform: "linkedin", blogPostId | newsletterId, siteUrl, businessId }` (Task 5 relies on these exact keys).

- [ ] **Step 1: Failing helper tests** `functions/src/__tests__/social-share-link.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  buildShareLink,
  htmlToText,
  DEFAULT_SHARE_IMAGE_PATH,
  NEWSLETTER_CARD_DESCRIPTION,
  type ShareTopic,
} from "../social-share-link.js"

const SITE = "https://www.darrenjpaul.com"
const blog = (o: Partial<ShareTopic> = {}): ShareTopic => ({
  kind: "blog", id: "b1", title: "ACL return", slug: "acl-return",
  excerpt: "What the research says.", content: "<p>x</p>", cover_image_url: "https://cdn.example.com/c.jpg", ...o,
})

describe("buildShareLink", () => {
  it("points a blog card at the article, with its title, excerpt and cover", () => {
    expect(buildShareLink(blog(), SITE)).toEqual({
      source_blog_post_id: "b1", source_newsletter_id: null,
      link_url: `${SITE}/blog/acl-return`, link_title: "ACL return",
      link_description: "What the research says.", link_image_url: "https://cdn.example.com/c.jpg",
    })
  })

  it("falls back to the site share image when the cover is missing or not https", () => {
    expect(buildShareLink(blog({ cover_image_url: null }), SITE).link_image_url).toBe(`${SITE}${DEFAULT_SHARE_IMAGE_PATH}`)
    expect(buildShareLink(blog({ cover_image_url: "http://insecure/c.jpg" }), SITE).link_image_url).toBe(`${SITE}${DEFAULT_SHARE_IMAGE_PATH}`)
  })

  it("cuts a long excerpt to 200 characters with an ellipsis, and keeps a null one null", () => {
    const d = buildShareLink(blog({ excerpt: "a".repeat(250) }), SITE).link_description!
    expect(d.length).toBe(200)
    expect(d.endsWith("…")).toBe(true)
    expect(buildShareLink(blog({ excerpt: null }), SITE).link_description).toBeNull()
  })

  it("points a newsletter card at the sign-up section with the default image", () => {
    expect(buildShareLink({ ...blog(), kind: "newsletter", id: "n1", title: "Issue 12", slug: "", cover_image_url: null }, SITE)).toEqual({
      source_blog_post_id: null, source_newsletter_id: "n1",
      link_url: `${SITE}/#newsletter`, link_title: "Issue 12",
      link_description: NEWSLETTER_CARD_DESCRIPTION, link_image_url: `${SITE}${DEFAULT_SHARE_IMAGE_PATH}`,
    })
  })

  it("still records the source but no card for a job from older code (no siteUrl)", () => {
    expect(buildShareLink(blog(), undefined)).toEqual({
      source_blog_post_id: "b1", source_newsletter_id: null,
      link_url: null, link_title: null, link_description: null, link_image_url: null,
    })
  })

  it("strips a trailing slash from siteUrl", () => {
    expect(buildShareLink(blog(), `${SITE}/`).link_url).toBe(`${SITE}/blog/acl-return`)
  })
})

describe("htmlToText", () => {
  it("drops tags and decodes the entities a newsletter body carries", () => {
    expect(htmlToText("<h2>Deload&nbsp;weeks</h2><p>Rest &amp; recover. It&#39;s &quot;normal&quot;.</p>")).toBe(
      "Deload weeks\nRest & recover. It's \"normal\".",
    )
  })
  it("removes style and script blocks entirely", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Hi</p><script>x()</script>")).toBe("Hi")
  })
})
```

- [ ] **Step 2: Run, expect FAIL:** `PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH" npm --prefix functions run test -- src/__tests__/social-share-link.test.ts`

- [ ] **Step 3: Implement** `functions/src/social-share-link.ts`:

```ts
// functions/src/social-share-link.ts
// Pure helpers for Share to LinkedIn: what a draft's link card points at, and
// newsletter HTML → text for the copywriter. functions/ cannot import lib/, and
// nothing in lib/ needs these, so there is no twin.

export const DEFAULT_SHARE_IMAGE_PATH = "/images/gym-training-01.jpg"
export const NEWSLETTER_CARD_DESCRIPTION = "Free newsletter from Darren Paul. Sign up to get the next issue."
const MAX_DESCRIPTION = 200

export interface ShareTopic {
  kind: "blog" | "newsletter"
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string | null
  cover_image_url: string | null
}

export interface ShareLinkFields {
  source_blog_post_id: string | null
  source_newsletter_id: string | null
  link_url: string | null
  link_title: string | null
  link_description: string | null
  link_image_url: string | null
}

function clip(text: string | null): string | null {
  if (!text) return null
  const t = text.trim()
  return t.length <= MAX_DESCRIPTION ? t : `${t.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
}

export function buildShareLink(topic: ShareTopic, siteUrl: string | undefined): ShareLinkFields {
  const source = {
    source_blog_post_id: topic.kind === "blog" ? topic.id : null,
    source_newsletter_id: topic.kind === "newsletter" ? topic.id : null,
  }
  // A job enqueued by code older than this feature carries no siteUrl: record
  // where the draft came from, but write no card rather than guess an origin.
  if (!siteUrl) {
    return { ...source, link_url: null, link_title: null, link_description: null, link_image_url: null }
  }
  const base = siteUrl.replace(/\/+$/, "")
  const fallbackImage = `${base}${DEFAULT_SHARE_IMAGE_PATH}`
  if (topic.kind === "newsletter") {
    return {
      ...source,
      link_url: `${base}/#newsletter`,
      link_title: topic.title,
      link_description: NEWSLETTER_CARD_DESCRIPTION,
      link_image_url: fallbackImage,
    }
  }
  return {
    ...source,
    link_url: `${base}/blog/${topic.slug}`,
    link_title: topic.title,
    link_description: clip(topic.excerpt),
    link_image_url: topic.cover_image_url?.startsWith("https://") ? topic.cover_image_url : fallbackImage,
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " }

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|h[1-6]|li|div|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|[a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Wire into `functions/src/social-agent.ts`:**
  1. `import { buildShareLink, htmlToText, type ShareTopic } from "./social-share-link.js"`; replace the `BlogTopic` interface body with `export type BlogTopic = ShareTopic`.
  2. `SocialAgentInput`: add `newsletterId?: string` and `siteUrl?: string` with a comment (`siteUrl`: the site the link card points at, stamped by the Next enqueue routes from `SITE_URL`; absent on jobs from older code → no card).
  3. Every `blog_posts` select in `pickTopic` / `pickTopicWithBrief` becomes `"id, title, slug, excerpt, content, cover_image_url"`, and each row is mapped to `{ ...row, kind: "blog" as const }` before being returned (the `scoreBlogVsBrief` call is unchanged).
  4. Add and export:

```ts
export async function pickNewsletterTopic(args: {
  supabase: SupabaseClient
  newsletterId: string
}): Promise<ShareTopic | null> {
  const { data } = await args.supabase
    .from("newsletters")
    .select("id, subject, preview_text, content")
    .eq("id", args.newsletterId)
    .maybeSingle()
  if (!data) return null
  const row = data as { id: string; subject: string; preview_text: string | null; content: string | null }
  return {
    kind: "newsletter",
    id: row.id,
    title: row.subject,
    slug: "",
    excerpt: row.preview_text || null,
    content: row.content ? htmlToText(row.content) : null,
    cover_image_url: null,
  }
}
```
  5. In `handleSocialAgentRun`, before the strategist: if both `input.blogPostId` and `input.newsletterId` are set → `await failJob("A share names one source: blogPostId or newsletterId, not both"); return`. If `input.newsletterId`: `const topic = await pickNewsletterTopic(...)`; if null → `failJob("Newsletter not found")`; set `brief = null`, `alignmentScore = null` and skip `pickTopicWithBrief` (explicit shares skip the brief exactly like an explicit `blogPostId`). Restructure with `let` bindings so both paths feed the rest of the handler unchanged.
  6. `buildCopywriterUserMessage`: label the source by kind (`Source blog post title:` vs `Source newsletter issue subject:`) and append these lines before "Write the post for this platform":

```ts
    "A link card to the source is attached beneath this post automatically.",
    "Do not paste a URL and do not write 'link below' or 'link in comments'.",
    input.topic.kind === "newsletter"
      ? "End with one short line inviting the reader to subscribe to the newsletter."
      : "",
```
  7. `draftForPlatform` takes `siteUrl?: string`; the insert becomes:

```ts
      .insert({
        platform,
        content: finalCaption.caption_text,
        approval_status: "draft",
        post_type: "text",
        ...buildShareLink(topic, siteUrl),
      })
```
  8. Memo + job result: `blog_post_id: topic.kind === "blog" ? topic.id : null` and add `newsletter_id: topic.kind === "newsletter" ? topic.id : null` in both the memo action payload and the job `result`. (The UI reads `result.platforms[0].social_post_id`; keep that shape.)

- [ ] **Step 6: Extend `functions/src/__tests__/social-agent.test.ts`:**
  - `buildCopywriterUserMessage` cases: a blog topic's message contains "Do not paste a URL" and NOT "subscribe"; a newsletter topic's message contains "Source newsletter issue subject:" and "subscribe".
  - `pickNewsletterTopic`: with a fake `supabase.from("newsletters")` returning `{ id: "n1", subject: "Issue 12", preview_text: "", content: "<p>Rest &amp; recover</p>" }` → `{ kind: "newsletter", title: "Issue 12", excerpt: null, content: "Rest & recover", … }`; returning `null` → `null`.
  - `handleSocialAgentRun` with `input: { platform: "linkedin", blogPostId: "b1", newsletterId: "n1" }` → the last `jobUpdate` is `{ status: "failed", error: "A share names one source: blogPostId or newsletterId, not both" }` and `h.from` was never called with `"social_posts"`.
  - Existing `pickTopic` tests: update expected rows to include `kind: "blog"` and `cover_image_url` where the fakes return them.

- [ ] **Step 7: Cron route passes `siteUrl`.** In `app/api/admin/internal/social-agent-cron/route.ts`: `import { SITE_URL } from "@/lib/constants"` and `input: { platform: "linkedin", businessId: platformBusinessId(), siteUrl: SITE_URL }`. Extend `__tests__/api/admin/internal/social-agent-cron.test.ts`: the enqueued input equals `{ platform: "linkedin", businessId: <the mocked platform id>, siteUrl: "https://www.darrenjpaul.com" }`.

- [ ] **Step 8: Run** the three test files (functions: `social-share-link.test.ts`, `social-agent.test.ts`; root: `social-agent-cron.test.ts`) → PASS. `npx tsc --noEmit -p functions 2>&1 | grep -E "social-agent|social-share-link"` → no output.

- [ ] **Step 9: Commit**

```bash
git add functions/src/social-share-link.ts functions/src/social-agent.ts functions/src/__tests__/social-share-link.test.ts functions/src/__tests__/social-agent.test.ts app/api/admin/internal/social-agent-cron/route.ts __tests__/api/admin/internal/social-agent-cron.test.ts
git commit -m "feat(social-agent): draft from a newsletter issue, and write the link card on every draft"
```

---

### Task 5: Share route

**Files:**
- Create: `app/api/admin/social/share/route.ts`
- Modify: `lib/tenancy/platform.ts` (inventory comment: add the share route beside `app/api/admin/social/agent/run/route.ts`)
- Test: `__tests__/api/admin/social/share.test.ts` (create); re-run `__tests__/lib/tenancy/platform-inventory.test.ts`

**Interfaces:**
- Consumes: `findOpenShareDraft`, `ShareSource` (Task 1); agent input keys (Task 4); `getBlogPostById` (`lib/db/blog-posts.ts`, throws when missing), `getNewsletterById` (`lib/db/newsletters.ts`, throws when missing), `listPlatformConnections` (`lib/db/platform-connections.ts`), `createAiJob` (`lib/ai-jobs`), `canAccessAdminPath` (`lib/permissions/guard`), `platformBusinessId` (`lib/tenancy/platform`), `SITE_URL` (`lib/constants`).
- Produces: `POST /api/admin/social/share` → `202 { jobId }` | `200 { existingPostId }` | `4xx { error }`. Task 6's button relies on exactly these shapes.

- [ ] **Step 1: Failing tests** `__tests__/api/admin/social/share.test.ts`, mocking as `__tests__/api/admin/social/agent-run.test.ts` does (hoisted `h` with `auth`, `canAccessAdminPath`, `createAiJob`), plus `@/lib/db/blog-posts` (`getBlogPostById`), `@/lib/db/newsletters` (`getNewsletterById`), `@/lib/db/platform-connections` (`listPlatformConnections`), `@/lib/db/social-posts` (`findOpenShareDraft`), `@/lib/tenancy/platform` (`platformBusinessId: () => "platform-biz"`). Cases — every refusal asserts `createAiJob` was NOT called, and the first case is the positive control:
  1. published blog, LinkedIn connected, no open draft → 202 `{ jobId: "job-1" }` and `createAiJob` called once with `{ type: "social_agent_run", userId: "admin-1", input: { platform: "linkedin", blogPostId: "b1", siteUrl: "https://www.darrenjpaul.com", businessId: "platform-biz" } }`.
  2. sent newsletter → 202 with `input.newsletterId: "n1"` and no `blogPostId` key.
  3. scheduled newsletter → 202.
  4. open draft exists → 200 `{ existingPostId: "sp-9" }`.
  5. draft blog → 409 `{ error: "Only published posts can be shared" }`.
  6. draft newsletter → 409 `{ error: "Only sent or scheduled issues can be shared" }`.
  7. LinkedIn row `not_connected` (or absent) → 409 `{ error: "Connect LinkedIn first (Platform connections)" }`.
  8. both ids → 400 `{ error: "Send blogPostId or newsletterId, not both" }`; neither → 400 `{ error: "Send blogPostId or newsletterId" }`.
  9. unknown blog (getter throws) → 404 `{ error: "Blog post not found" }`; unknown newsletter → 404 `{ error: "Newsletter not found" }`.
  10. no session → 401.

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** `app/api/admin/social/share/route.ts`:

```ts
// app/api/admin/social/share/route.ts
// POST { blogPostId } | { newsletterId } — "Share to LinkedIn". Returns an
// existing un-posted LinkedIn draft from the same source if there is one;
// otherwise queues the social agent (functions/src/social-agent.ts), which
// drafts the post in the brand voice with a link card and lands it in
// /admin/social for review. Spec: docs/superpowers/specs/2026-09-29-share-to-linkedin-design.md
//
// The dedupe is check-then-enqueue, not atomic: two concurrent requests can
// both draft. The button disables itself while a request is in flight.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAiJob } from "@/lib/ai-jobs"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { platformBusinessId } from "@/lib/tenancy/platform"
import { SITE_URL } from "@/lib/constants"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { getNewsletterById } from "@/lib/db/newsletters"
import { listPlatformConnections } from "@/lib/db/platform-connections"
import { findOpenShareDraft, type ShareSource } from "@/lib/db/social-posts"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { blogPostId?: unknown; newsletterId?: unknown }
    | null
  const blogPostId = typeof body?.blogPostId === "string" && body.blogPostId ? body.blogPostId : null
  const newsletterId = typeof body?.newsletterId === "string" && body.newsletterId ? body.newsletterId : null
  if (blogPostId && newsletterId) {
    return NextResponse.json({ error: "Send blogPostId or newsletterId, not both" }, { status: 400 })
  }
  if (!blogPostId && !newsletterId) {
    return NextResponse.json({ error: "Send blogPostId or newsletterId" }, { status: 400 })
  }

  let source: ShareSource
  if (blogPostId) {
    const post = await getBlogPostById(blogPostId).catch(() => null)
    if (!post) return NextResponse.json({ error: "Blog post not found" }, { status: 404 })
    if (post.status !== "published") {
      return NextResponse.json({ error: "Only published posts can be shared" }, { status: 409 })
    }
    source = { blogPostId }
  } else {
    const issue = await getNewsletterById(newsletterId!).catch(() => null)
    if (!issue) return NextResponse.json({ error: "Newsletter not found" }, { status: 404 })
    if (issue.status !== "sent" && issue.status !== "scheduled") {
      return NextResponse.json({ error: "Only sent or scheduled issues can be shared" }, { status: 409 })
    }
    source = { newsletterId: newsletterId! }
  }

  const connections = await listPlatformConnections()
  if (!connections.some((c) => c.plugin_name === "linkedin" && c.status === "connected")) {
    return NextResponse.json({ error: "Connect LinkedIn first (Platform connections)" }, { status: 409 })
  }

  const existing = await findOpenShareDraft(source)
  if (existing) return NextResponse.json({ existingPostId: existing.id }, { status: 200 })

  // businessId: the PLATFORM's, for the same reason as agent/run (see
  // lib/tenancy/platform.ts): nothing the social agent reads or writes has a
  // business_id, and the blog and newsletter are darrenjpaul.com's own.
  const { jobId } = await createAiJob({
    type: "social_agent_run",
    userId: session.user.id,
    input: { platform: "linkedin", ...source, siteUrl: SITE_URL, businessId: platformBusinessId() },
  })
  return NextResponse.json({ jobId }, { status: 202 })
}
```

- [ ] **Step 4: Inventory.** In `lib/tenancy/platform.ts`'s doc comment, the "SEO and social agents' JOB BUSINESS" bullet: change "three enqueue routes" to "four enqueue routes" and add `app/api/admin/social/share/route.ts (Share to LinkedIn from a blog post or newsletter issue)` to its list; the sentence about the manual route having a session applies to it too — say so ("The two manual routes HAVE one…"). Run `__tests__/lib/tenancy/platform-inventory.test.ts` → PASS (it fails if the route calls `platformBusinessId` without being listed).

- [ ] **Step 5: Run the share tests → PASS; tsc grep `social/share|tenancy/platform` → none.**

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/social/share/route.ts lib/tenancy/platform.ts __tests__/api/admin/social/share.test.ts
git commit -m "feat(social): POST /api/admin/social/share queues a LinkedIn draft from a blog post or issue"
```

---

### Task 6: Share to LinkedIn button, placed on blog + newsletter; homepage anchor

**Files:**
- Create: `components/admin/social/ShareToLinkedInButton.tsx`
- Modify: `components/admin/blog/BlogPostList.tsx` (actions cell, published rows)
- Modify: `app/(admin)/admin/blog/[id]/edit/page.tsx` (header, when published)
- Modify: `components/admin/newsletter/NewsletterList.tsx` (actions cell, sent/scheduled rows)
- Modify: `app/(admin)/admin/newsletter/[id]/edit/page.tsx` (header, when sent/scheduled)
- Modify: `app/(marketing)/page.tsx` (newsletter `<section>` gets `id="newsletter"` and `scroll-mt-20`)
- Test: `__tests__/components/admin/social/ShareToLinkedInButton.test.tsx` (create); re-run any existing BlogPostList / NewsletterList component tests (`git grep -ln "BlogPostList\|NewsletterList" -- __tests__`)

**Interfaces:**
- Consumes: the route in Task 5; `useAiJob` from `@/hooks/use-ai-job` (`status: "pending"|"processing"|"streaming"|"completed"|"failed"|"cancelled"`, `error`, `result`).
- Produces: `export function ShareToLinkedInButton(props: { source: { blogPostId: string } | { newsletterId: string }; variant?: "icon" | "full" })`. `icon` = list rows (icon button, label in `title`/`aria-label`); `full` = edit page header (icon + text).

- [ ] **Step 1: Failing component test** (Testing Library; mock `@/hooks/use-ai-job` with a controllable return; mock `fetch`; mock `sonner`):
  1. Idle renders a button named "Share to LinkedIn".
  2. Click → `fetch("/api/admin/social/share", { method: "POST", body: JSON.stringify({ blogPostId: "b1" }) … })`; while the request is pending the button is disabled (a second click sends nothing).
  3. 202 `{ jobId }` → shows "Writing LinkedIn post…"; when the mocked hook reports `completed` → a link "Draft ready → review in Social" with `href="/admin/social"`.
  4. 200 `{ existingPostId }` → a link "Draft already in Social" with `href="/admin/social"`, and the hook was given no job id.
  5. 409 `{ error: "Connect LinkedIn first (Platform connections)" }` → `toast.error` called with that exact message, button back to idle.
  6. hook reports `failed` with `error: "All platforms failed: …"` → `toast.error("Couldn't write the LinkedIn post: All platforms failed: …")`, button back to idle.
  7. hook reports `completed` with `result.skipped` → `toast.error` with a plain message ("The agent decided not to draft this one") and idle.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `components/admin/social/ShareToLinkedInButton.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Linkedin, Loader2, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { useAiJob } from "@/hooks/use-ai-job"
import { cn } from "@/lib/utils"

type Source = { blogPostId: string } | { newsletterId: string }
type State = "idle" | "requesting" | "writing" | "ready" | "exists"

export function ShareToLinkedInButton({ source, variant = "icon" }: { source: Source; variant?: "icon" | "full" }) {
  const [state, setState] = useState<State>("idle")
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useAiJob(jobId)

  useEffect(() => {
    if (state !== "writing" || !jobId) return
    if (job.status === "completed") {
      if (job.result && "skipped" in job.result) {
        toast.error("The agent decided not to draft this one")
        setJobId(null)
        setState("idle")
      } else {
        setState("ready")
      }
    } else if (job.status === "failed" || job.status === "cancelled") {
      toast.error(`Couldn't write the LinkedIn post: ${job.error ?? "unknown error"}`)
      setJobId(null)
      setState("idle")
    }
  }, [state, jobId, job.status, job.error, job.result])

  async function share() {
    if (state !== "idle") return
    setState("requesting")
    try {
      const res = await fetch("/api/admin/social/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source),
      })
      const data = (await res.json().catch(() => ({}))) as { jobId?: string; existingPostId?: string; error?: string }
      if (res.status === 202 && data.jobId) {
        setJobId(data.jobId)
        setState("writing")
      } else if (res.ok && data.existingPostId) {
        setState("exists")
      } else {
        toast.error(data.error ?? "Couldn't start the LinkedIn post")
        setState("idle")
      }
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.")
      setState("idle")
    }
  }

  if (state === "ready" || state === "exists") {
    return (
      <Link
        href="/admin/social"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
      >
        {state === "ready" ? "Draft ready → review in Social" : "Draft already in Social"}
        <ArrowRight className="size-3" />
      </Link>
    )
  }

  const busy = state === "requesting" || state === "writing"
  const label = state === "writing" ? "Writing LinkedIn post…" : "Share to LinkedIn"
  return (
    <button
      type="button"
      onClick={share}
      disabled={busy}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-60",
        variant === "icon" ? "p-1.5" : "px-3 py-1.5 text-sm border border-border",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Linkedin className="size-4" />}
      {variant === "full" || state === "writing" ? <span className="text-xs">{label}</span> : null}
    </button>
  )
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Place it.**
  - `BlogPostList.tsx` actions cell: first child of the `justify-end` div: `{post.status === "published" && <ShareToLinkedInButton source={{ blogPostId: post.id }} />}`.
  - Blog edit page: replace the `<h1>` with a flex row: `<div className="flex items-center justify-between gap-4 mb-6"><h1 className="text-2xl font-semibold text-primary">Edit Blog Post</h1>{post.status === "published" && <ShareToLinkedInButton source={{ blogPostId: post.id }} variant="full" />}</div>`.
  - `NewsletterList.tsx` actions cell: first child: `{(nl.status === "sent" || nl.status === "scheduled") && <ShareToLinkedInButton source={{ newsletterId: nl.id }} />}`.
  - Newsletter edit page: same header pattern, shown when `newsletter.status === "sent" || newsletter.status === "scheduled"`.
  - Homepage: the `{/* ─── Newsletter Section ─── */}` `<section>` gains `id="newsletter"` and `scroll-mt-20` (so the fixed header does not cover the form).

- [ ] **Step 6: Re-run the button test and any existing list tests by file; tsc grep `ShareToLinkedIn|BlogPostList|NewsletterList|blog/\[id\]|newsletter/\[id\]|\(marketing\)/page` → none.**

- [ ] **Step 7: Commit**

```bash
git add components/admin/social/ShareToLinkedInButton.tsx components/admin/blog/BlogPostList.tsx "app/(admin)/admin/blog/[id]/edit/page.tsx" components/admin/newsletter/NewsletterList.tsx "app/(admin)/admin/newsletter/[id]/edit/page.tsx" "app/(marketing)/page.tsx" __tests__/components/admin/social/ShareToLinkedInButton.test.tsx
git commit -m "feat(social): Share to LinkedIn button on published blog posts and sent/scheduled issues"
```

---

### Task 7: Manual Text posts without the multimedia flag

**Files:**
- Modify: `components/admin/content-studio/calendar/ManualPostDialog.tsx`
- Modify: `app/api/admin/content-studio/posts/route.ts`
- Test: `__tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx` (extend); `__tests__/api/admin/content-studio/posts-text.test.ts` (create, mocking like `posts-image.test.ts`)

**Interfaces:** none new.

- [ ] **Step 1: Failing route tests** `posts-text.test.ts` (feature flag mocked OFF — `isContentStudioMultimediaEnabled: () => false`):
  1. `{ platform: "linkedin", postType: "text", caption: "Hello" }` → 200 and `createSocialPost` called with `post_type: "text"` (positive control).
  2. `{ platform: "linkedin", postType: "text", caption: "   " }` → 400 `{ error: "Write the post text first" }`, `createSocialPost` not called.
  3. `{ platform: "instagram", postType: "text", caption: "Hi" }` → 400 `instagram does not support text posts` (existing matrix).
  4. `{ platform: "linkedin", postType: "image", mediaAssetId: "m1", caption: "x" }` with the flag OFF → still 400 "Multimedia posts are disabled…" (the flag still guards media).

- [ ] **Step 2: Run, expect FAIL** (case 1 gets the multimedia 400 today).

- [ ] **Step 3: Route change** — replace the flag check with:

```ts
  // Text needs no media pipeline, so the multimedia flag (which gates photo,
  // carousel and story uploads) does not apply to it.
  if (postType !== "video" && postType !== "text" && !isContentStudioMultimediaEnabled()) {
```
and after it:

```ts
  if (postType === "text" && caption === "") {
    return NextResponse.json({ error: "Write the post text first" }, { status: 400 })
  }
```

- [ ] **Step 4: Failing dialog tests** (extend the existing file): with `multimediaEnabled={false}` the "Post type" select is present with exactly the options Video and Text; choosing Text and a LinkedIn platform posts `postType: "text"`; with `multimediaEnabled` the options are Video, Text, Photo, Carousel, Story; with Text selected and an empty caption the create button is disabled.

- [ ] **Step 5: Dialog change** — render the Post type `<label>`/`<select>` unconditionally (remove the `multimediaEnabled ? … : null` wrapper around it only), options:

```tsx
              <option value="video">Video</option>
              <option value="text">Text</option>
              {multimediaEnabled ? (
                <>
                  <option value="image">Photo</option>
                  <option value="carousel">Carousel</option>
                  <option value="story">Story</option>
                </>
              ) : null}
```
and `const canSubmit = !busy && supportedSelected.length > 0 && mediaReady && (postType !== "text" || caption.trim() !== "")`. Rename the "Caption" label to `{postType === "text" ? "Post text" : "Caption"}` keeping `aria-label="Caption"` stable for existing tests.

- [ ] **Step 6: Run both files → PASS; tsc grep `ManualPostDialog|content-studio/posts` → none.**

- [ ] **Step 7: Commit**

```bash
git add components/admin/content-studio/calendar/ManualPostDialog.tsx app/api/admin/content-studio/posts/route.ts __tests__/components/admin/content-studio/calendar/ManualPostDialog.test.tsx __tests__/api/admin/content-studio/posts-text.test.ts
git commit -m "feat(content-studio): Text posts in the manual post box, without the multimedia flag"
```

---

### Task 8 (controller, not a subagent): verification, screenshots, handoff

- [ ] Whole-branch review by a fresh reviewer (diff handed over as a file; Read/Grep only).
- [ ] `npm run test:integration:selects` + `test:integration:drift` on the dev clone; `npm run build` in the worktree and grep for touched files.
- [ ] Annotated screenshots of the REAL admin at `screenshots/share-to-linkedin/` (blog list with the button, blog edit header, newsletter list, the "Writing…" and "Draft ready" states with `/api/admin/social/share` answered by Playwright `page.route` so no real agent job fires, a draft in `/admin/social`, the manual box with Text). Light only (admin is light-only). Burn markers in; compose at capture width.
- [ ] JOURNAL.md entry; memory for anything non-obvious; report with the prod rollout order (apply `00283` to prod BEFORE merging).

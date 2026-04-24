# Content Studio Multimedia — Phase 2f Sub-spec (AI Quote-Card Carousel from Video)

**Date:** 2026-04-24
**Status:** Approved for implementation (auto mode)
**Scope:** Generate a Facebook quote-card carousel from a video's existing transcript.
**Parent:** [2026-04-24-content-studio-multimedia-design.md](./2026-04-24-content-studio-multimedia-design.md) — Phase 2

---

## 1. What this ships

End-to-end feature: admin uploads a video → transcription runs (existing flow) → admin opens the video drawer → clicks **"Generate FB quote carousel"** → after ~20s, a draft Facebook carousel post appears with 5 branded quote-card images derived from the transcript. Admin reviews, edits the caption, approves, schedules.

Concrete deliverables:
- `@vercel/og` dependency added (PNG rendering via Satori + resvg-wasm, no native bindings).
- `lib/ai/quote-extraction.ts` — extracts punchy quotes from transcript text via Claude Sonnet 4.6 with structured JSON output.
- `lib/content-studio/quote-card-renderer.ts` — renders a single quote into a 1080×1080 PNG using `@vercel/og`'s `ImageResponse` (or `new Satori().render()` for buffer-return pathways).
- `app/api/admin/content-studio/quote-cards/route.ts` — POST route that runs the whole flow and returns `{postId}`.
- Minimal UI button on the admin video detail surface (the existing `DrawerVideoHeader` or equivalent) that triggers the endpoint and navigates to the draft post.

## 2. What this DOES NOT ship

| | Reason | Future phase |
|---|---|---|
| Instagram quote cards | IG carousels require JPEG; `@vercel/og` outputs PNG. Need a JPEG converter (resvg-js or Sharp). | Phase 2f.b |
| LinkedIn multi-image quote-card carousel | Same PNG works but LinkedIn-specific nuances (org tagging, doc-vs-multiimage UX) deserve their own phase | Phase 2f.c |
| Custom DJP brand font (Lexend Exa) loading | `@vercel/og` requires a font file buffer. For MVP use Satori's system-font fallback; brand font comes in polish phase | Phase 2f polish |
| Variable layout templates (quote+avatar, quote-over-frame, etc.) | Single template for MVP | Phase 2f.d |
| Quote editing / regeneration UI (admin tweaks the AI's picks before rendering) | Single-shot generate-and-commit for MVP. Admin can re-run endpoint to regenerate; overwrites the draft post. | Follow-up |
| Async Firestore job (like image_vision) | Full flow runs synchronously in the API route. 5 renders × ~300ms + Claude call ~8s + uploads ~3s ≈ 15-20s, within Vercel's default timeout. Move to async only if it breaks. | If needed |

## 3. Goals

- A video's transcript becomes a ready-to-review FB carousel post in under 30 seconds from button click.
- Generated assets are first-class `media_assets` rows with `derived_from_video_id` + `ai_analysis.origin = "quote_card"` so they show up correctly in a future asset library.
- Existing carousel publish path (Phase 2b FB plugin) publishes the draft unchanged — no plugin work required.

## 4. Non-goals

- Font / color customization via the UI.
- Multi-platform mix (generate for FB + IG simultaneously).
- Re-rendering already-generated quote cards (admin can delete the draft post and regenerate).

## 5. Architecture

### 5.1 Quote extraction

`lib/ai/quote-extraction.ts` exports `extractQuotesFromTranscript(transcript: string, count = 5): Promise<string[]>`. Uses the same `@anthropic-ai/sdk` pattern as `functions/src/image-vision.ts`:

- System prompt instructs Claude to return a JSON array of N quotes, each ≤ 140 chars, each a punchy hook or standalone line.
- Model: `claude-sonnet-4-6`.
- Falls back to `[]` if the response doesn't parse.

### 5.2 Quote card rendering

`lib/content-studio/quote-card-renderer.ts` exports `renderQuoteCard(text: string): Promise<Buffer>`. Uses `ImageResponse` from `next/og` (Next.js 16 has this built in via `@vercel/og`):

- Output: 1080×1080 PNG
- Background: brand primary `oklch(0.30 0.04 220)` (Green Azure) — inline as a hex approximation since Satori doesn't support oklch directly
- Center-aligned quote text, system serif fallback, size scales with content length (80px for ≤80 chars, 60px for 81-120, 48px for 121-140)
- Small "— Darren J Paul" footer in accent Gray Orange `#C49B7A`
- No logo image for MVP (would need inlined base64 asset); text-only branding

### 5.3 API route

`POST /api/admin/content-studio/quote-cards`:
- Input: `{videoUploadId: string, count?: number (2-10, default 5)}`
- Platform: hardcoded to `"facebook"` for MVP (PNG-compatible). Surface a platform param in the API for forward-compat but only accept "facebook" for now.
- Flow:
  1. Auth admin
  2. Load `video_uploads` + `video_transcripts` via DAL
  3. Reject if no transcript_text available
  4. Call `extractQuotesFromTranscript` → N quotes
  5. Render each quote to PNG via `renderQuoteCard`
  6. Upload each PNG to Firebase Storage at `images/{userId}/{timestamp}-quote-{i}.png`
  7. Insert each as `media_assets` row with `kind='image'`, `mime_type='image/png'`, `derived_from_video_id=videoUploadId`, `ai_analysis={origin: 'quote_card', quote: <source>}`
  8. Create a draft `social_posts` row with `post_type='carousel'`, `platform='facebook'`, `approval_status='draft'`, empty caption
  9. Attach each asset at its position via `attachMedia`
  10. Return `{postId, mediaAssetIds}`

Error handling: any step that fails rolls back any created assets/post (best-effort). Return structured error.

### 5.4 UI trigger

Check where the admin currently views video detail — likely:
- `components/admin/content-studio/drawer/DrawerVideoHeader.tsx`, or
- `app/(admin)/admin/content/[videoId]/page.tsx`

Add a "Generate FB quote carousel" button with icon. On click:
- POST to the new endpoint
- While pending: disable button, show spinner label
- On success: toast "Draft carousel created" + auto-navigate to `/admin/content/post/{postId}`
- On error: toast the error message

## 6. Files

**Create:**
- `lib/ai/quote-extraction.ts`
- `lib/content-studio/quote-card-renderer.ts`
- `app/api/admin/content-studio/quote-cards/route.ts`
- `__tests__/lib/ai/quote-extraction.test.ts`
- `__tests__/lib/content-studio/quote-card-renderer.test.ts`
- `__tests__/api/admin/content-studio/quote-cards.test.ts`

**Modify:**
- `package.json` — add `@vercel/og` (or confirm Next.js 16 bundles it at `next/og`)
- One of the video drawer / detail components — add the button
- `__tests__/` matching the UI change

## 7. Testing

- **Quote extraction unit** — mock Anthropic SDK, assert shape + JSON fallback.
- **Renderer unit** — call `renderQuoteCard("test")`, assert returns Buffer with PNG magic bytes (`0x89 0x50 0x4E 0x47`). Don't assert pixel content; just that the pipeline produces valid PNG bytes.
- **API route unit** — mock all DAL + renderer + upload helpers; assert the full orchestration calls them in order and returns the postId.
- **Button component unit** — click triggers fetch, success toast + navigation.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `@vercel/og` + Satori + resvg-wasm inflates the bundle | Acceptable for admin-only route that's not in the client bundle. Server-only. |
| Render takes longer than expected (Satori + resvg on long text) | Benchmark 5 renders locally; if total > 20s, parallelize or move to async job. |
| Firebase Storage upload fails partway | Track created assets; on error, best-effort delete what was uploaded and rollback the post insert. |
| Transcript too short (no usable quotes extracted) | Claude returns `[]`, route returns 422 with `"transcript too short to extract quotes"`. |
| Same video regenerated creates duplicate assets | Accept for MVP — each call creates fresh assets. Dedupe / reuse is a separate phase. |

## 9. Rollout

1. Land the phase behind existing `CS_MULTIMEDIA_ENABLED` flag — the route returns 400 if flag is off.
2. Smoke test on staging: pick a real video, generate, verify FB draft post renders with 5 cards.
3. Flip prod flag if not already on, dogfood one real FB quote carousel.

## 10. Open questions (deferred)

- Should quote cards be added to an existing draft post instead of always creating a new one?
- Should the UI show a preview grid of the generated cards before creating the post (admin approves before commit)?
- IG support needs JPEG conversion — do we use `@resvg/resvg-js` with `.render().asJpeg()`, or introduce Sharp, or render directly to a canvas? → defer to Phase 2f.b.

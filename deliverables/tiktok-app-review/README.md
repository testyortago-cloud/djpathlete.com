# TikTok app review — submission pack

Built 2026-09-21 for the "App details" / "App review" form.

| Item | File | State |
|---|---|---|
| App icon | `tiktok-app-icon-1024.png` | ✅ ready |
| Description | below, 112/120 chars | ✅ ready |
| Products + scopes | `app-review-explanation.txt`, 972/1000 | ✅ ready |
| Demo video | `tiktok-demo.mp4` + `tiktok-demo-poster.png` | ⚠️ renders, but shows a QUEUED post, not a landed one |

## 1. App icon

1024x1024, PNG, opaque, 37KB (limit 5MB). Brand mark on the brand primary
`#13323c` (`oklch(0.30 0.04 220)`). Rebuild: `node scripts/make-tiktok-app-icon.mjs`.

Two traps in the source art, both already hit once:

- `public/brand/dj-logo.png` carries a **1px frame at inset 20 at full alpha**, so
  `sharp.trim()` and any naive alpha bounding box return the whole 2040 canvas and
  the mark lands tiny and off-centre. The script crops inside the frame first.
- the mark is **white on transparency** — invisible on a white page. It has to be
  composed on the brand colour, not merely resized.

The mark is 727x547 in the source and lands 660px wide: downscaled, never enlarged.

## 2. Description (120 limit)

    Strength coaching for athletes. Coaches upload training clips, write captions, and post them straight to TikTok.

## 3. Products and scopes (1000 limit)

`app-review-explanation.txt`. Covers the two products and all **three** scopes the
app actually requests in
`app/api/admin/platform-connections/tiktok/connect/route.ts`: `user.info.basic`,
`video.publish`, `video.upload`.

If `video.upload` is not needed separately, remove it from BOTH the portal and
`SCOPES` in that route before submitting — the form warns that unused scopes delay
review.

## 4. Demo video

`tiktok-demo.mp4` — 1920x1080, 30fps, yuv420p, bt709, **90.3s, 16.5MB** (limit
50MB). Shot against **production** as `admin@darrenjpaul.com`, so the footage is
the real site with the real linked account, not a local build.

The `.mp4` is **gitignored** (`.gitignore:75`, `*.mp4`), so it lives here on disk
only. The poster frame is committed.

Four chapters, ordered the way a reviewer reads the form:

| Chapter | Shows | Covers |
|---|---|---|
| `01-connection` | Connections page, handle `darrenjpaul_` | Login Kit / `user.info.basic` |
| `02-library` | the coach's own uploaded videos | provenance of the media |
| `03-caption` | the editable TikTok caption | "nothing posts automatically" |
| `04-publish` | pressing Publish now | `video.publish` + `video.upload` |

Rebuild:

    DEMO_VIDEO_ID=<video> DEMO_POST_ID=<its tiktok social_posts row> \
    BASE_URL=https://www.darrenjpaul.com \
    node scripts/record-walkthrough.mjs --show tiktok-demo
    node scripts/prepare-walkthrough-media.mjs --show tiktok-demo
    cd render-worker && npx remotion render src/remotion/index.ts TikTokDemo \
      out/tiktok-demo.mp4 --image-format=png --color-space=bt709 --codec=h264 --crf=18

`HEADED=1` opens a real window to watch a take; headless is the default and is
what the shipping take should use, since a headed run can capture a screen lock
or a Space switch.

### The address chip is not decoration

Playwright's `recordVideo` captures the **page viewport only** — there is no
browser chrome in a take, so no address bar and no domain anywhere on screen. The
form requires "the domain of the website shown in the demo video matches the
website URL you provide", so the composition burns in a `www.darrenjpaul.com`
chip. It labels genuine production footage; it does not stand in for it.

### What this video does NOT show, and why

It shows the flow through to the **queued** confirmation, not a post landing on
TikTok. "Publish now" does not upload — it sets the row to `scheduled` with a past
timestamp, and `publishDuePostsCron` (`*/5 * * * *`) performs the upload up to five
minutes later. That post then failed:

    unaudited_client_can_only_post_to_private_accounts

**This is progress, not a regression.** The previous error was
`url_ownership_unverified`; it is gone, which proves the FILE_UPLOAD fix
(`894194a2`) is deployed and working against the live API. TikTok now refuses on
policy, not on transfer.

The rule is about the **account**, not the post: while the app is unaudited it can
only post to a TikTok account that is itself set to private. `darrenjpaul_` is
public, so `TIKTOK_PRIVACY_LEVEL` is irrelevant here.

### What unblocks a video showing a successful post

Not waiting for approval — that is circular, since the video is an input to the
approval. The form states that an app never approved before is **required** to use
a **sandbox** environment for the demo, and sandbox target accounts are private by
design, which is exactly what the error is asking for.

1. Create the sandbox in the TikTok Developer Portal, add a target test account.
2. Connect that account on `/admin/platform-connections`.
3. Re-run the three commands above.

Check before switching: the app reads `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`
from env. If the sandbox issues its own credentials, repointing those will drop the
live `darrenjpaul_` connection until they are pointed back — and chapter 01 shows
the connected account, so all four chapters would need re-shooting.

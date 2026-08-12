# Team Permissions Walkthrough — design

**Date:** 2026-08-12
**Deliverable:** `team-permissions-walkthrough.mp4` — a ~3 minute narrated how-to for the
admin team-permissions feature, owner-side only.

## What this is

A short instructional recording that teaches the owner how to invite a teammate, decide
what they can reach, scope them to particular clients, and change or remove that access
later. It is a how-to, not a marketing piece, and it films only the owner's screen — no
second account, no teammate's-eye view.

The existing narrated pipeline (built for the AI Bookkeeper walkthrough, commit
`55d0a296`) does all the hard parts already: Windows SAPI synthesizes each line, the
recorder holds each screen for exactly as long as its line runs, and Remotion stitches
the chapters with captions. This reuses that pipeline rather than inventing a second one.

## Approach: parameterize the pipeline by "show"

The four pipeline scripts are currently hard-wired to the bookkeeper — one exported
`CHAPTERS`, one output directory, one Remotion composition with a hard-coded chapter
order. Three options were considered:

- **Overwrite the bookkeeper's script.** Rejected: it destroys `timeline.json` and ~60
  narration WAVs, so the bookkeeper video could never be re-rendered.
- **Fork all four scripts.** Rejected: four near-duplicates now, twelve after the next
  video.
- **Add a `--show` parameter.** Chosen.

A single registry names each show. The bookkeeper keeps the directory name `walkthrough`
so no existing asset moves and its default behaviour stays byte-identical.

```js
// scripts/walkthroughs/registry.mjs
export const SHOWS = {
  bookkeeper: {
    chapters:    "./bookkeeper.mjs",
    dir:         "walkthrough",          // unchanged — existing assets stay put
    composition: "BookkeeperWalkthrough",
    viewport:    { width: 1600, height: 1000 },
    zoom:        1,
  },
  "team-permissions": {
    chapters:    "./team-permissions.mjs",
    dir:         "walkthrough-team",
    composition: "TeamPermissionsWalkthrough",
    viewport:    { width: 1920, height: 1080 },
    zoom:        1.2,
  },
}
```

Everything else derives from that entry: `.playwright-out/<dir>/`,
`render-worker/public/<dir>/`, and `scripts/narration/<show>.json`.

**The narration manifest must be namespaced per show.** It is keyed
`"<chapterId>#<index>"`, and both shows have a chapter `01-…`. A shared manifest would
hand one show's measured durations to the other's beats, and the recorder would hold
every screen for the wrong length — silently, because a number is a number. The
bookkeeper's existing `scripts/walkthrough-narration.json` moves to
`scripts/narration/bookkeeper.json`.

### Module split

| File | Role |
|---|---|
| `scripts/walkthroughs/registry.mjs` | The `SHOWS` table + a `resolveShow(id)` helper |
| `scripts/walkthroughs/timing.mjs` | `captionMs`, `beatMs`, `BREATH_MS`, manifest loading (per show) |
| `scripts/walkthroughs/bookkeeper.mjs` | The existing 13 chapters, moved verbatim |
| `scripts/walkthroughs/team-permissions.mjs` | The new 5 chapters |
| `scripts/record-walkthrough.mjs` | The recorder, `--show <id>` (default `bookkeeper`) |
| `scripts/synth-walkthrough-narration.mjs` | Gains `--show` |
| `scripts/prepare-walkthrough-media.mjs` | Gains `--show` |

`scripts/record-bookkeeper-walkthrough.mjs` is replaced by `record-walkthrough.mjs`.
`scripts/walkthrough-script.mjs` is replaced by `walkthroughs/timing.mjs` +
`walkthroughs/bookkeeper.mjs`.

## Native HD capture

The bookkeeper take captures 1600×1000 and the Remotion edit scales it **up** to
1920×1080 with a top-biased crop. That is an upscale, and it is the thing the standing
rule about HD exists to prevent.

The new show captures at **1920×1080 and maps 1:1** — a 1920×1080 viewport is already
16:9, so there is no scale, no crop, and no letterbox in the edit at all.

A 1920-wide viewport renders the admin UI physically smaller, which is worse for a
how-to, so the recorder injects `zoom: 1.2` on the root element. The layout viewport
becomes 1600×900 CSS px — the framing the bookkeeper take has — while the frames are
rasterised at a true 1920×1080. `deviceScaleFactor` cannot be used for this: Playwright's
`recordVideo` ignores it and `recordVideo.size` only ever scales content down.

**Verify before trusting it.** Screenshot `/admin/team` at zoom 1.2 and confirm the
sticky admin sidebar and the dialog's `max-h-[85vh]` still behave. If `zoom` disturbs
either, fall back to `zoom: 1` — still native 1080p, just a smaller-looking UI. Do not
fall back to upscaling.

## Demo data

`/admin/team` in the dev clone currently holds two rows, both video editors, both with
real personal Gmail addresses. There is nothing to teach with — no permission summaries,
no tiers, no assignments — and the addresses must not appear in a video that may be
shown to a new hire.

`scripts/seed-team-demo.mjs` fixes both problems. It is idempotent, so it can be re-run
between takes.

**Seeded teammates** (`users` rows; `password_hash` has been nullable since migration
`00125`, so no auth records are needed — these accounts are never signed into):

| Name | Preset | Permissions | Status |
|---|---|---|---|
| Marcus Bell | Coach | clients, programs, schedule, form_reviews, messages | active, 4 assigned clients |
| Priya Raman | Marketing Manager | blog, social, website, funnels, seo, leads, analytics:view | active |
| Joanne Wu | Bookkeeper | accounting:manage, payments:view, analytics:view | active |
| Tess Okafor | Front Desk | clients, schedule, messages, leads | **suspended** |
| Danny Cruz | Video Editor | *(none)* → role `editor` | active |

Plus one **pending invite** to `alex.reyes@djpathlete.demo`, so chapter 5 has a
resend/revoke target that exists before filming and does not depend on chapter 3 having
run. Every chapter records in its own browser context precisely so it can be re-recorded
alone; a chapter that depends on an earlier chapter's side effect breaks that.

All demo addresses are on `djpathlete.demo`. Emails to them cannot be delivered, which is
the point — see "Filming performs real mutations" below.

**The two real rows are neutralized**, not deleted: the script rewrites their names and
emails to demo identities, writes the originals to
`.playwright-out/team-demo-backup.json`, and `--restore` puts them back.

**Production guard.** The script requires `--target <project-ref>` and refuses to run
unless that value equals the project ref parsed out of `NEXT_PUBLIC_SUPABASE_URL`. It
prints the resolved host before doing anything.

No ref is hard-coded, so nothing about which database is which is committed to the repo,
and the guard fails closed: running it against production would mean deliberately typing
production's ref. A denylist on the prod ref would have the opposite polarity — it would
pass by default for any database it had never heard of.

## Filming performs real mutations

The recording clicks real buttons against whatever database `.env.local` points at. That
is the stale dev clone, so the writes are harmless. Two consequences worth stating:

- **"Send invite" attempts a real email.** `RESEND_API_KEY` is set in `.env.local`. But
  `app/api/admin/team/invites/route.ts:62` catches the send failure and still returns
  201, so an undeliverable `@djpathlete.demo` address produces the success toast and the
  pending row on camera while emailing nobody.
- **Chapters 2–5 mutate state**, so re-recording one needs `seed-team-demo.mjs` re-run
  first. In particular the invite created in chapter 3 makes a second run hit the unique
  violation ("An open invite already exists for this email") — the seed's reset clears
  demo invites.

## The recorder needs a richer action vocabulary

The bookkeeper's beats only navigate, click a uniquely-named button, scroll the window,
and press Escape. This walkthrough needs four things it does not have, and two of them
are outright traps in the current implementation:

1. **Row-scoped clicks.** `clickNamed` resolves `getByRole("button", {name}).first()`.
   Every member row has an "Edit access" button, so `.first()` silently films the wrong
   person. Beats need `{ row: "Marcus Bell", click: /edit access/i }`, resolving through
   `getByRole("row").filter({ hasText })`.
2. **Dialog-scoped scrolling.** `smoothScrollTo` scrolls `window`. The invite dialog is
   `max-h-[85vh] overflow-y-auto`, so window scrolling does nothing at all and the Money
   group never comes into shot. Beats need a scroll that targets the dialog's own
   scroll container.
3. **Typing** into the email field, visibly (per-character, not `fill`).
4. **Selecting** from the Role `<select>`, and clicking a **tier button** (`none` /
   `view` / `manage`), which must be scoped to its permission row — "manage" appears four
   times.

## Chapters and narration

Five chapters, 21 beats, ≈430 words — roughly 3 minutes once breaths and chapter titles
are counted.

### 1. Where it lives — `/admin/team`

1. "This is the Team page. Everyone who works with you is in one list — the people who've accepted, the people who haven't yet, and your video editors."
2. "It lives under Team in the admin sidebar, and only you can open it. No teammate can reach this page, whatever access you give them. That's the one door that never opens."
3. "Each row tells you three things: who they are, what they can reach, and whether they're active."

### 2. Inviting someone

1. "To add someone, click Invite member." — *click Invite member*
2. "Type their email. They'll get a link to set their own password — you never create one for them — and the link expires after seven days." — *type `sam.whitfield@djpathlete.demo`*
3. "Then pick a role. These are starting templates, not fixed job titles: Coach, Marketing Manager, Bookkeeper, Front Desk, or Video Editor." — *select Bookkeeper*

### 3. The permission picker

1. "Whichever role you pick just fills in the tick-boxes below. Everything from here is editable."
2. "Permissions come in four groups — Coaching, Marketing, Money and Tools. Most are a simple yes or no."
3. "The money ones are different. Payments, Accounting, Shop and Ads each have three settings: none, view, or manage. View can look; manage can change." — *scroll dialog to Money*
4. "A bookkeeper who can open the books but can't issue refunds is a two-second decision here." — *click Payments → view*
5. "Watch this note as you tick. With nothing ticked they only get the editor portal — video uploads and your feedback, no admin panel. Tick anything at all and they get the panel, limited to what's ticked."
6. "And some things can never be granted. Settings, this Team page, audit logs, automations, platform connections and your dashboard stay yours alone."
7. "Send the invite, and they appear in the list as pending until they accept." — *click Send invite*

### 4. Scoping to specific clients

1. "Ticking Clients doesn't hand someone your whole roster. It's assignment-based."
2. "Click the Clients button on their row and choose exactly who they work with." — *row Marcus Bell → click Clients*
3. "They'll see those clients and no others. A coach with four athletes sees four athletes — the rest of your roster doesn't exist for them." — *tick two, Save*

### 5. Changing and removing access

1. "Access isn't fixed at invite time. Edit access reopens the same tick-boxes for anyone already on the team." — *row Priya Raman → click Edit access*
2. "Clear every tick and they drop to the editor portal. Tick one and they're back in the panel. There's no second switch to forget."
3. "Suspend locks someone out immediately without deleting anything — the right move when someone's away, or on their way out." — *Escape, row Tess Okafor*
4. "An invite nobody's accepted yet can be re-sent or revoked." — *row alex.reyes*
5. "And whatever you change, it takes effect the next time they load a page."

## Remotion edit

`config.ts` becomes a factory rather than a module with one baked-in timeline, so each
show supplies its own `timeline.json`, chapter order and geometry. `Walkthrough.tsx`
takes the chapter list and geometry as props. Both compositions register in
`src/remotion/index.ts`.

For this show the geometry is the identity transform — `left: 0, top: 0, width: 1920,
height: 1080`. The bookkeeper keeps its fill-and-crop constants exactly as they are.

The four render traps documented for the bookkeeper all still apply and the staging step
already handles them: bound `<Audio>` to its own measured length, clamp chapters on
**counted** frames with a 3-frame tail margin, cut the lead-in with `-ss` *after* `-i`,
and stage all-intra (`-g 1`).

## Order of operations

1. `node scripts/seed-team-demo.mjs --target <dev-project-ref>`
2. `node scripts/synth-walkthrough-narration.mjs --show team-permissions`
3. `npm run dev` (must be dev — the dev-login bypass 404s under `next start`)
4. `node scripts/record-walkthrough.mjs --show team-permissions`
5. `node scripts/prepare-walkthrough-media.mjs --show team-permissions`
6. `npx remotion render src/remotion/index.ts TeamPermissionsWalkthrough` from `render-worker/`

Narration is synthesized **first** because it owns the clock. Recording against an
estimate and dubbing afterwards wastes the whole take.

## Verification

- `ffprobe` the deliverable: **1920×1080**, `yuv420p`, 30 fps.
- Rendered frame count equals the composition total.
- `volumedetect` reports real levels, not a silent track.
- Extract a frame at a beat that **navigates or opens a dialog** — an intra-chapter audio
  offset is invisible against a static screen.
- Watch chapter 3 specifically: it is the one whose framing depends on the dialog-scroll
  action working.
- Confirm no real email address appears in any frame.

## Out of scope

- The teammate's-eye view (reduced sidebar, a blocked page, the editor portal). It is the
  most persuasive footage available and it is deliberately excluded: it needs a second
  signed-in account, and `/api/dev/login` currently mints admin-only sessions from one
  fixed address. A follow-up video, if wanted.
- Any change to the bookkeeper walkthrough's content or its rendered output.
- Publishing or hosting the file anywhere.

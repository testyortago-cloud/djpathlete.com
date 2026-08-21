# Content scheduling — screenshots

All six shots are the real `/admin/*` app, driven with Playwright against the
real dev server (`npm run dev`, port 3050) and the **dev clone** Supabase
database (project ref `anjvztjiokcgiyhobknq` — never production). The admin
session was a minted NextAuth JWT for `admin@darrenjpaul.com`, and the
harness's first navigation was `/api/auth/session`, asserted to carry
`role: "admin"` before anything else ran (so an expired token would fail
loudly instead of silently screenshotting the login page).

**Light theme only.** The admin UI is light-only: dark is a `.dark` class
variant the admin components were never built against, and Playwright's
`colorScheme: "dark"` has no effect on it (it isn't `prefers-color-scheme`
driven). All shots below are the app's one real look, not a "light mode"
choice among several.

Annotations (numbered markers + captions) are burned into each PNG itself at
the capture's exact resolution (3200×2000, from a 1600×1000 viewport at
`deviceScaleFactor: 2`) — a title banner and caption legend are appended
above/below, but the screenshot pixels themselves are never scaled.

**Recaptured 2026-08-22.** Commit `d36f3800` (a fix wave landed after the
original capture) changed two things these shots document, so three of the
six went stale and were re-driven against the app running that commit:

- `01-blog-scheduled-tab.png` and `03-newsletter-scheduled-badge.png` — both
  list views used to gate the row's Schedule action to `draft` only. The fix
  also shows it on an already-`scheduled` row (icon title becomes "Move to a
  different time"), which is now called out as an extra numbered marker on
  each shot.
- `05-blog-missed-item.png` — `due.ts`'s missed-item reason used to render a
  raw ISO timestamp; it's now humanised by `formatMissedTime()`. The shot was
  redone end-to-end with a fresh post, not just a re-annotation: the row used
  in the original capture (and the one used in Task 12's smoke test) both
  still carry reason strings written by the *old* code, which re-running the
  checker does not rewrite. This shot uses "Plyometric Training: What Most
  Coaches Get Wrong" instead, put >24h overdue and then genuinely POSTed to
  `/api/admin/internal/content-schedule-due` so the *current* code generated
  the reason text — not a direct DB write of the string.
- `02-blog-schedule-dialog-open.png`, `04-blog-editor-armed-banner.png`, and
  `06-content-calendar-chips.png` were checked against the running app and
  are unchanged: `02` depicts the draft-row Schedule flow, which this fix
  wave didn't touch; `04`'s banner text and `06`'s chips were re-driven live
  and matched the committed PNGs exactly.

## The shots

1. **`01-blog-scheduled-tab.png`** — `/admin/blog`, Scheduled tab. Shows
   "Sports Performance Training: What Is Specificity?" carrying the
   Scheduled badge and its queued fire time (Aug 25, 2026, 8:30 AM), reached
   by clicking the real Schedule icon on the row and confirming in the real
   `SchedulePicker`. The row's Actions column also now carries a second
   CalendarClock icon, title `"Move to a different time"` — before commit
   `d36f3800`, the Schedule action only rendered for `draft` rows, so an
   already-scheduled post had no way to move its time, only cancel it.
2. **`02-blog-schedule-dialog-open.png`** — the real `SchedulePicker` dialog,
   open inline over the real blog list, mid-interaction (before the custom
   time was typed in) — the actual component, not a mock.
3. **`03-newsletter-scheduled-badge.png`** — `/admin/newsletter`, Scheduled
   tab. "Why Your COD Training Is Missing the Most Important Piece" reads
   **Scheduled**, not Draft — this is the Task 8 headline fix: before that
   branch, every scheduled newsletter rendered as Draft in this exact cell.
   Same as shot 1, the row now also carries the "Move to a different time"
   action — this list had the identical `draft`-only gate, fixed in the
   same commit.
4. **`04-blog-editor-armed-banner.png`** — `/admin/blog/[id]/edit` for the
   now-scheduled post, showing the armed banner: "Scheduled to go out on
   8/25/2026, 8:30:00 AM. Edits you save here will be included." with a
   working Cancel schedule link, and Publish still available in the toolbar.
5. **`05-blog-missed-item.png`** — `/admin/blog`, All tab. "Plyometric
   Training: What Most Coaches Get Wrong" shows status reverted to Draft
   with a danger-tone **Missed** badge and the runner's own
   `schedule_failed_reason` text rendered underneath the title, reading
   "Missed its slot — it was set for Thu 20 Aug 2026 at 4:31 PM UTC and that
   is more than 24 hours ago. Pick a new time." (truncated by the row's own
   single-line cell — the new wording runs a few characters longer than the
   raw ISO timestamp it replaced, so it clips a little sooner).
   **How this state was reached (recaptured 2026-08-22):** commit
   `d36f3800` humanised this message — `formatMissedTime()` in
   `lib/content-schedule/due.ts` now renders "Thu 20 Aug 2026 at 4:31 PM
   UTC" instead of a raw ISO string. The two posts used for the *original*
   capture and for Task 12's smoke test ("Braking Performance Framework..."
   and "Sport Performance Training: Train the Brake...", both still visible
   as Missed rows above this one in the All tab) still carry reason strings
   the *old* code wrote — re-running the checker doesn't rewrite an
   already-set `schedule_failed_reason`, so they stay stuck showing the raw
   ISO format forever. To show the *current* wording truthfully, a
   previously-untouched draft post ("Plyometric Training...") was set to
   `status='scheduled'`, `scheduled_at` 25 hours in the past (Supabase
   Management API, same guarded dev-clone-only pattern as Task 1), and then
   the harness genuinely `POST`ed to
   `/api/admin/internal/content-schedule-due` — the real cron endpoint,
   running the code shipped in this commit — which wrote the reason itself.
   No reason string was ever typed in directly.
6. **`06-content-calendar-chips.png`** — `/admin/content?tab=calendar`,
   reached by clicking the real Calendar tab in Content Studio's own nav.
   Shows both the blog chip and the newsletter chip from shots 1–4 and 3,
   stacked on the same day cell (both land on the same UTC day once their
   local-time inputs are converted). **No social chips appear**, and that is
   captioned honestly rather than staged around: all 50 social posts in this
   dev clone are `approval_status='draft'` with no `scheduled_at`, so there
   is nothing for the calendar to show for that channel. The panel's own
   "Nothing is waiting to be scheduled" copy confirms the same thing.

## Smoke test — the real scheduler runner against the real dev DB

Endpoint: `POST /api/admin/internal/content-schedule-due`, bearer-authed with
`INTERNAL_CRON_TOKEN` from `.env.local`, run against the dev server on
localhost:3050 (dev clone database).

**Safety constraint honored:** the call was constructed to exercise only the
non-outward-facing paths — an item still in the future (proves WAITING) and
an item more than 24h overdue (proves MISSED). No newsletter was ever placed
in the fire window, so nothing could be queued for a real send, and no blog
post was placed in the fire window either, so nothing pinged IndexNow or
queued an AI job. The fire path itself is covered by this branch's unit
tests (`__tests__/api/admin/internal/content-schedule-due.test.ts`,
`__tests__/lib/content-schedule/*.test.ts`), not exercised live.

**Fixture written directly (Management API, same pattern as shot 5):** one
extra draft blog post, "Sport Performance Training: Train the Brake, Not the
Gas" (id `4b6303ff-1e2a-4309-bacb-b100587744b2`), set to
`status='scheduled'`, `scheduled_at` = 25 hours before the call (i.e.
already past the 24h grace window) — this is the MISSED case. The two items
already sitting `scheduled` in the future from shots 1–4/3 (the blog post at
2026-08-25 00:30 UTC and the newsletter at 2026-08-25 23:15 UTC) served as
the WAITING case with no extra setup needed.

**Request:**

```
POST /api/admin/internal/content-schedule-due
Authorization: Bearer <INTERNAL_CRON_TOKEN>
```

**Response (actual, verbatim):**

```json
{ "ok": true, "considered": 3, "published": 0, "sent": 0, "missed": 1, "failed": 0 }
```

`published: 0` and `sent: 0` confirm nothing fired — no blog went out, no
newsletter was queued for send.

**Row states, before → after:**

| Row | Before | After |
|---|---|---|
| Blog "Sport Performance Training: Train the Brake, Not the Gas" (missed fixture) | `status='scheduled'`, `scheduled_at='2026-08-20T15:47:49.752Z'` | `status='draft'`, `scheduled_at=NULL`, `schedule_failed_reason='Missed its slot — it was set for 2026-08-20T15:47:49.752+00:00 and that is more than 24 hours ago. Pick a new time.'` |
| Blog "Sports Performance Training: What Is Specificity?" (waiting) | `status='scheduled'`, `scheduled_at='2026-08-25T00:30:00Z'` | unchanged — still `status='scheduled'`, same `scheduled_at` |
| Newsletter "Why Your COD Training Is Missing the Most Important Piece" (waiting) | `status='scheduled'`, `scheduled_at='2026-08-25T23:15:00Z'` | unchanged — still `status='scheduled'`, same `scheduled_at`, **not sent** |

The run was also logged to `cron_runs` by the route's own
`logCronStart`/`logCronEnd` wiring:

```json
{
  "cron_name": "contentScheduleCron",
  "status": "success",
  "detail": { "sent": 0, "failed": 0, "missed": 1, "published": 0, "considered": 3 }
}
```

confirming the health-watchdog path this branch wired up (Task 6) is live
end-to-end, not just unit-tested.

## Database

Dev clone only, Supabase project ref `anjvztjiokcgiyhobknq`. Production
(`epzuvzkokzqtzomeyoha`) was never touched — every direct-write script used
here carries the same guard clause Task 1 established
(`if (ref === "epzuvzkokzqtzomeyoha") throw new Error(...)`).

**Recapture (2026-08-22) added one more permanent row state:** "Plyometric
Training: What Most Coaches Get Wrong" (`fd58ad0e-411e-4736-bf7f-3001d8b0355b`)
was set `scheduled` / 25h-overdue, then genuinely run through
`/api/admin/internal/content-schedule-due`, landing it as `draft` with the
current, humanised `schedule_failed_reason` — left as-is rather than
reverted, same reasoning as Task 12's original three rows: it's a realistic
state, and shot 05 references it by exact title. The two waiting items from
shots 1–4/3 were confirmed unchanged and unsent by the same run
(`published: 0, sent: 0, missed: 1`).

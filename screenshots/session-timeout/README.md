# Session time bomb — idle timeout + absolute cap

Captured 2026-09-14 against the real app on the dev clone, at 1440×900 CSS ×2
(2880px wide, never upscaled). Regenerate with the windows in
`lib/session-policy.ts` temporarily shortened (60s idle / 30s warning), then:

```bash
npm run dev
node scripts/capture-session-timeout.mjs
```

Both warning shots are the real dialog on the real dashboard, reached by letting
a real session actually go idle — not a component mounted in isolation. The
countdowns read seconds rather than `2:00` because of those shortened windows,
and the captions on the images say so.

---

## What this does

Before: `maxAge` was 24 hours on a NextAuth JWT session — and under the JWT
strategy that window **slides**. Every session read re-signs the token, and
`proxy.ts` (the `auth()` wrapper) copies the refreshed cookie onto every page
response. Anyone who opened the app once a day was renewed forever. A phone left
on a bench stayed signed in indefinitely.

Now, two clocks:

| Clock | Length | Resets on | Enforced by |
|---|---|---|---|
| **Idle** | 2 hours | every page load | `session.maxAge` — the sliding window itself |
| **Absolute** | 7 days | nothing | `loginAt` claim + `applyAbsoluteCap`, which returns `null` and destroys the session |

The absolute cap is the only guarantee a session ever ends. "Stay signed in"
extends the idle window and **cannot** extend the cap.

---

## The frames

| # | File | What it shows |
|---|---|---|
| 1 | `01-warning-client.png` | The warning over the athlete's dashboard, with a live countdown and one button. |
| 2 | `02-expired-landing.png` | Where an ended session lands — the reason stated, the original page preserved in `callbackUrl`. |
| 3 | `03-warning-admin.png` | The identical warning in the coach's shell. One rule for everyone. |

---

## Verified by driving the real app, not by reading the code

All seven checks passed against a running app with the windows shortened:

- A page navigation **pushes the cookie's expiry forward** (measured on the cookie itself, not via the session endpoint, which would have slid it and proved nothing).
- The warning appears before the session dies, and **"Stay signed in" really extends it** — the user stays on the page they were working on.
- An idle tab **does** end up on `/login?expired=1&callbackUrl=%2Fclient%2Fdashboard`.
- **Constant activity cannot outrun the absolute cap**: a session navigated every five seconds was still signed out at the cap.

### The bug this found

The first implementation could never sign anybody out. The guard's own "is it
really dead?" check called `getSession()`, which re-signs the JWT — so the poll
landed a second before expiry and pushed the cookie back out to a full window,
every cycle, forever. Measured directly:

```
t=60s  expires in 1s   requests: /api/auth/session
t=65s  expires in 55s  <-- SLID
```

The fix is `app/api/session/alive`, a liveness read that deliberately does not
renew: `auth()` with no arguments takes next-auth's RSC branch, which discards
the session response's `Set-Cookie`, and `proxy.ts` does not match `/api/*`. A
test pins that the guard never confirms through `getSession` again.

---

## Limits worth knowing

- **Idle means "time since the last page load", not "since the last keystroke".**
  Reading one long page for over two hours without navigating would warn. The
  warning exists precisely so that is recoverable in one click.
- **Focusing a parked tab renews the session**, because `SessionProvider`
  refetches on focus — pre-existing NextAuth behaviour. The absolute cap is what
  stops that mattering.
- **A dead tab is noticed within about 15–30 seconds** of the cookie actually
  dying, not instantly: the liveness confirm backs off (15s → 30s → 60s) while
  the answer keeps coming back alive, which is what a session legitimately
  rolled in another tab looks like.
- **No dark variant.** Both shells are light-only.
- The admin shot shows the dev clone's default tenant ("Northcrest Barbell"),
  not production data.

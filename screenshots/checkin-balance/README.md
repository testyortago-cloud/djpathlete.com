# Check-in balance — "5 sessions left" on a pack that held 3

Captured 2026-09-14 against the real app on the dev clone, at phone size
(430×932 CSS, ×3 device pixels — 1290px wide, never upscaled). Regenerate with:

```bash
npm run dev                                                # port 3050
MODE=after  node scripts/capture-checkin-balance-freshness.mjs
MODE=before node scripts/capture-checkin-balance-freshness.mjs   # needs the pre-fix public/sw.js
```

Every shot is the real `/checkin/me?token=…` screen, reached the way a client
reaches it: a real login to the client portal first (which is what installs the
service worker), then the client's own permanent check-in link. The capture
refuses to run unless the service worker has actually taken control — without
it, the before-shot would quietly look like the after-shot.

---

## What went wrong

Sandeep opened his bookmarked check-in link, read **5 sessions left**, tapped
Check in, and the confirmation said **2**.

Both numbers came from the same database. The screen before the tap had been
answered by the service worker (`public/sw.js`) out of its own cache, using a
**stale-while-revalidate** strategy: hand back the cached copy immediately, then
quietly refresh it for next time. So every visit rendered the answer fetched on
the **previous** visit. His last visit was 28 Aug, when the pack did hold 5. In
between, the coach checked him in twice from the admin side. The tap is a POST,
which the cache never touched — so only the confirmation told the truth.

Verified against production for his account: personal-link check-ins on 17/21/24/26/28 Aug,
coach check-ins on 25 Aug and 11 Sep, and today's tap returning `remaining: 2`.

---

## The frames

| # | File | What it shows |
|---|---|---|
| 1 | `01-before-stale-balance.png` | **Before.** Pack holds 6, screen says 8 — the number from the previous visit. |
| 2 | `02-after-live-balance.png` | **After.** Same link, same two coach check-ins in between; the screen says 6. |
| 3 | `03-after-checkin-confirmation.png` | **After.** 6 before the tap, 5 after it — the drop is exactly one session. |
| 4 | `04-after-refresh-on-return.png` | **After.** A tab left open showing 5 re-reads itself to 2 when the client returns to it. |

---

## What changed

- **`public/sw.js`** — API reads are network-first, with the cache kept only as
  an offline fallback. A session balance is never cached at all, online or off:
  offline, an error is honest, and the check-in POST could not have gone through
  anyway. The API cache was renamed `djp-api-v3` so the worker's own cleanup
  evicts the entries the old strategy wrote into every installed phone.
- **The new worker takes over immediately** (`skipWaiting` on install). Nothing
  in the app has ever sent the `SKIP_WAITING` message its handler listens for,
  so without this the corrected worker would sit in "waiting" until every tab it
  is replacing was closed — and the old one would keep answering on exactly the
  phones that never close a tab.
- **`components/checkin/PersonalCheckinClient.tsx`** — re-reads the balance
  whenever the page comes back into view, so a tab parked on a phone for days
  cannot show a number the coach has since moved.
- **`app/api/checkin/personal`, `.../roster`** — answer `Cache-Control: private,
  no-store`. Next's default for these routes is `public, max-age=0,
  must-revalidate`, and `public` is wrong for one named client's balance.
- **The confirmation now counts the way the screen before it counted.** The
  pre-tap number sums every pack a client can still use; the check-in itself
  only knows the one pack it deducted from. Nobody has two active packs today,
  so this was not what bit Sandeep — but a client who bought a second pack
  before finishing the first would have watched the number lurch on one tap, or
  jump *up* once the older pack ran dry.

---

## Two honest limits

- **Frame 4's trigger is simulated, the refresh is not.** Headless Chromium
  reports every page as visible — `bringToFront()` and CDP's page-lifecycle
  states were both measured here and neither moves `document.visibilityState`.
  So the capture fires the same event a browser fires when a phone is unlocked.
  Everything downstream of it is real: the component's own handler, a real
  request to the real route, the real render.
- **No dark variant.** This screen is light-only by construction — the card is
  `bg-white` and the page `bg-surface`, with no dark treatment to capture.

The capture moves one dev pack's balance to reach each state and puts it back
afterwards. It refuses to run against anything but the dev clone.

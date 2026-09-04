# Calendly per coach, phase 2 — go-live runbook

**Written:** 2026-09-05, for `feat/calendly-per-coach-phase2` (`98d9da2e`, pushed, not merged).
**Darren's Calendly plan:** Standard — which is what webhooks need, so the `plan_lapsed` path
should never appear. Free accounts get a 403 when we register for booking notifications; Standard,
Teams and Enterprise do not.

---

## There are TWO halves, and they need different values

They are independent. Doing one does not do the other.

| | What it does | What it needs |
|---|---|---|
| **A. Per-coach connection** (this branch) | A coach connects their own Calendly from a screen; bookings arrive tagged with the right coach and business | `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, `CALENDLY_WEBHOOK_SIGNING_KEY` |
| **B. The website chat assistant offering real times** | The public chat can show actual free slots and a booking link instead of a bare link | `CALENDLY_API_TOKEN`, `CALENDLY_EVENT_TYPE_URI`, `CALENDLY_SCHEDULING_URL` (+ the same signing key) |

**Half B still reads the old environment variables**, not the new connection row —
`lib/lead-engine/chat/tools.ts:417` calls `readCalendlyConfig()`. `calendlyConfigForBusiness()`
exists and is tested, but nothing calls it until phase 4 gives the public routes a real tenant.
So if you want the assistant to quote real times, you still set the three legacy values, even
after connecting through OAuth.

Since Darren is the only coach today, you probably want both.

---

## Facts this runbook rests on, checked rather than assumed

- Production `NEXTAUTH_URL` is **`https://www.darrenjpaul.com`** — with `www`, no trailing slash.
- Production currently has **zero** `CALENDLY_*` variables.
- The redirect URI is **derived** from `NEXTAUTH_URL`, never configured separately
  (`lib/calendly/connect-env.ts`). OAuth compares it byte-for-byte and it is sent twice — on the
  authorize redirect and again on the token exchange — so one derivation removes a whole class of
  `invalid_grant` failures. It also means a forged `Host` header cannot redirect Calendly anywhere.

---

## Step 1 — Create the Calendly OAuth application

In Calendly, **Integrations & apps → API & webhooks** offers two doors on a screen headed
"How would you like to get started?":

- **Personal access tokens** — "for your organization's private or internal application".
  This is **half B**, the chat assistant's token. Not this step.
- **OAuth** — "Build a public application any Calendly user can connect to."
  **This is the one.** Its wording sounds bigger than the job, but "any Calendly user can connect"
  is precisely what per-coach means, even while Darren is the only coach.

Click **OAuth → Get started here**, which lands on
<https://developer.calendly.com/console/apps>. Click **Create new app**.

| Field | Value |
|---|---|
| Name of app | `DJP Athlete` (whatever a coach should see on the consent screen) |
| Kind of app | **Web** |
| Environment type | **Production** |
| Redirect URI | `https://www.darrenjpaul.com/api/admin/bookings/calendar/callback` |

**The redirect URI must match exactly** — `www`, `https`, no trailing slash. An apex-vs-`www`
mismatch is the single most common failure here, and Calendly reports it as a redirect-uri error
rather than anything that names the real cause.

Copy the **Client ID** and **Client Secret** from the credentials page.
**The secret is shown once.** If you lose it you must rotate it.

You do NOT configure a webhook URL in the portal. The app registers the booking subscription
itself, over the API, at the moment you pick your consult meeting.

---

## Step 2 — Generate the webhook signing key

```bash
openssl rand -hex 32
```

This is **ours, not Calendly's** — we choose it when registering the subscription, and Calendly
signs each delivery with it so we can prove the delivery is real. One key serves every coach;
coaches never see it. Keep it.

---

## Step 3 — Put the values in Vercel (BEFORE merging)

Environment variables only take effect on the next deployment, so set them first and the merge
deploy picks them up in one go.

```bash
vercel env add CALENDLY_CLIENT_ID production
vercel env add CALENDLY_CLIENT_SECRET production
vercel env add CALENDLY_WEBHOOK_SIGNING_KEY production
```

For half B as well:

```bash
vercel env add CALENDLY_API_TOKEN production        # a Personal Access Token, see below
vercel env add CALENDLY_EVENT_TYPE_URI production
vercel env add CALENDLY_SCHEDULING_URL production
```

The Personal Access Token comes from Calendly → **Integrations & apps → API & webhooks →
Personal Access Tokens**. It is a different thing from the OAuth app, and it describes only
Darren's own account.

To find the two URIs, with `CALENDLY_API_TOKEN` in your local `.env.local`:

```bash
node scripts/calendly-setup.mjs
```

It prints every active event type with both its API URI (`CALENDLY_EVENT_TYPE_URI`) and its public
booking page (`CALENDLY_SCHEDULING_URL`) side by side, because they are different things and are
easy to swap. It writes nothing.

---

## Step 4 — Merge the branch

```bash
git checkout main && git pull
git merge feat/calendly-per-coach-phase2
git push origin main
```

This is safe as a **single** merge — unlike phase 0, which needed two. Migration `00250` only adds
two nullable columns and creates functions with no existing callers, so the previous build tolerates
it for the minutes the migration Action and the Vercel build race. Verified against production:
`coach_calendar_connections` already exists there with 0 rows, and both unique constraints the new
functions rely on are already present.

Wait for the Vercel deploy to be **live**, not merely merged.

---

## Step 5 — Connect

1. Sign in and go to **Bookings → Your calendar** (`/admin/bookings/calendar`).
2. Click **Connect Calendly**. Calendly asks Darren to say yes.
3. Back on the screen, pick which of Darren's meetings is the consult, and click **Use this meeting**.
   That is what registers the booking notifications — it is not automatic, and it is deliberate:
   an account can host several meetings and only one of them is the consult.
4. Tick the **Check for conflicts** confirmation.

### Step 4 is not a formality

No Calendly API exposes whether "Check for conflicts" is switched on. It is the setting that makes
Darren's real commitments block slots, so with it off Calendly will happily double-book him — and
nothing on any screen would look wrong until it happened. Open Calendly's calendar settings, confirm
it is on for the calendar he actually uses, then tick the box. The screen shows an amber warning
until you do.

---

## How to tell it worked

- The card reads **Connected**, names Darren's Calendly account, and shows the chosen meeting.
- Book a real test consult on the public page. Within a few seconds it should appear in
  **Bookings**, and a contact should exist for the invitee.
- Check the row carries the tenant rather than a placeholder:

```sql
select b.id, b.business_id, b.host_id, b.connection_id, b.booking_date
  from public.bookings b
 where b.source = 'calendly'
 order by b.created_at desc limit 5;
```

`connection_id` being non-null is the proof that phase 2's path ran, rather than the environment
ramp. If `connection_id` is null but the booking arrived, the ramp handled it — which means the
event type on the delivery did not match the connection row, and is worth investigating before you
add a second coach.

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Clicking Connect shows "Connecting Calendly is not set up on this site yet" | `CALENDLY_CLIENT_ID`/`SECRET` missing from the deployed build | Add them, then **redeploy** — env vars do not apply retroactively |
| Calendly rejects the redirect | The registered URI is not byte-identical | It must be `https://www.darrenjpaul.com/api/admin/bookings/calendar/callback` |
| "We could not finish connecting safely, so we stopped" | The sign-in expired mid-consent, or the attempt took over 10 minutes | Click Connect again. Nothing was written |
| "Calendly only sends us bookings on a paid plan" | The account is Free | Should not happen on Standard — check you connected the right Calendly account |
| Bookings do not arrive | The subscription was never registered, or Calendly disabled it | Re-pick the meeting on the screen; that re-registers it |

---

## Two things to watch after go-live

1. **Nothing alerts on a failed tenant lookup.** If the connections table becomes unreadable
   (a key rotation, an RLS change), every delivery answers 500 so Calendly retries — and Calendly
   disables a subscription after 24 hours of failures. The log line is
   `[calendly-webhook] could not resolve this delivery's tenant`. `console.error` is not an alert;
   wire one before this carries real volume.
2. **Set the signing key and the event-type URI together.** With the signing key set but
   `CALENDLY_EVENT_TYPE_URI` unset and no connection row yet, deliveries are acknowledged and
   ignored rather than rejected — bookings would be silently dropped rather than visibly failing.
   Connecting through the screen makes this moot, so do Step 5 promptly after Step 4.

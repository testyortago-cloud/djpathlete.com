# Email sender audit — 2026-09-04

Why `sendSequenceEmail` failed with *"The darrenjpaul.com domain is not verified"*,
every other place the same fault can occur, and exactly what to check in the env.

---

## 1. The original fault

Resend has **one** verified domain on the account:

| Domain | Status | Created |
|---|---|---|
| `send.darrenjpaul.com` | verified | 2026-05-07 |
| `darrenjpaul.com` (apex) | never added | — |

The Lead Engine does **not** read `RESEND_FROM_EMAIL`. It builds the From header
from the database, at `lib/lead-engine/email.ts:419`:

```ts
from: `${settings.sender_name} <${settings.sender_email}>`,
```

At the time of the failure `business_settings.sender_email` held
`noreply@darrenjpaul.com` — the unverified apex. Resend rejects the whole send.

**Date note:** the `Aug 22, 2026` shown in the UI is `sequence_runs.created_at`
(when the runs were enrolled). The sends actually failed **31 Aug 2026,
12:00–12:10 UTC** (`updated_at`). All 73 runs are `sms_repermission`.

**Now fixed in the DB** — prod `business_settings.sender_email` reads
`noreply@send.darrenjpaul.com`.

---

## 2. Every other place the same fault lives

There are exactly **five** definitions of a sending address in the codebase.
All five read `RESEND_FROM_EMAIL`; four of them fall back to the **unverified apex**.

| # | File | Fallback when the env var is unset | Blast radius |
|---|---|---|---|
| 1 | `lib/email.ts:38` | `DJP Athlete <noreply@darrenjpaul.com>` ❌ | **39 senders** — auth, clients, programs, bookings, admin alerts |
| 2 | `lib/resend.ts:4` | `no-reply@darrenjpaul.com` ❌ | shop emails, all 4 bookkeeping emails, 7 internal report crons |
| 3 | `lib/messaging/email-new-message.ts:5` | `DJP Athlete <noreply@darrenjpaul.com>` ❌ | new-message notifications |
| 4 | `functions/src/newsletter-send.ts:65` | `DJP Athlete <noreply@darrenjpaul.com>` ❌ | newsletter batches — **see §3, this one is live-broken** |
| 5 | `functions/src/lib/notify-job-done.ts:60` | `DJP Athlete <noreply@send.darrenjpaul.com>` ✅ | program/week generation notices |

Only #5 is correct — and it already carries a comment explaining this exact bug.
The fix was applied there and nowhere else.

`INFO_EMAIL` / `SALES_EMAIL` in `lib/email.ts:1537-1538` are **recipients**, not
senders, so they need no verification. Same for `reply_to`
(`darren@darrenjpaul.com`) — reply-to is never validated by Resend.

### The gap behind all four

`assertSendable` (`lib/lead-engine/email.ts:140`) checks `sender_email` is
non-empty. Nothing anywhere checks the **domain is one Resend will accept**.
That is why a one-character config difference silently killed 73 runs.

---

## 3. The one that an env var cannot fix

`functions/src/index.ts:43`

```ts
const sendSecrets = [supabaseUrl, supabaseServiceRoleKey, resendApiKey]
//                   ↑ resendFromEmail is NOT in this list
```

`newsletterSend` (line 355) binds `sendSecrets`. `resendFromEmail` is declared as
a secret at line 26 but **never bound to this function**, so
`process.env.RESEND_FROM_EMAIL` is `undefined` inside it — it always takes the
hardcoded apex fallback and every newsletter batch is rejected.

Setting the secret correctly will not help. The binding has to change:

```ts
const sendSecrets = [supabaseUrl, supabaseServiceRoleKey, resendApiKey, resendFromEmail]
```

Every other email-sending function uses `allSecrets`, which does include it.

---

## 4. What to check in your env

Two separate stores. A value being right in one says nothing about the other.

### A. Vercel production — the Next.js app

```bash
vercel env ls production
```

| Variable | Expected | Status |
|---|---|---|
| `RESEND_FROM_EMAIL` | `Darren J. Paul <noreply@send.darrenjpaul.com>` | **present but marked SENSITIVE — value cannot be read back.** Re-set it to be certain. |
| `RESEND_API_KEY` | the live key | present ✅ |

Your local `.env.prod` copy still says `noreply@darrenjpaul.com` (the apex). If
that copy reflects Vercel, **all product email is still being rejected.**

To set it:

```bash
vercel env rm RESEND_FROM_EMAIL production
printf 'Darren J. Paul <noreply@send.darrenjpaul.com>' | vercel env add RESEND_FROM_EMAIL production
# then redeploy — env changes do not reach a running deployment
```

### B. Firebase secrets — the functions runtime

```bash
firebase functions:secrets:access RESEND_FROM_EMAIL
```

Must also be `Darren J. Paul <noreply@send.darrenjpaul.com>`. This is a
**different store** from Vercel and does not inherit from it.
(The Firebase CLI is not installed in this checkout, so this one is unverified.)

### C. Supabase `business_settings` — the Lead Engine

```sql
select sender_name, sender_email, reply_to from business_settings;
```

Currently `noreply@send.darrenjpaul.com` ✅ — already correct.

### D. Resend account

Either keep everything on `send.darrenjpaul.com`, **or** add and verify the apex
at https://resend.com/domains. Right now the apex is not present at all.

---

## 5. Other env gaps found while sweeping

Comparing what the code reads against what Vercel production actually holds.
Most apparent gaps turned out to have a fallback already set — these are the ones
that do not:

| Variable | Reader | Effect when unset |
|---|---|---|
| `CALENDLY_API_TOKEN`, `CALENDLY_WEBHOOK_SIGNING_KEY`, `CALENDLY_EVENT_TYPE_URI`, `CALENDLY_SCHEDULING_URL`, `CALENDLY_API_BASE`, `CALENDLY_SIGNATURE_*` | `app/api/webhooks/calendly/route.ts` | **None are in Vercel.** Expected — `feat/calendly-booking` is unmerged. Must be set **before** that merge or the webhook answers `calendly not configured`. |
| `RESEND_AUDIENCE_ID` | `lib/shop/resend-audience.ts:8` | shop audience sync is skipped |
| `GHL_BLOG_ID` | `lib/ghl-blog.ts` | blog sync inert |
| `GHL_WORKFLOW_QUESTIONNAIRE_COMPLETE` | `app/api/questionnaire/route.ts` | that workflow never triggers |

**Checked and fine** (a fallback or alias is already set in Vercel):
`APP_URL`/`NEXT_PUBLIC_SITE_URL` → `NEXT_PUBLIC_APP_URL` + `NEXTAUTH_URL`;
`STRIPE_SECRET_KEY_LIVE` → `STRIPE_SECRET_KEY`;
`GOOGLE_OAUTH_CLIENT_ID/SECRET` → `GOOGLE_CLIENT_ID/SECRET`;
`GOOGLE_BUSINESS_PLACE_ID` → `GOOGLE_PLACE_ID`;
`FIREBASE_PROJECT_ID` → `NEXT_PUBLIC_FIREBASE_PROJECT_ID`;
`FIREBASE_FUNCTIONS_REGION` → defaults `us-central1`;
`COACH_FIRST_NAME` → defaults `Coach`.

**Correctly absent:** `DEV_AUTH_BYPASS_ENABLED` / `DEV_AUTH_BYPASS_EMAIL` are in
`.env.prod` but **not** in Vercel. Keep it that way — they are an auth bypass.

**Correction to earlier notes:** the four Twilio variables *are* now present in
Vercel production (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_CLIENT_SECRET`, `TWILIO_MAIN_SID`).

---

## 6. Changed in production today

`system_settings.cron_sequence_tick_enabled` → **`false`** (was `true`).

Sequence sending is off. Verified by reading the row back on a separate
connection. Nothing was going to send regardless — all 73 runs are terminal
`failed` and there are zero `active` runs — but the tick is now gated shut, so
any new enrolment will not send either.

**Not done, deliberately:** `scripts/repair-failed-sequence-runs.mjs` was **not**
run. The 73 failed runs remain untouched.

To turn sending back on later:

```sql
update system_settings set value = 'true'::jsonb
where key = 'cron_sequence_tick_enabled';
```

---

## 7. Outstanding

1. Confirm/re-set `RESEND_FROM_EMAIL` in **Vercel production**, then redeploy.
2. Confirm the **Firebase secret** of the same name.
3. Add `resendFromEmail` to `sendSecrets` in `functions/src/index.ts:43`.
4. Change the four apex fallbacks (§2, rows 1-4) to `send.darrenjpaul.com` so an
   unset variable cannot reintroduce this silently.
5. Consider a startup assertion that the From domain is one Resend has verified —
   the whole failure mode is that nothing checks.

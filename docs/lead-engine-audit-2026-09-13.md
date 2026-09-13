# Lead Engine audit — what actually works in production

**Date:** 2026-09-13 (measured 2026-09-12 16:38–17:10 UTC)
**Code:** `main` @ `5a20f4ff`, deployed to production.
**Method:** production read through the read-only `supabase-prod` MCP (object existence, not the
migration ledger); Resend's `GET /domains` and `GET /emails`; Firebase function logs; the real admin
driven with Playwright on the dev clone (`localhost:3050`, project `anjvztjiokcgiyhobknq`); 94
targeted tests; four read-only code reviews. Nothing on production was written, retried, published
or flipped. Screenshots are in `screenshots/lead-engine-audit/` (index: `index.html`).

**This document does not fix anything.** Section 4 says what to fix, in what order.

---

## 0. The three sentences that matter

1. **The Resend fault is fixed and the engine is armed.** The 73 failures were caused by
   `business_settings.sender_email` being `noreply@darrenjpaul.com`; Resend has only
   `send.darrenjpaul.com` verified (the apex is not registered there at all) and the sender is now
   `noreply@send.darrenjpaul.com`. The tick fires every five minutes from Firebase and answered
   `200 {claimed:0, sent:0}` at 16:40 UTC today. Nothing sends because **nothing has been captured
   since the twelve sequences were switched on (2026-09-09)** — every capture after that date was a
   Stripe purchase, which no sequence listens to. The engine is idle, not broken.
2. **The public has no way in.** All six funnels/pages are `draft`; `/go/athlete-quiz`,
   `/go/rotational-athlete-score` and `/go/the-recruiting-ready-athlete` answer 404 on
   `www.darrenjpaul.com`. Athlete Quiz was live on 2026-09-06 and was taken offline at
   2026-09-11 19:50 UTC (two `funnel.updated` audit rows, neither carrying a target id).
3. **The funnel maker works end to end, with one bug on the happy path.** Built from scratch in the
   real UI on the dev clone: create → AI drafts both pages in 83 s → publish from the builder →
   `/go/<slug>` 200 → form submit → contact, timeline event, SMS consent and a New Lead Nurture run.
   But the builder writes the form's redirect as `/go/<funnel-name-slugified>/thank-you`, a URL it
   guesses from the NAME, so any funnel whose address differs from its name sends every lead to
   **Page not found** after submitting. The builder's own rail shows "leads nowhere" and publishes
   anyway. The lead is captured; the visitor sees a 404.

---

## 1. Production baseline, re-measured

Every number in the brief re-measured **unchanged** on 2026-09-12 16:38 UTC: 170 contacts ·
12 sequences all `active` · 1 quiz · 263 timeline events · 521 `marketing_attribution` ·
5 bookings · 0 `contact_suppressions` · 0 `contact_consents` · 73 `sequence_runs` all `failed` ·
73 `sequence_messages` all `failed` · 6 funnels, 0 published · 7 steps · 1 submission ·
`sms_messages` 0 rows · 3 opportunities · 3 pipelines / 12 stages.

Things the brief did not know, or that have moved:

| Fact | Measured |
|---|---|
| Resend verified domains | **Only `send.darrenjpaul.com`** (verified, us-east-1, since 2026-05-07). `darrenjpaul.com` is not in the account. |
| Sender in `business_settings` | `Darren J. Paul <noreply@send.darrenjpaul.com>`, reply-to `darren@darrenjpaul.com`, postal address set, display name `DJP Athlete`. All four preflight fields the tick requires are present. |
| Resend send log (last 50) | Every send is from `noreply@send.darrenjpaul.com`: client program emails, session-pack nudges, the 2026-09-11 "Launch of the Newsletter" batch (3 bounces in the first 50). |
| `cron_sequence_tick_enabled` | `true` since 2026-08-20. `cron_pipeline_reconcile_enabled` has **no row** → default false. |
| Tick cron | `sequenceTickCron`: 3,458 `cron_runs`, **all success**, last 16:35:01 UTC; Firebase log at 16:40:01 shows the route answering `200 {ok:true, claimed:0 … businesses:1}`. |
| Athlete Quiz funnel | `status='draft'` but its one step still carries `published_version_id` and one version row. Unpublish writes only `funnels.status`; the version stays. `/go` requires BOTH `status='published'` AND a published version, so it 404s. `?preview=1` as admin would still render it. |
| Captures since 2026-08-22 (the GHL import) | 7 `entry_point` events: 5 `purchase` (Stripe), 1 `checkout_abandoned` (2026-09-08, before that sequence was active), 1 `quiz` (2026-08-31). Zero funnel-form, newsletter, inquiry or lead-magnet captures. |
| The one quiz capture (2026-08-31) | Created a contact, a timeline row, an opportunity on Coaching ("Consult Booked"), and **no run** — the four quiz sequences were `draft` until 2026-09-09 (migration 00229 seeds them draft on purpose). Not a bug. |
| Contacts with `first_touch_session_id` | **0 of 170.** The one funnel submission has `attribution_session_id` null. See §2.8. |
| `lead_magnets` | **0 rows.** The lead-magnet capture path has nothing to capture. |
| Twilio | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` set on Vercel production; messaging-service SID set in `business_settings`; `sms_sender_phone` empty (see §2.5). `.env.prod` does NOT carry the Twilio variables — scripts that need them must read Vercel. |
| Audit logs | 2,748 rows, 11 categories in use; the `funnel.updated` rows that took Athlete Quiz offline have `target_id: null, metadata: {}`. |
| Tenancy | `funnels`, `funnel_steps`, `funnel_submissions` have **no `business_id`** (confirmed on prod columns). `/go` resolves no tenant; the slug is global. |

---

## 2. Feature by feature

Legend: **WORKS** = exercised end to end in this audit or proven by production data. **WORKS (code)**
= verified by reading the deployed code and its tests, not exercised. **BROKEN** = a defect
reproduced. **NOT VERIFIED** = could not be exercised from here; says why.

| # | Feature | Verdict | Evidence | What it would take |
|---|---|---|---|---|
| 2.1 | Capture — funnel form | **WORKS**, 3 defects | Dev, real UI: `POST /api/funnels/submit` 200 → `funnel_submissions` row, contact `95018214…`, `entry_point/funnel_form`, `contact_consents` sms/true, `sequence_runs` active in New Lead Nurture (`next_run_at` = now). Coach alert delivered via Resend. Shots 07, 13, 14. | (a) redirect 404 — §3.1; (b) name never captured — §3.2; (c) attribution null — §3.5 |
| 2.1 | Capture — quiz | **WORKS** (prod) | 2026-08-31 real submission: contact + timeline + opportunity. No run because the sequence was draft then. Route code + `__tests__/api/quiz-submit*.test.ts`. | Nothing. Publish the quiz funnel. |
| 2.1 | Capture — newsletter | **WORKS (code)** | `captureLead(source:"newsletter")` + email consent row only when `consent_marketing===true`; enrols `newsletter_welcome`. Prod: 2 subscribers ever from the website form, 5,814 from one CSV. | Nothing in code. |
| 2.1 | Capture — contact form | **WORKS (code)**, dead end | Creates a contact and emails; **no sequence has `trigger_source='contact_form'`**, so nothing nurtures a contact-form lead. Same for the chat (`ai_chat`). | Decide whether these should enrol; one trigger row each. |
| 2.1 | Capture — inquiry | **WORKS (code)** | Contact + opportunity (assessment board for `service='assessment'`, else coaching) + `service_application_received` enrolment. Audited under the same slug as the contact form (`contact.submitted`). | Nothing. |
| 2.1 | Capture — lead magnets | **NOT USABLE** | `lead_magnets` has 0 rows on prod; route is gated on `isShopDigitalEnabled()`; delivery email ignores Resend's result. | Create a magnet; read the send result. |
| 2.1 | Consent rows (0/170) | **Design + gap** | Every writer of `contact_consents` needs a ticked box (SMS on quiz/funnel/inquiry/events; email on newsletter/chat), a STOP/START text, an unsubscribe click, or the consent link in the re-permission email. No funnel, quiz, inquiry, purchase or import ever records **email** consent. Email sending is **not** consent-gated (decided 2026-09-07); SMS is hard-gated. Shot 13 shows "Never asked". | Owner decision (§4 #6). |
| 2.2 | Sequences — tick runner | **WORKS** | Firebase `*/5` → `POST /api/admin/internal/sequence-tick` (Bearer `INTERNAL_CRON_TOKEN`) → 3,458 successes; `claim_sequence_runs` on prod gates on `sequences.status='active'` inside the claim (verified 2026-09-09 via `pg_get_functiondef`). | Nothing. |
| 2.2 | Sequences — enrolment, branch, tag, stage, quiet hours, cap, exits | **WORKS (code + tests)**; STOP exit **WORKS** (dev) | 28+4+10 tick tests green; `branch_condition` ∈ {`has_phone`,`has_user`,`has_consent`,`source_is`}; quiet hours = ALLOWED window 08:00–20:59 contact-local; cap = 1/contact/day; exits on payment, booking, STOP, unsubscribe. Dev: STOP flipped the run to `exited/sms_stop` (shot 13). | Nothing. |
| 2.2 | Sequences — email send | **WORKS** (dev, 2026-09-06), **NOT re-verified today** | Dev `sequence_messages`: "Your Athlete Quiz result" `sent`, provider `resend`, id present, same Resend account. Prod has never had a successful run. My attempt to run the tick against the audit contact was blocked by the permission classifier (it would email the test inbox). | Owner: `node --env-file=.env.local scripts/capture-lead-engine-audit.mjs tick` (needs `cron_sequence_tick_enabled` true on dev). |
| 2.2 | Sequences — why nothing sent since 09-09 | **Explained** | No trigger fired: 0 funnel/quiz/newsletter/inquiry/lead-magnet captures after activation; 0 published funnels. | Publish a funnel (§4 #2). |
| 2.3 | The 73 stranded runs | **Terminal by design** | All `sms_repermission`, position 0, attempts 1, `failed` (a "configuration" fault is not retried once classified terminal). Contacts: 73 with email and phone, **0** purchased since, **0** suppressed, **0** consent rows, **0** are clients. See §3.3 for options. | Owner decision. |
| 2.4 | Email — lead-engine sender | **WORKS (code)**, honest | `lib/lead-engine/email.ts` builds its own Resend client, **throws** when the key is missing, throws `SequenceSendError` on a Resend error (that is the 73's message). Does not verify the returned id (stores null as `sent`). | Optional: treat a null id as a failure. |
| 2.4 | Email — `lib/email.ts` silent success | **Latent** | Returns `{data:null,error:null}` when `RESEND_API_KEY` is unset. Production HAS the key (Vercel), so no path silently reports success today. When the key is absent: 29 of 33 senders report success; contact form, inquiry, funnel lead alert, registration and four event senders would tell the user "sent". Lead-magnet delivery ignores the result even with a key. | Make the wrapper return an error shape; read the result in `lib/shop/emails.ts:190`. |
| 2.4 | Email — FROM addresses | **SAFE today** | Sequence FROM = `business_settings.sender_email` (the field that carried the fault). Transactional FROM = `RESEND_FROM_EMAIL` (Vercel, marked sensitive; the Resend log proves it resolves to `send.darrenjpaul.com`). No code hard-codes an apex FROM. | Validate `sender_email` against Resend's verified list in the settings form (§4 #1). |
| 2.5 | Two-way SMS — inbound | **WORKS** (dev, signed forged webhook) | Reply → `sms_messages` `received` linked to the contact + `sms_inbound` timeline (shot 12). Bad signature → 403 `invalid signature`. STOP → `contact_suppressions`, consent sms/false, run `exited/sms_stop`, `sms_stop_received`, empty TwiML with `X-Twilio-Inbound-Outcome: stop`. | Nothing. Owner: send a real STOP from a handset once. |
| 2.5 | Two-way SMS — admin screens | **WORKS** (dev) | `/admin/sms` list and `/admin/sms/<phone>` thread render; the composer disables itself and says why after STOP (shot 12). | Nothing. |
| 2.5 | Two-way SMS — outbound send | **NOT VERIFIED** | Cannot send from here (Twilio 21612, no route to PH). Route + `sendManualSms` covered by `sms-send-route.test.ts`, `send-manual-sms.test.ts`. Known: checks suppression, **not** SMS consent (policy); status callback can race the insert; a missing env var shows only as a 502 in the thread. | Owner sends one text to their own handset. |
| 2.5 | Two-way SMS — tenant match | **Works for one tenant** | Inbound matches the business by `sms_sender_phone` only; prod has that EMPTY and only the messaging-service SID set → every inbound falls back to `platformBusinessId()`. Correct today; wrong the day a second coach texts. | Match on the messaging-service SID too. |
| 2.6 | Funnel maker — build & publish | **WORKS** (dev, real UI) | Shots 01–03: dialog → both pages drafted (83 s) → `POST /api/admin/funnels/<id>/publish` → status `published`, 2 version rows. "Publish funnel" enabled only once every page has a draft. | Nothing. |
| 2.6 | Funnel maker — `/go` public | **WORKS** (dev) / **404 on prod** | Dev: 200 in a fresh browser (shot 04). Prod: nothing is published. | Publish. |
| 2.6 | Funnel maker — form redirect | **BROKEN** | §3.1. Shot 08. | Small code fix. |
| 2.6 | Landing page maker | **WORKS** (dev) | Shots 15–18: dialog → drafted (99 s) → builder "Publish" published the page AND flipped it live in one request → `/go/<slug>` 200 public. `/admin/pages/<id>` redirects to the list (no detail screen, by design). | Nothing. |
| 2.6 | Convert page ↔ funnel | **WORKS** (dev) | Shot 19. page→funnel kept `status='published'`, `/go` still 200; funnel→page (one step) kept it too. Audited as `funnel.converted`. | Nothing. |
| 2.6 | The five guards | **HOLD** | Through the real routes with the admin session: `POST /steps` on a page → 400 "A landing page is one page…"; `PATCH {kind}` → 400; `PATCH {status, kind}` → 400 (raw-body check runs first); `POST /convert` on a 2-step funnel → 400 "has 2 pages"; `PATCH {status:"published"}` on a funnel → 400 "Use POST …/publish". Plus 94/94 tests in 8 suites. | Nothing. |
| 2.6 | Three preview routes agree | **WORKS** (dev) | `/preview/<slug>` and `/funnel-preview/<stepId>` both 200 as admin and **404 signed out**; both call `renderDraftPreview` (`lib/funnels/preview-render.ts:88-113`). `/go` renders stored version rows and never recompiles — CSS is frozen at publish. | Nothing. |
| 2.6 | Test run writes nothing | **WORKS** (dev) | `/preview` form → `POST /api/funnels/preview-submit` 200; row counts across `contacts, funnel_submissions, contact_timeline_events, sequence_runs, contact_consents, opportunities, marketing_attribution, users, audit_logs, lead_inquiries` identical before and after (shots 09–10). Validation matches live ("Parent / guardian name is required"). | Nothing. |
| 2.6 | Page-vs-funnel bite list | **Minor** | Features only on `FunnelDetailScreen`, invisible to a `kind='page'` row: run window + the auto-offline warning, "Selling: <offer>", `notify_emails` (not settable for a page at all), per-step quiz attempt counts. A page converted from a dated funnel keeps `ends_at` and can be taken offline by `funnelWindowCron` with nothing on screen saying so. | Show run window / notify on the card. |
| 2.7 | Pipeline — capture lands on a board | **WORKS** (prod, coaching only) | 3 prod opportunities: payment → Won ($150), quiz → Consult Booked, booking → Lost; `pipeline.opportunity_created` audit row. `routeToPipeline` exists (assessment for `service='assessment'`, camps_clinics for `event_signup` payments, else coaching). | — |
| 2.7 | Pipeline — the other two boards | **INVISIBLE** | `/admin/pipeline` renders only Coaching (`page.tsx` passes no key; `PipelineBoard` has no switcher). A card routed to `camps_clinics` or `assessment` exists in the table and cannot be seen. No UI creates a pipeline; `create_business()` seeds coaching only. Bookings never carry `serviceType`, so an assessment booking lands on coaching. | Board switcher (medium). |
| 2.7 | Pipeline — reconcile cron | **OFF and unwatchable** | No flag row → route answers `{skipped}` before `logCronStart`, so `cron_runs` never sees it and the health scanner treats it as disabled. | Set the flag; log before the gate. |
| 2.8 | Attribution | **Partial by design** | `proxy.ts:35` sets the `djp_attr` cookie only when the landing URL carries a click id or `utm_*`; the `marketing_attribution` insert is a fire-and-forget fetch from middleware. Only funnel/quiz/chat pass a session id into the contact, and only on the create branch. Result: 0/170 contacts linked; the prod submission is null; my `?utm_source=audit` visit did create a row. | Stamp a session for every `/go` visitor; backfill on update (§4 #8). |
| 2.8 | Inbox | **NOT VERIFIED**, Gmail | `/admin/inbox` is Gmail via `platform_connections`, not GHL; dev shows "Connect Gmail". GHL matters only to the Inbox-SLA watchdog (`degraded` when unset). | Owner connects Gmail. |
| 2.8 | Audit logs | **WORKS** | 2,748 rows; lead-engine mutations wired (sequences status/steps/enrol, sms send, funnels publish/convert/steps). Gaps: `funnel.updated` rows carry no `target_id`/metadata; `quizzes/[id]` PATCH and the events routes write no audit row. | Add target ids (small). |
| 2.8 | Automation health | **Blind spots** | `funnelWindowCron` never logs to `cron_runs` and is "non-reporting" in the scanner; `pipelineReconcileCron` as above. | Add `logCronStart/End`. |

---

## 3. The defects, precisely

### 3.1 BROKEN — the builder guesses the funnel's address for the form redirect

Reproduced on the dev clone with a funnel created in the real dialog, address
`off-season-speed-camp-dxf8`, name "Off-Season Speed Camp".

- The builder's prompt tells the model to write `successMode: "redirect"` plus
  `redirectUrl: "/go/<funnel-slug>/<next-page-slug>"` (`lib/funnels/sections/prompt.ts:673-676`).
  The catalogue gives the model `stepSlugs` and `nextStepSlug` (`prompt.ts:750-790`) but **never
  the funnel's own slug**, so it invents one from the name: the published `project_data` carries
  `"redirectUrl": "/go/off-season-speed-camp/thank-you"`.
- The auto-connect pass only fills a redirect when the form has **no** URL
  (`lib/funnels/connections.ts:409-421`, "half-configured is still configured"), so it never corrects
  a wrong one. `internalPage()` fails to recognise it as internal, so it is treated as an external
  link and the publish gate lets it through.
- The step rail already knows: it shows **"leads nowhere"** under the Signup page (shot 02) — and
  "Publish funnel" is enabled anyway.
- Effect: `POST /api/funnels/submit` 200, lead captured, browser navigates to a 404 (shot 08).
  In `/preview` the same URL is rewritten to `/preview/off-season-speed-camp/thank-you`, which also
  404s — preview and publish agree, in the failing direction.
- It only bites when the address differs from `slugify(name)`. Every prod funnel currently has a
  matching pair, which is why nobody has seen it; the first renamed address or slug collision will.

**Fix (small):** pass the funnel slug into the catalogue and the prompt so the model can write the
real path — or better, have the model emit `{kind:"step", stepSlug}` for the form's success target
and compile it through `funnelBasePath` like every other CTA; and make "leads nowhere" a publish
blocker (or auto-repair to `/go/<real slug>/<nextStepSlug>` at publish). One test: publish a funnel
whose slug ≠ slugified name, assert the compiled redirect starts with `/go/<slug>/`.

### 3.2 GAP — leads arrive without a name

`buildName()` reads only `first_name`, `name`, `last_name` (`app/api/funnels/submit/route.ts:416-421`).
The builder names its fields `athlete_name`, `parent_name`. The visitor typed "Riley Audit" and
"Aean Audit"; the contact, the submissions board (shot 14, Lead column "—") and the coach alert have
no name. Email and phone are found by field **type**, which is why they survive.

**Fix (small):** find name fields the same way — by a `role: "name"` on the field, or by matching
`*name*` — and prefer the parent's name when both exist. Cheap, and it also fixes the contact record.

### 3.3 The 73 stranded runs — options and blast radius

What they are: 73 distinct GHL-imported contacts, enrolled 2026-08-22 07:32 in
`sms_repermission` (subject "Can we text you?", one email → stop), failed 2026-08-31 12:00–12:10
on the sender-domain error. Since then: none purchased, none suppressed, none became clients, none
has any consent row, none has a session id. The engine is armed, so a repaired run **will send**.

What a repair does (`scripts/repair-failed-sequence-runs.mjs`, `--apply` required, `--next-run-at`
mandatory): deletes the run's `sequence_messages` rows (all of them, including any `sent` — harmless
here, none are), resets the run to `active/position 0/attempts 0/next_run_at=<arg>`, writes a
`sequence_run_repaired` timeline row per contact and one audit row.

What happens next, tick by tick: the claim takes **25 runs per tick across all businesses**, ordered
by `next_run_at`; quiet hours are checked per contact (08:00–20:59 in `contacts.timezone`, else
America/New_York) and a run outside the window is deferred to 08:00; the daily cap is **per
contact**, so it does not throttle the batch. Expect the 73 emails over 3–5 ticks (15–25 minutes)
once `next_run_at` falls inside the window. Each email carries a per-contact HMAC consent link
(`/sms-consent/<token>`, no expiry) and the unsubscribe footer. Structural double-send risk is the
generic at-least-once window between Resend accepting and `markSent` — no more than any send.

Options:
1. **Send as written, re-dated** — `--next-run-at` inside the window. 73 people get a 22-day-old
   "can we text you?" ask. Blast radius: 73 real inboxes, from the same sending domain the newsletter
   uses.
2. **Leave them.** Terminal `failed` is inert; the reporting screen keeps showing 73 "Something went
   wrong" forever. A contact can still be re-enrolled by hand (the Enrol UI defaults to
   `onePerContact=false`), so nothing is locked.
3. **Re-ask later with fresh copy.** Edit step 0 in `/admin/sequences/sms_repermission` first
   (the step editor refuses to remove a step that has messages, but editing copy is fine), then run
   the repair.

The two documents that say "73 were mailed on 22 Aug" (`docs/lead-engine-status-2026-08-23.md`,
migration `00226` header) are wrong; the message rows say `failed` and Resend has no record.

### 3.4 Email consent is never asked, and that is a policy, not a bug

170 contacts, 0 consent rows, and email is deliberately not gated (`sequence-tick.ts:127-132`
sends an email step with no consent row; only a `branch has_consent email` step ever reads it).
The funnel form shows SMS wording and records SMS consent when ticked (verified); it shows **no**
email wording, so `capture-contact.ts` refuses to invent one. If the owner wants a dated email
consent trail, it needs wording on the form and one `recordConsent` call — the machinery exists.

### 3.5 Attribution is only ever captured for tagged landings

`proxy.ts:34-68` returns before setting `djp_attr` unless the URL carries `gclid/gbraid/wbraid/
fbclid/utm_*`. An organic visitor to `/go/<slug>` gets no cookie, the submission's
`attribution_session_id` is null, and the contact's `first_touch_session_id` stays null forever
(`upsertContactIdentity` writes it only on the create branch). The 521 rows are ad-click sessions.
`captureLead()` cannot even carry a session id, so newsletter/contact/inquiry/chat/Stripe drop it.

### 3.6 Smaller things found on the way

- **No test pins `/go`'s two-condition serve rule** (`lib/db/funnels.ts:493, 506-511`) — the
  load-bearing invariant of the subsystem.
- **`/api/funnels/submit` accepts a submission for an unpublished funnel** as long as the step
  keeps its `published_version_id`; only `getPublishedFormConfig` gates. A direct POST for Athlete
  Quiz's step today would create a lead and enrol it while `/go` 404s. `/api/funnels/checkout`
  does check status.
- **`.ilike` slug is unescaped** (`funnels.ts:57`): `/go/%25` matches every funnel and
  `maybeSingle` throws (500). Stored slugs are validated; the URL is not.
- **SEO columns have no writer** (`seo_title`, `seo_description`, `og_image_url`, `noindex`).
- **`notify_emails`, run window, offer are creation-only**; no edit surface, and `CreatePageDialog`
  never sends them.
- **Bookings never create a contact** (`lib/bookings/ingest.ts:303` finds only), so a Calendly
  booking from a stranger leaves no spine row and no card.
- **`/api/ghl/contact` and `/api/ghl/webhook` are unauthenticated proxies**; no tests.
- **The step rail shows "never published" / "writing…" right after a successful funnel publish**
  (shot 03) — cosmetic, stale client state.
- **CLAUDE.md** still names `middleware.ts` (it is `proxy.ts`) and says "only the form island can
  write" (the quiz island writes on live too, with its own no-write preview route).

---

## 4. What to fix, in the order that unblocks the most

| # | Action | Kind | Why first |
|---|---|---|---|
| 1 | **Resend: answered.** `send.darrenjpaul.com` verified; sender fixed; nothing to do. Add a validation in `BusinessSettingsForm` that refuses a `sender_email` whose domain is not in Resend's verified list, so the 08-31 fault cannot be typed back in. | small code | Everything downstream depends on it, and today it is only correct by convention. |
| 2 | **Publish a funnel** (owner). Athlete Quiz has a published version already; "Go live" on its card is one click. | owner, 0 code | The engine has had nothing to nurture since it was armed. |
| 3 | **Fix the redirect-slug bug (§3.1)** before #2 if the funnel's address will ever differ from its name — and make "leads nowhere" block publishing. | small code + 1 test | The first real lead on a renamed funnel lands on a 404. |
| 4 | **Capture the name (§3.2).** | small code | Every lead is currently nameless in Contacts, the board and the alert. |
| 5 | **Decide the 73 (§3.3).** | owner | Nothing else is blocked on it. |
| 6 | **Decide email consent (§3.4)** and, if wanted, add wording + `recordConsent` on the funnel form. | owner, then small | Compliance posture, not function. |
| 7 | **Pipeline board switcher** so `camps_clinics` and `assessment` cards are visible; pass `serviceType` from bookings. | medium | Routing "shipped" but its output cannot be seen. |
| 8 | **Attribution for every visitor** on `/go` (stamp a session without a click id; let `captureLead` carry it; backfill on the update branch). | small–medium | Campaign→revenue is empty by construction. |
| 9 | **Turn on `cron_pipeline_reconcile_enabled` and log before the gate**; add `logCronStart/End` to `funnelWindowCron`. | minutes + tiny | Two crons are unwatchable. |
| 10 | **Pin `/go`'s serve rule with a test; check `funnels.status` in `/api/funnels/submit`; escape the slug.** | small | Cheap insurance on the subsystem's core. |
| 11 | **SMS:** match inbound tenant on the messaging-service SID; insert the `queued` row before the Twilio call (status race); surface missing env in the UI. Policy: should manual sends check consent? | small ×3 + owner | Before real handsets. |
| 12 | **Audit: put `target_id` on `funnel.updated`/`created`/`deleted`.** | tiny | The unpublish that took the site's only funnel offline cannot be attributed to a row. |
| 13 | **Tenancy:** `business_id` on `funnels`/`funnel_steps`/`funnel_submissions`, or a documented seam in `lib/tenancy/platform.ts`. | medium | The SaaS direction; not today's blocker. |

---

## 5. What this audit did that touched the outside world

- **Production:** read only. No row written, no flag flipped, no run retried, no funnel published.
- **Dev clone (`anjvztjiokcgiyhobknq`):** created funnel `off-season-speed-camp-dxf8` (id
  `dc35d215…`, published) and landing page `return-to-sport-screen-yce9` (id from `.state.json`,
  published); three form submissions; contacts `tayawaschoolworks+audit@` (matched by phone onto the
  seeded "Dana Okafor" — my harness reused the seed's number, and the engine correctly filed it as an
  identifier conflict) and `tayawaschoolworks+audit2@` (fresh); switched **New Lead Nurture ON**
  through the real dialog (still on); pushed Dana's run 30 days out so no tick can email a `.demo`
  address; inserted then deleted `cron_sequence_tick_enabled`; two signed inbound webhooks (a reply
  and a STOP) for `+12025550177`.
- **Email:** the two funnel submissions each triggered the product's coach alert, delivered by Resend
  to `darren@darrenjpaul.com` **and** the test inbox (subjects `[Lead] tayawaschoolworks+audit…`).
  That is the product's default recipient list, not something I addressed; the owner should expect
  two test alerts in their inbox. No sequence email and no SMS was sent.
- **Blocked by the permission classifier, left for the owner:** the production screenshot pass
  (`node --env-file=.env.prod scripts/capture-lead-engine-audit-prod.mjs`, read-only, mints an
  admin session) and the dev tick run that would prove a sequence email end to end today
  (`node --env-file=.env.local scripts/capture-lead-engine-audit.mjs tick`, after setting
  `cron_sequence_tick_enabled` true on dev). The 2026-09-06 dev send is the standing proof.

## 6. Evidence index

- Screenshots: `screenshots/lead-engine-audit/` — 18 annotated PNGs, all the real admin or the real
  public route on the dev clone; `index.html` lists them with one line each.
- Scripts: `scripts/capture-lead-engine-audit.mjs` (stages `build`, `nurture`, `submit2`, `tick`,
  `preview`, `sms`, `page`, `reshoot`) and `scripts/capture-lead-engine-audit-prod.mjs` (read-only).
- Tests run: `patch-route`, `convert-route`, `add-step-route`, `preview-submit`, `platform-inventory`,
  `sequence-tick`, `sequence-tick-send-faults`, `sequence-tick-sms` — 8 files, 94/94 green.
- Production queries: all through `supabase-prod` `execute_sql`; column shapes taken from
  `information_schema.columns`, constraints from `pg_constraint`, never the migration ledger.
- Code reviews (read-only, notes in the session scratchpad): capture paths, sequence engine + email,
  funnel maker, SMS/pipeline/inbox/attribution/audit.

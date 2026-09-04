# Full Engine Phase 5 — the business settings screen

**Status:** design, not yet approved
**Date:** 2026-09-01
**Branch:** `feat/business-settings` (not created)
**Parent:** [docs/full-engine-scope-vs-built.md](../../full-engine-scope-vs-built.md) §6
**Closes scope lines:** "Branding and business details are settings, not code…
A rebrand, or a move to a new sending domain, stops being a development job."

---

## 1. What this is

Every field the proposal promises already exists as a column. What does not exist
is any way to change one.

```
$ grep -rn "updateBusinessSettings" app lib components --include=*.ts --include=*.tsx
lib/db/businesses.ts:38:  export async function updateBusinessSettings(...)
lib/automation/sequence-tick-runner.ts:640:  // ... and nothing calls updateBusinessSettings, so an
lib/lead-engine/email.ts:125:  // `updateBusinessSettings`, so an untouched install would send ...
```

**Zero callers.** The two hits are comments complaining about the zero callers.

The cost of that showed up on 2026-09-01: changing one sender address took a
hand-written `UPDATE` against production, guarded on the old value, confirmed by
`RETURNING` — plus a separate environment-variable change, plus a redeploy. That
is a developer task, three times over, for a field the proposal sells as a
setting.

This is the smallest of the five phases. It is last only because of that, not
because it matters least: it is the one that stops you needing me to change your
own name.

---

## 2. The part that makes this more than a form

**A settings screen that changes `sender_email` and nothing else would be a
lie**, because the address is read from two different places by two different
mechanisms:

| Reader | Source | Takes effect |
|---|---|---|
| The Lead Engine (`lib/lead-engine/email.ts`) | `business_settings.sender_email` — a database read, per request | immediately |
| ~38 senders in `lib/email.ts` — password resets, invites, receipts, notifications | `RESEND_FROM_EMAIL` — an environment variable, baked at build | only after a redeploy |

So today, setting the field in a screen would fix the Lead Engine's mail and
leave every transactional email in the product still going out from the old
address. Someone would change it, watch a sequence email arrive correctly, and
reasonably conclude it was done.

**Phase 5 has to make `business_settings` authoritative for both.** `lib/email.ts`
reads the database, with `RESEND_FROM_EMAIL` demoted to a fallback for when the
row cannot be read. That is the change that turns the column into a setting.

It is also a change with reach — ~38 call sites depend on that resolution — so it
is a build-and-targeted-test gate, not a "looks fine" one.

---

## 3. The feature that would have prevented the 73

On 2026-08-31 the sequence tick failed all 73 `sms_repermission` runs against
`The darrenjpaul.com domain is not verified`. `assertSendable` was written for
exactly that failure and did not fire, because **its predicate is emptiness** and
a wrong-but-present address is not empty. The design note from that incident is
the right one: a preflight over local state cannot cover a provider-side fact.

**A settings screen can, because it is a human-initiated action where a network
call is affordable.** On save, before writing:

1. Call Resend's domains API with the production key.
2. If the address's domain is not verified, **refuse the save** and show the
   list of domains that are.

This is not a preflight in a five-minute cron; it is one API call, once, at the
moment a person types an address. It converts the fault that destroyed the
campaign into a validation message.

Same shape for `sms_sender_phone` / `sms_messaging_service_sid`: check the number
is in the Messaging Service's sender pool before saving. The A2P work already
proved that the account-side `messaging_service_sid` reads `null` even for a
number that *is* in the pool — so **check pool membership, not that field**, or
the validation will reject a correct configuration.

---

## 4. What to build

### 4.1 The screen

`/admin/settings/business`, grouped so the dangerous fields are visibly
dangerous:

```
Identity          display_name, logo_url
Sending — email   sender_name, sender_email, reply_to        [verified ✓]
Sending — SMS     sms_sender_phone, sms_messaging_service_sid, sms_help_text
Timing            timezone, quiet_hours_start, quiet_hours_end, daily_message_cap
Legal             postal_address
```

`postal_address` appears on outbound mail for CAN-SPAM. Label it as such, so
nobody empties it to tidy the form.

### 4.2 Route

`PATCH /api/admin/settings/business`, `withAudit()`, Zod-validated, partial
updates only.

```ts
{ slug: "settings.business_updated", category: "admin_write",
  description: "Business identity, sending or timing settings changed" },
```

**Record the old and new values in the metadata.** `lib/audit/scrub.ts` already
redacts `password / token / secret / api_key` at any depth and caps the payload
at 8KB, so this is safe by default — and "who changed the sender address, when,
and from what" is precisely the question that gets asked after a delivery
incident.

### 4.3 Logo upload

`logo_url` is a text column. Either wire it to the existing upload route under
`app/api/uploads/` and store the resulting URL, or make it a plain URL field and
say so in the label. Do not ship a file picker that writes a blob URL.

---

## 5. The trap that will bite: static prerendering

Read [app/(marketing)/layout.tsx](../../../app/(marketing)/layout.tsx) before
touching this. Its doc comment is a post-mortem of this exact mistake:

> *"THIS LAYOUT READS NOTHING, AND THAT IS DELIBERATE… this layout wraps the
> ENTIRE public site, and those pages are statically generated… Both values were
> therefore frozen into each page at build time and never re-read — one build even
> froze two different answers into two different pages."*

The consequence for Phase 5 is direct: **changing `display_name` in the screen
will not change it on `/faq`, `/services`, `/contact`, `/testimonials`,
`/philosophy`, `/glossary`, `/education`, `/athletes/*`, `/privacy-policy`,
`/terms-of-service` or `/sports`** until the next deploy. The same is already
true of the legal pages, which are prerendered and show a stale `Version N` line
until a redeploy.

Three honest options, and the screen must do one of them:

1. **Say so.** A banner on the identity group: *"Your business name appears on
   public pages that are built ahead of time. It will update there at the next
   deploy."* Cheapest, and truthful.
2. **Read it from the browser**, the way the chat launcher already does via
   `GET /api/ask/config`. Correct, and the pattern is established.
3. **Trigger a rebuild on save.** Rejected — a settings edit that redeploys the
   site is a surprising and expensive side effect.

Take 1 now, and 2 for any surface where a stale name is actually harmful.

---

## 6. Other traps

- **Verify every environment after an env change.** `vercel env add --force`
  **splits a multi-target entry**: forcing Production left Preview and
  Development on the 194-day-old value. And the `ls` timestamp column is
  `createdAt`, not `updatedAt`, so a successful override can still read "194d
  ago". List every environment, not the one you targeted.
- **`RESEND_FROM_EMAIL` cannot be deleted in this phase.** It stays as the
  fallback, and it stays correct, because a database read can fail. Removing it
  is a later change once the DB read has run in production for a while.
- **The no-brand-literals sweep.** `__tests__/lib/lead-engine/no-brand-literals.test.ts`
  fails on a hard-coded brand name under `lib/lead-engine`. Any default or
  placeholder added here must name no business.
- **A send that did not throw is not a send.** If the domain check calls Resend
  and the key is missing, it must fail the save loudly — not pass validation
  because nothing threw.
- **`null` and `[]` are different answers.** Resend returning no domains means
  "could not read" or "none configured"; neither is "this one is verified".
  Default the unknown case to refusing the save.

---

## 7. Tasks

1. `lib/email.ts` resolves the From address from `business_settings`, falling
   back to `RESEND_FROM_EMAIL`. **Build gate:** `tsc --noEmit` against the 251
   baseline, plus targeted tests on a sample of the ~38 senders.
2. `lib/validators/business-settings.ts` — Zod, partial, with timezone validated
   against the IANA list and quiet hours as 0–23 integers.
3. Resend domain verification on save (§3).
4. Twilio sender-pool check on save (§3) — pool membership, not the number's own
   `messaging_service_sid`.
5. `PATCH /api/admin/settings/business` with `withAudit` and the new slug.
6. `/admin/settings/business` screen, five groups, light-only.
7. The §5 banner.
8. Screenshot: the form with real values, and the refusal when an unverified
   sending domain is entered. **That second shot is the deliverable** — it is the
   evidence that the 31 August incident cannot repeat from this surface.

---

## 8. Out of scope, and one of them is big

**Multi-business.** The proposal's third example — *"adding a second business
line stops being a development job"* — is not delivered by this phase and should
not be claimed. `SINGLETON_BUSINESS_ID` is hard-coded in **124 places**. Every
table already carries `business_id`, so the schema is ready and the application
is not.

That is a genuine project of its own — realistically the largest single piece of
work remaining in this codebase — and it should be scoped and quoted separately
rather than folded in here. The first two examples in that sentence, a rebrand
and a new sending domain, are fully delivered by this phase.

Also out of scope:

- Per-user preferences. This is business configuration, not user settings.
- Editing sequence content. That belongs with sequences.
- Feature flags (`chat_assistant_enabled`, the cron switches). They live in
  `system_settings` and deserve their own screen with their own warnings —
  flipping a cron is not the same kind of act as changing a reply-to address.

# Phase 1 multi-coach proof — a second business, created through the real form

What this proves: an operator creates a **second business** through the real
"Add a business" form (never seeded), invites a coach into it, edits its
settings, and the admin screens start reading *that* business's own rows
instead of the singleton's. This is a browser proof, not a mocked test — every
shot below is the real admin route, in the real running app, against the dev
clone.

Script: `scripts/capture-phase1-multicoach-screenshots.mjs`. Run with the dev
server up (`npm run dev`, port 3050) against the dev clone only — the script
refuses to run against any other Supabase project. Each run creates one new
business (through the form), one new invite, and one new user account (by
actually claiming that invite) — a fresh, human-sounding name each time so a
re-run never collides with an earlier one. Nothing is deleted and nothing
pre-existing is touched.

Business this run created: **Trailhead Strength & Conditioning**
(`trailhead-strength-conditioning`). Coach invited and who actually claimed
the link: **Devon Delgado**.

| # | Shot | What it shows | Spec section |
|---|---|---|---|
| 01 | `01-admin-businesses-list-before.png` | `/admin/businesses` with only the singleton ("Primary") listed, before this run creates anything. | §5.1 |
| 02 | `02-admin-businesses-new-filled.png` | The real create form filled in: the web address auto-fills from the name, and the time zone reads "Pacific Time (Los Angeles)" — never a raw IANA id. | §5.1–5.2 |
| 03 | `03-admin-business-detail-settings.png` | The new business's own settings screen, mid-edit-and-save (the "Settings saved" toast is up), grouped under plain headings — Identity, Email, Timing, Text messages, Legal. | §5.3 |
| 04 | `04-admin-business-invite-coach.png` | The Members card's "Invite a coach" dialog, open, showing the real 7-day invite link — not a mocked email. | §5.3, §6.3 |
| 05 | `05-admin-businesses-list-after.png` | `/admin/businesses` again: both the singleton and the new business now listed. | §5.1 |
| 06 | `06-admin-contacts-switcher-primary.png` | The business switcher (now visible with two choices) set to "Primary", reading the singleton's own, populated contacts list. | §6.1–6.2 |
| 07 | `07-admin-contacts-switcher-new-business.png` | The same screen, same code, switched to the new business: zero contacts — the correct answer for a business minutes old, not the singleton's rows leaking through. | §6.1–6.2 |
| 08 | `08-admin-businesses-new-slug-conflict.png` | The 409 duplicate-web-address error, rendered on the field itself (not a toast) — typing the web address the new business already claimed. | §5.1, Task 4's test |
| 09 | `09-admin-bookings-coach-scoped.png` | Signed in as Devon Delgado — a real invited coach, not the operator — `/admin/bookings` scoped to their own business, and **no switcher** (their account belongs to exactly one business). | §6.1–6.2, §6.3 |
| 10 | `10-admin-contacts-coach-no-access.png` | A staff coach's real attempt at `/admin/contacts`, landing on `/admin/no-access` because `proxy.ts` default-denies the unmapped path before the page ever renders. Documents a pre-existing gap (below), not a bug this phase introduced. Re-captured after the final review caught the burned-in caption naming the wrong mechanism (`requireAdmin()`) — see its own header comment in `scripts/recapture-shot-10-contacts-caption-fix.mjs`. | — |

## Why shot 10 exists, and why shot 09 is `/admin/bookings` and not `/admin/contacts`

The task brief this proof was written against assumed a signed-in coach could
load `/admin/contacts`. It isn't reachable by any invited teammate today, and
the proximate cause is `proxy.ts`, not the page: for any `/admin/*` path it
resolves `canAccessPath({role:"staff",...}, pathname, method)`
(`lib/permissions/registry.ts`) *before* the page component runs.
`/admin/contacts` appears in no `PATH_PERMISSIONS` rule, so that resolves to
`kind: "unmapped"`, `canAccessPath` returns `false`
(`lib/permissions/registry.ts:611`), and the proxy redirects straight to
`/admin/no-access` — the contacts page's own `requireAdmin()` call never gets
the chance to run. Separately, `roleForPermissions()`
(`lib/permissions/registry.ts:576`) never returns `"admin"` for an invited
teammate under any preset — only `"staff"` or `"editor"` — so even a coach who
somehow reached the page would fail that check too; it just isn't the check
that actually fires here. A coach is redirected to `/admin/no-access` before
that page ever renders, regardless of which permission preset their invite
carried.

This is not a hole Phase 1 opened — `/admin/contacts` has never been
staff-reachable — so it isn't this task's to fix. Shot 09 proves the phase's
actual claim (a real invited teammate's admin screens read their own
business, and only their own business, with no switcher) on a screen a coach
*can* reach: `/admin/bookings`, gated by the `"schedule"` permission the
"Coach" preset grants. Shot 10 captures the `/admin/contacts` attempt exactly
as it happens, as the documented evidence for that substitution rather than a
bare claim in a report.

## Light only, deliberately

The admin UI is light-only — `.dark` is a class variant these components were
never built against, and there's no toggle that applies it. There is no
second rendering to capture.

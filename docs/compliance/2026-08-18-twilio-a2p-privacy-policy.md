# Twilio A2P 10DLC — footer + privacy policy

Two blockers behind Twilio error 18601 ("the association between business name and
website cannot be verified"). The profile registers **YORTAGO LLC** against
**darrenjpaul.com**, and until now the site named YORTAGO nowhere.

## 1. Footer — DONE, live

`57b71a37` on `origin/main`, deployed and verified on the live site:

> darrenjpaul.com is operated by YORTAGO LLC, 3925 Addlestone Avenue 302, Wesley Chapel, Florida 33543, US

The address string matches the Twilio profile character-for-character (spelled-out
"Florida", trailing "US") because that is what the carrier check compares against.

## 2. Privacy policy — content ready, NOT yet published

The policy content lives in the `legal_documents` table, not in this repo, so this is
a database change and not a deploy. The new content is
[privacy-policy-v2.html](privacy-policy-v2.html), built from the live v1 by
[build-privacy-policy-v2.mjs](build-privacy-policy-v2.mjs).

Every existing sentence is preserved byte-for-byte — 51 of 58 lines are untouched.
The build script anchors each edit on an exact string and throws unless it matches
exactly once, then asserts all A2P elements are present before writing output.

### What changed

| # | Change | Why |
|---|--------|-----|
| 1 | `Effective Date: [March 1st 2026]` → `18 August 2026` | A bracketed placeholder reads as an unfinished document |
| 2 | Intro now names **YORTAGO LLC** as operator of darrenjpaul.com | Same name/site mismatch that caused 18601 |
| 3 | New collection bullet: mobile number + consent record | The policy has to say it collects what it collects |
| 4 | "marketing emails" → "marketing emails **and text messages**" | §2 named email only |
| 5 | New §4 clause: mobile info never sold or shared for marketing | **The clause carrier vetting actually looks for** |
| 6 | New **§9 SMS and text messaging** (old 9–11 renumber to 10–12) | Frequency, rates, STOP, HELP, carrier liability |
| 7 | Removed "This document is a placeholder and requires review by a qualified legal professional before use." | A reviewer reading that can reject the policy outright |

### Two judgment calls to confirm

- **Message frequency — "up to approximately 6 messages per month"** is a number I
  chose. It must match what the Twilio campaign registration claims. Change it in
  `privacy-policy-v2.html` before publishing if the real cadence differs.
- **Removing the "placeholder" disclaimer** (change 7). It was actively working
  against the submission, but it is a deliberate legal hedge and its removal is
  Darren's call. The whole document still warrants a lawyer's review.

### How to publish

**Preferred — the admin UI.** Go to `/admin/legal`, create a new Privacy Policy
version, and paste the contents of `privacy-policy-v2.html`. `POST /api/admin/legal`
bumps the version, deactivates the old row, and writes a `legal_document.published`
audit row.

**Fallback — the script**, if the admin UI is not reachable:

```bash
node scripts/publish-privacy-policy.mjs .env.prod --dry   # inspect, publish nothing
node scripts/publish-privacy-policy.mjs .env.prod         # publish
```

It refuses to run if any A2P element is missing from the content. Note it writes to
the database directly and so leaves **no audit row** — the admin UI is better.

Publishing creates a new version and deactivates the old one; it never edits a row in
place, because `user_consents.legal_document_id` points at the version a person
agreed to. Rewriting v1 would silently change what past clients consented to.

### Blocker: an unread draft already exists

A dry run against prod showed **three** rows, not one:

| version | active | effective |
|---------|--------|-----------|
| 2 | **false** | 2026-08-18 |
| 1 | **true** | 2026-04-06 |

There is already an inactive **v2 dated today** that somebody — a peer session, or
Darren in the admin UI — created and never activated. I could not read its contents:
the sandbox blocked every further prod database call after that first dry run.

**Read v2 before publishing anything.** If it is already an SMS/A2P rewrite, publish
that instead of, or merged with, this one. `publish-privacy-policy.mjs` now detects
this case, prints a summary of any draft newer than the active version, and exits
rather than burying it; `--force` overrides.

## 3. Still outstanding for the A2P submission

- **The on-site opt-in.** Carrier vetting wants a screenshot of the actual consent
  checkbox with its exact wording, and that wording should match §9. Worth checking
  against the lead-engine consent work (`13db8917`), which already stores the consent
  text that was shown.
- **The TrustHub address document** was still in DRAFT at last check — the footer fix
  does not clear that.
- `/privacy-policy` is `robots: noindex` (from `2b503674`). Manual vetting fetches the
  URL directly so this is very unlikely to matter, but it is worth knowing.

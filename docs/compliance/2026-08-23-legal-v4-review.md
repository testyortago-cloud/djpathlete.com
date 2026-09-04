# Legal v4 — review sheet (2026-08-23)

Prepared for the A2P campaign review. **Nothing is published** — this is the dry-run output.

Build:  `node --env-file=.env.prod scripts/publish-legal-a2p-cleanup.mjs`  (prints, writes nothing)
Ship:   `PUBLISH=true node --env-file=.env.prod scripts/publish-legal-a2p-cleanup.mjs`

Each block below is a separate paragraph on the page.

## privacy_policy  v3 (active) -> v4

### 1. drop-placeholder

**Before:**

> This document is a placeholder and requires review by a qualified legal professional before use.

**After:**

> _(removed entirely)_

### 2. effective-date

**Before:**

> Effective Date: [March 1st 2026]

**After:**

> Effective Date: 18 August 2026

### 3. name-operator

**Before:**

> DJP Athlete ("we", "our", "us") is committed to protecting your privacy.

**After:**

> DJP Athlete is a brand of YORTAGO LLC ("we", "our", "us"), which operates darrenjpaul.com. We are committed to protecting your privacy.

### 4. add-no-sell

**Before:**

> We do not sell, rent or share your mobile number, or your consent to receive text messages, with any third party for their own marketing purposes.

**After:**

> We do not sell, rent or share your mobile number, or your consent to receive text messages, with any third party for their own marketing purposes.
>
> No mobile information will be sold or shared with third parties or affiliates for marketing or promotional purposes. Reply STOP to any message to unsubscribe at any time. Reply HELP for assistance.

## terms_of_service  v2 (active) -> v3

One edit only — the same trailing disclaimer removed. The body is asserted byte-identical.

**Removed:**

> This document is a placeholder and requires review by a qualified legal professional before use.

## Decisions made

- **effective_date column is NOT changed** (privacy stays 2026-08-18, terms 2026-05-04). Removing a
  disclaimer and naming the operator clarifies an existing policy; it does not start a new one. A new
  date would imply a re-consent event that did not happen — 31 `user_consents` rows point at v1.
- **The existing no-sell sentence is kept alongside the added one.** The original is what a human wrote
  for this business; the addition is the phrasing carrier vetting matches on. They agree, so the policy
  carries both rather than trading one for the other.
- **The site consent checkbox wording is NOT touched.** The submitted `message_flow` quotes it verbatim;
  changing it now would break that match mid-review.
- **Publishing is opt-in** (`PUBLISH=true`), inverted from `publish-privacy-policy-sms.mjs`, because this
  one edits two live legal documents and the muscle-memory failure mode is an unreviewed change.

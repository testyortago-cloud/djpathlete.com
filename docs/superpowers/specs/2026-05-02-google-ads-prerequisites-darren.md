# Google Ads Integration — Prerequisites for Darren

**Date:** 2026-05-02
**Status:** Action items for Darren (blocks Phase 1.1 going to production)
**Reference:** Roadmap Phase 1, Spec `2026-05-02-google-ads-integration-design.md`

These are real-world setup steps only Darren can complete. Most have lead times that compress nothing else. Start them today; engineering work runs in parallel against a sandbox account.

---

## 1. Apply for Google Ads Developer Token (1–2 weeks lead time)

**Why:** Without a Developer Token, the integration cannot make Google Ads API calls in production. Test access works against managed test accounts without a token, but live campaign data requires it.

**Steps:**
1. Sign in to your Google Ads account at https://ads.google.com
2. Go to **Tools & Settings → Setup → API Center** (gear icon, top-right)
3. Click **Apply for token**
4. Application form will ask:
   - Company name and website (use `darrenjpaul.com`)
   - Tool description — paste this:
     > "Internal AI marketing automation platform that syncs campaign performance data, generates ad copy variations, recommends keyword and bid optimizations, and produces weekly performance reports. Single-advertiser use, not resold or shared."
   - API call volume — answer "low (under 1,000 operations/day)"
   - Use case — select **"Manage your own/your employer's accounts"**
5. Wait for approval email. Usually 1–2 weeks. Reply promptly to any clarifying questions from Google.
6. Once approved, the Developer Token is shown in the API Center page. **Save it securely** (it's a string; treat it like a password).

**Send to engineering when received:** the Developer Token string.

---

## 2. Confirm Google Ads account structure

**Why:** This determines whether we treat your setup as a single direct account or a Manager Account (MCC) that owns sub-accounts.

**How to check:**
1. Sign in to https://ads.google.com
2. Top-right account switcher — does it show:
   - One Customer ID (10-digit, like `123-456-7890`)? → Single direct account ✅
   - A "Manager account" with multiple sub-accounts under it? → MCC structure
3. **Send to engineering:** the 10-digit Customer ID (with dashes, e.g. `123-456-7890`). If MCC, send the manager Customer ID and the sub-account ID you advertise from.

---

## 3. Create OAuth credentials (Google Cloud Console — 15 min)

**Why:** The integration uses OAuth 2.0 to access your Google Ads data on your behalf, refreshable indefinitely.

**Steps:**
1. Go to https://console.cloud.google.com
2. Create a new project (or reuse the one you have — DJP Athlete may already have a project for Search Console / YouTube). Name suggestion: `djp-marketing-automation`
3. In **APIs & Services → Library**, search for and **Enable**:
   - Google Ads API
   - (Optional, for later) Google Search Console API
4. Go to **APIs & Services → OAuth consent screen**:
   - User Type: **External**
   - App name: `DJP Marketing Automation`
   - Support email: `darren@darrenjpaul.com`
   - Authorized domains: `darrenjpaul.com`
   - Scopes: add `https://www.googleapis.com/auth/adwords`
   - Test users: add `darren@darrenjpaul.com` (and any other coach emails that may need access)
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `DJP Marketing Automation — Web`
   - Authorized redirect URIs: add both:
     - `https://www.darrenjpaul.com/api/integrations/google-ads/callback`
     - `http://localhost:3050/api/integrations/google-ads/callback` (for dev)
6. Click **Create**. A modal shows the **Client ID** and **Client Secret**.

**Send to engineering:**
- OAuth Client ID
- OAuth Client Secret
- Confirm the redirect URIs match what you set

---

## 4. Inventory current campaigns (15 min, helps spec calibration)

**Why:** Phase 1 supports 5 campaign types (Search, YouTube Video, Retargeting, Performance Max, Lead Gen). Tells us what to prioritize for testing.

**How to share:**
1. In Google Ads, **Campaigns** tab
2. For each active campaign, note:
   - Name
   - Type (Search / Video / Performance Max / etc.)
   - Status (Enabled / Paused)
   - Approximate monthly spend
3. Send as a quick list, no exact dollar amounts needed.

---

## 5. Decide automation comfort level (5 min)

**Why:** The three automation modes (Auto-pilot / Co-pilot / Advisory) are configurable per-campaign. Defaults influence the first-launch behavior.

**Three modes:**
- **Auto-pilot** — System adds clearly-bad negative keywords without asking. Bid and budget changes still need your approval.
- **Co-pilot** — Every recommendation goes into an approval queue. You review and one-click apply.
- **Advisory** — Recommendations are reported but never applied. Pure read-only.

**Default proposal:**
- Existing high-spend campaigns → **Co-pilot** (you stay in the loop)
- New experimental campaigns → **Advisory** for the first 2 weeks, then promote to Co-pilot
- All Performance Max campaigns → **Advisory** only (Google's own AI is opaque enough)

**Send to engineering:** approval of the default proposal, or your override.

---

## What engineering is doing in parallel

While these prereqs are in flight (especially the Developer Token):

- Writing the integration spec → `docs/superpowers/specs/2026-05-02-google-ads-integration-design.md`
- Writing Plan 1.1 (OAuth + sync schema) → `docs/superpowers/plans/2026-05-XX-google-ads-phase1-oauth-and-sync.md`
- Building OAuth flow + Supabase schema against a Google Ads **test account** (does not require Developer Token)
- Wiring the admin UI shell at `app/(admin)/admin/ads/`

When credentials arrive, we flip the integration from test-account to live-account by swapping env vars. Zero code change.

---

## Send-back checklist (when ready)

- [ ] Google Ads Developer Token (the string)
- [ ] 10-digit Customer ID (and Manager Customer ID if MCC)
- [ ] OAuth Client ID + Client Secret
- [ ] Confirmed redirect URIs match
- [ ] Campaign inventory (names, types, statuses)
- [ ] Automation mode default approval/override

Send these via your usual secure channel — never paste secrets in plain email or unencrypted chat.

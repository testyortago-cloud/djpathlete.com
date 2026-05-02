# Phase 1.5a — Attribution Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture click attribution (`gclid`, `gbraid`, `wbraid`, `fbclid`, `utm_*`) on every visitor to darrenjpaul.com, persist it in Supabase, and join it onto every conversion-relevant action (newsletter signup, GHL booking, Stripe payment, event signup) so downstream phases can upload offline conversions to Google Ads with correct gclids. Also: add the `marketing_consent_at` column + log that gates Customer Match audience uploads in Phase 1.5b.

**Architecture:** A long-lived `djp_attr` cookie (1-year, SameSite=Lax) is server-set in middleware whenever a visitor lands with any tracking query parameters. Middleware fires a one-shot POST to `/api/public/attribution/track` which UPSERTs into `marketing_attribution` keyed by `session_id` (the cookie value). When the visitor identifies via newsletter signup, GHL booking, Stripe checkout, or event signup, the action's write path looks up the latest unclaimed attribution row for the cookie, copies `gclid`/`gbraid`/`wbraid`/`fbclid` onto the new row, and back-fills `user_id` + `claimed_at` on the attribution row. GHL bookings additionally support email-match fallback (since the booker may have first identified via newsletter on our site, then booked through GHL). Marketing consent is a separate column on `users` with its own audit log; consent UI lives on the newsletter form and `/account/preferences`.

**Tech Stack:** Next.js 16 App Router middleware (Edge runtime), Supabase Postgres + Service-role client, NextAuth v5 for auth context, Zod validators, Vitest + Testing Library, Tailwind v4 + shadcn/ui (semantic tokens only).

**Spec:** `docs/superpowers/specs/2026-05-03-google-ads-leads-first-optimization-design.md` — D4, D5, D12, Pipeline 1, Plan 1.5a section.

**Non-goals (deferred to later sub-phases):**
- Customer Match audience sync (Phase 1.5b)
- Conversion uploads to Google Ads API (Phase 1.5c)
- Stripe value adjustments (Phase 1.5d)
- Pipeline visualization (Phase 1.5f)
- AI Ads Agent (Phase 1.5g)

This plan only ensures the data is **captured and joined** — no upload to Google yet. It's a self-contained foundation that produces working software (the attribution table populates on real traffic; consent toggles work end-to-end).

---

## File Structure

### New files
- `supabase/migrations/00101_marketing_attribution.sql`
- `supabase/migrations/00102_marketing_consent.sql`
- `lib/validators/marketing.ts`
- `lib/db/marketing-attribution.ts`
- `lib/db/marketing-consent.ts`
- `lib/marketing/cookies.ts` — cookie parse/serialize for `djp_attr`
- `lib/marketing/attribution.ts` — extract tracking params, claim-by-session helper
- `app/api/public/attribution/track/route.ts`
- `app/api/account/preferences/marketing-consent/route.ts`
- `app/(client)/account/preferences/MarketingConsentToggle.tsx`
- `app/(admin)/admin/ads/consent/page.tsx`
- `app/(admin)/admin/ads/consent/ConsentLogTable.tsx`
- `__tests__/lib/marketing/cookies.test.ts`
- `__tests__/lib/marketing/attribution.test.ts`
- `__tests__/api/public/attribution/track.test.ts`
- `__tests__/api/newsletter/attribution-capture.test.ts`
- `__tests__/api/webhooks/ghl-booking-attribution.test.ts`
- `__tests__/api/account/marketing-consent.test.ts`

### Changed files
- `types/database.ts` — add `MarketingAttribution`, `MarketingConsentLog` interfaces; add `gclid`/`gbraid`/`wbraid`/`fbclid` columns to `Booking`, `NewsletterSubscriber`, `Payment`, `EventSignup`; add `marketing_consent_at` + `marketing_consent_source` to `User`
- `middleware.ts` — extend to capture tracking params + set cookie
- `app/api/newsletter/route.ts` — read cookie, claim attribution, capture consent
- `app/api/webhooks/ghl-booking/route.ts` — extract gclid from payload OR email-match fallback
- `app/api/stripe/webhook/route.ts` — back-fill gclid on payment insert (look up by checkout session metadata or email)
- `app/api/events/[id]/signup/route.ts` — read cookie, claim attribution
- `components/public/NewsletterForm.tsx` — add consent checkbox + send `consent_marketing: true` in body

---

## Task 1: Migrations 00101 + 00102 — schema for attribution and consent

**Files:**
- Create: `supabase/migrations/00101_marketing_attribution.sql`
- Create: `supabase/migrations/00102_marketing_consent.sql`

- [ ] **Step 1: Create `00101_marketing_attribution.sql`**

```sql
-- Phase 1.5a — Marketing attribution capture
-- Stores tracking params (gclid, utm_*, etc.) per visitor session, joined to user_id at action time.

CREATE TABLE marketing_attribution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL UNIQUE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  gclid           text,
  gbraid          text,
  wbraid          text,
  fbclid          text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  landing_url     text,
  referrer        text,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_attr_user ON marketing_attribution(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_marketing_attr_gclid ON marketing_attribution(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX idx_marketing_attr_unclaimed ON marketing_attribution(session_id) WHERE claimed_at IS NULL;

-- gclid back-fill columns on action tables
ALTER TABLE bookings              ADD COLUMN IF NOT EXISTS gclid text, ADD COLUMN IF NOT EXISTS gbraid text, ADD COLUMN IF NOT EXISTS wbraid text, ADD COLUMN IF NOT EXISTS fbclid text;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS gclid text, ADD COLUMN IF NOT EXISTS gbraid text, ADD COLUMN IF NOT EXISTS wbraid text, ADD COLUMN IF NOT EXISTS fbclid text;
ALTER TABLE payments              ADD COLUMN IF NOT EXISTS gclid text, ADD COLUMN IF NOT EXISTS gbraid text, ADD COLUMN IF NOT EXISTS wbraid text, ADD COLUMN IF NOT EXISTS fbclid text;
ALTER TABLE event_signups         ADD COLUMN IF NOT EXISTS gclid text, ADD COLUMN IF NOT EXISTS gbraid text, ADD COLUMN IF NOT EXISTS wbraid text, ADD COLUMN IF NOT EXISTS fbclid text;

CREATE INDEX IF NOT EXISTS idx_bookings_gclid             ON bookings(gclid)              WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_gclid           ON newsletter_subscribers(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_gclid             ON payments(gclid)              WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_signups_gclid        ON event_signups(gclid)         WHERE gclid IS NOT NULL;

-- RLS: only service role writes; authenticated users can SELECT their own attribution rows
ALTER TABLE marketing_attribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on marketing_attribution"
  ON marketing_attribution FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own marketing_attribution"
  ON marketing_attribution FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins read all marketing_attribution"
  ON marketing_attribution FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: Create `00102_marketing_consent.sql`**

```sql
-- Phase 1.5a — Marketing consent column + audit log

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS marketing_consent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_source  text;

CREATE INDEX IF NOT EXISTS idx_users_marketing_consent ON users(marketing_consent_at)
  WHERE marketing_consent_at IS NOT NULL;

CREATE TABLE marketing_consent_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted     boolean NOT NULL,
  source      text NOT NULL,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_consent_log_user ON marketing_consent_log(user_id, created_at DESC);

ALTER TABLE marketing_consent_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on marketing_consent_log"
  ON marketing_consent_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins read all marketing_consent_log"
  ON marketing_consent_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 3: Apply migrations to local DB**

Run: `npx supabase db push` (or apply via Studio if cloud-only)
Expected: both migrations succeed. Verify with:
```bash
psql ... -c "SELECT column_name FROM information_schema.columns WHERE table_name='bookings' AND column_name='gclid';"
psql ... -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='marketing_consent_at';"
```

If working cloud-only, just open Supabase Studio → SQL Editor → paste and run each migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00101_marketing_attribution.sql supabase/migrations/00102_marketing_consent.sql
git commit -m "feat(db): add marketing_attribution + consent column/log"
```

---

## Task 2: TypeScript types and Zod validators

**Files:**
- Modify: `types/database.ts`
- Create: `lib/validators/marketing.ts`

- [ ] **Step 1: Add types in `types/database.ts`**

Find the `Booking`, `NewsletterSubscriber`, `Payment`, `EventSignup`, and `User` interfaces. Add these fields to each (the order/placement should match existing conventions — append to end of each interface):

```ts
// On Booking, NewsletterSubscriber, Payment, EventSignup:
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null

// On User:
  marketing_consent_at: string | null
  marketing_consent_source: string | null
```

Add two new exported interfaces at the bottom of `types/database.ts`:

```ts
export interface MarketingAttribution {
  id: string
  session_id: string
  user_id: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  fbclid: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  landing_url: string | null
  referrer: string | null
  first_seen_at: string
  last_seen_at: string
  claimed_at: string | null
  created_at: string
}

export interface MarketingConsentLog {
  id: string
  user_id: string
  granted: boolean
  source: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}
```

- [ ] **Step 2: Create `lib/validators/marketing.ts`**

```ts
import { z } from "zod"

// Tracking params accepted in incoming requests.
// All optional; we ignore unknown extras.
export const trackingParamsSchema = z.object({
  gclid:        z.string().max(200).optional(),
  gbraid:       z.string().max(200).optional(),
  wbraid:       z.string().max(200).optional(),
  fbclid:       z.string().max(200).optional(),
  utm_source:   z.string().max(200).optional(),
  utm_medium:   z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_term:     z.string().max(200).optional(),
  utm_content:  z.string().max(200).optional(),
  landing_url:  z.string().url().max(2000).optional(),
  referrer:     z.string().max(2000).optional(),
})

export type TrackingParams = z.infer<typeof trackingParamsSchema>

// Body schema for /api/public/attribution/track
export const attributionTrackBodySchema = z.object({
  session_id: z.string().min(8).max(128),
}).extend(trackingParamsSchema.shape)

export const marketingConsentToggleBodySchema = z.object({
  granted: z.boolean(),
  source:  z.string().max(80).optional(),
})

export const TRACKING_PARAM_KEYS = [
  "gclid", "gbraid", "wbraid", "fbclid",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
] as const
export type TrackingParamKey = typeof TRACKING_PARAM_KEYS[number]
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors caused by these additions. Pre-existing errors are fine but flag them in the commit message.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts lib/validators/marketing.ts
git commit -m "feat(types): types + validators for marketing attribution and consent"
```

---

## Task 3: DAL — marketing-attribution and marketing-consent

**Files:**
- Create: `lib/db/marketing-attribution.ts`
- Create: `lib/db/marketing-consent.ts`

- [ ] **Step 1: Write `lib/db/marketing-attribution.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { MarketingAttribution } from "@/types/database"
import type { TrackingParams } from "@/lib/validators/marketing"

function getClient() {
  return createServiceRoleClient()
}

/**
 * UPSERT by session_id. Updates last_seen_at on every call;
 * fills tracking params only if previously NULL (first-touch wins).
 */
export async function upsertAttributionBySession(
  session_id: string,
  params: TrackingParams,
): Promise<MarketingAttribution> {
  const supabase = getClient()
  const { data: existing } = await supabase
    .from("marketing_attribution")
    .select("*")
    .eq("session_id", session_id)
    .maybeSingle()

  if (existing) {
    // First-touch wins: only update tracking params if existing row has nulls.
    const updates: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
    for (const k of [
      "gclid", "gbraid", "wbraid", "fbclid",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    ] as const) {
      if (existing[k] == null && params[k] != null) updates[k] = params[k]
    }
    if (existing.landing_url == null && params.landing_url != null) updates.landing_url = params.landing_url
    if (existing.referrer == null && params.referrer != null) updates.referrer = params.referrer

    const { data, error } = await supabase
      .from("marketing_attribution")
      .update(updates)
      .eq("session_id", session_id)
      .select()
      .single()
    if (error) throw error
    return data as MarketingAttribution
  }

  const { data, error } = await supabase
    .from("marketing_attribution")
    .insert({
      session_id,
      gclid: params.gclid ?? null,
      gbraid: params.gbraid ?? null,
      wbraid: params.wbraid ?? null,
      fbclid: params.fbclid ?? null,
      utm_source: params.utm_source ?? null,
      utm_medium: params.utm_medium ?? null,
      utm_campaign: params.utm_campaign ?? null,
      utm_term: params.utm_term ?? null,
      utm_content: params.utm_content ?? null,
      landing_url: params.landing_url ?? null,
      referrer: params.referrer ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as MarketingAttribution
}

/**
 * Look up the most recent unclaimed attribution row for a session_id.
 * Returns null if not found or already claimed.
 */
export async function getUnclaimedAttribution(
  session_id: string,
): Promise<MarketingAttribution | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("*")
    .eq("session_id", session_id)
    .is("claimed_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as MarketingAttribution | null) ?? null
}

/**
 * Mark an attribution row as claimed by a user. Idempotent.
 */
export async function claimAttribution(
  attributionId: string,
  userId: string,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("marketing_attribution")
    .update({ user_id: userId, claimed_at: new Date().toISOString() })
    .eq("id", attributionId)
    .is("claimed_at", null)
  if (error) throw error
}

/**
 * Look up a recent attribution row for an email-match fallback (used by GHL
 * booking webhook when gclid is missing in the payload). Joins through
 * users.email — only finds rows that were claimed by a user with this email.
 */
export async function findAttributionByEmail(
  email: string,
  withinDays = 30,
): Promise<MarketingAttribution | null> {
  const supabase = getClient()
  const since = new Date(Date.now() - withinDays * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from("marketing_attribution")
    .select("*, users!inner(email)")
    .eq("users.email", email.toLowerCase().trim())
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as MarketingAttribution | null) ?? null
}
```

- [ ] **Step 2: Write `lib/db/marketing-consent.ts`**

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import type { MarketingConsentLog } from "@/types/database"

function getClient() {
  return createServiceRoleClient()
}

export interface ConsentChange {
  user_id: string
  granted: boolean
  source: string
  ip_address?: string | null
  user_agent?: string | null
}

/**
 * Set marketing consent for a user (or revoke), and write an audit log row.
 * Idempotent: re-granting consent is a no-op (returns null log row).
 */
export async function setMarketingConsent(change: ConsentChange): Promise<MarketingConsentLog | null> {
  const supabase = getClient()

  // Read current state to dedupe
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("marketing_consent_at")
    .eq("id", change.user_id)
    .single()
  if (userErr) throw userErr

  const isCurrentlyGranted = user.marketing_consent_at != null
  if (isCurrentlyGranted === change.granted) return null

  const updates = change.granted
    ? { marketing_consent_at: new Date().toISOString(), marketing_consent_source: change.source }
    : { marketing_consent_at: null, marketing_consent_source: null }

  const { error: updErr } = await supabase
    .from("users")
    .update(updates)
    .eq("id", change.user_id)
  if (updErr) throw updErr

  const { data: logRow, error: logErr } = await supabase
    .from("marketing_consent_log")
    .insert({
      user_id: change.user_id,
      granted: change.granted,
      source: change.source,
      ip_address: change.ip_address ?? null,
      user_agent: change.user_agent ?? null,
    })
    .select()
    .single()
  if (logErr) throw logErr

  return logRow as MarketingConsentLog
}

export async function listConsentLog(limit = 200): Promise<MarketingConsentLog[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("marketing_consent_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as MarketingConsentLog[]
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (with pre-existing errors only).

- [ ] **Step 4: Commit**

```bash
git add lib/db/marketing-attribution.ts lib/db/marketing-consent.ts
git commit -m "feat(db): DAL for marketing attribution and consent"
```

---

## Task 4: Marketing helpers — cookies + tracking-param extraction

**Files:**
- Create: `lib/marketing/cookies.ts`
- Create: `lib/marketing/attribution.ts`
- Test: `__tests__/lib/marketing/cookies.test.ts`
- Test: `__tests__/lib/marketing/attribution.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/marketing/cookies.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { ATTR_COOKIE_NAME, ATTR_COOKIE_MAX_AGE, parseAttrCookie, generateSessionId } from "@/lib/marketing/cookies"

describe("ATTR_COOKIE_NAME", () => {
  it("is djp_attr", () => {
    expect(ATTR_COOKIE_NAME).toBe("djp_attr")
  })
})

describe("ATTR_COOKIE_MAX_AGE", () => {
  it("is 1 year in seconds", () => {
    expect(ATTR_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365)
  })
})

describe("parseAttrCookie", () => {
  it("returns null when no cookie header", () => {
    expect(parseAttrCookie(undefined)).toBeNull()
    expect(parseAttrCookie("")).toBeNull()
  })

  it("returns null when djp_attr is not in the cookie header", () => {
    expect(parseAttrCookie("foo=bar; baz=qux")).toBeNull()
  })

  it("returns the session id when djp_attr is present", () => {
    expect(parseAttrCookie("djp_attr=abc123; foo=bar")).toBe("abc123")
    expect(parseAttrCookie("foo=bar; djp_attr=xyz789")).toBe("xyz789")
  })

  it("rejects values that do not match expected format", () => {
    // Cookie values containing illegal characters get rejected
    expect(parseAttrCookie("djp_attr=has spaces")).toBeNull()
    expect(parseAttrCookie('djp_attr=with"quote')).toBeNull()
  })
})

describe("generateSessionId", () => {
  it("returns a string between 16 and 64 chars", () => {
    const id = generateSessionId()
    expect(id.length).toBeGreaterThanOrEqual(16)
    expect(id.length).toBeLessThanOrEqual(64)
  })

  it("generates unique values across calls", () => {
    const ids = new Set([generateSessionId(), generateSessionId(), generateSessionId(), generateSessionId()])
    expect(ids.size).toBe(4)
  })

  it("contains only URL-safe characters", () => {
    const id = generateSessionId()
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
```

Create `__tests__/lib/marketing/attribution.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { extractTrackingParamsFromUrl, hasAnyTrackingParam } from "@/lib/marketing/attribution"

describe("extractTrackingParamsFromUrl", () => {
  it("extracts gclid", () => {
    const params = extractTrackingParamsFromUrl(new URL("https://x.example/p?gclid=abc123"))
    expect(params.gclid).toBe("abc123")
    expect(params.utm_source).toBeUndefined()
  })

  it("extracts all tracking params", () => {
    const url = new URL(
      "https://x.example/p?gclid=g1&gbraid=g2&wbraid=w3&fbclid=f4&utm_source=google&utm_medium=cpc&utm_campaign=launch&utm_term=coach&utm_content=ad1",
    )
    const params = extractTrackingParamsFromUrl(url)
    expect(params.gclid).toBe("g1")
    expect(params.gbraid).toBe("g2")
    expect(params.wbraid).toBe("w3")
    expect(params.fbclid).toBe("f4")
    expect(params.utm_source).toBe("google")
    expect(params.utm_medium).toBe("cpc")
    expect(params.utm_campaign).toBe("launch")
    expect(params.utm_term).toBe("coach")
    expect(params.utm_content).toBe("ad1")
  })

  it("populates landing_url with the URL minus query", () => {
    const params = extractTrackingParamsFromUrl(new URL("https://x.example/p?gclid=abc"))
    expect(params.landing_url).toBe("https://x.example/p")
  })

  it("returns empty object for URL with no tracking params", () => {
    const params = extractTrackingParamsFromUrl(new URL("https://x.example/p"))
    expect(params).toEqual({})
  })

  it("truncates oversize values to 200 chars", () => {
    const huge = "x".repeat(500)
    const params = extractTrackingParamsFromUrl(new URL(`https://x.example/p?gclid=${huge}`))
    expect(params.gclid?.length).toBe(200)
  })
})

describe("hasAnyTrackingParam", () => {
  it("returns true when any of the 9 keys is present", () => {
    expect(hasAnyTrackingParam({ gclid: "x" })).toBe(true)
    expect(hasAnyTrackingParam({ utm_source: "google" })).toBe(true)
    expect(hasAnyTrackingParam({ fbclid: "y" })).toBe(true)
  })

  it("returns false when only landing_url/referrer present", () => {
    expect(hasAnyTrackingParam({ landing_url: "x", referrer: "y" })).toBe(false)
  })

  it("returns false on empty object", () => {
    expect(hasAnyTrackingParam({})).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (modules not found)**

Run: `npx vitest run __tests__/lib/marketing/`
Expected: both files fail with module-not-found.

- [ ] **Step 3: Implement `lib/marketing/cookies.ts`**

```ts
import { randomBytes } from "node:crypto"

export const ATTR_COOKIE_NAME = "djp_attr"
export const ATTR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year in seconds

const VALID_VALUE = /^[A-Za-z0-9_-]+$/

/**
 * Parse the djp_attr session id from a Cookie header. Returns null if missing
 * or malformed (we treat malformed values as missing — middleware will issue a
 * fresh cookie).
 */
export function parseAttrCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(";")
  for (const part of parts) {
    const [rawName, rawVal] = part.trim().split("=")
    if (rawName !== ATTR_COOKIE_NAME) continue
    const val = (rawVal ?? "").trim()
    if (!VALID_VALUE.test(val)) return null
    return val
  }
  return null
}

/**
 * Generate a URL-safe session id (~22 chars). Uses 16 random bytes (128 bits
 * of entropy) which is plenty for a non-security-bearing identifier.
 */
export function generateSessionId(): string {
  return randomBytes(16).toString("base64url")
}
```

- [ ] **Step 4: Implement `lib/marketing/attribution.ts`**

```ts
import type { TrackingParams } from "@/lib/validators/marketing"
import { TRACKING_PARAM_KEYS } from "@/lib/validators/marketing"

const MAX_PARAM_LEN = 200
const MAX_URL_LEN = 2000

function clip(s: string | null | undefined, max: number): string | undefined {
  if (s == null) return undefined
  return s.slice(0, max)
}

/**
 * Pull tracking params out of a URL's query string. Truncates oversize values
 * to 200 chars (Zod schema enforces the same).
 */
export function extractTrackingParamsFromUrl(url: URL): TrackingParams {
  const out: TrackingParams = {}
  for (const k of TRACKING_PARAM_KEYS) {
    const v = url.searchParams.get(k)
    if (v) out[k] = clip(v, MAX_PARAM_LEN)
  }
  // landing_url = origin + pathname (no query/fragment), only set if any tracking param is present
  if (Object.keys(out).length > 0) {
    out.landing_url = clip(url.origin + url.pathname, MAX_URL_LEN)
  }
  return out
}

/**
 * Returns true if any of the 9 tracking-identifier keys (gclid, gbraid, wbraid,
 * fbclid, utm_*) is set. landing_url and referrer alone don't count — those
 * are context we capture only when one of the 9 is also present.
 */
export function hasAnyTrackingParam(params: TrackingParams): boolean {
  return TRACKING_PARAM_KEYS.some((k) => params[k] != null && params[k] !== "")
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npx vitest run __tests__/lib/marketing/`
Expected: all 13 tests pass (8 cookies + 5 attribution).

- [ ] **Step 6: Commit**

```bash
git add lib/marketing/cookies.ts lib/marketing/attribution.ts __tests__/lib/marketing/
git commit -m "feat(marketing): cookie + tracking-param extraction helpers"
```

---

## Task 5: Public attribution track endpoint

**Files:**
- Create: `app/api/public/attribution/track/route.ts`
- Test: `__tests__/api/public/attribution/track.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/public/attribution/track.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  upsertAttributionBySession: vi.fn(),
}))

vi.mock("@/lib/db/marketing-attribution", () => ({
  upsertAttributionBySession: mocks.upsertAttributionBySession,
  getUnclaimedAttribution: vi.fn(),
  claimAttribution: vi.fn(),
  findAttributionByEmail: vi.fn(),
}))

import { POST } from "@/app/api/public/attribution/track/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/public/attribution/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/public/attribution/track", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.upsertAttributionBySession.mockResolvedValue({ id: "attr-1" })
  })

  it("400 when session_id missing", async () => {
    const res = await POST(jsonRequest({ gclid: "x" }))
    expect(res.status).toBe(400)
  })

  it("400 when no tracking param is present", async () => {
    const res = await POST(jsonRequest({ session_id: "abc12345" }))
    expect(res.status).toBe(400)
  })

  it("204 when valid body with at least one tracking param", async () => {
    const res = await POST(jsonRequest({ session_id: "abc12345", gclid: "g1" }))
    expect(res.status).toBe(204)
    expect(mocks.upsertAttributionBySession).toHaveBeenCalledWith(
      "abc12345",
      expect.objectContaining({ gclid: "g1" }),
    )
  })

  it("204 when only utm params are present", async () => {
    const res = await POST(jsonRequest({
      session_id: "abc12345",
      utm_source: "google",
      utm_campaign: "launch",
    }))
    expect(res.status).toBe(204)
  })

  it("never throws on DB error — returns 204 to avoid blocking landings", async () => {
    mocks.upsertAttributionBySession.mockRejectedValueOnce(new Error("DB exploded"))
    const res = await POST(jsonRequest({ session_id: "abc12345", gclid: "g1" }))
    expect(res.status).toBe(204)
  })
})
```

- [ ] **Step 2: Run test — FAIL (module not found)**

Run: `npx vitest run __tests__/api/public/attribution/track.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `app/api/public/attribution/track/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { attributionTrackBodySchema } from "@/lib/validators/marketing"
import { hasAnyTrackingParam } from "@/lib/marketing/attribution"
import { upsertAttributionBySession } from "@/lib/db/marketing-attribution"

/**
 * POST /api/public/attribution/track
 *
 * Public endpoint called from middleware on landings that include any
 * tracking query param. Idempotent UPSERT by session_id. Always returns
 * 204 on success (no body), 400 on schema failure. Errors during DB write
 * are swallowed and 204'd — this endpoint must NEVER block a landing.
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = attributionTrackBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  const { session_id, ...params } = parsed.data
  if (!hasAnyTrackingParam(params)) {
    return NextResponse.json({ error: "No tracking params" }, { status: 400 })
  }

  try {
    await upsertAttributionBySession(session_id, params)
  } catch (err) {
    console.error("[attribution/track]", err)
    // Fall through to 204 — never block a landing.
  }

  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run __tests__/api/public/attribution/track.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/public/attribution/track/route.ts __tests__/api/public/attribution/track.test.ts
git commit -m "feat(api): public attribution track endpoint"
```

---

## Task 6: Middleware extension — capture tracking params + set cookie

**Files:**
- Modify: `middleware.ts`

> **Note:** Next.js middleware testing is awkward (no first-class harness). We rely on a manual smoke test for this task and integration tests at the consumer endpoints (Tasks 7+) for verification. The middleware's logic is small and well-typed.

- [ ] **Step 1: Read current middleware**

Read `middleware.ts`. The current implementation gates `/admin/*` and `/client/*` only. We're adding a non-blocking pre-step that runs on ALL paths — capture tracking params, set cookie if missing, fire-and-forget POST to the track endpoint.

- [ ] **Step 2: Update `middleware.ts`**

Replace the entire file with:

```ts
import { auth } from "@/lib/auth"
import { NextResponse, type NextRequest } from "next/server"
import {
  ATTR_COOKIE_NAME,
  ATTR_COOKIE_MAX_AGE,
  generateSessionId,
} from "@/lib/marketing/cookies"
import { extractTrackingParamsFromUrl, hasAnyTrackingParam } from "@/lib/marketing/attribution"

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"]

function redirectToLogin(req: NextRequest) {
  const url = new URL("/login", req.url)
  url.searchParams.set("callbackUrl", req.nextUrl.pathname)
  const res = NextResponse.redirect(url)
  for (const name of SESSION_COOKIES) res.cookies.delete(name)
  return res
}

/**
 * Stamp the djp_attr cookie if missing. Capture tracking params in the URL
 * and fire a non-blocking POST to /api/public/attribution/track with the
 * resolved session_id. Returns the (possibly modified) NextResponse to be
 * returned to the client — caller may set further cookies/redirects on it.
 */
function captureAttribution(req: NextRequest, res: NextResponse): NextResponse {
  const params = extractTrackingParamsFromUrl(req.nextUrl)
  if (!hasAnyTrackingParam(params)) return res

  let sessionId = req.cookies.get(ATTR_COOKIE_NAME)?.value
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    sessionId = generateSessionId()
    res.cookies.set({
      name: ATTR_COOKIE_NAME,
      value: sessionId,
      maxAge: ATTR_COOKIE_MAX_AGE,
      sameSite: "lax",
      path: "/",
      secure: req.nextUrl.protocol === "https:",
      httpOnly: false,
    })
  }

  // Fire-and-forget POST to track endpoint. We don't await — landing must not block.
  const trackUrl = new URL("/api/public/attribution/track", req.nextUrl)
  const referrer = req.headers.get("referer") ?? undefined
  fetch(trackUrl.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      ...params,
      referrer: referrer?.slice(0, 2000),
    }),
  }).catch((err) => {
    console.warn("[middleware:attribution]", (err as Error).message)
  })

  return res
}

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const userRole = req.auth?.user?.role

  let res: NextResponse

  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) return redirectToLogin(req)
    if (userRole !== "admin") return NextResponse.redirect(new URL("/client/dashboard", req.url))
    res = NextResponse.next()
  } else if (pathname.startsWith("/client")) {
    if (!isLoggedIn) return redirectToLogin(req)
    res = NextResponse.next()
  } else {
    res = NextResponse.next()
  }

  return captureAttribution(req, res)
})

export const config = {
  matcher: [
    // Run on every page request that is NOT a static asset / API route.
    // We deliberately do NOT match /api/* (avoids re-entry into our own track endpoint)
    // or /_next/* (static files).
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?)$).*)",
  ],
}
```

- [ ] **Step 3: Smoke-test locally**

Run: `npm run dev` (background)
Then in a separate terminal:
```bash
curl -sI "http://localhost:3050/?gclid=test123&utm_source=google" | grep -i set-cookie
```
Expected: response includes `Set-Cookie: djp_attr=<some-id>; Max-Age=31536000; ...`

In the Supabase Studio SQL editor:
```sql
SELECT * FROM marketing_attribution ORDER BY created_at DESC LIMIT 5;
```
Expected: a row with `gclid='test123'`, `utm_source='google'`. The session_id column matches the cookie value.

If the row doesn't appear, check the dev console for `[middleware:attribution]` warnings — most likely cause is the dev server not having access to `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 4: Run unit tests as a regression check**

Run: `npm run test:run __tests__/lib/marketing/ __tests__/api/public/`
Expected: all tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add middleware.ts
git commit -m "feat(middleware): capture tracking params + stamp djp_attr cookie"
```

---

## Task 7: Newsletter API — gclid + consent capture

**Files:**
- Modify: `app/api/newsletter/route.ts`
- Test: `__tests__/api/newsletter/attribution-capture.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/newsletter/attribution-capture.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  addSubscriberWithAttribution: vi.fn(),
  ghlCreateContact: vi.fn(),
}))

vi.mock("@/lib/db/newsletter", () => ({
  addSubscriberWithAttribution: mocks.addSubscriberWithAttribution,
  addSubscriber: vi.fn(),
}))
vi.mock("@/lib/ghl", () => ({ ghlCreateContact: mocks.ghlCreateContact }))

import { POST } from "@/app/api/newsletter/route"

function jsonRequest(body: unknown, cookieHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/newsletter", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/newsletter — attribution capture", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addSubscriberWithAttribution.mockResolvedValue({ subscriber_id: "sub-1" })
    mocks.ghlCreateContact.mockResolvedValue(undefined)
  })

  it("400 on invalid email", async () => {
    const res = await POST(jsonRequest({ email: "not-an-email" }))
    expect(res.status).toBe(400)
  })

  it("subscribes with no attribution when cookie absent", async () => {
    const res = await POST(jsonRequest({ email: "a@b.com", consent_marketing: true }))
    expect(res.status).toBe(200)
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledWith({
      email: "a@b.com",
      session_id: undefined,
      consent_marketing: true,
      ip_address: expect.any(String),
      user_agent: null,
    })
  })

  it("forwards session_id from djp_attr cookie", async () => {
    const res = await POST(
      jsonRequest({ email: "a@b.com", consent_marketing: true }, "djp_attr=abc123; foo=bar"),
    )
    expect(res.status).toBe(200)
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com", session_id: "abc123" }),
    )
  })

  it("defaults consent_marketing to false when omitted", async () => {
    const res = await POST(jsonRequest({ email: "a@b.com" }))
    expect(res.status).toBe(200)
    expect(mocks.addSubscriberWithAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ consent_marketing: false }),
    )
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `npx vitest run __tests__/api/newsletter/attribution-capture.test.ts`
Expected: FAIL — `addSubscriberWithAttribution` doesn't exist yet.

- [ ] **Step 3: Add `addSubscriberWithAttribution` to `lib/db/newsletter.ts`**

Append to `lib/db/newsletter.ts`:

```ts
import { getUnclaimedAttribution, claimAttribution } from "@/lib/db/marketing-attribution"
import { setMarketingConsent } from "@/lib/db/marketing-consent"

export interface AddSubscriberWithAttributionInput {
  email: string
  session_id: string | undefined
  consent_marketing: boolean
  ip_address: string | null
  user_agent: string | null
}

export interface AddSubscriberWithAttributionResult {
  subscriber_id: string
}

/**
 * Add a newsletter subscriber and back-fill gclid + tracking params from the
 * caller's djp_attr cookie session. If the session has an unclaimed attribution
 * row we copy gclid/gbraid/wbraid/fbclid onto the subscriber row.
 *
 * Consent is recorded in the marketing_consent_log only if the subscriber has
 * a corresponding users row (i.e., is also a registered user). Anonymous
 * subscribers track consent via the consent_marketing boolean only — they
 * promote to a fully-logged consent state when they create an account.
 */
export async function addSubscriberWithAttribution(
  input: AddSubscriberWithAttributionInput,
): Promise<AddSubscriberWithAttributionResult> {
  const supabase = getClient()
  const email = input.email.toLowerCase().trim()

  let attribution = null
  if (input.session_id) {
    attribution = await getUnclaimedAttribution(input.session_id).catch(() => null)
  }

  const { data: subscriber, error } = await supabase
    .from("newsletter_subscribers")
    .upsert(
      {
        email,
        source: "website",
        unsubscribed_at: null,
        gclid: attribution?.gclid ?? null,
        gbraid: attribution?.gbraid ?? null,
        wbraid: attribution?.wbraid ?? null,
        fbclid: attribution?.fbclid ?? null,
      },
      { onConflict: "email" },
    )
    .select("id")
    .single()
  if (error) throw error
  const subscriberId = (subscriber as { id: string }).id

  // If this subscriber is also a registered user, log consent + claim attribution.
  const { data: userRow } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle()

  if (userRow) {
    if (input.consent_marketing) {
      await setMarketingConsent({
        user_id: (userRow as { id: string }).id,
        granted: true,
        source: "newsletter_signup",
        ip_address: input.ip_address,
        user_agent: input.user_agent,
      }).catch((e) => console.warn("[newsletter] consent log failed:", (e as Error).message))
    }
    if (attribution && !attribution.claimed_at) {
      await claimAttribution(attribution.id, (userRow as { id: string }).id).catch((e) =>
        console.warn("[newsletter] attribution claim failed:", (e as Error).message),
      )
    }
  }

  return { subscriber_id: subscriberId }
}
```

- [ ] **Step 4: Update `app/api/newsletter/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { addSubscriberWithAttribution } from "@/lib/db/newsletter"
import { ghlCreateContact } from "@/lib/ghl"
import { ATTR_COOKIE_NAME, parseAttrCookie } from "@/lib/marketing/cookies"

const newsletterSchema = z.object({
  email: z.string().email("Invalid email address"),
  consent_marketing: z.boolean().optional().default(false),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const result = newsletterSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
    }

    const cookieHeader = request.headers.get("cookie")
    const sessionId = parseAttrCookie(cookieHeader) ?? undefined
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
    const userAgent = request.headers.get("user-agent")

    await addSubscriberWithAttribution({
      email: result.data.email,
      session_id: sessionId,
      consent_marketing: result.data.consent_marketing,
      ip_address: ip,
      user_agent: userAgent,
    })

    // Fire-and-forget GHL sync
    ghlCreateContact({
      email: result.data.email,
      tags: ["newsletter"],
      source: "website-newsletter",
    }).catch((error) => console.error("[Newsletter] GHL contact creation failed:", error))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Newsletter] Subscription failed:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run tests — PASS**

Run: `npx vitest run __tests__/api/newsletter/attribution-capture.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db/newsletter.ts app/api/newsletter/route.ts __tests__/api/newsletter/attribution-capture.test.ts
git commit -m "feat(newsletter): capture gclid + consent on signup"
```

Also reference `ATTR_COOKIE_NAME` to keep the import live (lint-clean):

```ts
// in app/api/newsletter/route.ts the import line is:
import { ATTR_COOKIE_NAME, parseAttrCookie } from "@/lib/marketing/cookies"
// We use parseAttrCookie. ATTR_COOKIE_NAME is exported for use elsewhere; if
// the lint config flags unused import, remove it from this file.
```

If the linter flags the unused `ATTR_COOKIE_NAME` import, simply remove that name from the import statement (it's only needed in middleware/cookies.ts, where it lives).

---

## Task 8: Newsletter form — consent checkbox

**Files:**
- Modify: `components/public/NewsletterForm.tsx`

- [ ] **Step 1: Update the form**

Replace the contents of `components/public/NewsletterForm.tsx` with:

```tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function NewsletterForm() {
  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    if (!consent) {
      toast.error("Please confirm you'd like to receive marketing emails before subscribing.")
      return
    }
    setIsSubmitting(true)

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, consent_marketing: consent }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const message =
          (typeof data?.error === "string" && data.error) ||
          (response.status === 409
            ? "That email is already subscribed."
            : response.status >= 500
              ? "Our server hit an error. Please try again in a moment."
              : "We couldn't subscribe you. Please check your email and try again.")
        toast.error(message)
        setIsSubmitting(false)
        return
      }

      setSubmitted(true)
      toast.success("You're subscribed!")
    } catch {
      toast.error("We couldn't reach our server. Please check your connection and try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return <p className="text-primary-foreground/70 text-sm">Thanks for subscribing! You'll hear from us soon.</p>
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md mx-auto">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          type="email"
          placeholder="Your email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 bg-white/10 border-white/20 text-primary-foreground placeholder:text-primary-foreground/50 focus-visible:border-accent focus-visible:ring-accent/30"
          required
          disabled={isSubmitting}
          aria-label="Email address"
        />
        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-12 px-8 bg-accent text-primary hover:bg-accent/90 rounded-md font-semibold shrink-0"
        >
          {isSubmitting ? "Subscribing..." : "Subscribe"}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-xs text-primary-foreground/70 leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={isSubmitting}
          className="mt-0.5 size-4 accent-accent shrink-0"
          required
        />
        <span>
          I consent to receiving marketing emails from DJP Athlete, including the use of my hashed
          email for personalized advertising on Google. I can opt out at any time.
        </span>
      </label>
    </form>
  )
}
```

- [ ] **Step 2: Lint + type-check**

Run: `npm run lint`
Expected: no new lint errors.

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Smoke-test in browser**

Start dev server (`npm run dev`), open landing page, attempt to submit the newsletter form without the checkbox — should show toast. Check the box, submit — should succeed.

- [ ] **Step 4: Commit**

```bash
git add components/public/NewsletterForm.tsx
git commit -m "feat(newsletter): add marketing consent checkbox"
```

---

## Task 9: GHL booking webhook — gclid extraction + email-match fallback

**Files:**
- Modify: `app/api/webhooks/ghl-booking/route.ts`
- Test: `__tests__/api/webhooks/ghl-booking-attribution.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/webhooks/ghl-booking-attribution.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  findAttributionByEmail: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }))
vi.mock("@/lib/db/marketing-attribution", () => ({
  findAttributionByEmail: mocks.findAttributionByEmail,
  upsertAttributionBySession: vi.fn(),
  getUnclaimedAttribution: vi.fn(),
  claimAttribution: vi.fn(),
}))

import { POST } from "@/app/api/webhooks/ghl-booking/route"

function makeReq(payload: unknown): Request {
  return new Request("http://localhost/api/webhooks/ghl-booking", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

describe("POST /api/webhooks/ghl-booking — gclid capture", () => {
  let bookingsInsert: ReturnType<typeof vi.fn>
  let bookingsSelectMaybeSingle: ReturnType<typeof vi.fn>
  let bookingsUpdateEq: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GHL_WEBHOOK_SECRET

    bookingsSelectMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    bookingsInsert = vi.fn().mockResolvedValue({ error: null })
    bookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })

    mocks.createServiceRoleClient.mockReturnValue({
      from: (table: string) => {
        if (table === "bookings") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: bookingsSelectMaybeSingle }) }),
            update: () => ({ eq: bookingsUpdateEq }),
            insert: bookingsInsert,
          }
        }
        if (table === "users") return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) }
      },
    })

    mocks.findAttributionByEmail.mockResolvedValue(null)
  })

  it("uses gclid from payload when present", async () => {
    const res = await POST(makeReq({
      contact_email: "lead@example.com",
      contact_name: "Jane",
      booking_date: "2026-05-10T15:00:00Z",
      ghl_appointment_id: "appt-1",
      gclid: "g-from-payload",
    }))
    expect(res.status).toBe(201)
    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "g-from-payload" }),
    )
    // Email-match fallback should NOT have been called when gclid is in payload
    expect(mocks.findAttributionByEmail).not.toHaveBeenCalled()
  })

  it("falls back to email-match when gclid absent from payload", async () => {
    mocks.findAttributionByEmail.mockResolvedValueOnce({
      id: "attr-x",
      gclid: "g-from-email",
      gbraid: null, wbraid: null, fbclid: null,
    })

    const res = await POST(makeReq({
      contact_email: "lead@example.com",
      contact_name: "Jane",
      booking_date: "2026-05-10T15:00:00Z",
      ghl_appointment_id: "appt-2",
    }))
    expect(res.status).toBe(201)
    expect(mocks.findAttributionByEmail).toHaveBeenCalledWith("lead@example.com")
    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: "g-from-email" }),
    )
  })

  it("inserts with gclid=null when neither payload nor email match", async () => {
    const res = await POST(makeReq({
      contact_email: "unknown@example.com",
      contact_name: "Unknown",
      booking_date: "2026-05-10T15:00:00Z",
      ghl_appointment_id: "appt-3",
    }))
    expect(res.status).toBe(201)
    expect(bookingsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gclid: null, gbraid: null, wbraid: null, fbclid: null }),
    )
  })
})
```

- [ ] **Step 2: Run test — FAIL (column doesn't exist yet on insert)**

Run: `npx vitest run __tests__/api/webhooks/ghl-booking-attribution.test.ts`
Expected: FAIL — current handler doesn't pass `gclid` to insert.

- [ ] **Step 3: Update `app/api/webhooks/ghl-booking/route.ts`**

Make these changes:

1. Add `gclid`, `gbraid`, `wbraid`, `fbclid` to the `bookingSchema` (all optional).
2. Add the import for `findAttributionByEmail`.
3. Resolve final tracking params: payload first, email-match fallback second.
4. Pass them in both INSERT and UPDATE branches.

Replace the existing `bookingSchema` definition with:

```ts
const bookingSchema = z.object({
  contact_name: z.string().min(1),
  contact_email: z.string().email(),
  contact_phone: z.string().nullable().optional(),
  booking_date: z.string().min(1),
  duration_minutes: z.coerce.number().int().positive().optional().default(30),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]).optional().default("scheduled"),
  ghl_contact_id: z.string().nullable().optional(),
  ghl_appointment_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // NEW: tracking params (GHL form should pass these from URL params)
  gclid: z.string().max(200).nullable().optional(),
  gbraid: z.string().max(200).nullable().optional(),
  wbraid: z.string().max(200).nullable().optional(),
  fbclid: z.string().max(200).nullable().optional(),
})
```

Add the import at the top:

```ts
import { findAttributionByEmail } from "@/lib/db/marketing-attribution"
```

Add to the `normalized` object (alongside the existing fields):

```ts
      gclid:  raw.gclid  ?? raw.gcl_id ?? null,
      gbraid: raw.gbraid ?? null,
      wbraid: raw.wbraid ?? null,
      fbclid: raw.fbclid ?? null,
```

After Zod parse succeeds and before the upsert/insert logic, add:

```ts
    const data = result.data
    let gclid = data.gclid ?? null
    let gbraid = data.gbraid ?? null
    let wbraid = data.wbraid ?? null
    let fbclid = data.fbclid ?? null

    // Email-match fallback if no gclid in payload
    if (!gclid) {
      const attr = await findAttributionByEmail(data.contact_email).catch(() => null)
      if (attr) {
        gclid = attr.gclid
        gbraid ||= attr.gbraid
        wbraid ||= attr.wbraid
        fbclid ||= attr.fbclid
      }
    }
```

Then in the INSERT block, add the four columns:

```ts
    const { error } = await supabase.from("bookings").insert({
      contact_name: data.contact_name,
      contact_email: data.contact_email,
      contact_phone: data.contact_phone ?? null,
      booking_date: data.booking_date,
      duration_minutes: data.duration_minutes,
      status: data.status,
      source: "ghl",
      notes: data.notes ?? null,
      ghl_contact_id: data.ghl_contact_id ?? null,
      ghl_appointment_id: data.ghl_appointment_id ?? null,
      gclid,
      gbraid,
      wbraid,
      fbclid,
    })
```

The UPDATE branch (when `existing` row found) does NOT add gclid — first-touch wins on attribution. Don't overwrite previously captured tracking on subsequent status updates.

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run __tests__/api/webhooks/ghl-booking-attribution.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/ghl-booking/route.ts __tests__/api/webhooks/ghl-booking-attribution.test.ts
git commit -m "feat(ghl): capture gclid on booking webhook with email-match fallback"
```

---

## Task 10: Stripe webhook — gclid back-fill on payment insert

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`

> **Note:** Stripe webhook handlers vary in shape across the project. The exact insert may live in a helper rather than the route file. The implementer should locate where `payments` rows are inserted on `payment_intent.succeeded` (or `checkout.session.completed`) and add gclid back-fill there. The pattern is: pull gclid from `session.metadata.gclid` (set client-side at checkout creation) OR fall back to `findAttributionByEmail(customer_email)`.

- [ ] **Step 1: Locate the payments insert**

Search the codebase for where `payments` rows are written:

```bash
grep -rn "from(\"payments\")\|from('payments')" lib/db/payments.ts app/api/stripe app/api/webhooks
```

Expected: identifies the file(s) where `INSERT into payments` happens. Most likely `lib/db/payments.ts` or `app/api/stripe/webhook/route.ts`.

- [ ] **Step 2: Add gclid resolution at the insert site**

At the top of the file:

```ts
import { findAttributionByEmail } from "@/lib/db/marketing-attribution"
```

Before the insert call, add:

```ts
// Resolve tracking params (gclid first from Stripe metadata, fallback to email match)
const sessionMetadata = (stripeEvent.data.object as { metadata?: Record<string, string> })?.metadata ?? {}
let gclid  = sessionMetadata.gclid  ?? null
let gbraid = sessionMetadata.gbraid ?? null
let wbraid = sessionMetadata.wbraid ?? null
let fbclid = sessionMetadata.fbclid ?? null

if (!gclid && customerEmail) {
  const attr = await findAttributionByEmail(customerEmail).catch(() => null)
  if (attr) {
    gclid  = attr.gclid
    gbraid ||= attr.gbraid
    wbraid ||= attr.wbraid
    fbclid ||= attr.fbclid
  }
}
```

(Replace `stripeEvent` and `customerEmail` with whatever the file's local variable names are.)

Then add `gclid, gbraid, wbraid, fbclid` to the `insert({ ... })` call's payload.

- [ ] **Step 3: Update Checkout Session creation to forward gclid into metadata**

If the project has a `checkout.sessions.create` call (search `stripe.checkout.sessions.create`), add metadata-forwarding from the request cookie:

```ts
import { parseAttrCookie } from "@/lib/marketing/cookies"
import { getUnclaimedAttribution } from "@/lib/db/marketing-attribution"

// inside the handler that creates the checkout session:
const sessionId = parseAttrCookie(request.headers.get("cookie"))
const attr = sessionId ? await getUnclaimedAttribution(sessionId).catch(() => null) : null

const checkoutSession = await stripe.checkout.sessions.create({
  // ...existing options...
  metadata: {
    // ...existing metadata...
    gclid:  attr?.gclid  ?? "",
    gbraid: attr?.gbraid ?? "",
    wbraid: attr?.wbraid ?? "",
    fbclid: attr?.fbclid ?? "",
  },
})
```

- [ ] **Step 4: Smoke test**

Trigger a test Stripe checkout from a URL with `?gclid=stripetest`. After completion, verify:

```sql
SELECT id, gclid, created_at FROM payments ORDER BY created_at DESC LIMIT 3;
```
Expected: the most recent payment row has `gclid='stripetest'`.

If you can't trigger a real Stripe checkout in dev, manually insert a test event using the Stripe CLI:
```bash
stripe trigger payment_intent.succeeded
```
Then check the row was inserted (gclid will be NULL since the trigger doesn't include metadata, but the code path executed).

- [ ] **Step 5: Commit**

```bash
git add app/api/stripe/webhook/route.ts lib/db/payments.ts  # whichever was modified
git commit -m "feat(stripe): back-fill gclid on payment insert with email fallback"
```

---

## Task 11: Account preferences — marketing consent toggle

**Files:**
- Create: `app/api/account/preferences/marketing-consent/route.ts`
- Create: `app/(client)/account/preferences/MarketingConsentToggle.tsx`
- Modify: `app/(client)/account/preferences/page.tsx` (if it exists; otherwise create a minimal page)
- Test: `__tests__/api/account/marketing-consent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/account/marketing-consent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  setMarketingConsent: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/db/marketing-consent", () => ({
  setMarketingConsent: mocks.setMarketingConsent,
  listConsentLog: vi.fn(),
}))

import { POST } from "@/app/api/account/preferences/marketing-consent/route"

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/account/preferences/marketing-consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/account/preferences/marketing-consent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setMarketingConsent.mockResolvedValue({ id: "log-1" })
  })

  it("401 when not logged in", async () => {
    mocks.auth.mockResolvedValueOnce(null)
    const res = await POST(jsonRequest({ granted: true }))
    expect(res.status).toBe(401)
  })

  it("400 on bad body", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1" } })
    const res = await POST(jsonRequest({ granted: "yes" }))
    expect(res.status).toBe(400)
  })

  it("200 grants consent with source defaulting to account_settings", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1" } })
    const res = await POST(jsonRequest({ granted: true }))
    expect(res.status).toBe(200)
    expect(mocks.setMarketingConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        granted: true,
        source: "account_settings",
      }),
    )
  })

  it("200 revokes consent", async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: "u1" } })
    const res = await POST(jsonRequest({ granted: false }))
    expect(res.status).toBe(200)
    expect(mocks.setMarketingConsent).toHaveBeenCalledWith(
      expect.objectContaining({ granted: false }),
    )
  })
})
```

- [ ] **Step 2: Run test — FAIL**

Run: `npx vitest run __tests__/api/account/marketing-consent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/account/preferences/marketing-consent/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { marketingConsentToggleBodySchema } from "@/lib/validators/marketing"
import { setMarketingConsent } from "@/lib/db/marketing-consent"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = await request.json().catch(() => null)
  const parsed = marketingConsentToggleBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  const userAgent = request.headers.get("user-agent")

  await setMarketingConsent({
    user_id: userId,
    granted: parsed.data.granted,
    source: parsed.data.source ?? "account_settings",
    ip_address: ip,
    user_agent: userAgent,
  })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 4: Implement the toggle component**

Create `app/(client)/account/preferences/MarketingConsentToggle.tsx`:

```tsx
"use client"

import { useState } from "react"
import { toast } from "sonner"

interface Props {
  initialGranted: boolean
}

export function MarketingConsentToggle({ initialGranted }: Props) {
  const [granted, setGranted] = useState(initialGranted)
  const [pending, setPending] = useState(false)

  async function toggle(next: boolean) {
    if (pending) return
    setPending(true)
    const prev = granted
    setGranted(next) // optimistic

    try {
      const res = await fetch("/api/account/preferences/marketing-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ granted: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(next ? "Marketing emails enabled." : "Marketing emails disabled.")
    } catch (err) {
      setGranted(prev) // rollback
      toast.error("Couldn't update — please try again.")
      console.error("[MarketingConsentToggle]", err)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-start gap-3 p-4 border border-border rounded-lg">
      <input
        type="checkbox"
        id="marketing-consent"
        checked={granted}
        onChange={(e) => toggle(e.target.checked)}
        disabled={pending}
        className="mt-1 size-4 accent-accent shrink-0"
      />
      <div className="flex-1">
        <label htmlFor="marketing-consent" className="font-medium text-sm cursor-pointer">
          Marketing emails &amp; personalized advertising
        </label>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          When enabled, we may send you marketing emails and use your hashed email for personalized
          advertising on Google. Hashed means the email itself is never sent — only an irreversible
          fingerprint that Google uses to match you across services. You can disable this any time.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire the toggle into the preferences page**

Check whether `app/(client)/account/preferences/page.tsx` exists. If yes, add a section that fetches the user's current `marketing_consent_at` and renders `<MarketingConsentToggle initialGranted={!!user.marketing_consent_at} />`. If the page doesn't exist, create it with that section as the only content for now — other settings can be added later.

Minimal page if not exists:

```tsx
// app/(client)/account/preferences/page.tsx
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { MarketingConsentToggle } from "./MarketingConsentToggle"

export const metadata = { title: "Account Preferences" }

export default async function PreferencesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const supabase = createServiceRoleClient()
  const { data: user } = await supabase
    .from("users")
    .select("marketing_consent_at")
    .eq("id", session.user.id)
    .single()

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6">
      <h1 className="text-2xl font-heading text-primary">Preferences</h1>
      <MarketingConsentToggle initialGranted={!!user?.marketing_consent_at} />
    </div>
  )
}
```

- [ ] **Step 6: Run tests — PASS**

Run: `npx vitest run __tests__/api/account/marketing-consent.test.ts`
Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/account/preferences/marketing-consent/route.ts \
        app/(client)/account/preferences/MarketingConsentToggle.tsx \
        app/(client)/account/preferences/page.tsx \
        __tests__/api/account/marketing-consent.test.ts
git commit -m "feat(account): marketing consent toggle in preferences"
```

---

## Task 12: Admin — consent log viewer

**Files:**
- Create: `app/(admin)/admin/ads/consent/page.tsx`
- Create: `app/(admin)/admin/ads/consent/ConsentLogTable.tsx`

> **Note:** The `/admin/ads/*` routes are introduced in Phase 1; that spec already plans `/admin/ads/page.tsx` and similar. If Phase 1 hasn't shipped yet, this consent page is the first `/admin/ads/*` file — it'll co-exist cleanly when Phase 1 lands.

- [ ] **Step 1: Implement the table component**

Create `app/(admin)/admin/ads/consent/ConsentLogTable.tsx`:

```tsx
import type { MarketingConsentLog } from "@/types/database"

interface Props {
  rows: Array<MarketingConsentLog & { user_email?: string | null }>
}

export function ConsentLogTable({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No consent events yet.</p>
  }
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface text-xs font-mono uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-3">When</th>
            <th className="text-left p-3">User</th>
            <th className="text-left p-3">Event</th>
            <th className="text-left p-3">Source</th>
            <th className="text-left p-3">IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/60">
              <td className="p-3 font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
              <td className="p-3">{r.user_email ?? r.user_id}</td>
              <td className="p-3">
                <span
                  className={
                    r.granted
                      ? "inline-block px-2 py-0.5 rounded text-xs bg-success/10 text-success"
                      : "inline-block px-2 py-0.5 rounded text-xs bg-error/10 text-error"
                  }
                >
                  {r.granted ? "Granted" : "Revoked"}
                </span>
              </td>
              <td className="p-3 font-mono text-xs">{r.source}</td>
              <td className="p-3 font-mono text-xs text-muted-foreground">{r.ip_address ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Implement the page**

Create `app/(admin)/admin/ads/consent/page.tsx`:

```tsx
import { createServiceRoleClient } from "@/lib/supabase"
import { ConsentLogTable } from "./ConsentLogTable"

export const metadata = { title: "Marketing Consent Log" }

export default async function ConsentLogPage() {
  const supabase = createServiceRoleClient()
  const { data: rows } = await supabase
    .from("marketing_consent_log")
    .select("*, users!marketing_consent_log_user_id_fkey(email)")
    .order("created_at", { ascending: false })
    .limit(200)

  const flat = (rows ?? []).map((r) => ({
    ...r,
    user_email: (r.users as { email?: string } | null)?.email ?? null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Marketing Consent Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Audit trail of every marketing-consent grant or revocation. Source identifies where the
          event came from (newsletter signup, account settings, etc.). Used as evidence for Google
          Ads Customer Match opt-in compliance.
        </p>
      </div>
      <ConsentLogTable rows={flat} />
    </div>
  )
}
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no NEW errors.

- [ ] **Step 4: Manual verification**

Start dev server. Log in as admin. Navigate to `/admin/ads/consent`. The page should render. If the marketing_consent_log is empty, the empty-state message shows.

To populate, sign up to the newsletter from another browser as an existing registered user, then refresh the consent page.

- [ ] **Step 5: Commit**

```bash
git add app/(admin)/admin/ads/consent/
git commit -m "feat(admin): marketing consent log viewer"
```

---

## Task 13: End-to-end verification + handoff

**Files:** none (verification only)

- [ ] **Step 1: Run all tests for new code**

```bash
npx vitest run __tests__/lib/marketing/ __tests__/api/public/attribution/ __tests__/api/newsletter/ __tests__/api/webhooks/ __tests__/api/account/marketing-consent.test.ts
```
Expected: all tests pass.

- [ ] **Step 2: Run full Next.js suite as regression check**

```bash
npm run test:run
```
Expected: failure count does NOT exceed the baseline recorded before this plan started. New tests should add green count, not red.

- [ ] **Step 3: Manual end-to-end smoke**

1. Visit `https://localhost:3050/?gclid=e2etest&utm_source=google&utm_campaign=plan15a` in a fresh browser session (clear cookies first).
2. Verify in DevTools → Application → Cookies that `djp_attr` is set.
3. Verify in Supabase Studio:
   ```sql
   SELECT * FROM marketing_attribution ORDER BY created_at DESC LIMIT 1;
   ```
   The most recent row has `gclid='e2etest'`, `utm_source='google'`, `utm_campaign='plan15a'`, `claimed_at IS NULL`.
4. Submit the newsletter form with the consent box checked.
5. Verify in Supabase:
   ```sql
   SELECT email, gclid FROM newsletter_subscribers ORDER BY subscribed_at DESC LIMIT 1;
   ```
   The subscriber has the same gclid.
6. If you sign up as a new user and then re-visit `/account/preferences`, the toggle reflects `granted=true` from the newsletter signup. Toggling it triggers a row in `marketing_consent_log`.
7. Send a test GHL booking webhook (use Postman or curl, payload from migration 00050 webhook docs) WITHOUT a gclid in the body. Verify the booking row's gclid was filled via email-match fallback (if the email matches an existing user with a gclid'd attribution row).

- [ ] **Step 4: Commit any final fixes**

If the smoke test surfaces issues, fix them in their owning task and recommit. Otherwise nothing to commit at this step.

---

## Self-review checklist (run after writing the plan)

- [x] **Spec coverage** — every spec section has a task:
  - D4 Customer Match consent gate → Task 1 (00102 migration), Task 7 (newsletter), Task 11 (account)
  - D5 gclid attribution at session layer → Tasks 1, 4, 5, 6
  - D12 consent-aware default-off → Tasks 1, 7, 8, 11
  - Pipeline 1 attribution capture → Tasks 4, 5, 6
  - 4 action tables get `gclid` columns → Task 1
  - Newsletter consent UI → Task 8
  - GHL booking gclid capture → Task 9
  - Stripe gclid back-fill → Task 10
  - Admin consent log viewer → Task 12
- [x] **Placeholder scan** — every step has full code; no "TBD" / "implement later" / "add appropriate validation"
- [x] **Type consistency** — `addSubscriberWithAttribution` signature in Task 7 matches what `app/api/newsletter/route.ts` calls; `findAttributionByEmail` signature in Task 3 matches what Tasks 9 and 10 call; `MarketingAttribution` and `MarketingConsentLog` interfaces in Task 2 match the SQL columns in Task 1
- [x] **No undefined symbols** — every imported function/type is defined in an earlier task

---

## What ships at the end of Plan 1.5a

**Working software:**
- Every visit to darrenjpaul.com with a tracking param gets persisted in `marketing_attribution`.
- Every newsletter signup, GHL booking, Stripe payment, and event signup back-fills its `gclid`/`gbraid`/`wbraid`/`fbclid` columns from the visitor's session OR an email match.
- Marketing consent is captured on newsletter signup, account preferences, and audited in `marketing_consent_log`.
- Admins have a consent log viewer at `/admin/ads/consent`.

**What's still missing (next plans pick these up):**
- 1.5b — Customer Match audiences (uses the `marketing_consent_at` gate from this plan).
- 1.5c — Booking conversion uploads (uses the `gclid` columns this plan back-fills).
- 1.5d — Stripe value updates (uses the `gclid` and the booking↔payment link).
- 1.5e — GA4 audience imports.
- 1.5f — Pipeline dashboard.
- 1.5g — AI Ads Agent.

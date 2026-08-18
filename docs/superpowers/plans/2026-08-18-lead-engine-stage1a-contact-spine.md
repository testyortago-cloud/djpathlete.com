# Lead Engine — Stage 1a: the contact spine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One contact record per human being, merged across email and phone, carrying dated per-channel consent and an append-only timeline, fed by the funnel entry points.

**Architecture:** A new `contacts` table sits *beside* `users` rather than replacing it — `users` owns login and billing, `contacts` owns marketing and consent. Every entry point calls one function, `recordContactEvent`, which normalises the identifiers, merges on email or phone, appends a timeline row, and returns the contact. All new tables carry `business_id` so the system can serve more than one business later without unpicking what is built now.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (service-role DAL in `lib/db/`), Zod 4 validators, Vitest, `libphonenumber-js` (added by this plan).

**Spec:** [docs/superpowers/specs/2026-08-18-lead-engine-design.md](../specs/2026-08-18-lead-engine-design.md)

## Global Constraints

- **Migrations start at `00212`.** Numbering is sequential; do not skip or reuse.
- **`business_id uuid NOT NULL` on every table this plan creates**, defaulting to the singleton `'00000000-0000-0000-0000-000000000001'`.
- **No `citext`.** The extension is not enabled in this project. Emails are stored lowercased as `text`, uniqueness enforced by an expression index on `lower(email)` — the pattern `funnel_submissions` already uses.
- **Nothing existing is re-pointed.** `lead_inquiries.lead_user_id`, `funnel_submissions.lead_user_id`, `marketing_consent_log.user_id` and `user_consents.user_id` keep pointing at `users`. Do not migrate or drop them.
- **Code must tolerate the old schema for one deploy.** Migrations and Vercel deploys race on merge. A missing column raises PostgREST `PGRST204`; catch it and degrade rather than throwing, on any path that captures a lead. Losing an optional field is acceptable; losing the lead is not.
- **No brand literals.** Do not write `"DJP Athlete"`, `"Darren"`, or the sending domain into any file this plan creates. Business identity comes from `business_settings`.
- **Tests are targeted.** Run the suites for what you changed, plus `npx tsc --noEmit`. Do not run the full suite. This repo has **258 pre-existing tsc errors** — compare the total count against that baseline rather than assuming any error is yours.

---

### Task 1: The business and settings tables

**Files:**
- Create: `supabase/migrations/00212_lead_engine_business.sql`
- Create: `lib/db/businesses.ts`
- Create: `lib/lead-engine/constants.ts`
- Test: `__tests__/lib/lead-engine-constants.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SINGLETON_BUSINESS_ID: string`; `getBusinessSettings(): Promise<BusinessSettings>`; type `BusinessSettings = { business_id: string; display_name: string; sender_name: string; sender_email: string; reply_to: string; logo_url: string | null; timezone: string; quiet_hours_start: number; quiet_hours_end: number; daily_message_cap: number; postal_address: string; sms_help_text: string }`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00212_lead_engine_business.sql
-- Lead Engine: the tenant row every other Lead Engine table hangs off.
--
-- There is exactly one business today. The column exists anyway, because
-- separating one business's data from another's is cheap while the tables are
-- empty and expensive once they are not.

CREATE TABLE IF NOT EXISTS public.businesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.businesses (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Primary')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.business_settings (
  business_id        uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  display_name       text    NOT NULL DEFAULT '',
  sender_name        text    NOT NULL DEFAULT '',
  sender_email       text    NOT NULL DEFAULT '',
  reply_to           text    NOT NULL DEFAULT '',
  logo_url           text,
  timezone           text    NOT NULL DEFAULT 'America/New_York',
  quiet_hours_start  smallint NOT NULL DEFAULT 8  CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end    smallint NOT NULL DEFAULT 21 CHECK (quiet_hours_end   BETWEEN 0 AND 23),
  daily_message_cap  smallint NOT NULL DEFAULT 1  CHECK (daily_message_cap >= 1),
  postal_address     text    NOT NULL DEFAULT '',
  sms_help_text      text    NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.business_settings (business_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (business_id) DO NOTHING;

ALTER TABLE public.businesses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on businesses"
  ON public.businesses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on business_settings"
  ON public.business_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Note the defaults are empty strings, not the business name. Seeding real values is an admin action, not a migration — a migration that writes the brand in is the thing the no-brand-literals rule exists to prevent.

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/lib/lead-engine-constants.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

describe("SINGLETON_BUSINESS_ID", () => {
  it("matches the uuid seeded by migration 00212", () => {
    expect(SINGLETON_BUSINESS_ID).toBe("00000000-0000-0000-0000-000000000001")
  })

  it("is a syntactically valid uuid", () => {
    expect(SINGLETON_BUSINESS_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run __tests__/lib/lead-engine-constants.test.ts`
Expected: FAIL — `Cannot find module '@/lib/lead-engine/constants'`

- [ ] **Step 4: Write the constant**

```ts
// lib/lead-engine/constants.ts
// The one business that exists today. Every Lead Engine row carries it, so a
// second business can be added later without rewriting what is already stored.
export const SINGLETON_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run __tests__/lib/lead-engine-constants.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 6: Write the settings DAL**

```ts
// lib/db/businesses.ts
import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

export type BusinessSettings = {
  business_id: string
  display_name: string
  sender_name: string
  sender_email: string
  reply_to: string
  logo_url: string | null
  timezone: string
  quiet_hours_start: number
  quiet_hours_end: number
  daily_message_cap: number
  postal_address: string
  sms_help_text: string
}

function getClient() {
  return createServiceRoleClient()
}

export async function getBusinessSettings(
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<BusinessSettings> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("business_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`business_settings row missing for ${businessId}`)
  return data as BusinessSettings
}

export async function updateBusinessSettings(
  patch: Partial<Omit<BusinessSettings, "business_id">>,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<BusinessSettings> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("business_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .select()
    .single()
  if (error) throw error
  return data as BusinessSettings
}
```

`getBusinessSettings` throws on a missing row rather than returning defaults. A silently-defaulted sender identity would send mail from an empty address and look like a delivery bug rather than a configuration one.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `258` — unchanged from baseline

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/00212_lead_engine_business.sql lib/db/businesses.ts lib/lead-engine/constants.ts __tests__/lib/lead-engine-constants.test.ts
git commit -m "feat(lead-engine): every record knows which business it belongs to"
```

---

### Task 2: Identifier normalisation

**Files:**
- Modify: `package.json` (add `libphonenumber-js`)
- Create: `lib/lead-engine/identity.ts`
- Test: `__tests__/lib/lead-engine-identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normaliseEmail(raw: string | null | undefined): string | null`; `normalisePhone(raw: string | null | undefined, defaultCountry?: "US"): string | null`.

Both return `null` rather than throwing. An unparseable phone number must not cost you the lead — the contact is still created, just without a phone identifier.

- [ ] **Step 1: Add the dependency**

```bash
npm install libphonenumber-js
```

There is no phone library in this repo today. Hand-rolling E.164 normalisation looks easy and is not: extension suffixes, `+1` versus `1` versus bare 10-digit, and non-NANP numbers all have to be right, because a wrong normalisation silently splits one human into two contacts.

- [ ] **Step 2: Write the failing tests**

```ts
// __tests__/lib/lead-engine-identity.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"

describe("normaliseEmail", () => {
  it("lowercases and trims", () => {
    expect(normaliseEmail("  Darren@Example.COM ")).toBe("darren@example.com")
  })

  it("returns null for blank or missing input", () => {
    expect(normaliseEmail("")).toBeNull()
    expect(normaliseEmail("   ")).toBeNull()
    expect(normaliseEmail(null)).toBeNull()
    expect(normaliseEmail(undefined)).toBeNull()
  })

  it("returns null for something that is not an address", () => {
    expect(normaliseEmail("not-an-email")).toBeNull()
  })
})

describe("normalisePhone", () => {
  it("normalises the same US number written four ways to one E.164 value", () => {
    const expected = "+16176504548"
    expect(normalisePhone("617-650-4548")).toBe(expected)
    expect(normalisePhone("(617) 650 4548")).toBe(expected)
    expect(normalisePhone("6176504548")).toBe(expected)
    expect(normalisePhone("+1 617 650 4548")).toBe(expected)
  })

  it("keeps a non-US number in its own country format", () => {
    expect(normalisePhone("+44 20 7946 0958")).toBe("+442079460958")
  })

  it("returns null rather than throwing on junk", () => {
    expect(normalisePhone("hello")).toBeNull()
    expect(normalisePhone("123")).toBeNull()
    expect(normalisePhone(null)).toBeNull()
    expect(normalisePhone(undefined)).toBeNull()
    expect(normalisePhone("")).toBeNull()
  })
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run __tests__/lib/lead-engine-identity.test.ts`
Expected: FAIL — `Cannot find module '@/lib/lead-engine/identity'`

- [ ] **Step 4: Write the implementation**

```ts
// lib/lead-engine/identity.ts
// Identifier normalisation for contact matching.
//
// Both functions return null instead of throwing. These run on the lead-capture
// path, where an unparseable identifier must cost you that identifier and never
// the lead itself.

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  if (!EMAIL_RE.test(trimmed)) return null
  return trimmed
}

export function normalisePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "US",
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = parsePhoneNumberFromString(trimmed, defaultCountry)
    if (!parsed || !parsed.isValid()) return null
    return parsed.number
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run __tests__/lib/lead-engine-identity.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 6: Prove the tests can fail**

Temporarily change `trimmed.toLowerCase()` to `trimmed` in `normaliseEmail` and re-run. The first test must fail. Restore it. A test that passes on the first run has not yet been shown to be testing anything.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/lead-engine/identity.ts __tests__/lib/lead-engine-identity.test.ts
git commit -m "feat(lead-engine): one human's phone number written four ways is one identifier"
```

---

### Task 3: The contacts table and the merge

**Files:**
- Create: `supabase/migrations/00213_lead_engine_contacts.sql`
- Create: `lib/lead-engine/merge.ts`
- Test: `__tests__/lib/lead-engine-merge.test.ts`

**Interfaces:**
- Consumes: `normaliseEmail`, `normalisePhone` (Task 2); `SINGLETON_BUSINESS_ID` (Task 1).
- Produces: `type MatchCandidate = { id: string; email: string | null; phone_e164: string | null; created_at: string }`; `type MergeDecision = { kind: "create" } | { kind: "update"; contactId: string } | { kind: "merge"; survivorId: string; mergedId: string }`; `decideMerge(candidates: MatchCandidate[], email: string | null, phone: string | null): MergeDecision`.

`decideMerge` is a **pure function** — no database access. That is what makes the merge rule, which is the part most systems get wrong, cheap to test exhaustively.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00213_lead_engine_contacts.sql
-- Lead Engine: one row per human being.
--
-- `users` cannot do this job. users.email is unique and carries the login, so
-- two records for one person cannot both exist, and 90 of the contacts being
-- imported have a phone number and no email at all. So contacts sits beside
-- users: users owns login and billing, contacts owns marketing and consent.
--
-- No citext: the extension is not enabled here, so uniqueness is enforced with
-- expression indexes on lower(email), the pattern funnel_submissions uses.

CREATE TABLE IF NOT EXISTS public.contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  email         text,
  phone_e164    text,
  name          text,
  first_touch_session_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_need_one_identifier
    CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_business_email_uniq
  ON public.contacts (business_id, lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_business_phone_uniq
  ON public.contacts (business_id, phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_user_idx
  ON public.contacts (user_id) WHERE user_id IS NOT NULL;

-- Merges are destructive. Keep them reversible on paper.
CREATE TABLE IF NOT EXISTS public.contact_merges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  survivor_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  merged_id     uuid NOT NULL,
  merged_snapshot jsonb NOT NULL,
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_merges_survivor_idx
  ON public.contact_merges (survivor_id, created_at DESC);

ALTER TABLE public.contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on contacts"
  ON public.contacts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on contact_merges"
  ON public.contact_merges FOR ALL TO service_role USING (true) WITH CHECK (true);
```

`merged_id` is deliberately **not** a foreign key — the row it names is deleted by the merge, and the audit trail has to outlive it.

- [ ] **Step 2: Write the failing tests**

```ts
// __tests__/lib/lead-engine-merge.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { decideMerge, type MatchCandidate } from "@/lib/lead-engine/merge"

const older: MatchCandidate = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "marissa@example.com",
  phone_e164: null,
  created_at: "2026-01-01T00:00:00Z",
}
const newer: MatchCandidate = {
  id: "22222222-2222-2222-2222-222222222222",
  email: null,
  phone_e164: "+16176504548",
  created_at: "2026-06-01T00:00:00Z",
}

describe("decideMerge", () => {
  it("creates when nothing matches", () => {
    expect(decideMerge([], "new@example.com", null)).toEqual({ kind: "create" })
  })

  it("updates when only the email matches", () => {
    expect(decideMerge([older], "marissa@example.com", null)).toEqual({
      kind: "update",
      contactId: older.id,
    })
  })

  it("updates when only the phone matches", () => {
    expect(decideMerge([newer], null, "+16176504548")).toEqual({
      kind: "update",
      contactId: newer.id,
    })
  })

  it("merges when email and phone point at different contacts, oldest surviving", () => {
    expect(decideMerge([older, newer], "marissa@example.com", "+16176504548")).toEqual({
      kind: "merge",
      survivorId: older.id,
      mergedId: newer.id,
    })
  })

  it("merges the same way regardless of candidate order", () => {
    expect(decideMerge([newer, older], "marissa@example.com", "+16176504548")).toEqual({
      kind: "merge",
      survivorId: older.id,
      mergedId: newer.id,
    })
  })

  it("updates, not merges, when both identifiers point at the same contact", () => {
    const both: MatchCandidate = { ...older, phone_e164: "+16176504548" }
    expect(decideMerge([both], "marissa@example.com", "+16176504548")).toEqual({
      kind: "update",
      contactId: both.id,
    })
  })

  it("ignores a candidate that matches neither identifier", () => {
    const unrelated: MatchCandidate = {
      id: "33333333-3333-3333-3333-333333333333",
      email: "someone@else.com",
      phone_e164: null,
      created_at: "2025-01-01T00:00:00Z",
    }
    expect(decideMerge([unrelated], "new@example.com", null)).toEqual({ kind: "create" })
  })

  it("matches email case-insensitively", () => {
    expect(decideMerge([older], "MARISSA@EXAMPLE.COM", null)).toEqual({
      kind: "update",
      contactId: older.id,
    })
  })
})
```

The order-independence test matters: the survivor must be chosen by `created_at`, never by whichever row the database happened to return first.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run __tests__/lib/lead-engine-merge.test.ts`
Expected: FAIL — `Cannot find module '@/lib/lead-engine/merge'`

- [ ] **Step 4: Write the implementation**

```ts
// lib/lead-engine/merge.ts
// The merge rule, as a pure function.
//
// The case that makes this feature work, and that most systems get wrong: a
// submission whose email matches contact X and whose phone matches a different
// contact Y is not a new person. It is evidence that X and Y are the same human.

export type MatchCandidate = {
  id: string
  email: string | null
  phone_e164: string | null
  created_at: string
}

export type MergeDecision =
  | { kind: "create" }
  | { kind: "update"; contactId: string }
  | { kind: "merge"; survivorId: string; mergedId: string }

function sameEmail(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

export function decideMerge(
  candidates: MatchCandidate[],
  email: string | null,
  phone: string | null,
): MergeDecision {
  const byEmail = candidates.find((c) => sameEmail(c.email, email)) ?? null
  const byPhone = phone ? (candidates.find((c) => c.phone_e164 === phone) ?? null) : null

  if (!byEmail && !byPhone) return { kind: "create" }
  if (byEmail && !byPhone) return { kind: "update", contactId: byEmail.id }
  if (!byEmail && byPhone) return { kind: "update", contactId: byPhone.id }
  if (byEmail && byPhone && byEmail.id === byPhone.id) {
    return { kind: "update", contactId: byEmail.id }
  }

  // Two different contacts, one human. Oldest record survives.
  const [survivor, merged] = [byEmail!, byPhone!].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
  )
  return { kind: "merge", survivorId: survivor.id, mergedId: merged.id }
}
```

The `a.id` tiebreak keeps the decision deterministic when two rows share a timestamp — without it the same input could merge in either direction on different runs.

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run __tests__/lib/lead-engine-merge.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 6: Prove the merge tests can fail**

Apply each mutation, confirm the named test fails, then revert:

| Mutation | Test that must fail |
|---|---|
| Sort `b.created_at` first (newest survives) | "oldest surviving" |
| Drop the `byEmail.id === byPhone.id` branch | "updates, not merges, when both identifiers point at the same contact" |
| Make `sameEmail` case-sensitive | "matches email case-insensitively" |

Run each mutation for real. "MUTANT KILLED" is a guess until the mutation has actually been applied.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00213_lead_engine_contacts.sql lib/lead-engine/merge.ts __tests__/lib/lead-engine-merge.test.ts
git commit -m "feat(lead-engine): two records reachable the same way are one person"
```

---

### Task 4: The timeline and recordContactEvent

**Files:**
- Create: `supabase/migrations/00214_lead_engine_timeline.sql`
- Create: `lib/db/contacts.ts`
- Test: `__tests__/db/contacts-record-event.test.ts`

**Interfaces:**
- Consumes: `decideMerge` (Task 3), `normaliseEmail` / `normalisePhone` (Task 2), `SINGLETON_BUSINESS_ID` (Task 1).
- Produces: `recordContactEvent(input: RecordContactEventInput): Promise<{ contactId: string; created: boolean; merged: boolean }>` where `RecordContactEventInput = { email?: string | null; phone?: string | null; name?: string | null; source: ContactEventSource; attributionSessionId?: string | null; metadata?: Record<string, unknown> }` and `ContactEventSource = "funnel_form" | "funnel_checkout" | "contact_form" | "newsletter" | "lead_magnet" | "event_signup" | "shop" | "assessment" | "questionnaire" | "step_up" | "ai_chat"`.

This is the single funnel every entry point calls. Getting its signature right now is what makes Stage 4 a week of small edits.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00214_lead_engine_timeline.sql
-- Lead Engine: append-only history for a contact.
--
-- Reads across both identity spines — contact-native events here, plus the
-- payments and bookings that still hang off users.

CREATE TABLE IF NOT EXISTS public.contact_timeline_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                 REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  source       text NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_timeline_contact_idx
  ON public.contact_timeline_events (contact_id, occurred_at DESC);

ALTER TABLE public.contact_timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on contact_timeline_events"
  ON public.contact_timeline_events FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/db/contacts-record-event.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const state: { rows: any[] } = { rows: [] }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => makeTable(table),
  }),
}))

function makeTable(table: string) {
  const api: any = {
    _filters: [] as any[],
    select() { return api },
    or() { return api },
    eq() { return api },
    order() { return api },
    limit() { return api },
    async then(res: any) { return res({ data: state.rows, error: null }) },
    insert(payload: any) {
      const row = { id: `new-${state.rows.length + 1}`, created_at: "2026-08-18T00:00:00Z", ...payload }
      if (table === "contacts") state.rows.push(row)
      return { select: () => ({ single: async () => ({ data: row, error: null }) }) }
    },
    update(patch: any) {
      return { eq: () => ({ select: () => ({ single: async () => ({ data: { ...state.rows[0], ...patch }, error: null }) }) }) }
    },
    delete() { return { eq: async () => ({ error: null }) } },
  }
  return api
}

import { recordContactEvent } from "@/lib/db/contacts"

beforeEach(() => { state.rows = [] })

describe("recordContactEvent", () => {
  it("creates a contact when nothing matches", async () => {
    const out = await recordContactEvent({
      email: "New@Example.com",
      phone: "617-650-4548",
      name: "Marissa",
      source: "funnel_form",
    })
    expect(out.created).toBe(true)
    expect(out.merged).toBe(false)
    expect(state.rows[0].email).toBe("new@example.com")
    expect(state.rows[0].phone_e164).toBe("+16176504548")
  })

  it("rejects an event carrying neither identifier", async () => {
    await expect(
      recordContactEvent({ email: null, phone: null, source: "funnel_form" }),
    ).rejects.toThrow(/identifier/i)
  })

  it("stores the business id on the contact", async () => {
    await recordContactEvent({ email: "a@b.com", source: "newsletter" })
    expect(state.rows[0].business_id).toBe("00000000-0000-0000-0000-000000000001")
  })
})
```

Mocking the Supabase client keeps this a unit test. It is a real risk that the mock and the implementation are wrong together — `npx tsc --noEmit` in Step 6 is what catches a mocked column that does not exist.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run __tests__/db/contacts-record-event.test.ts`
Expected: FAIL — `Cannot find module '@/lib/db/contacts'`

- [ ] **Step 4: Write the implementation**

```ts
// lib/db/contacts.ts
// The one entry point every front door calls.

import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"
import { normaliseEmail, normalisePhone } from "@/lib/lead-engine/identity"
import { decideMerge, type MatchCandidate } from "@/lib/lead-engine/merge"

export type ContactEventSource =
  | "funnel_form" | "funnel_checkout" | "contact_form" | "newsletter"
  | "lead_magnet" | "event_signup" | "shop" | "assessment"
  | "questionnaire" | "step_up" | "ai_chat"

export type RecordContactEventInput = {
  email?: string | null
  phone?: string | null
  name?: string | null
  source: ContactEventSource
  attributionSessionId?: string | null
  metadata?: Record<string, unknown>
  businessId?: string
}

function getClient() {
  return createServiceRoleClient()
}

export async function recordContactEvent(
  input: RecordContactEventInput,
): Promise<{ contactId: string; created: boolean; merged: boolean }> {
  const businessId = input.businessId ?? SINGLETON_BUSINESS_ID
  const email = normaliseEmail(input.email)
  const phone = normalisePhone(input.phone)

  if (!email && !phone) {
    throw new Error("recordContactEvent needs at least one usable identifier (email or phone)")
  }

  const supabase = getClient()

  const or: string[] = []
  if (email) or.push(`email.eq.${email}`)
  if (phone) or.push(`phone_e164.eq.${phone}`)

  const { data: found, error: findErr } = await supabase
    .from("contacts")
    .select("id,email,phone_e164,created_at")
    .eq("business_id", businessId)
    .or(or.join(","))
  if (findErr) throw findErr

  const decision = decideMerge((found ?? []) as MatchCandidate[], email, phone)

  let contactId: string
  let created = false
  let merged = false

  if (decision.kind === "create") {
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        business_id: businessId,
        email,
        phone_e164: phone,
        name: input.name ?? null,
        first_touch_session_id: input.attributionSessionId ?? null,
      })
      .select()
      .single()
    if (error) throw error
    contactId = data.id
    created = true
  } else if (decision.kind === "update") {
    contactId = decision.contactId
    await supabase
      .from("contacts")
      .update({
        email: email ?? undefined,
        phone_e164: phone ?? undefined,
        name: input.name ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
  } else {
    contactId = decision.survivorId
    merged = true
    await mergeContacts(decision.survivorId, decision.mergedId, businessId)
    await supabase
      .from("contacts")
      .update({
        email: email ?? undefined,
        phone_e164: phone ?? undefined,
        name: input.name ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
  }

  await supabase.from("contact_timeline_events").insert({
    business_id: businessId,
    contact_id: contactId,
    kind: "entry_point",
    source: input.source,
    metadata: input.metadata ?? {},
  })

  return { contactId, created, merged }
}

async function mergeContacts(survivorId: string, mergedId: string, businessId: string) {
  const supabase = getClient()
  const { data: loser } = await supabase.from("contacts").select("*").eq("id", mergedId).maybeSingle()

  await supabase.from("contact_timeline_events").update({ contact_id: survivorId }).eq("contact_id", mergedId)

  await supabase.from("contact_merges").insert({
    business_id: businessId,
    survivor_id: survivorId,
    merged_id: mergedId,
    merged_snapshot: loser ?? {},
    reason: "email and phone resolved to different contacts",
  })

  await supabase.from("contacts").delete().eq("id", mergedId)
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run __tests__/db/contacts-record-event.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `258`. Anything higher is yours — find it with `npx tsc --noEmit 2>&1 | grep -E "lib/db/contacts|lead-engine"`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/00214_lead_engine_timeline.sql lib/db/contacts.ts __tests__/db/contacts-record-event.test.ts
git commit -m "feat(lead-engine): eleven front doors, one contact record"
```

---

### Task 5: Per-channel consent and suppression

**Files:**
- Create: `supabase/migrations/00215_lead_engine_consent.sql`
- Create: `lib/db/contact-consents.ts`
- Test: `__tests__/db/contact-consents.test.ts`

**Interfaces:**
- Consumes: `SINGLETON_BUSINESS_ID` (Task 1).
- Produces: `recordConsent(input: { contactId: string; channel: "email" | "sms"; granted: boolean; source: string; wordingShown: string; ip?: string | null; userAgent?: string | null }): Promise<void>`; `hasConsent(contactId: string, channel: "email" | "sms"): Promise<boolean>`; `isSuppressed(identifier: string): Promise<boolean>`; `suppress(identifier: string, reason: string): Promise<void>`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/00215_lead_engine_consent.sql
-- Lead Engine: dated, per-channel consent.
--
-- Two consent tables already exist and neither does this job. user_consents
-- holds legal waivers; marketing_consent_log holds one boolean keyed to a user.
-- Neither is per-channel, and neither can exist for a person without a users
-- row — which is exactly the population being imported.
--
-- Neither is migrated or dropped. This supersedes them going forward.

CREATE TABLE IF NOT EXISTS public.contact_consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('email','sms')),
  granted       boolean NOT NULL,
  source        text NOT NULL,
  wording_shown text NOT NULL,
  ip_address    text,
  user_agent    text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_consents_lookup_idx
  ON public.contact_consents (contact_id, channel, occurred_at DESC);

-- Keyed by identifier, not contact: a suppression must survive a merge, a
-- delete, and the same person arriving again months later.
CREATE TABLE IF NOT EXISTS public.contact_suppressions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                 REFERENCES public.businesses(id) ON DELETE CASCADE,
  identifier   text NOT NULL,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_suppressions_uniq
  ON public.contact_suppressions (business_id, identifier);

ALTER TABLE public.contact_consents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on contact_consents"
  ON public.contact_consents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on contact_suppressions"
  ON public.contact_suppressions FOR ALL TO service_role USING (true) WITH CHECK (true);
```

`wording_shown` is `NOT NULL` on purpose. A consent record that cannot reproduce what the person agreed to is not evidence of much.

- [ ] **Step 2: Write the failing tests**

```ts
// __tests__/db/contact-consents.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const store: { consents: any[]; suppressions: any[] } = { consents: [], suppressions: [] }

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const rows = table === "contact_consents" ? store.consents : store.suppressions
      const api: any = {
        insert: async (payload: any) => { rows.push({ ...payload, occurred_at: payload.occurred_at ?? new Date().toISOString() }); return { error: null } },
        select: () => api,
        eq: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: async () => ({ data: rows[rows.length - 1] ?? null, error: null }),
      }
      return api
    },
  }),
}))

import { recordConsent, hasConsent, isSuppressed, suppress } from "@/lib/db/contact-consents"

beforeEach(() => { store.consents = []; store.suppressions = [] })

describe("consent", () => {
  it("records the wording the person was actually shown", async () => {
    await recordConsent({
      contactId: "c1", channel: "sms", granted: true,
      source: "funnel_form", wordingShown: "Text me about camps and clinics.",
    })
    expect(store.consents[0].wording_shown).toBe("Text me about camps and clinics.")
    expect(store.consents[0].channel).toBe("sms")
    expect(store.consents[0].granted).toBe(true)
  })

  it("treats the most recent record as authoritative", async () => {
    await recordConsent({ contactId: "c1", channel: "email", granted: true, source: "form", wordingShown: "w" })
    await recordConsent({ contactId: "c1", channel: "email", granted: false, source: "unsubscribe", wordingShown: "w" })
    expect(await hasConsent("c1", "email")).toBe(false)
  })

  it("returns false when there is no consent record at all", async () => {
    expect(await hasConsent("c-unknown", "sms")).toBe(false)
  })
})

describe("suppression", () => {
  it("suppresses by identifier", async () => {
    await suppress("marissa@example.com", "unsubscribed")
    expect(await isSuppressed("marissa@example.com")).toBe(true)
  })
})
```

The "no record at all" test encodes the rule that absence is never consent.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run __tests__/db/contact-consents.test.ts`
Expected: FAIL — `Cannot find module '@/lib/db/contact-consents'`

- [ ] **Step 4: Write the implementation**

```ts
// lib/db/contact-consents.ts
import { createServiceRoleClient } from "@/lib/supabase"
import { SINGLETON_BUSINESS_ID } from "@/lib/lead-engine/constants"

export type ConsentChannel = "email" | "sms"

function getClient() {
  return createServiceRoleClient()
}

export async function recordConsent(input: {
  contactId: string
  channel: ConsentChannel
  granted: boolean
  source: string
  wordingShown: string
  ip?: string | null
  userAgent?: string | null
  businessId?: string
}): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("contact_consents").insert({
    business_id: input.businessId ?? SINGLETON_BUSINESS_ID,
    contact_id: input.contactId,
    channel: input.channel,
    granted: input.granted,
    source: input.source,
    wording_shown: input.wordingShown,
    ip_address: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  })
  if (error) throw error
}

/**
 * The most recent record wins. A read failure throws rather than returning
 * false: "could not read" and "they said no" are different answers, and only
 * one of them is safe to act on.
 */
export async function hasConsent(contactId: string, channel: ConsentChannel): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_consents")
    .select("granted")
    .eq("contact_id", contactId)
    .eq("channel", channel)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return false
  return Boolean(data.granted)
}

export async function suppress(
  identifier: string,
  reason: string,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("contact_suppressions")
    .insert({ business_id: businessId, identifier: identifier.toLowerCase(), reason })
  if (error && !String(error.message).includes("duplicate")) throw error
}

export async function isSuppressed(
  identifier: string,
  businessId: string = SINGLETON_BUSINESS_ID,
): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("contact_suppressions")
    .select("id")
    .eq("business_id", businessId)
    .eq("identifier", identifier.toLowerCase())
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run __tests__/db/contact-consents.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00215_lead_engine_consent.sql lib/db/contact-consents.ts __tests__/db/contact-consents.test.ts
git commit -m "feat(lead-engine): consent is per channel, dated, and quotes what was shown"
```

---

### Task 6: Wire the funnel form into the contact spine

**Files:**
- Modify: `app/api/funnels/submit/route.ts`
- Test: `__tests__/api/funnel-submit-contact.test.ts`

**Interfaces:**
- Consumes: `recordContactEvent` (Task 4), `recordConsent` (Task 5).
- Produces: nothing new. This proves the funnel works end to end before the other ten doors are wired in Stage 4.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/funnel-submit-contact.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest"

const recordContactEvent = vi.fn(async () => ({ contactId: "c1", created: true, merged: false }))
vi.mock("@/lib/db/contacts", () => ({ recordContactEvent }))

describe("funnel submit → contact spine", () => {
  it("passes the submitted identifiers and the attribution session through", async () => {
    const { captureContactFromSubmission } = await import("@/lib/funnels/capture-contact")
    await captureContactFromSubmission({
      name: "Marissa",
      email: "Marissa@Example.com",
      phone: "617-650-4548",
      attributionSessionId: "sess-123",
      payload: { sport: "lacrosse" },
    })
    expect(recordContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "Marissa@Example.com",
        phone: "617-650-4548",
        name: "Marissa",
        source: "funnel_form",
        attributionSessionId: "sess-123",
      }),
    )
  })

  it("never throws when the contact write fails — the submission still stands", async () => {
    recordContactEvent.mockRejectedValueOnce(new Error("PGRST204 column missing"))
    const { captureContactFromSubmission } = await import("@/lib/funnels/capture-contact")
    await expect(
      captureContactFromSubmission({ name: "X", email: "x@y.com", phone: null, attributionSessionId: null, payload: {} }),
    ).resolves.toBeNull()
  })
})
```

The second test is the important one. During the deploy window the `contacts` table may not exist yet, and a lead-capture route that throws because of a marketing feature is a worse bug than the one being fixed.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run __tests__/api/funnel-submit-contact.test.ts`
Expected: FAIL — `Cannot find module '@/lib/funnels/capture-contact'`

- [ ] **Step 3: Write the helper**

```ts
// lib/funnels/capture-contact.ts
// Bridges a funnel submission into the contact spine.
//
// Deliberately swallows every error. Migrations and deploys race each other, so
// during one deploy window `contacts` may not exist. Losing the contact row is
// recoverable; losing the lead is not.

import { recordContactEvent } from "@/lib/db/contacts"

export async function captureContactFromSubmission(input: {
  name: string | null
  email: string | null
  phone: string | null
  attributionSessionId: string | null
  payload: Record<string, unknown>
}): Promise<string | null> {
  if (!input.email && !input.phone) return null
  try {
    const { contactId } = await recordContactEvent({
      email: input.email,
      phone: input.phone,
      name: input.name,
      source: "funnel_form",
      attributionSessionId: input.attributionSessionId,
      metadata: input.payload,
    })
    return contactId
  } catch (err) {
    console.error("[capture-contact] contact write failed; submission unaffected", err)
    return null
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run __tests__/api/funnel-submit-contact.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Call it from the submit route**

In `app/api/funnels/submit/route.ts`, add the import beside the existing ones:

```ts
import { captureContactFromSubmission } from "@/lib/funnels/capture-contact"
```

Then, immediately after the existing `createSubmission(...)` call succeeds and before the email send, add:

```ts
await captureContactFromSubmission({
  name: values.name ?? null,
  email: values.email ?? null,
  phone: values.phone ?? null,
  attributionSessionId: attributionSessionId ?? null,
  payload: values,
})
```

Use the variable names already in scope at that point in the route — read the surrounding lines rather than assuming `values` and `attributionSessionId` are spelled that way.

- [ ] **Step 6: Typecheck and run the funnel suites**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → expect `258`
Run: `npx vitest run __tests__/api __tests__/db __tests__/lib/lead-engine-identity.test.ts __tests__/lib/lead-engine-merge.test.ts`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add app/api/funnels/submit/route.ts lib/funnels/capture-contact.ts __tests__/api/funnel-submit-contact.test.ts
git commit -m "feat(lead-engine): a funnel submission becomes a contact"
```

---

## What this plan deliberately does not cover

Stage 1a stops at a working contact spine. Still to come, each as its own plan:

- **Stage 1b — the sequence engine.** Tables, the five-minute tick, atomic claim, send-time guardrails, exit conditions, four seeded email sequences. The hardest part of the whole build.
- **Stage 1c — pipeline and reporting.** One board, self-moving cards, campaign-to-revenue.
- **Stage 2 — SMS.** Blocked on the Twilio registration chain, not on code.
- **Stage 3 — the website assistant.**
- **Stage 4 — the remaining ten entry points**, plus the GoHighLevel import under the consent position in §6 of the spec.

# Two-Way SMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can hold a real text conversation with a contact — see the thread, send a message, reply to an inbound one, and see delivery state per message.

**Architecture:** A new `sms_messages` table becomes the conversation's record, keyed on **phone number** (the contact link is a nullable enrichment). Three existing writers feed it: the inbound webhook, the sequence tick runner, and a new manual-send path. The Twilio status callback updates it by `twilio_sid`. Two new admin screens read it: a thread list and a conversation with a compose box. `sequence_messages` remains the *engine's* record and is pointed at from `sms_messages.sequence_message_id` so the two cannot disagree.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (service-role DAL), Vitest, Zod, Tailwind v4, shadcn/ui, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-full-engine-phase3-two-way-sms-design.md` — **read §8 first.** Sections §1–§7 were written 2026-09-01 and §8 supersedes them where they disagree.

## Global Constraints

- **Node 24.** The shell default here is Node 20 and vitest *throws* on it. Every command needs `export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"` first (`source`/`nvm use` is blocked in this worktree).
- **Targeted tests only.** `npx vitest run <path>`. Never the full suite. `npx tsc --noEmit` is a separate gate.
- **Baselines** (measured at branch point `5da41913`, in `/tmp/.../scratchpad/tsc-baseline.txt`): compare the per-file tsc error **set**, not the total. A falling count hides new errors.
- **Send with `MessagingServiceSid`, never `From`.** A `From` send does not reliably carry the A2P campaign.
- **A send that did not throw is not a send.** Never return `{ ok: true }` on an unconfigured send — fail loudly and visibly.
- **Inbound webhook answers empty TwiML**, `Content-Type: text/xml`. Assert on the **body**, never only the status.
- **Every new table gets `business_id`; every new reader gets a tenant predicate.** Never add a `SINGLETON_BUSINESS_ID` reference.
- **Admin UI is light-only.** No `.dark` variants.
- **Tables use `components/ui/data-table.tsx`.** `DataTableEmpty` renders its own `<tr>` — never wrap it in `DataTableRow`.
- **No Claude attribution in any commit message.** No `Co-Authored-By`, no "Generated with".
- Migration number is **`00259`**. Apply to the dev clone (standing instruction); Supabase keys on the version NUMBER, so never edit an applied migration — write a new one.
- **Never send a real text to a real contact.** No production data, no production flags.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/00259_sms_messages.sql` | The table, indexes, RLS |
| `lib/db/sms-messages.ts` | All `sms_messages` queries — thread list, one thread, insert, status update |
| `lib/lead-engine/sms.ts` (modify) | `countSmsSegments`, `renderManualSms`, `sendManualSms` |
| `app/api/admin/sms/send/route.ts` | The manual-send route — auth, tenant, validation, audit |
| `lib/audit/actions.ts` (modify) | Two new slugs |
| `lib/permissions/registry.ts` (modify) | Two new path prefixes → `contacts` |
| `app/api/webhooks/twilio/inbound/route.ts` (modify) | One new write, outside the matched-contact gate |
| `app/api/webhooks/twilio/status/route.ts` + `lib/db/sequences.ts` (modify) | Status callback also updates `sms_messages` |
| `lib/automation/sequence-tick-runner.ts` (modify) | Sequence sends mirror into `sms_messages` |
| `app/(admin)/admin/sms/page.tsx` | Thread list (DataTable) |
| `app/(admin)/admin/sms/[phone]/page.tsx` | One conversation |
| `components/admin/sms/SmsThread.tsx` | Bubble list, newest at bottom |
| `components/admin/sms/SmsComposer.tsx` | Compose box, segment counter, quiet-hours confirm, suppression lockout |

---

## Task 1: Migration `00259_sms_messages.sql`

**Files:**
- Create: `supabase/migrations/00259_sms_messages.sql`
- Create: `__tests__/lib/db/sms-messages-schema.test.ts`

**Interfaces:**
- Produces: table `public.sms_messages` with columns `id, business_id, contact_id, phone, direction, body, twilio_sid, status, error_code, sent_by, sequence_message_id, occurred_at, created_at`.

- [ ] **Step 1: Write the migration**

Copy 00214's service-role policy verbatim. Note `contact_id` is **nullable** and `phone` is **NOT NULL** — the thread is keyed on the phone number.

```sql
-- supabase/migrations/00259_sms_messages.sql
-- Two-way SMS: the conversation's record.
--
-- `sequence_messages` stays the ENGINE's record — it is about a run. This
-- table is about a PERSON, and is keyed on the phone number rather than the
-- contact, because a text can arrive from a number nobody has on file and
-- that conversation still has to exist. `contact_id` is the enrichment;
-- `sequence_message_id` points at the engine's row so the two cannot
-- disagree about one send.

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                  REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone         text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body          text NOT NULL,
  twilio_sid    text,
  status        text NOT NULL DEFAULT 'queued',
  error_code    text,
  sent_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sequence_message_id uuid REFERENCES public.sequence_messages(id) ON DELETE SET NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_twilio_sid_key
  ON public.sms_messages (twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_contact_idx
  ON public.sms_messages (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_phone_idx
  ON public.sms_messages (business_id, phone, occurred_at DESC);

ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on sms_messages"
  ON public.sms_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Deviation from spec §4.1, deliberate:** `contact_id` is `ON DELETE SET NULL`, not `ON DELETE CASCADE`. Cascading would destroy the record of real messages sent to a real person when a contact row is deleted — the same class of loss the `sequence_messages_step_id_fkey` cascade caused (see CLAUDE.md, sequence management). The phone number is the key; the thread must survive. Also `sms_messages_phone_idx` leads with `business_id` because every read is tenant-scoped.

- [ ] **Step 2: Apply to the dev clone**

Use the `supabase` MCP `apply_migration` with name `sms_messages`. Then read it back — do not trust the statement's own report:

```sql
select column_name, data_type, is_nullable from information_schema.columns
where table_name = 'sms_messages' order by ordinal_position;
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.sms_messages'::regclass;
```

`information_schema` hides constraints — use `pg_constraint` for the FKs and the CHECK.

- [ ] **Step 3: Write the schema test**

```ts
// __tests__/lib/db/sms-messages-schema.test.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"

const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/00259_sms_messages.sql"),
  "utf8",
)

describe("00259_sms_messages", () => {
  it("keys the thread on a NOT NULL phone", () => {
    expect(sql).toMatch(/phone\s+text NOT NULL/)
  })

  it("lets a message outlive its contact rather than cascading it away", () => {
    // A cascade here would destroy the record of real texts to a real
    // person. The phone number is the key; the contact link is enrichment.
    expect(sql).toMatch(/contact_id\s+uuid REFERENCES public\.contacts\(id\) ON DELETE SET NULL/)
  })

  it("enables RLS with a service-role-only policy", () => {
    expect(sql).toMatch(/ALTER TABLE public\.sms_messages ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/FOR ALL TO service_role/)
  })

  it("scopes the phone index by tenant", () => {
    expect(sql).toMatch(/sms_messages_phone_idx[\s\S]*business_id, phone/)
  })
})
```

- [ ] **Step 4: Run it**

```
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
npx vitest run __tests__/lib/db/sms-messages-schema.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00259_sms_messages.sql __tests__/lib/db/sms-messages-schema.test.ts
git commit -m "feat(sms): add sms_messages table

The conversation's record, keyed on phone rather than contact so a text
from an unknown number still forms a thread. contact_id is SET NULL on
delete, not CASCADE — a deleted contact must not erase the record of real
messages sent to a real person."
```

---

## Task 2: `lib/db/sms-messages.ts`

**Files:**
- Create: `lib/db/sms-messages.ts`
- Create: `__tests__/lib/db/sms-messages.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SmsDirection = "inbound" | "outbound"
  export type SmsMessageRow = {
    id: string; business_id: string; contact_id: string | null; phone: string
    direction: SmsDirection; body: string; twilio_sid: string | null
    status: string; error_code: string | null; sent_by: string | null
    sequence_message_id: string | null; occurred_at: string; created_at: string
  }
  export type SmsThreadSummary = {
    phone: string; contactId: string | null; contactName: string | null
    lastBody: string; lastDirection: SmsDirection; lastOccurredAt: string
    lastStatus: string; inboundCount: number; messageCount: number
  }
  export async function insertSmsMessage(input: {
    businessId: string; contactId?: string | null; phone: string
    direction: SmsDirection; body: string; twilioSid?: string | null
    status?: string; errorCode?: string | null; sentBy?: string | null
    sequenceMessageId?: string | null
  }): Promise<{ id: string }>
  export async function listSmsThreads(businessId: string, limit?: number): Promise<SmsThreadSummary[]>
  export async function getSmsThread(phone: string, businessId: string): Promise<SmsMessageRow[]>
  export async function updateSmsStatusBySid(
    twilioSid: string, status: string, errorCode?: string | null,
  ): Promise<"updated" | "unknown_message">
  ```

- [ ] **Step 1: Write the failing tests**

The Supabase client is mocked. Follow the argument-blind-mock trap: assert the **value** passed to `.eq()`, not just that it was called.

```ts
// __tests__/lib/db/sms-messages.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const eq = vi.fn()
const mockFrom = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}))

import {
  insertSmsMessage,
  getSmsThread,
  listSmsThreads,
  updateSmsStatusBySid,
} from "@/lib/db/sms-messages"

const BIZ = "11111111-1111-1111-1111-111111111111"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("insertSmsMessage", () => {
  it("writes the row and returns its id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "m1" }, error: null })
    const insert = vi.fn().mockReturnValue({ select: () => ({ single }) })
    mockFrom.mockReturnValue({ insert })

    const res = await insertSmsMessage({
      businessId: BIZ, phone: "+15551230000", direction: "inbound", body: "hi",
    })

    expect(res).toEqual({ id: "m1" })
    expect(mockFrom).toHaveBeenCalledWith("sms_messages")
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: BIZ, phone: "+15551230000", direction: "inbound", body: "hi",
        contact_id: null,
      }),
    )
  })

  it("throws rather than returning a success shape when the write fails", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "boom", code: "42P01" } })
    mockFrom.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) })

    await expect(
      insertSmsMessage({ businessId: BIZ, phone: "+1555", direction: "outbound", body: "x" }),
    ).rejects.toThrow(/boom/)
  })
})

describe("getSmsThread", () => {
  it("scopes the read to the tenant AND the phone, oldest first", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const eqPhone = vi.fn().mockReturnValue({ order })
    const eqBiz = vi.fn().mockReturnValue({ eq: eqPhone })
    mockFrom.mockReturnValue({ select: () => ({ eq: eqBiz }) })

    await getSmsThread("+15551230000", BIZ)

    // Mutating either VALUE must fail this test — an argument-blind mock
    // tolerates a wrong-tenant predicate.
    expect(eqBiz).toHaveBeenCalledWith("business_id", BIZ)
    expect(eqPhone).toHaveBeenCalledWith("phone", "+15551230000")
    expect(order).toHaveBeenCalledWith("occurred_at", { ascending: true })
  })
})

describe("updateSmsStatusBySid", () => {
  it("reports unknown_message when no row carries that sid", async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    const eqSid = vi.fn().mockReturnValue({ select })
    mockFrom.mockReturnValue({ update: () => ({ eq: eqSid }) })

    const out = await updateSmsStatusBySid("SMnope", "delivered")

    expect(out).toBe("unknown_message")
    expect(eqSid).toHaveBeenCalledWith("twilio_sid", "SMnope")
  })

  it("reports updated when a row matched", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: "m1" }], error: null })
    mockFrom.mockReturnValue({ update: () => ({ eq: () => ({ select }) }) })

    expect(await updateSmsStatusBySid("SM1", "delivered")).toBe("updated")
  })
})

describe("listSmsThreads", () => {
  it("collapses many messages into one row per phone, newest first", async () => {
    const rows = [
      { phone: "+1999", contact_id: null, body: "newest", direction: "inbound",
        occurred_at: "2026-09-10T10:00:00Z", status: "received", contacts: null },
      { phone: "+1888", contact_id: "c1", body: "older", direction: "outbound",
        occurred_at: "2026-09-09T10:00:00Z", status: "delivered",
        contacts: { name: "Jane" } },
      { phone: "+1999", contact_id: null, body: "oldest", direction: "outbound",
        occurred_at: "2026-09-08T10:00:00Z", status: "delivered", contacts: null },
    ]
    const order = vi.fn().mockResolvedValue({ data: rows, error: null })
    const eqBiz = vi.fn().mockReturnValue({ order })
    mockFrom.mockReturnValue({ select: () => ({ eq: eqBiz }) })

    const threads = await listSmsThreads(BIZ)

    expect(eqBiz).toHaveBeenCalledWith("business_id", BIZ)
    expect(threads).toHaveLength(2)
    expect(threads[0]).toMatchObject({
      phone: "+1999", lastBody: "newest", messageCount: 2, inboundCount: 1,
    })
    expect(threads[1]).toMatchObject({ phone: "+1888", contactName: "Jane", messageCount: 1 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run __tests__/lib/db/sms-messages.test.ts
```
Expected: FAIL — cannot resolve `@/lib/db/sms-messages`.

- [ ] **Step 3: Implement**

```ts
// lib/db/sms-messages.ts — every sms_messages query.
//
// The thread is keyed on PHONE, not contact: a text from a number nobody has
// on file still forms a conversation. Every read takes an explicit
// businessId and applies it as a predicate — a reader with no tenant
// predicate is a leak with a fuse in it.

import { createServiceRoleClient } from "@/lib/supabase"

function getClient() {
  return createServiceRoleClient()
}

export type SmsDirection = "inbound" | "outbound"

export type SmsMessageRow = {
  id: string
  business_id: string
  contact_id: string | null
  phone: string
  direction: SmsDirection
  body: string
  twilio_sid: string | null
  status: string
  error_code: string | null
  sent_by: string | null
  sequence_message_id: string | null
  occurred_at: string
  created_at: string
}

export type SmsThreadSummary = {
  phone: string
  contactId: string | null
  contactName: string | null
  lastBody: string
  lastDirection: SmsDirection
  lastOccurredAt: string
  lastStatus: string
  inboundCount: number
  messageCount: number
}

export async function insertSmsMessage(input: {
  businessId: string
  contactId?: string | null
  phone: string
  direction: SmsDirection
  body: string
  twilioSid?: string | null
  status?: string
  errorCode?: string | null
  sentBy?: string | null
  sequenceMessageId?: string | null
}): Promise<{ id: string }> {
  const { data, error } = await getClient()
    .from("sms_messages")
    .insert({
      business_id: input.businessId,
      contact_id: input.contactId ?? null,
      phone: input.phone,
      direction: input.direction,
      body: input.body,
      twilio_sid: input.twilioSid ?? null,
      status: input.status ?? (input.direction === "inbound" ? "received" : "queued"),
      error_code: input.errorCode ?? null,
      sent_by: input.sentBy ?? null,
      sequence_message_id: input.sequenceMessageId ?? null,
    })
    .select("id")
    .single()
  // Throw, never return a success shape: a caller that records a send it
  // never made is the failure mode lib/email.ts already has.
  if (error) throw new Error(`insertSmsMessage failed (${error.code}): ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function getSmsThread(phone: string, businessId: string): Promise<SmsMessageRow[]> {
  const { data, error } = await getClient()
    .from("sms_messages")
    .select("*")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .order("occurred_at", { ascending: true })
  if (error) throw new Error(`getSmsThread failed (${error.code}): ${error.message}`)
  return (data ?? []) as SmsMessageRow[]
}

export async function listSmsThreads(
  businessId: string,
  limit = 500,
): Promise<SmsThreadSummary[]> {
  const { data, error } = await getClient()
    .from("sms_messages")
    .select("phone, contact_id, body, direction, occurred_at, status, contacts(name)")
    .eq("business_id", businessId)
    .order("occurred_at", { ascending: false })
  if (error) throw new Error(`listSmsThreads failed (${error.code}): ${error.message}`)

  type Row = {
    phone: string
    contact_id: string | null
    body: string
    direction: SmsDirection
    occurred_at: string
    status: string
    contacts: { name: string | null } | null
  }

  // Rows arrive newest-first, so the FIRST row seen for a phone is that
  // thread's latest message. Walk every row — a deduping helper would drop
  // one of two rows sharing a phone and the counts would be wrong.
  const byPhone = new Map<string, SmsThreadSummary>()
  for (const row of (data ?? []) as Row[]) {
    const existing = byPhone.get(row.phone)
    if (!existing) {
      byPhone.set(row.phone, {
        phone: row.phone,
        contactId: row.contact_id,
        contactName: row.contacts?.name ?? null,
        lastBody: row.body,
        lastDirection: row.direction,
        lastOccurredAt: row.occurred_at,
        lastStatus: row.status,
        inboundCount: row.direction === "inbound" ? 1 : 0,
        messageCount: 1,
      })
      continue
    }
    existing.messageCount += 1
    if (row.direction === "inbound") existing.inboundCount += 1
    // A later row may carry the contact link the newest one lacks.
    if (!existing.contactId && row.contact_id) {
      existing.contactId = row.contact_id
      existing.contactName = row.contacts?.name ?? null
    }
  }

  return [...byPhone.values()].slice(0, limit)
}

/**
 * Applies one Twilio status callback to the `sms_messages` row carrying that
 * sid. Mirrors `applyDeliveryStatus`'s outcome space (never throws on an
 * unknown sid) so the webhook can report both without branching on an error.
 */
export async function updateSmsStatusBySid(
  twilioSid: string,
  status: string,
  errorCode: string | null = null,
): Promise<"updated" | "unknown_message"> {
  if (!twilioSid) return "unknown_message"
  const patch: Record<string, unknown> = { status }
  if (errorCode) patch.error_code = errorCode
  const { data, error } = await getClient()
    .from("sms_messages")
    .update(patch)
    .eq("twilio_sid", twilioSid)
    .select("id")
  if (error) throw new Error(`updateSmsStatusBySid failed (${error.code}): ${error.message}`)
  return (data ?? []).length > 0 ? "updated" : "unknown_message"
}
```

- [ ] **Step 4: Run to verify it passes**

```
npx vitest run __tests__/lib/db/sms-messages.test.ts
```
Expected: PASS.

- [ ] **Step 5: Mutate the tenant predicate**

Temporarily change `.eq("business_id", businessId)` in `getSmsThread` to `.eq("business_id", "nope")`. Re-run. The test MUST fail. Revert.

- [ ] **Step 6: Commit**

```bash
git add lib/db/sms-messages.ts __tests__/lib/db/sms-messages.test.ts
git commit -m "feat(sms): add the sms_messages data access layer

Thread list, one thread, insert and status-by-sid update. Every read takes
an explicit businessId and applies it as a predicate. The thread collapse
walks every row rather than deduping, so two messages sharing a phone both
count."
```

---

## Task 3: `countSmsSegments` + `renderManualSms`

**Files:**
- Modify: `lib/lead-engine/sms.ts`
- Create: `__tests__/lib/lead-engine/sms-manual-render.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function countSmsSegments(text: string): {
    characters: number; segments: number; encoding: "GSM-7" | "UCS-2"; perSegment: number
  }
  export function renderManualSms(args: { body: string; appendOptOut: boolean }): { text: string }
  ```

Segment counting must match Twilio: GSM-7 is 160 for a single segment and **153** per segment once concatenated (the UDH header costs 7 characters); UCS-2 is **70** single and **67** concatenated. One character outside the GSM-7 alphabet — an emoji, a curly apostrophe — flips the whole message to UCS-2. GSM-7 extension characters (`^{}\[~]|€`) each cost **two** septets.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/lead-engine/sms-manual-render.test.ts
import { describe, it, expect } from "vitest"
import { countSmsSegments, renderManualSms, SMS_OPT_OUT_SENTENCE } from "@/lib/lead-engine/sms"

describe("countSmsSegments", () => {
  it("counts a plain message as one GSM-7 segment", () => {
    expect(countSmsSegments("Hey Jane, see you at 4pm.")).toMatchObject({
      encoding: "GSM-7", segments: 1, perSegment: 160,
    })
  })

  it("fits exactly 160 GSM-7 characters in one segment", () => {
    const out = countSmsSegments("a".repeat(160))
    expect(out).toMatchObject({ segments: 1, characters: 160 })
  })

  it("splits at 161 into two segments of 153", () => {
    expect(countSmsSegments("a".repeat(161))).toMatchObject({ segments: 2, perSegment: 153 })
  })

  it("flips the WHOLE message to UCS-2 on one curly apostrophe", () => {
    // The trap: a single non-GSM character re-encodes everything, so a
    // 100-char message that was one segment becomes two.
    const body = "a".repeat(99) + "’"
    expect(countSmsSegments(body)).toMatchObject({ encoding: "UCS-2", segments: 2, perSegment: 67 })
  })

  it("flips to UCS-2 on an emoji and counts it as a surrogate pair", () => {
    const out = countSmsSegments("hi \u{1F44B}")
    expect(out.encoding).toBe("UCS-2")
    // The emoji is two UTF-16 code units, so 3 + 2 = 5.
    expect(out.characters).toBe(5)
  })

  it("charges GSM-7 extension characters two septets", () => {
    // 80 euro signs = 160 septets = still one segment; 81 would not be.
    expect(countSmsSegments("€".repeat(80))).toMatchObject({ encoding: "GSM-7", segments: 1 })
    expect(countSmsSegments("€".repeat(81))).toMatchObject({ encoding: "GSM-7", segments: 2 })
  })

  it("treats an empty message as zero segments", () => {
    expect(countSmsSegments("")).toMatchObject({ segments: 0, characters: 0 })
  })
})

describe("renderManualSms", () => {
  it("appends the opt-out sentence on its own line when asked", () => {
    const { text } = renderManualSms({ body: "Hey Jane", appendOptOut: true })
    expect(text).toBe(`Hey Jane\n\n${SMS_OPT_OUT_SENTENCE}`)
  })

  it("sends the body alone when not asked", () => {
    const { text } = renderManualSms({ body: "Hey Jane", appendOptOut: false })
    expect(text).toBe("Hey Jane")
    expect(text).not.toContain("STOP")
  })

  it("trims trailing whitespace so the opt-out line never doubles up", () => {
    const { text } = renderManualSms({ body: "Hey Jane  \n\n", appendOptOut: true })
    expect(text).toBe(`Hey Jane\n\n${SMS_OPT_OUT_SENTENCE}`)
  })

  it("does not substitute templates — a manual message is typed, not rendered", () => {
    const { text } = renderManualSms({ body: "Use code {{name}}", appendOptOut: false })
    expect(text).toBe("Use code {{name}}")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run __tests__/lib/lead-engine/sms-manual-render.test.ts
```
Expected: FAIL — `countSmsSegments is not a function`.

- [ ] **Step 3: Implement — append to `lib/lead-engine/sms.ts`**

```ts
/**
 * The GSM-7 default alphabet. A message composed only of these characters
 * is sent as 7-bit septets; anything else forces the whole message to
 * UCS-2. Kept as an explicit set rather than a regex range because the
 * alphabet is not contiguous in Unicode.
 */
const GSM7_BASE =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

/**
 * Characters reachable in GSM-7 only via the escape sequence — each costs
 * TWO septets, not one. A message of 81 euro signs is two segments even
 * though it is 81 characters.
 */
const GSM7_EXTENDED = "^{}\\[~]|€"

const GSM7_BASE_SET = new Set(GSM7_BASE)
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED)

/**
 * Counts a message the way Twilio bills it.
 *
 * Single-segment limits are 160 (GSM-7) and 70 (UCS-2). The moment a message
 * needs more than one segment, each part gives up room to a UDH concatenation
 * header: 153 septets, or 67 UTF-16 code units. `characters` is reported in
 * the unit the compose box should show — UTF-16 code units — so an emoji
 * counts as the two units it occupies on the wire.
 */
export function countSmsSegments(text: string): {
  characters: number
  segments: number
  encoding: "GSM-7" | "UCS-2"
  perSegment: number
} {
  const characters = text.length

  let isGsm7 = true
  let septets = 0
  for (const char of text) {
    if (GSM7_BASE_SET.has(char)) {
      septets += 1
    } else if (GSM7_EXTENDED_SET.has(char)) {
      septets += 2
    } else {
      isGsm7 = false
      break
    }
  }

  if (characters === 0) {
    return { characters: 0, segments: 0, encoding: "GSM-7", perSegment: 160 }
  }

  if (isGsm7) {
    if (septets <= 160) return { characters, segments: 1, encoding: "GSM-7", perSegment: 160 }
    return {
      characters,
      segments: Math.ceil(septets / 153),
      encoding: "GSM-7",
      perSegment: 153,
    }
  }

  // UCS-2 counts UTF-16 code units, which is what `text.length` already is.
  if (characters <= 70) return { characters, segments: 1, encoding: "UCS-2", perSegment: 70 }
  return {
    characters,
    segments: Math.ceil(characters / 67),
    encoding: "UCS-2",
    perSegment: 67,
  }
}

/**
 * Renders a manually typed message.
 *
 * Deliberately NOT `renderSequenceSms`: a manual message is typed by a human
 * into a box, so `{{name}}` is literal text they meant to send, not a
 * template to substitute. And the opt-out sentence is conditional here —
 * spec §3.2 puts it on the first outbound to a contact in a rolling 30 days
 * rather than on every reply, because appending it to a one-line reply in a
 * live conversation reads as automated and costs a third of the segment.
 * Sequence sends are unaffected and keep appending every time.
 */
export function renderManualSms(args: { body: string; appendOptOut: boolean }): { text: string } {
  const body = args.body.trimEnd()
  if (!args.appendOptOut) return { text: body }
  return { text: `${body}\n\n${SMS_OPT_OUT_SENTENCE}` }
}
```

- [ ] **Step 4: Run to verify it passes**

```
npx vitest run __tests__/lib/lead-engine/sms-manual-render.test.ts __tests__/lib/lead-engine/sms.test.ts
```
Expected: PASS, and the pre-existing `sms.test.ts` still passes.

- [ ] **Step 5: Check the brand-literal guard**

`__tests__/lib/lead-engine/no-brand-literals.test.ts` scans this file on disk. Run it:

```
npx vitest run __tests__/lib/lead-engine/no-brand-literals.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/sms.ts __tests__/lib/lead-engine/sms-manual-render.test.ts
git commit -m "feat(sms): count segments the way Twilio bills them, render manual copy

One curly apostrophe or emoji re-encodes the whole message to UCS-2 and
halves the room, so the compose box has to compute it rather than count
characters. GSM-7 extension characters cost two septets.

renderManualSms does not substitute templates: a manual message is typed by
a human, so {{name}} is literal text they meant to send."
```

---

## Task 4: `sendManualSms` — the three-check order

**Files:**
- Modify: `lib/lead-engine/sms.ts`
- Create: `__tests__/lib/lead-engine/send-manual-sms.test.ts`

**Interfaces:**
- Consumes: `isSuppressed(identifier, businessId)` from `lib/db/contact-consents`, `assertSmsSendable(settings)`, `sendRenderedSequenceSms(...)`, `insertSmsMessage(...)` from `lib/db/sms-messages`.
- Produces:
  ```ts
  export class SmsSuppressedError extends Error { readonly phone: string }
  export async function sendManualSms(args: {
    phone: string; body: string; settings: BusinessSettings; businessId: string
    contactId?: string | null; sentBy?: string | null; appendOptOut: boolean
    statusCallbackUrl?: string
  }): Promise<{ messageId: string; providerMessageId: string | null; text: string }>
  ```

**Check order, failing on the first:** suppression → configuration → segment length. Suppression comes first because it is the one check with legal consequences; an unconfigured business must not mask a suppressed number.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/lead-engine/send-manual-sms.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const isSuppressed = vi.fn()
const insertSmsMessage = vi.fn()
const sendRendered = vi.fn()

vi.mock("@/lib/db/contact-consents", () => ({ isSuppressed }))
vi.mock("@/lib/db/sms-messages", () => ({ insertSmsMessage }))

import { sendManualSms, SmsSuppressedError, SmsNotConfiguredError } from "@/lib/lead-engine/sms"
import type { BusinessSettings } from "@/lib/db/businesses"

const BIZ = "11111111-1111-1111-1111-111111111111"
const CONFIGURED = {
  sms_messaging_service_sid: "MGtest", sms_sender_phone: "",
} as unknown as BusinessSettings
const UNCONFIGURED = {
  sms_messaging_service_sid: "", sms_sender_phone: "",
} as unknown as BusinessSettings

beforeEach(() => {
  vi.resetAllMocks()
  isSuppressed.mockResolvedValue(false)
  insertSmsMessage.mockResolvedValue({ id: "m1" })
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC1")
  vi.stubEnv("TWILIO_MAIN_SID", "SK1")
  vi.stubEnv("TWILIO_CLIENT_SECRET", "secret")
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ sid: "SM123" }),
  }) as unknown as typeof fetch
})

describe("sendManualSms — suppression", () => {
  it("REFUSES a suppressed number and sends nothing", async () => {
    isSuppressed.mockResolvedValue(true)

    await expect(
      sendManualSms({
        phone: "+15551230000", body: "hi", settings: CONFIGURED,
        businessId: BIZ, appendOptOut: false,
      }),
    ).rejects.toThrow(SmsSuppressedError)

    // The guard is worthless if the provider was still called.
    expect(global.fetch).not.toHaveBeenCalled()
    expect(insertSmsMessage).not.toHaveBeenCalled()
  })

  it("checks suppression against the normalised phone and this tenant", async () => {
    await sendManualSms({
      phone: "+15551230000", body: "hi", settings: CONFIGURED,
      businessId: BIZ, appendOptOut: false,
    })
    expect(isSuppressed).toHaveBeenCalledWith("+15551230000", BIZ)
  })

  it("checks suppression BEFORE configuration", async () => {
    // Both are wrong. The suppression error is the one that must surface —
    // an unconfigured business must never mask a suppressed number.
    isSuppressed.mockResolvedValue(true)
    await expect(
      sendManualSms({
        phone: "+15551230000", body: "hi", settings: UNCONFIGURED,
        businessId: BIZ, appendOptOut: false,
      }),
    ).rejects.toThrow(SmsSuppressedError)
  })
})

describe("sendManualSms — configuration", () => {
  it("THROWS on an unconfigured business rather than returning a success shape", async () => {
    await expect(
      sendManualSms({
        phone: "+15551230000", body: "hi", settings: UNCONFIGURED,
        businessId: BIZ, appendOptOut: false,
      }),
    ).rejects.toThrow(SmsNotConfiguredError)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe("sendManualSms — the send", () => {
  it("sends with MessagingServiceSid, never From", async () => {
    await sendManualSms({
      phone: "+15551230000", body: "hi", settings: CONFIGURED,
      businessId: BIZ, appendOptOut: false,
    })
    const body = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    expect(body).toContain("MessagingServiceSid=MGtest")
    expect(body).not.toContain("From=")
  })

  it("records the message with the provider sid and the sender", async () => {
    const out = await sendManualSms({
      phone: "+15551230000", body: "hi", settings: CONFIGURED, businessId: BIZ,
      contactId: "c1", sentBy: "u1", appendOptOut: false,
    })

    expect(out).toMatchObject({ messageId: "m1", providerMessageId: "SM123", text: "hi" })
    expect(insertSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ, contactId: "c1", phone: "+15551230000",
        direction: "outbound", body: "hi", twilioSid: "SM123",
        status: "sent", sentBy: "u1",
      }),
    )
  })

  it("appends the opt-out sentence when told to, and sends THAT text", async () => {
    const out = await sendManualSms({
      phone: "+15551230000", body: "hi", settings: CONFIGURED,
      businessId: BIZ, appendOptOut: true,
    })
    expect(out.text).toContain("Reply STOP to opt out")
    const body = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    expect(decodeURIComponent(body)).toContain("Reply STOP to opt out")
  })

  it("records a failed row rather than swallowing a provider error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ code: 21610, message: "blocked" }),
    }) as unknown as typeof fetch

    await expect(
      sendManualSms({
        phone: "+15551230000", body: "hi", settings: CONFIGURED,
        businessId: BIZ, appendOptOut: false,
      }),
    ).rejects.toThrow(/blocked/)

    expect(insertSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", errorCode: "21610" }),
    )
  })
})

describe("sendManualSms — segment length", () => {
  it("refuses a message over 10 segments", async () => {
    await expect(
      sendManualSms({
        phone: "+15551230000", body: "a".repeat(1600), settings: CONFIGURED,
        businessId: BIZ, appendOptOut: false,
      }),
    ).rejects.toThrow(/segment/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run __tests__/lib/lead-engine/send-manual-sms.test.ts
```
Expected: FAIL — `sendManualSms is not a function`.

- [ ] **Step 3: Implement — append to `lib/lead-engine/sms.ts`**

Add the imports at the top of the file (`isSuppressed` from `@/lib/db/contact-consents`, `insertSmsMessage` from `@/lib/db/sms-messages`).

```ts
/**
 * Thrown when the destination number has sent STOP. Spec §3.3: this one is
 * not a preference. Carries the phone so a caller can name it.
 */
export class SmsSuppressedError extends Error {
  readonly phone: string
  constructor(phone: string) {
    super(`cannot send: ${phone} has opted out`)
    this.name = "SmsSuppressedError"
    this.phone = phone
  }
}

/** A manual message longer than this is refused rather than silently billed. */
const MANUAL_SMS_MAX_SEGMENTS = 10

/**
 * Sends one manually typed message and records it.
 *
 * THREE CHECKS, failing on the first: suppression -> configuration ->
 * segment length. Suppression is first deliberately: it is the check with
 * legal consequences, and ordering configuration ahead of it would let an
 * unconfigured business mask a suppressed number behind a different error.
 *
 * Quiet hours are NOT checked here (spec §3.1). A human replying inside a
 * live conversation is a different act from bulk marketing at 2am; the
 * compose box warns and requires a second click, and `quietHoursDefer` on
 * the sequence path is untouched.
 *
 * THIS FUNCTION THROWS. It never returns `{ ok: true }` on a send that did
 * not happen — lib/email.ts's success-shape-when-unconfigured is exactly the
 * pattern this must not repeat. A failed provider call still writes a
 * `failed` row before rethrowing, so the conversation shows what happened.
 */
export async function sendManualSms(args: {
  phone: string
  body: string
  settings: BusinessSettings
  businessId: string
  contactId?: string | null
  sentBy?: string | null
  appendOptOut: boolean
  statusCallbackUrl?: string
}): Promise<{ messageId: string; providerMessageId: string | null; text: string }> {
  const { phone, businessId } = args

  // 1. Suppression.
  if (await isSuppressed(phone, businessId)) {
    throw new SmsSuppressedError(phone)
  }

  // 2. Configuration. Throws SmsNotConfiguredError.
  assertSmsSendable(args.settings)

  // 3. Segment length.
  const { text } = renderManualSms({ body: args.body, appendOptOut: args.appendOptOut })
  const counted = countSmsSegments(text)
  if (counted.segments > MANUAL_SMS_MAX_SEGMENTS) {
    throw new Error(
      `message is ${counted.segments} segments (max ${MANUAL_SMS_MAX_SEGMENTS}); shorten it`,
    )
  }

  let providerMessageId: string | null = null
  try {
    ;({ providerMessageId } = await sendRenderedSequenceSms({
      to: phone,
      text,
      settings: args.settings,
      statusCallbackUrl: args.statusCallbackUrl,
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Record the attempt before rethrowing: the conversation has to show a
    // failed message, not a gap.
    const codeMatch = message.match(/\[(\d+)\]/)
    await insertSmsMessage({
      businessId,
      contactId: args.contactId ?? null,
      phone,
      direction: "outbound",
      body: text,
      status: "failed",
      errorCode: codeMatch ? codeMatch[1] : null,
      sentBy: args.sentBy ?? null,
    })
    throw err
  }

  const { id } = await insertSmsMessage({
    businessId,
    contactId: args.contactId ?? null,
    phone,
    direction: "outbound",
    body: text,
    twilioSid: providerMessageId,
    status: "sent",
    sentBy: args.sentBy ?? null,
  })

  return { messageId: id, providerMessageId, text }
}
```

- [ ] **Step 4: Run to verify it passes**

```
npx vitest run __tests__/lib/lead-engine/send-manual-sms.test.ts
```
Expected: PASS.

- [ ] **Step 5: MUTATE the suppression check specifically**

This is required, not optional — and it is a **source-only** mutation with `fetch` mocked, so nothing is transmitted. Do **not** run any mutation against a live dev server.

Apply each mutation, run the suite, confirm it FAILS, revert:

1. Delete the `if (await isSuppressed(...)) throw` block entirely → "REFUSES a suppressed number" must fail.
2. Invert it to `if (!(await isSuppressed(...)))` → must fail.
3. Move the suppression check to *after* `assertSmsSendable` → "checks suppression BEFORE configuration" must fail.
4. Change `isSuppressed(phone, businessId)` to `isSuppressed(phone, "other-business")` → "checks suppression against the normalised phone and this tenant" must fail.

Record the four results. A mutation that SURVIVES means the test pins nothing — fix the test before continuing.

- [ ] **Step 6: Commit**

```bash
git add lib/lead-engine/sms.ts __tests__/lib/lead-engine/send-manual-sms.test.ts
git commit -m "feat(sms): add sendManualSms with the three-check order

Suppression, then configuration, then segment length, failing on the first.
Suppression is first on purpose: it is the check with legal consequences,
and an unconfigured business must never mask a suppressed number behind a
different error.

Throws on every refusal. A send that did not happen must not return a
success shape, and a failed provider call still records a failed row so the
conversation shows what happened instead of a gap."
```

---

## Task 5: `POST /api/admin/sms/send`

**Files:**
- Create: `app/api/admin/sms/send/route.ts`
- Modify: `lib/audit/actions.ts`
- Modify: `lib/permissions/registry.ts`
- Create: `__tests__/app/api/admin/sms-send-route.test.ts`

**Interfaces:**
- Consumes: `sendManualSms`, `SmsSuppressedError`, `SmsNotConfiguredError`, `resolveAdminTenantForRequest`, `withAudit`.
- Produces: `POST /api/admin/sms/send` accepting `{ phone: string; body: string; contactId?: string; confirmQuietHours?: boolean }`.

**Status codes:** `200` sent · `409` suppressed (distinct, per §3.3) · `503` unconfigured · `400` invalid body / too long · `403` not permitted.

- [ ] **Step 1: Add the two audit slugs**

In `lib/audit/actions.ts`, in the marketing block:

```ts
  { slug: "sms.sent_manual", category: "marketing", description: "Admin sent a text to a contact" },
  {
    slug: "sms.send_refused",
    category: "marketing",
    description: "Manual text refused (suppressed or unconfigured)",
  },
```

- [ ] **Step 2: Add the two path prefixes**

In `lib/permissions/registry.ts`, beside the other `contacts` prefixes:

```ts
  // SMS threads are contact history of the same sensitivity as /admin/chat
  // and /admin/sequences, which `contacts` already owns. Deliberately NOT
  // the `messages` key — that is the coach-to-client chat, and granting it
  // must not also grant the ability to text a lead. No new key is minted:
  // hasPermission falls through to the tiered branch on an unknown key and
  // GRANTS, so an unused key is a hazard.
  { prefix: "/admin/sms", permission: "contacts" },
  { prefix: "/api/admin/sms", permission: "contacts" },
```

- [ ] **Step 3: Write the failing route tests**

Test the ROUTE directly, UI out of the picture — two guards mask each other.

```ts
// __tests__/app/api/admin/sms-send-route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const sendManualSms = vi.fn()
const resolveAdminTenantForRequest = vi.fn()
const currentActor = vi.fn()
const canAccessPath = vi.fn()
const getBusinessSettings = vi.fn()
const recentOutboundExists = vi.fn()

vi.mock("@/lib/lead-engine/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lead-engine/sms")>()
  return { ...actual, sendManualSms }
})
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenantForRequest }))
vi.mock("@/lib/permissions/guard", () => ({ currentActor }))
vi.mock("@/lib/permissions/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions/registry")>()
  return { ...actual, canAccessPath }
})
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings }))
vi.mock("@/lib/db/sms-messages", () => ({ recentOutboundExists }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))

import { POST } from "@/app/api/admin/sms/send/route"
import { SmsSuppressedError, SmsNotConfiguredError } from "@/lib/lead-engine/sms"

const BIZ = "11111111-1111-1111-1111-111111111111"

function post(body: unknown) {
  return new Request("https://example.com/api/admin/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  resolveAdminTenantForRequest.mockResolvedValue({ businessId: BIZ, choices: [], isOperator: true })
  currentActor.mockResolvedValue({ id: "u1", role: "admin", permissions: null })
  canAccessPath.mockReturnValue(true)
  getBusinessSettings.mockResolvedValue({ sms_messaging_service_sid: "MGtest" })
  recentOutboundExists.mockResolvedValue(false)
  sendManualSms.mockResolvedValue({ messageId: "m1", providerMessageId: "SM1", text: "hi" })
})

describe("POST /api/admin/sms/send — the suppression guard", () => {
  it("answers 409 and does NOT send when the number is suppressed", async () => {
    sendManualSms.mockRejectedValue(new SmsSuppressedError("+15551230000"))

    const res = await POST(post({ phone: "+15551230000", body: "hi" }))

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.reason).toBe("suppressed")
  })

  it("refuses a suppressed number even with a signed-in admin and a valid body", async () => {
    // The route is the guard. The compose box being disabled proves nothing.
    sendManualSms.mockRejectedValue(new SmsSuppressedError("+15551230000"))
    const res = await POST(post({ phone: "+15551230000", body: "please reply" }))
    expect(res.status).toBe(409)
  })
})

describe("POST /api/admin/sms/send — configuration", () => {
  it("answers 503 rather than a success shape when SMS is unconfigured", async () => {
    sendManualSms.mockRejectedValue(new SmsNotConfiguredError(["sms_messaging_service_sid"]))
    const res = await POST(post({ phone: "+15551230000", body: "hi" }))
    expect(res.status).toBe(503)
    expect((await res.json()).reason).toBe("not_configured")
  })
})

describe("POST /api/admin/sms/send — auth", () => {
  it("answers 403 when the actor cannot reach this path", async () => {
    canAccessPath.mockReturnValue(false)
    const res = await POST(post({ phone: "+15551230000", body: "hi" }))
    expect(res.status).toBe(403)
    expect(sendManualSms).not.toHaveBeenCalled()
  })

  it("answers 403 when there is no actor at all", async () => {
    currentActor.mockResolvedValue(null)
    const res = await POST(post({ phone: "+15551230000", body: "hi" }))
    expect(res.status).toBe(403)
    expect(sendManualSms).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/sms/send — validation", () => {
  it("rejects an empty body", async () => {
    const res = await POST(post({ phone: "+15551230000", body: "   " }))
    expect(res.status).toBe(400)
    expect(sendManualSms).not.toHaveBeenCalled()
  })

  it("rejects a phone that is not E.164", async () => {
    const res = await POST(post({ phone: "not-a-phone", body: "hi" }))
    expect(res.status).toBe(400)
    expect(sendManualSms).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/sms/send — the opt-out rule", () => {
  it("appends the opt-out sentence on the first outbound in 30 days", async () => {
    recentOutboundExists.mockResolvedValue(false)
    await POST(post({ phone: "+15551230000", body: "hi" }))
    expect(sendManualSms).toHaveBeenCalledWith(expect.objectContaining({ appendOptOut: true }))
  })

  it("omits it when this business already texted them inside 30 days", async () => {
    recentOutboundExists.mockResolvedValue(true)
    await POST(post({ phone: "+15551230000", body: "hi" }))
    expect(sendManualSms).toHaveBeenCalledWith(expect.objectContaining({ appendOptOut: false }))
  })
})

describe("POST /api/admin/sms/send — the happy path", () => {
  it("sends and reports the provider id", async () => {
    const res = await POST(post({ phone: "+15551230000", body: "hi", contactId: "c1" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: "m1", providerMessageId: "SM1" })
    expect(sendManualSms).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+15551230000", businessId: BIZ, contactId: "c1", sentBy: "u1" }),
    )
  })
})
```

- [ ] **Step 4: Add `recentOutboundExists` to the DAL**

In `lib/db/sms-messages.ts`:

```ts
/**
 * Has this business sent this number an outbound text inside the window?
 *
 * Spec §3.2's rolling-30-day rule. `queued`/`failed` rows count: the
 * question is "have we already shown them the opt-out sentence recently",
 * and a message that reached the carrier showed it whether or not it was
 * ultimately delivered.
 */
export async function recentOutboundExists(
  phone: string,
  businessId: string,
  withinDays = 30,
): Promise<boolean> {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await getClient()
    .from("sms_messages")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .eq("direction", "outbound")
    .gte("occurred_at", since)
    .limit(1)
  if (error) throw new Error(`recentOutboundExists failed (${error.code}): ${error.message}`)
  return (data ?? []).length > 0
}
```

- [ ] **Step 5: Implement the route**

```ts
// app/api/admin/sms/send/route.ts — the manual send.
//
// THIS ROUTE IS THE GUARD. The compose box is disabled for a suppressed
// number too, but a guard on the client path is not a guard: if the claim is
// "no surface can text a suppressed number", this is what has to enforce it.
// Its suppression test runs with the UI out of the picture for exactly that
// reason.

import { NextResponse } from "next/server"
import { z } from "zod"
import { withAudit } from "@/lib/audit/with-audit"
import { currentActor } from "@/lib/permissions/guard"
import { canAccessPath } from "@/lib/permissions/registry"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getBusinessSettings } from "@/lib/db/businesses"
import { recentOutboundExists } from "@/lib/db/sms-messages"
import { sendManualSms, SmsSuppressedError, SmsNotConfiguredError } from "@/lib/lead-engine/sms"
import { appOrigin } from "@/lib/lead-engine/origin"

const sendSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "phone must be E.164"),
  body: z.string().trim().min(1, "message is empty").max(1600),
  contactId: z.string().uuid().optional(),
  // Spec §3.1: quiet hours WARN, they do not block. The client sets this
  // after the second click; the route records it but never refuses on it.
  confirmQuietHours: z.boolean().optional(),
})

export const POST = withAudit(
  {
    action: "sms.sent_manual",
    category: "marketing",
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { target_id: id } : {}
    },
  },
  async (request: Request) => {
    const actor = await currentActor()
    if (!actor || !canAccessPath(actor, "/api/admin/sms/send", "POST")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { businessId } = await resolveAdminTenantForRequest(request)

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = sendSchema.safeParse(payload)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { phone, body, contactId } = parsed.data
    const settings = await getBusinessSettings(businessId)

    // Spec §3.2: the opt-out sentence goes on the first outbound to this
    // number in a rolling 30 days, not on every reply.
    const appendOptOut = !(await recentOutboundExists(phone, businessId))

    try {
      const result = await sendManualSms({
        phone,
        body,
        settings,
        businessId,
        contactId: contactId ?? null,
        sentBy: actor.id,
        appendOptOut,
        statusCallbackUrl: `${appOrigin()}/api/webhooks/twilio/status`,
      })

      const res = NextResponse.json({
        id: result.messageId,
        providerMessageId: result.providerMessageId,
        text: result.text,
      })
      res.headers.set("x-audit-target-id", result.messageId)
      return res
    } catch (err) {
      if (err instanceof SmsSuppressedError) {
        return NextResponse.json(
          {
            error: "This number has opted out of texts. You cannot message them.",
            reason: "suppressed",
          },
          { status: 409 },
        )
      }
      if (err instanceof SmsNotConfiguredError) {
        return NextResponse.json(
          {
            error: "Texting is not set up for this business yet.",
            reason: "not_configured",
          },
          { status: 503 },
        )
      }
      const message = err instanceof Error ? err.message : "Send failed"
      return NextResponse.json({ error: message, reason: "send_failed" }, { status: 502 })
    }
  },
)
```

- [ ] **Step 6: Run the tests**

```
npx vitest run __tests__/app/api/admin/sms-send-route.test.ts
```
Expected: PASS. If it reports "no tests", the `@vitest-environment node` pragma is missing — route suites need it here.

- [ ] **Step 7: Run the audit + permission guard suites**

```
npx vitest run __tests__/lib/audit __tests__/lib/permissions __tests__/lib/tenancy/platform-inventory.test.ts
```
Expected: PASS. These pin the action taxonomy and the path map.

- [ ] **Step 8: Commit**

```bash
git add app/api/admin/sms/send/route.ts lib/audit/actions.ts lib/permissions/registry.ts lib/db/sms-messages.ts __tests__/app/api/admin/sms-send-route.test.ts
git commit -m "feat(sms): add POST /api/admin/sms/send

The route is the guard. A suppressed number is refused here with a distinct
409, tested with the UI out of the picture — if the claim is that no surface
can text a suppressed number, the button being disabled proves nothing.

Paths map to the contacts permission, not messages: that key is the
coach-to-client chat, and granting it must not also grant texting a lead."
```

---

## Task 6: The inbound webhook writes `sms_messages`

**Files:**
- Modify: `app/api/webhooks/twilio/inbound/route.ts`
- Modify: `__tests__/api/webhooks/twilio-inbound.test.ts`

**Interfaces:**
- Consumes: `insertSmsMessage` from `lib/db/sms-messages`.

**The write goes OUTSIDE the `if (contactId)` gate** (spec §8.4). Every timeline write there is gated because `contact_timeline_events.contact_id` is NOT NULL; `sms_messages.contact_id` is nullable by design, and a text from an unknown number must still form a thread.

- [ ] **Step 1: Write the failing tests**

Add to the existing suite — **retarget, do not replace**. Keep every existing assertion, especially the empty-TwiML one.

```ts
describe("inbound webhook — the conversation record", () => {
  it("writes an sms_messages row for a matched contact", async () => {
    // ...existing harness setup for a matched contact, body "hey coach"...
    const res = await POST(signedRequest({ From: "+15551230000", To: TO, Body: "hey coach" }))

    expect(res.status).toBe(200)
    expect(insertSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+15551230000", direction: "inbound", body: "hey coach",
        contactId: expect.any(String), status: "received",
      }),
    )
  })

  it("STILL writes one when NO contact matches", async () => {
    // The whole point of keying the thread on the phone number. The timeline
    // row cannot exist here (contact_id is NOT NULL); this one must.
    findContactByIdentifiers.mockResolvedValue(null)

    const res = await POST(signedRequest({ From: "+15559999999", To: TO, Body: "who is this" }))

    expect(res.status).toBe(200)
    expect(insertSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+15559999999", contactId: null, direction: "inbound" }),
    )
  })

  it("stores the FULL body, not the 500-char timeline cap", async () => {
    const long = "x".repeat(900)
    await POST(signedRequest({ From: "+15551230000", To: TO, Body: long }))

    const call = insertSmsMessage.mock.calls.at(-1)![0]
    expect(call.body).toHaveLength(900)
  })

  it("answers empty TwiML, not JSON — assert the BODY", async () => {
    const res = await POST(signedRequest({ From: "+15551230000", To: TO, Body: "hi" }))
    expect(res.headers.get("Content-Type")).toContain("text/xml")
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  })

  it("still answers 200 and empty TwiML when the conversation write fails", async () => {
    // The compliance writes above it must not be undone by the conversation
    // view failing, and Twilio must not be handed a retry it cannot fix.
    insertSmsMessage.mockRejectedValue(new Error("table gone"))

    const res = await POST(signedRequest({ From: "+15551230000", To: TO, Body: "hi" }))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain("<Response></Response>")
  })

  it("does NOT write a conversation row for a STOP keyword", async () => {
    // STOP is a command, not conversation. It has its own compliance record.
    await POST(signedRequest({ From: "+15551230000", To: TO, Body: "STOP" }))
    expect(insertSmsMessage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

```
npx vitest run __tests__/api/webhooks/twilio-inbound.test.ts
```
Expected: the new tests FAIL; every pre-existing test still PASSES.

- [ ] **Step 3: Implement**

Add the import, then in the anything-else branch — **before** the `if (contactId)` block:

```ts
    // The conversation's record. OUTSIDE the matched-contact gate on
    // purpose: the timeline writes above are all gated because
    // contact_timeline_events.contact_id is NOT NULL, but sms_messages is
    // keyed on the PHONE and its contact link is nullable — a text from a
    // number nobody has on file still has to form a thread, which is
    // exactly the case the old design lost.
    //
    // Its own try/catch, and it is the LAST write: a failure here must not
    // roll back the compliance writes above it, and must not turn a handled
    // message into a 500 Twilio will retry forever.
    try {
      await insertSmsMessage({
        businessId,
        contactId,
        phone: identifier,
        direction: "inbound",
        body: rawBody,
        status: "received",
      })
    } catch (err) {
      console.error("[twilio-inbound-webhook] sms_messages insert failed:", err)
    }

    if (contactId) {
      // ...existing timeline write and ops-alert email, unchanged...
    }
```

Note `body: rawBody` — the **full** body, not `capBody(rawBody)`. The 500-char cap is a timeline-metadata scrub; the conversation needs the whole message.

- [ ] **Step 4: Run the suite**

```
npx vitest run __tests__/api/webhooks/twilio-inbound.test.ts
```
Expected: PASS — all pre-existing tests plus the six new ones.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/twilio/inbound/route.ts __tests__/api/webhooks/twilio-inbound.test.ts
git commit -m "feat(sms): inbound webhook writes the conversation record

The insert sits outside the matched-contact gate. Every timeline write there
is gated because contact_timeline_events.contact_id is NOT NULL, but this
table is keyed on the phone number and its contact link is nullable — a text
from someone not on file still has to form a thread.

It stores the full body rather than the timeline's 500-char scrub, and logs
rather than throwing: a conversation-view failure must not roll back the
compliance writes above it or hand Twilio a retry it cannot fix."
```

---

## Task 7: The status callback updates `sms_messages`

**Files:**
- Modify: `app/api/webhooks/twilio/status/route.ts`
- Modify: `__tests__/api/webhooks/twilio-status.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("status webhook — sms_messages", () => {
  it("updates the conversation row by twilio_sid", async () => {
    const res = await POST(signedRequest({ MessageSid: "SM1", MessageStatus: "delivered" }))
    expect(res.status).toBe(200)
    expect(updateSmsStatusBySid).toHaveBeenCalledWith("SM1", "delivered", null)
  })

  it("passes the carrier error code through when one is present", async () => {
    await POST(signedRequest({ MessageSid: "SM1", MessageStatus: "failed", ErrorCode: "30006" }))
    expect(updateSmsStatusBySid).toHaveBeenCalledWith("SM1", "failed", "30006")
  })

  it("still answers 200 and empty TwiML when only the sequence row matched", async () => {
    updateSmsStatusBySid.mockResolvedValue("unknown_message")
    const res = await POST(signedRequest({ MessageSid: "SM1", MessageStatus: "delivered" }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("<Response></Response>")
  })

  it("does not 500 the webhook when the conversation update throws", async () => {
    updateSmsStatusBySid.mockRejectedValue(new Error("boom"))
    const res = await POST(signedRequest({ MessageSid: "SM1", MessageStatus: "delivered" }))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run __tests__/api/webhooks/twilio-status.test.ts
```

- [ ] **Step 3: Implement**

In `app/api/webhooks/twilio/status/route.ts`, after `applyDeliveryStatus`:

```ts
  // The same callback updates the conversation's row. Its own try/catch and
  // NOT part of `outcome`: `applyDeliveryStatus` owns the sequence record and
  // its outcome string, and a conversation-view write must not be able to
  // turn a delivered receipt into a 500 Twilio retries.
  //
  // Twilio's status is passed through verbatim rather than mapped. The
  // sequence path maps to a four-value space because it drives the engine;
  // the conversation just displays what the carrier said.
  try {
    await updateSmsStatusBySid(
      params.MessageSid ?? "",
      params.MessageStatus ?? "",
      params.ErrorCode ?? null,
    )
  } catch (err) {
    console.error("[twilio-status-webhook] sms_messages update failed:", err)
  }
```

- [ ] **Step 4: Run to verify it passes**

```
npx vitest run __tests__/api/webhooks/twilio-status.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/twilio/status/route.ts __tests__/api/webhooks/twilio-status.test.ts
git commit -m "feat(sms): status callback updates the conversation row

Passes Twilio's status through verbatim — the sequence path maps to four
values because it drives the engine, but the conversation just shows what
the carrier said. Logs rather than throwing so a display write cannot turn a
delivery receipt into a 500 Twilio retries forever."
```

---

## Task 8: Sequence sends mirror into `sms_messages`

**Files:**
- Modify: `lib/automation/sequence-tick-runner.ts`
- Modify: `__tests__/lib/automation/sequence-tick-sms.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("sequence SMS — the conversation record", () => {
  it("writes an sms_messages row linked to the sequence message", async () => {
    await runTick()
    expect(insertSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "outbound",
        sequenceMessageId: expect.any(String),
        twilioSid: "SM123",
        status: "sent",
        sentBy: null,
      }),
    )
  })

  it("records the rendered text including the opt-out sentence", async () => {
    // Sequence sends keep appending it every time — §3.2 changes manual
    // sends only.
    await runTick()
    const call = insertSmsMessage.mock.calls.at(-1)![0]
    expect(call.body).toContain("Reply STOP to opt out")
  })

  it("does not fail the send when the conversation write throws", async () => {
    insertSmsMessage.mockRejectedValue(new Error("boom"))
    const summary = await runTick()
    // markSent already ran. Losing the mirror must not turn a delivered
    // message into a failed run.
    expect(summary.failed).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```
npx vitest run __tests__/lib/automation/sequence-tick-sms.test.ts
```

- [ ] **Step 3: Implement**

In `lib/automation/sequence-tick-runner.ts`, immediately after `await markSent(messageId as string, "twilio", providerMessageId)` on the SMS path:

```ts
        // Mirror into the conversation. `sequence_messages` stays the
        // engine's record — this one is the person's, and the link keeps
        // them from disagreeing about a single send. Never fatal: the
        // message has already gone and markSent has already run, so losing
        // the mirror must not turn a delivered text into a failed run.
        try {
          await insertSmsMessage({
            businessId,
            contactId: run.contact_id,
            phone: to,
            direction: "outbound",
            body: rendered.text,
            twilioSid: providerMessageId,
            status: "sent",
            sequenceMessageId: messageId as string,
          })
        } catch (err) {
          console.error("[sequence-tick] sms_messages mirror failed:", err)
        }
```

- [ ] **Step 4: Run to verify it passes**

```
npx vitest run __tests__/lib/automation/sequence-tick-sms.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/automation/sequence-tick-runner.ts __tests__/lib/automation/sequence-tick-sms.test.ts
git commit -m "feat(sms): sequence sends mirror into the conversation

Linked by sequence_message_id so the engine's record and the person's record
cannot disagree about one send. Never fatal — the text has already gone and
markSent has already run, so losing the mirror must not fail the run."
```

---

## Task 9: `/admin/sms` — the thread list

**Files:**
- Create: `app/(admin)/admin/sms/page.tsx`
- Create: `__tests__/app/admin-sms-list.test.tsx`

Use the house `DataTable`. `DataTableEmpty` renders its **own `<tr>`** — do not wrap it in `DataTableRow`, and `DataTable` emits no `<tbody>`, so supply one.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/app/admin-sms-list.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SmsThreadList } from "@/components/admin/sms/SmsThreadList"

const THREADS = [
  {
    phone: "+15551230000", contactId: "c1", contactName: "Jane Doe",
    lastBody: "See you Tuesday", lastDirection: "inbound" as const,
    lastOccurredAt: "2026-09-11T18:04:00Z", lastStatus: "received",
    inboundCount: 2, messageCount: 5,
  },
]

describe("SmsThreadList", () => {
  it("shows one row per phone with the contact's name and last message", () => {
    render(<SmsThreadList threads={THREADS} />)
    expect(screen.getByText("Jane Doe")).toBeInTheDocument()
    expect(screen.getByText("See you Tuesday")).toBeInTheDocument()
  })

  it("falls back to the number when nobody matches", () => {
    render(<SmsThreadList threads={[{ ...THREADS[0], contactId: null, contactName: null }]} />)
    expect(screen.getByText("+15551230000")).toBeInTheDocument()
  })

  it("renders an empty state with no threads", () => {
    render(<SmsThreadList threads={[]} />)
    expect(screen.getByText(/no text conversations yet/i)).toBeInTheDocument()
  })

  it("renders the empty state inside a valid table body", () => {
    // DataTableEmpty renders its own <tr>; wrapping it makes colSpan span
    // nothing. A stray <tr> inside <table> is what that looks like.
    const { container } = render(<SmsThreadList threads={[]} />)
    expect(container.querySelectorAll("tbody > tr")).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**, then implement `components/admin/sms/SmsThreadList.tsx` and the page.

The page:

```tsx
// app/(admin)/admin/sms/page.tsx — every text conversation.
//
// NOT /admin/messages: that is the coach-to-client in-app chat, it is owned
// by the `messages` permission, and notification emails deep-link into it.
// Merging the two is the unified inbox, which the quotation puts in the NEXT
// phase.
//
// Admin UI is light-only.

import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { listSmsThreads } from "@/lib/db/sms-messages"
import { SmsThreadList } from "@/components/admin/sms/SmsThreadList"

export const metadata = { title: "Texts" }
export const dynamic = "force-dynamic"

export default async function AdminSmsPage() {
  await requirePermission("contacts")
  const { businessId } = await resolveAdminTenant()

  // Not wrapped in try/catch, deliberately: a failed read must not render as
  // "no conversations". null and [] are different answers.
  const threads = await listSmsThreads(businessId)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Texts</h1>
        <p className="text-sm text-muted-foreground">
          Every text conversation with a lead or client, newest first.
        </p>
      </div>
      <SmsThreadList threads={threads} />
    </div>
  )
}
```

- [ ] **Step 3: Run the test.** Expected: PASS.
- [ ] **Step 4: Commit.**

---

## Task 10: `/admin/sms/[phone]` — conversation + compose

**Files:**
- Create: `app/(admin)/admin/sms/[phone]/page.tsx`
- Create: `components/admin/sms/SmsThread.tsx`
- Create: `components/admin/sms/SmsComposer.tsx`
- Create: `__tests__/components/admin/sms-composer.test.tsx`

The conversation is **not** a table — alternating bubbles, newest at the bottom, inbound left / outbound right, each outbound showing its delivery state.

The phone number is URL-encoded (`+` must be `%2B`). Decode with `decodeURIComponent` and re-normalise before querying.

- [ ] **Step 1: Write the failing composer tests**

```tsx
// __tests__/components/admin/sms-composer.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SmsComposer } from "@/components/admin/sms/SmsComposer"

const base = {
  phone: "+15551230000", contactId: "c1", suppressed: false,
  contactLocalHour: 14, contactTimezone: "America/New_York",
}

describe("SmsComposer — the segment counter", () => {
  it("counts a plain message as one segment", async () => {
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "Hey Jane")
    expect(screen.getByText(/8 characters · 1 segment/i)).toBeInTheDocument()
  })

  it("warns that one emoji halves the room", async () => {
    render(<SmsComposer {...base} />)
    await userEvent.type(screen.getByRole("textbox"), "Hi \u{1F44B}")
    expect(screen.getByText(/UCS-2/i)).toBeInTheDocument()
  })
})

describe("SmsComposer — suppression", () => {
  it("disables the box and says why", () => {
    render(<SmsComposer {...base} suppressed />)
    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(screen.getByText(/opted out/i)).toBeInTheDocument()
  })

  it("disables Send too", () => {
    render(<SmsComposer {...base} suppressed />)
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled()
  })
})

describe("SmsComposer — quiet hours warn, never block", () => {
  it("asks for a second click at 11:40pm but still allows the send", async () => {
    const onSend = vi.fn()
    render(<SmsComposer {...base} contactLocalHour={23} onSend={onSend} />)

    await userEvent.type(screen.getByRole("textbox"), "you up?")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    // First click warns and does NOT send.
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(/send anyway/i)).toBeInTheDocument()

    // Second click sends. Warn, do not block (§3.1).
    await userEvent.click(screen.getByRole("button", { name: /send anyway/i }))
    expect(onSend).toHaveBeenCalledOnce()
  })

  it("sends on the first click during the day", async () => {
    const onSend = vi.fn()
    render(<SmsComposer {...base} contactLocalHour={14} onSend={onSend} />)
    await userEvent.type(screen.getByRole("textbox"), "hello")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(onSend).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run to verify it fails**, then implement both components and the page.
- [ ] **Step 3: Run the tests.** Expected: PASS.
- [ ] **Step 4: Commit.**

---

## Task 11: Link from the contact detail page

**Files:**
- Modify: `components/admin/contacts/ContactDetail.tsx`
- Modify: the matching test

- [ ] **Step 1:** Add a "Text" action beside the existing contact actions, linking to `/admin/sms/${encodeURIComponent(phone)}`. Render it **only** when the contact has a `phone_e164`; a link to a thread for a contact with no number is a dead end.
- [ ] **Step 2:** Test that the link is absent with no phone and present with one — an absence assertion needs a presence control.
- [ ] **Step 3:** Run, commit.

---

## Task 12: Gates, screenshots and the journal

- [ ] **Step 1: tsc**

```
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Diff the per-file error **set** against `scratchpad/tsc-baseline.txt`. New files must contribute **zero** errors.

- [ ] **Step 2: Targeted suites, all of them, one run**

```
npx vitest run __tests__/lib/db/sms-messages.test.ts \
  __tests__/lib/db/sms-messages-schema.test.ts \
  __tests__/lib/lead-engine/sms-manual-render.test.ts \
  __tests__/lib/lead-engine/send-manual-sms.test.ts \
  __tests__/lib/lead-engine/sms.test.ts \
  __tests__/lib/lead-engine/no-brand-literals.test.ts \
  __tests__/app/api/admin/sms-send-route.test.ts \
  __tests__/api/webhooks/twilio-inbound.test.ts \
  __tests__/api/webhooks/twilio-status.test.ts \
  __tests__/lib/automation/sequence-tick-sms.test.ts \
  __tests__/app/admin-sms-list.test.tsx \
  __tests__/components/admin/sms-composer.test.tsx \
  __tests__/lib/tenancy/platform-inventory.test.ts
```

- [ ] **Step 3: Seed the dev clone with a realistic conversation**

Write `scripts/seed-sms-thread-dev.mjs` pointed at **`.env.local` (the dev clone) only**. It must refuse to run against `.env.prod`. Seed one thread of ~6 messages both directions with a `delivered` and a `failed`, plus one suppressed contact for the refusal shot. Never a real phone number — use `+1555…`.

- [ ] **Step 4: Screenshots**

Drive the REAL admin at the REAL routes with Playwright. Not a harness, not a preview page. `screenshots/two-way-sms/`:

1. `01-thread-list.png` — `/admin/sms` with real rows
2. `02-conversation.png` — `/admin/sms/%2B1555…` both directions with a delivery state
3. `03-compose-segments.png` — the compose box with the segment counter live
4. `04-suppressed-refusal.png` — the disabled box with the reason
5. `05-quiet-hours-warning.png` — the second-click confirm

Annotations burned INTO the PNGs, composed at the capture's exact pixel width. Park the pointer before capturing. **Light only — the admin is light-only, say so in the report.**

- [ ] **Step 5: Whole-branch review** — `superpowers:requesting-code-review` across the full diff. Task reviews cannot see the gaps between briefs.

- [ ] **Step 6: Journal**

Append a dated entry to `JOURNAL.md`, newest first, tagged `[Feature build-out]`, with mistakes + lessons. **Never stage it.**

---

## Self-Review

**Spec coverage:** §3.1 → Task 10; §3.2 → Tasks 3, 5; §3.3 → Tasks 4, 5, 10; §4.1 → Task 1; §4.2 → dropped per §8.2; §4.3 → Tasks 2, 4, 5; §4.4 → Task 6; §4.5 → Tasks 9, 10 + Task 7 for delivery state; §4.6 → no-op per §8.1; §6 tasks 1, 3, 11 → done/dropped/no-op; task 12 (real handset) → the owner's, out of my scope; task 13 → Task 12 step 4.

**Type consistency:** `insertSmsMessage` takes camelCase args and writes snake_case columns throughout. `SmsThreadSummary` is produced by Task 2 and consumed by Task 9. `updateSmsStatusBySid` returns the same `"updated" | "unknown_message"` space as `applyDeliveryStatus`. `sendManualSms` returns `{ messageId, providerMessageId, text }`, consumed by Task 5.

**Known gap, deliberate:** `recentOutboundExists` is added in Task 5 rather than Task 2 because that is where its requirement appears.

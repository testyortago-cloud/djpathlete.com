# Form Review Voice Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a record/send/play voice-message capability inside form-review threads, for both coach (admin) and client.

**Architecture:** New `form_review_message_attachments` table (1:many on `form_review_messages`, kind-discriminated, audio for now). Audio blobs are recorded in-browser via `MediaRecorder`, uploaded directly to Firebase Storage at `form-review-audio/{userId}/{ts}.{ext}` (mirrors existing video-upload pattern), then a row insert lands in Postgres via a discriminated-union API. Server-side `getSignedVideoUrl` (already exists, generic over path) produces 1 h playback URLs at page render time.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + RLS, Firebase Storage + firebase-admin signing, `MediaRecorder` Web API, Zod discriminated unions, Vitest + Playwright.

**Spec:** [docs/superpowers/specs/2026-05-19-form-review-voice-feedback-design.md](../specs/2026-05-19-form-review-voice-feedback-design.md)

---

## File Map

**New files:**

| File | Responsibility |
|---|---|
| `supabase/migrations/00156_form_review_message_attachments.sql` | Schema, RLS, Postgres RPC for atomic message+attachment insert |
| `lib/validators/form-review-message.ts` | Zod discriminated-union request schema |
| `components/shared/VoiceRecorder.tsx` | Self-contained mic button + state machine + upload |
| `__tests__/lib/validators/form-review-message.test.ts` | Validator unit tests |
| `__tests__/lib/db/form-reviews-audio.test.ts` | DAL audio path tests |
| `__tests__/components/VoiceRecorder.test.tsx` | Component state-machine tests |
| `__tests__/e2e/form-review-voice.spec.ts` | Playwright happy-path |

**Modified files:**

| File | What changes |
|---|---|
| `types/database.ts` | Add `FormReviewMessageAttachment`, attachments array on `FormReviewMessage`, nullable `message` |
| `lib/db/form-reviews.ts` | Extend `getFormReviewMessages` to join attachments + sign URLs; add `createFormReviewMessageWithAudio` |
| `app/api/admin/form-reviews/[id]/messages/route.ts` | Discriminated-union validator, audio branch, path-ownership check, audit log |
| `app/api/client/form-reviews/[id]/messages/route.ts` | Same |
| `components/shared/FormReviewThread.tsx` | Render audio attachments, mount `VoiceRecorder`, audio send flow |
| `storage.rules` | New `form-review-audio` write block |
| `lib/audit/actions.ts` | Add `form_review.message.audio_sent` slug |
| `lib/email.ts` + email template | Audio preview line in feedback email |

---

## Task 1: DB migration — attachments table + RLS + RPC

**Files:**
- Create: `supabase/migrations/00156_form_review_message_attachments.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00156_form_review_message_attachments.sql`:

```sql
-- Form review message attachments: audio (and future media) attached to thread messages
-- ====================================================================================

-- Allow a message row to have null text when it carries only attachments
ALTER TABLE form_review_messages
  ALTER COLUMN message DROP NOT NULL;

CREATE TABLE IF NOT EXISTS form_review_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES form_review_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio')),
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  duration_seconds INT,
  byte_size INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_form_review_attachments_message
  ON form_review_message_attachments(message_id);

-- =====================================================================
-- RLS
-- =====================================================================

ALTER TABLE form_review_message_attachments ENABLE ROW LEVEL SECURITY;

-- Clients can SELECT attachments on messages on their own reviews
CREATE POLICY "Clients can view attachments on own review messages"
  ON form_review_message_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM form_review_messages m
      JOIN form_reviews r ON r.id = m.form_review_id
      WHERE m.id = form_review_message_attachments.message_id
        AND r.client_user_id = auth.uid()
    )
  );

-- Clients can INSERT attachments only on their own message rows on their own reviews
CREATE POLICY "Clients can create attachments on own messages"
  ON form_review_message_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM form_review_messages m
      JOIN form_reviews r ON r.id = m.form_review_id
      WHERE m.id = form_review_message_attachments.message_id
        AND m.user_id = auth.uid()
        AND r.client_user_id = auth.uid()
    )
  );

-- Admins can SELECT and INSERT on all
CREATE POLICY "Admins can view all attachments"
  ON form_review_message_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can create attachments"
  ON form_review_message_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- =====================================================================
-- RPC: atomic insert of message + attachment
-- =====================================================================

CREATE OR REPLACE FUNCTION create_form_review_message_with_attachment(
  p_review_id UUID,
  p_user_id UUID,
  p_kind TEXT,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_duration_seconds INT,
  p_byte_size INT
) RETURNS TABLE (
  message_id UUID,
  attachment_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id UUID;
  v_attachment_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  INSERT INTO form_review_messages (form_review_id, user_id, message)
  VALUES (p_review_id, p_user_id, NULL)
  RETURNING id, created_at INTO v_message_id, v_created_at;

  INSERT INTO form_review_message_attachments
    (message_id, kind, storage_path, mime_type, duration_seconds, byte_size)
  VALUES
    (v_message_id, p_kind, p_storage_path, p_mime_type, p_duration_seconds, p_byte_size)
  RETURNING id INTO v_attachment_id;

  RETURN QUERY SELECT v_message_id, v_attachment_id, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION create_form_review_message_with_attachment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_form_review_message_with_attachment TO service_role;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Per project memory, migrations are applied via `mcp__supabase__apply_migration`, not the CLI.

Invoke `mcp__supabase__apply_migration` with `name="form_review_message_attachments"` and `query=<contents of the .sql file above>`.

Expected: success response, no error.

- [ ] **Step 3: Verify the migration landed**

Invoke `mcp__supabase__list_tables` and confirm `form_review_message_attachments` appears.

Then invoke `mcp__supabase__execute_sql` with:

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'form_review_messages' AND column_name = 'message';
```

Expected: row `message | YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00156_form_review_message_attachments.sql
git commit -m "feat(form-reviews): migration for message attachments + RPC"
```

---

## Task 2: Type definitions

**Files:**
- Modify: `types/database.ts:836-842` (FormReviewMessage interface) and `types/database.ts:1320-1323` (Tables.form_review_messages)

- [ ] **Step 1: Add `FormReviewMessageAttachment` interface**

Open [types/database.ts](../../../types/database.ts). Immediately after the `FormReviewMessage` interface (currently lines 836-842), add:

```ts
export type FormReviewMessageAttachmentKind = "audio"

export interface FormReviewMessageAttachment {
  id: string
  message_id: string
  kind: FormReviewMessageAttachmentKind
  storage_path: string
  mime_type: string
  duration_seconds: number | null
  byte_size: number
  created_at: string
}
```

- [ ] **Step 2: Make `FormReviewMessage.message` nullable, add attachments**

Edit the existing `FormReviewMessage` interface (currently lines 836-842) so that `message` is nullable and an optional attachments field is present:

```ts
export interface FormReviewMessage {
  id: string
  form_review_id: string
  user_id: string
  message: string | null
  created_at: string
  attachments?: FormReviewMessageAttachment[]
}
```

- [ ] **Step 3: Add the table to the Database type map**

Locate the `Tables:` block around line 1320 that registers `form_review_messages`. Immediately after it, add:

```ts
form_review_message_attachments: {
  Row: FormReviewMessageAttachment
  Insert: Omit<FormReviewMessageAttachment, "id" | "created_at">
  Update: Partial<Omit<FormReviewMessageAttachment, "id" | "created_at">>
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (or only pre-existing errors unrelated to form reviews).

- [ ] **Step 5: Commit**

```bash
git add types/database.ts
git commit -m "feat(form-reviews): types for message attachments"
```

---

## Task 3: Zod validator for messages (discriminated union)

**Files:**
- Create: `lib/validators/form-review-message.ts`
- Create: `__tests__/lib/validators/form-review-message.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/validators/form-review-message.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { formReviewMessageSchema } from "@/lib/validators/form-review-message"

describe("formReviewMessageSchema", () => {
  it("accepts a text-only message", () => {
    const r = formReviewMessageSchema.safeParse({ message: "Reset your hips" })
    expect(r.success).toBe(true)
  })

  it("accepts a valid audio-only message", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-review-audio/u-123/1700000000000.webm",
        mime_type: "audio/webm",
        duration_seconds: 14,
        byte_size: 180_000,
      },
    })
    expect(r.success).toBe(true)
  })

  it("rejects empty text", () => {
    expect(formReviewMessageSchema.safeParse({ message: "" }).success).toBe(false)
  })

  it("rejects audio with bad path prefix", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-reviews/u-123/foo.webm",
        mime_type: "audio/webm",
        duration_seconds: 14,
        byte_size: 180_000,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects audio over 120 seconds", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-review-audio/u-123/x.webm",
        mime_type: "audio/webm",
        duration_seconds: 121,
        byte_size: 100,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects audio over 3 MB", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-review-audio/u-123/x.webm",
        mime_type: "audio/webm",
        duration_seconds: 14,
        byte_size: 3 * 1024 * 1024 + 1,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects unsupported mime", () => {
    const r = formReviewMessageSchema.safeParse({
      audio: {
        storage_path: "form-review-audio/u-123/x.pdf",
        mime_type: "application/pdf",
        duration_seconds: 14,
        byte_size: 100,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects payload with both message and audio", () => {
    const r = formReviewMessageSchema.safeParse({
      message: "hi",
      audio: {
        storage_path: "form-review-audio/u-123/x.webm",
        mime_type: "audio/webm",
        duration_seconds: 14,
        byte_size: 100,
      },
    })
    expect(r.success).toBe(false)
  })

  it("rejects empty payload", () => {
    expect(formReviewMessageSchema.safeParse({}).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:run -- form-review-message`
Expected: 9 failing tests (module not found).

- [ ] **Step 3: Implement the validator**

Create `lib/validators/form-review-message.ts`:

```ts
import { z } from "zod"

const AUDIO_MIME_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"] as const

const audioAttachmentSchema = z.object({
  storage_path: z.string().regex(/^form-review-audio\/[^/]+\/[^/]+$/),
  mime_type: z.enum(AUDIO_MIME_TYPES),
  duration_seconds: z.number().int().min(1).max(120),
  byte_size: z.number().int().min(1).max(3 * 1024 * 1024),
})

// Strict objects so { message, audio } together is rejected.
const textOnly = z.object({ message: z.string().min(1).max(5000) }).strict()
const audioOnly = z.object({ audio: audioAttachmentSchema }).strict()

export const formReviewMessageSchema = z.union([textOnly, audioOnly])

export type FormReviewMessageInput = z.infer<typeof formReviewMessageSchema>
export type FormReviewAudioInput = z.infer<typeof audioAttachmentSchema>
```

- [ ] **Step 4: Run tests, confirm green**

Run: `npm run test:run -- form-review-message`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/form-review-message.ts __tests__/lib/validators/form-review-message.test.ts
git commit -m "feat(form-reviews): validator for text/audio message union"
```

---

## Task 4: DAL — `createFormReviewMessageWithAudio` + attachment join in reads

**Files:**
- Modify: `lib/db/form-reviews.ts` (extend `getFormReviewMessages` and `createFormReviewMessage`, add `createFormReviewMessageWithAudio`)
- Create: `__tests__/lib/db/form-reviews-audio.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/db/form-reviews-audio.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const rpcMock = vi.fn()
const fromMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: fromMock,
    rpc: rpcMock,
  }),
}))

vi.mock("@/lib/firebase-admin", () => ({
  getSignedVideoUrl: vi.fn(async (path: string) => `https://signed.example/${path}?token=x`),
}))

import { createFormReviewMessageWithAudio, getFormReviewMessages } from "@/lib/db/form-reviews"

describe("createFormReviewMessageWithAudio", () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it("calls the RPC and returns the joined message+attachment shape", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          message_id: "msg-1",
          attachment_id: "att-1",
          created_at: "2026-05-19T00:00:00Z",
        },
      ],
      error: null,
    })

    const result = await createFormReviewMessageWithAudio({
      review_id: "r-1",
      user_id: "u-1",
      kind: "audio",
      storage_path: "form-review-audio/u-1/x.webm",
      mime_type: "audio/webm",
      duration_seconds: 12,
      byte_size: 100_000,
    })

    expect(rpcMock).toHaveBeenCalledWith("create_form_review_message_with_attachment", {
      p_review_id: "r-1",
      p_user_id: "u-1",
      p_kind: "audio",
      p_storage_path: "form-review-audio/u-1/x.webm",
      p_mime_type: "audio/webm",
      p_duration_seconds: 12,
      p_byte_size: 100_000,
    })
    expect(result.id).toBe("msg-1")
    expect(result.message).toBeNull()
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments?.[0].storage_path).toBe("form-review-audio/u-1/x.webm")
  })

  it("throws when the RPC returns an error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } })
    await expect(
      createFormReviewMessageWithAudio({
        review_id: "r-1",
        user_id: "u-1",
        kind: "audio",
        storage_path: "form-review-audio/u-1/x.webm",
        mime_type: "audio/webm",
        duration_seconds: 12,
        byte_size: 100,
      }),
    ).rejects.toThrow(/boom/)
  })
})

describe("getFormReviewMessages signs audio URLs", () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
  })

  it("adds a playback_url to each audio attachment", async () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: "m-1",
            form_review_id: "r-1",
            user_id: "u-1",
            message: null,
            created_at: "2026-05-19T00:00:00Z",
            form_review_message_attachments: [
              {
                id: "a-1",
                message_id: "m-1",
                kind: "audio",
                storage_path: "form-review-audio/u-1/x.webm",
                mime_type: "audio/webm",
                duration_seconds: 14,
                byte_size: 100,
                created_at: "2026-05-19T00:00:00Z",
              },
            ],
            users: { first_name: "A", last_name: "B", avatar_url: null, role: "admin" },
          },
        ],
        error: null,
      }),
    }
    fromMock.mockReturnValue(builder)

    const rows = await getFormReviewMessages("r-1")
    expect(rows[0].attachments).toHaveLength(1)
    expect(rows[0].attachments?.[0]).toMatchObject({
      storage_path: "form-review-audio/u-1/x.webm",
      playback_url: expect.stringContaining("https://signed.example/"),
    })
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:run -- form-reviews-audio`
Expected: failure — `createFormReviewMessageWithAudio` not exported.

- [ ] **Step 3: Update `lib/db/form-reviews.ts`**

Open [lib/db/form-reviews.ts](../../../lib/db/form-reviews.ts). Replace the `getFormReviewMessages` function and add the new `createFormReviewMessageWithAudio` function:

```ts
import { createServiceRoleClient } from "@/lib/supabase"
import { getSignedVideoUrl } from "@/lib/firebase-admin"
import type {
  FormReview,
  FormReviewMessage,
  FormReviewMessageAttachment,
  FormReviewStatus,
} from "@/types/database"

// ...existing code unchanged above this point...

export async function getFormReviewMessages(reviewId: string) {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("form_review_messages")
    .select(
      "*, users(first_name, last_name, avatar_url, role), form_review_message_attachments(*)",
    )
    .eq("form_review_id", reviewId)
    .order("created_at", { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as Array<
    FormReviewMessage & {
      form_review_message_attachments?: FormReviewMessageAttachment[]
      users?: unknown
    }
  >

  // Sign audio attachment URLs server-side; client never sees raw Firebase paths.
  return Promise.all(
    rows.map(async (row) => {
      const rawAttachments = row.form_review_message_attachments ?? []
      const attachments = await Promise.all(
        rawAttachments.map(async (att) => {
          if (att.kind !== "audio") return att
          let playback_url: string | null = null
          try {
            playback_url = await getSignedVideoUrl(att.storage_path)
          } catch (err) {
            console.error("Failed to sign audio attachment URL:", att.storage_path, err)
          }
          return { ...att, playback_url }
        }),
      )
      const { form_review_message_attachments: _, ...rest } = row
      return { ...rest, attachments }
    }),
  )
}

export async function createFormReviewMessageWithAudio(input: {
  review_id: string
  user_id: string
  kind: "audio"
  storage_path: string
  mime_type: string
  duration_seconds: number
  byte_size: number
}): Promise<FormReviewMessage> {
  const supabase = getClient()
  const { data, error } = await supabase.rpc("create_form_review_message_with_attachment", {
    p_review_id: input.review_id,
    p_user_id: input.user_id,
    p_kind: input.kind,
    p_storage_path: input.storage_path,
    p_mime_type: input.mime_type,
    p_duration_seconds: input.duration_seconds,
    p_byte_size: input.byte_size,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error("RPC returned no row")

  return {
    id: row.message_id,
    form_review_id: input.review_id,
    user_id: input.user_id,
    message: null,
    created_at: row.created_at,
    attachments: [
      {
        id: row.attachment_id,
        message_id: row.message_id,
        kind: "audio",
        storage_path: input.storage_path,
        mime_type: input.mime_type,
        duration_seconds: input.duration_seconds,
        byte_size: input.byte_size,
        created_at: row.created_at,
      },
    ],
  }
}
```

Note: the returned attachment type from `getFormReviewMessages` now includes an optional `playback_url`. Extend the type in `types/database.ts` accordingly.

- [ ] **Step 4: Add `playback_url` to attachment type**

Edit [types/database.ts](../../../types/database.ts) `FormReviewMessageAttachment` interface to add the optional field:

```ts
export interface FormReviewMessageAttachment {
  id: string
  message_id: string
  kind: FormReviewMessageAttachmentKind
  storage_path: string
  mime_type: string
  duration_seconds: number | null
  byte_size: number
  created_at: string
  /** Populated server-side by `getFormReviewMessages`; signed Firebase URL, ~1 h TTL. */
  playback_url?: string | null
}
```

- [ ] **Step 5: Run tests, confirm green**

Run: `npm run test:run -- form-reviews-audio`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/db/form-reviews.ts types/database.ts __tests__/lib/db/form-reviews-audio.test.ts
git commit -m "feat(form-reviews): DAL for audio attachments with signed URLs"
```

---

## Task 5: API — admin messages POST handles audio branch

**Files:**
- Modify: `app/api/admin/form-reviews/[id]/messages/route.ts`

- [ ] **Step 1: Update the POST handler**

Replace the contents of [app/api/admin/form-reviews/[id]/messages/route.ts](../../../app/api/admin/form-reviews/[id]/messages/route.ts) (lines 14-88) with:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getFormReviewById,
  getFormReviewMessages,
  createFormReviewMessage,
  createFormReviewMessageWithAudio,
  updateFormReview,
} from "@/lib/db/form-reviews"
import { createNotification } from "@/lib/db/notifications"
import { getUserById } from "@/lib/db/users"
import { sendFormReviewFeedbackEmail } from "@/lib/email"
import { formReviewMessageSchema } from "@/lib/validators/form-review-message"
import { recordAudit } from "@/lib/audit/record"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const { id } = await params
    const messages = await getFormReviewMessages(id)
    return NextResponse.json(messages)
  } catch (error) {
    console.error("Admin form review messages GET error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const parsed = formReviewMessageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    let message
    if ("audio" in parsed.data) {
      const a = parsed.data.audio
      const expectedPrefix = `form-review-audio/${session.user.id}/`
      if (!a.storage_path.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: "Path ownership mismatch" }, { status: 403 })
      }
      message = await createFormReviewMessageWithAudio({
        review_id: id,
        user_id: session.user.id,
        kind: "audio",
        storage_path: a.storage_path,
        mime_type: a.mime_type,
        duration_seconds: a.duration_seconds,
        byte_size: a.byte_size,
      })
      // Fire-and-forget audit log
      recordAudit({
        action: "form_review.message.audio_sent",
        target_type: "form_review",
        target_id: id,
        metadata: { duration_seconds: a.duration_seconds, byte_size: a.byte_size },
      }).catch(() => {})
    } else {
      message = await createFormReviewMessage({
        form_review_id: id,
        user_id: session.user.id,
        message: parsed.data.message,
      })
    }

    const review = await getFormReviewById(id)
    if (review.status === "pending") {
      await updateFormReview(id, { status: "in_progress" })
    }

    try {
      const client = await getUserById(review.client_user_id)
      await createNotification({
        user_id: review.client_user_id,
        title: "Form Review Feedback",
        message: `Your coach left feedback on "${review.title}"`,
        type: "success",
        is_read: false,
        link: `/client/form-reviews/${review.id}`,
      })

      sendFormReviewFeedbackEmail({
        clientEmail: client.email,
        clientFirstName: client.first_name,
        clientUserId: client.id,
        reviewTitle: review.title,
        reviewId: review.id,
        audioDurationSeconds:
          "audio" in parsed.data ? parsed.data.audio.duration_seconds : null,
      }).catch((err) => console.error("Failed to send form review feedback email:", err))
    } catch (err) {
      console.error("Failed to notify client of form review feedback:", err)
    }

    return NextResponse.json(message, { status: 201 })
  } catch (error) {
    console.error("Admin form review message POST error:", error)
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `lib/email.ts` (new `audioDurationSeconds` arg not yet added) and `lib/audit/actions.ts` (new action slug not yet added) — both addressed in Tasks 9 and 11.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/form-reviews/[id]/messages/route.ts
git commit -m "feat(form-reviews): admin messages POST handles audio branch"
```

---

## Task 6: API — client messages POST mirrors the audio branch

**Files:**
- Modify: `app/api/client/form-reviews/[id]/messages/route.ts`

- [ ] **Step 1: Read the existing client route to preserve its current shape**

Run: `cat app/api/client/form-reviews/[id]/messages/route.ts`

It will resemble the admin route but: (a) it allows any authenticated user (not admin-gated), (b) it scopes by `client_user_id === session.user.id`, and (c) it notifies the **coach**, not the client. Preserve those differences.

- [ ] **Step 2: Update the POST handler with audio branch + path-ownership check**

In [app/api/client/form-reviews/[id]/messages/route.ts](../../../app/api/client/form-reviews/[id]/messages/route.ts), replace the existing Zod schema and POST handler with the same structure as the admin route, but:

- Drop the admin role check; keep only `if (!session?.user?.id) return 401`.
- Before doing anything, fetch the review and verify `review.client_user_id === session.user.id`; if not, return 403.
- On audio branch, path prefix check uses `form-review-audio/${session.user.id}/` (the client's own user id).
- Replace the `createNotification`/`sendFormReviewFeedbackEmail` block with whatever the existing client route does to notify the coach. (If currently it does nothing, leave it alone — the spec only changes admin → client email, not client → coach.)

Use the admin route from Task 5 as the structural template, mutatis mutandis.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: same as Task 5 (pending edits to email + audit).

- [ ] **Step 4: Commit**

```bash
git add app/api/client/form-reviews/[id]/messages/route.ts
git commit -m "feat(form-reviews): client messages POST handles audio branch"
```

---

## Task 7: Storage rules

**Files:**
- Modify: `storage.rules`

- [ ] **Step 1: Add the audio block**

Edit [storage.rules](../../../storage.rules). Add a new match block after the existing `form-reviews` block (line 7-11):

```
    // Form review voice messages — open upload scoped to form-review-audio path
    // Auth is enforced at the Next.js API layer + path-ownership check
    match /form-review-audio/{userId}/{fileName} {
      allow read: if true;
      allow write: if request.resource.size < 3 * 1024 * 1024  // 3MB max
                   && request.resource.contentType.matches('audio/.*');
    }
```

- [ ] **Step 2: Deploy storage rules (manual)**

Storage rule changes do not deploy with the Next.js app. Run:

```bash
firebase deploy --only storage
```

Expected: `✔  Deploy complete!`

If you don't have Firebase CLI auth, flag in the PR description that someone with deploy access must run this before merging.

- [ ] **Step 3: Commit**

```bash
git add storage.rules
git commit -m "feat(form-reviews): storage rule for voice message uploads"
```

---

## Task 8: Audit action slug

**Files:**
- Modify: `lib/audit/actions.ts`

- [ ] **Step 1: Add the slug**

Open [lib/audit/actions.ts](../../../lib/audit/actions.ts). Locate the existing form-review-related slugs (search for `form_review.`). Add one new row in the same block:

```ts
{ slug: "form_review.message.audio_sent", category: "client_action", description: "Voice message sent on a form review thread" },
```

If no `form_review.*` block exists yet, add it in a logical place — somewhere near other content/client-action slugs. Match the existing style.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: the messages route from Task 5 now compiles cleanly w.r.t. `recordAudit`.

- [ ] **Step 3: Commit**

```bash
git add lib/audit/actions.ts
git commit -m "feat(audit): form_review.message.audio_sent action"
```

---

## Task 9: Email — audio preview line

**Files:**
- Modify: `lib/email.ts` (function signature) and the underlying email template component (location to be found in Step 1)

- [ ] **Step 1: Locate the email template**

Run: `grep -rn "sendFormReviewFeedbackEmail\|FormReviewFeedback" lib/ components/emails/`

You will find:
- `lib/email.ts` exports `sendFormReviewFeedbackEmail({ clientEmail, clientFirstName, clientUserId, reviewTitle, reviewId })`
- A React Email template under `components/emails/...` (likely `FormReviewFeedback.tsx` or similar) which it renders

- [ ] **Step 2: Add `audioDurationSeconds` to the function signature**

In `lib/email.ts`, change the type of the `sendFormReviewFeedbackEmail` parameter to include:

```ts
audioDurationSeconds?: number | null
```

Pass it through to the template render call.

- [ ] **Step 3: Update the template**

In the template component, accept the new optional prop and branch the preview text. Pattern:

```tsx
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

// In the template body:
{audioDurationSeconds
  ? <Text>🎧 Voice message ({formatDuration(audioDurationSeconds)})</Text>
  : <Text>Your coach left new feedback on this review.</Text>
}
```

Keep the existing `View review` CTA button unchanged.

- [ ] **Step 4: Smoke-test render**

Run: `npm run test:run -- emails`
Expected: existing email tests still pass; if there's a snapshot test, you may need to update it for the new prop default.

- [ ] **Step 5: Commit**

```bash
git add lib/email.ts components/emails/
git commit -m "feat(email): voice-message preview in form-review feedback email"
```

---

## Task 10: `VoiceRecorder` component

**Files:**
- Create: `components/shared/VoiceRecorder.tsx`
- Create: `__tests__/components/VoiceRecorder.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/VoiceRecorder.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { VoiceRecorder } from "@/components/shared/VoiceRecorder"

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true)
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state: "inactive" | "recording" = "inactive"
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) })
    this.onstop?.()
  }
}

const fakeStream = {
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("VoiceRecorder", () => {
  it("renders the mic button when MediaRecorder is supported", () => {
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument()
  })

  it("renders nothing when MediaRecorder is missing", () => {
    vi.stubGlobal("MediaRecorder", undefined)
    const { container } = render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("transitions idle → recording on click", async () => {
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument()
    })
  })

  it("transitions to stopped (preview controls visible) after stop", async () => {
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await waitFor(() => screen.getByRole("button", { name: /stop/i }))
    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument()
    })
  })

  it("returns to idle after delete", async () => {
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await waitFor(() => screen.getByRole("button", { name: /stop/i }))
    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    await waitFor(() => screen.getByRole("button", { name: /delete/i }))
    fireEvent.click(screen.getByRole("button", { name: /delete/i }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:run -- VoiceRecorder`
Expected: failure (module not found).

- [ ] **Step 3: Implement the component**

Create `components/shared/VoiceRecorder.tsx`:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { ref as storageRef, uploadBytesResumable } from "firebase/storage"
import { storage } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Mic, Square, Send, Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface VoiceRecorderProps {
  userId: string
  onSend(payload: {
    storage_path: string
    mime_type: string
    duration_seconds: number
    byte_size: number
  }): Promise<void>
  disabled?: boolean
}

const MAX_DURATION_SECONDS = 120
const MAX_BYTES = 3 * 1024 * 1024

type State = "idle" | "recording" | "stopped" | "uploading"

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus"
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm"
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4"
  return null
}

function normalizeMime(mime: string): "audio/webm" | "audio/mp4" | "audio/ogg" {
  if (mime.startsWith("audio/webm")) return "audio/webm"
  if (mime.startsWith("audio/mp4")) return "audio/mp4"
  return "audio/ogg"
}

function extFor(mime: string): string {
  if (mime.startsWith("audio/webm")) return "webm"
  if (mime.startsWith("audio/mp4")) return "m4a"
  return "ogg"
}

export function VoiceRecorder({ userId, onSend, disabled }: VoiceRecorderProps) {
  const [state, setState] = useState<State>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const supported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    timerRef.current = null
    stopTimerRef.current = null
  }

  useEffect(() => cleanupStream, [])

  function reset() {
    setBlob(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setElapsed(0)
    setProgress(0)
    setState("idle")
    cleanupStream()
  }

  async function startRecording() {
    const mime = pickMimeType()
    if (!mime) {
      toast.error("Your browser doesn't support voice recording.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 })
      recorderRef.current = rec
      rec.ondataavailable = (e) => {
        if ((e as { data: Blob }).data.size > 0) chunksRef.current.push((e as { data: Blob }).data)
      }
      rec.onstop = () => {
        const recordedBlob = new Blob(chunksRef.current, { type: mime })
        setBlob(recordedBlob)
        setPreviewUrl(URL.createObjectURL(recordedBlob))
        setState("stopped")
      }
      rec.start()
      setState("recording")
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
      stopTimerRef.current = setTimeout(() => stopRecording(), MAX_DURATION_SECONDS * 1000)
    } catch (err) {
      console.error("getUserMedia error:", err)
      toast.error("Microphone access required. Enable it in your browser settings.")
      cleanupStream()
      setState("idle")
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop()
    }
    if (timerRef.current) clearInterval(timerRef.current)
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
  }

  async function handleSend() {
    if (!blob) return
    if (blob.size > MAX_BYTES) {
      toast.error("Voice message too large. Re-record a shorter clip.")
      return
    }
    setState("uploading")
    const mime = normalizeMime(blob.type)
    const ext = extFor(blob.type)
    const path = `form-review-audio/${userId}/${Date.now()}.${ext}`
    const ref = storageRef(storage, path)
    try {
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(ref, blob, { contentType: blob.type })
        task.on(
          "state_changed",
          (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => reject(err),
          () => resolve(),
        )
      })
      await onSend({
        storage_path: path,
        mime_type: mime,
        duration_seconds: elapsed,
        byte_size: blob.size,
      })
      reset()
    } catch (err) {
      console.error("Voice upload error:", err)
      toast.error("Failed to send voice message. Try again.")
      setState("stopped")
    }
  }

  if (!supported) return null

  function formatTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  if (state === "idle") {
    return (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Record voice message"
        onClick={startRecording}
        disabled={disabled}
      >
        <Mic className="size-4" />
      </Button>
    )
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-red-50 border border-red-200">
        <span className="size-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-mono text-red-700 tabular-nums">{formatTime(elapsed)}</span>
        <Button type="button" size="icon" variant="ghost" aria-label="Stop recording" onClick={stopRecording}>
          <Square className="size-4 fill-current" />
        </Button>
      </div>
    )
  }

  if (state === "stopped" && previewUrl) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted">
        <audio src={previewUrl} controls className="h-8" />
        <Button type="button" size="icon" variant="ghost" aria-label="Delete recording" onClick={reset}>
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
        <Button type="button" size="icon" aria-label="Send voice message" onClick={handleSend}>
          <Send className="size-4" />
        </Button>
      </div>
    )
  }

  // uploading
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted">
      <Loader2 className="size-4 animate-spin" />
      <span className="text-xs text-muted-foreground">{progress}%</span>
    </div>
  )
}
```

- [ ] **Step 4: Run tests, confirm green**

Run: `npm run test:run -- VoiceRecorder`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add components/shared/VoiceRecorder.tsx __tests__/components/VoiceRecorder.test.tsx
git commit -m "feat(form-reviews): VoiceRecorder component"
```

---

## Task 11: Wire `VoiceRecorder` into `FormReviewThread`

**Files:**
- Modify: `components/shared/FormReviewThread.tsx`

- [ ] **Step 1: Extend the `Message` type, add `currentUserId` is already there**

Edit [components/shared/FormReviewThread.tsx](../../../components/shared/FormReviewThread.tsx). Update the `Message` interface:

```ts
interface Attachment {
  id: string
  kind: "audio"
  storage_path: string
  mime_type: string
  duration_seconds: number | null
  playback_url?: string | null
}

interface Message {
  id: string
  user_id: string
  message: string | null
  created_at: string
  attachments?: Attachment[]
  users?: {
    first_name: string
    last_name: string
    avatar_url?: string | null
    role?: string
  } | null
}
```

- [ ] **Step 2: Add the audio send handler and import `VoiceRecorder`**

At the top of the file, add:

```tsx
import { VoiceRecorder } from "@/components/shared/VoiceRecorder"
```

Inside the component, add (next to `handleSend`):

```tsx
async function handleSendAudio(payload: {
  storage_path: string
  mime_type: string
  duration_seconds: number
  byte_size: number
}) {
  const res = await fetch(`${apiBasePath}/${reviewId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: payload }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || "Failed to send voice message")
  }
  const created = await res.json()
  setMessages((prev) => [...prev, created])
}
```

- [ ] **Step 3: Render audio attachments inside the message map**

In the messages `.map((msg) => ...)` block, replace the bubble body (`{msg.message}`) with a branch:

```tsx
<div
  className={cn(
    "max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
    isOwn ? "bg-primary text-primary-foreground" : "bg-white border border-border text-foreground",
  )}
>
  {msg.attachments?.[0]?.kind === "audio" ? (
    <div className="flex items-center gap-2">
      {msg.attachments[0].playback_url ? (
        <audio src={msg.attachments[0].playback_url} controls className="h-8" />
      ) : (
        <span className="text-xs italic opacity-70">Audio unavailable</span>
      )}
      {msg.attachments[0].duration_seconds != null && (
        <span className="text-xs opacity-70 tabular-nums">
          ({Math.floor(msg.attachments[0].duration_seconds / 60)}:
          {(msg.attachments[0].duration_seconds % 60).toString().padStart(2, "0")})
        </span>
      )}
    </div>
  ) : (
    msg.message
  )}
</div>
```

- [ ] **Step 4: Mount `VoiceRecorder` next to the existing Send button**

In the reply input section, change:

```tsx
<Button size="icon" onClick={handleSend} disabled={!newMessage.trim() || sending} className="shrink-0">
  <Send className="size-4" />
</Button>
```

to:

```tsx
<VoiceRecorder
  userId={currentUserId}
  onSend={handleSendAudio}
  disabled={sending}
/>
<Button size="icon" onClick={handleSend} disabled={!newMessage.trim() || sending} className="shrink-0">
  <Send className="size-4" />
</Button>
```

- [ ] **Step 5: Manual smoke test (no auto-test for this UI integration)**

Run: `npm run dev` (port 3050)

1. Sign in as admin, open a form review at `/admin/form-reviews/[id]`.
2. Click the mic icon next to the Send button. Grant mic permission.
3. Speak for ~5 seconds. Click stop. Click send. Watch the upload progress, then see the audio bubble appear in the thread.
4. Sign in as the client owner of that review, open `/client/form-reviews/[id]`, confirm the audio bubble renders with a playable `<audio>` element.

If steps 1-4 all pass, the integration is good. If any fail, debug before committing.

- [ ] **Step 6: Commit**

```bash
git add components/shared/FormReviewThread.tsx
git commit -m "feat(form-reviews): voice recorder + audio playback in thread"
```

---

## Task 12: E2E Playwright happy-path test

**Files:**
- Create: `__tests__/e2e/form-review-voice.spec.ts`
- Modify: `playwright.config.ts` (Chromium launch args for fake media stream)

- [ ] **Step 1: Add fake-media-stream flags to Chromium project in playwright config**

Open `playwright.config.ts`. In the Chromium project block, add to `use.launchOptions`:

```ts
launchOptions: {
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
},
```

(Merge with any existing `args`; don't drop existing flags.)

- [ ] **Step 2: Write the happy-path test**

Create `__tests__/e2e/form-review-voice.spec.ts`:

```ts
import { test, expect } from "@playwright/test"

// Assumes seeded e2e users exist: admin@example.test and client@example.test
// and a seeded form review owned by the client. These IDs live in __tests__/e2e/fixtures.ts
// or are created in beforeAll. Adapt to whatever pattern the project uses.

test.describe("form review voice messages", () => {
  test("admin records a voice message, client sees it", async ({ browser }) => {
    // --- admin records ---
    const adminCtx = await browser.newContext()
    const adminPage = await adminCtx.newPage()
    await adminPage.goto("/login")
    await adminPage.getByLabel(/email/i).fill("admin@example.test")
    await adminPage.getByLabel(/password/i).fill("test-password")
    await adminPage.getByRole("button", { name: /sign in/i }).click()

    await adminPage.goto("/admin/form-reviews")
    await adminPage.getByRole("link", { name: /e2e seeded review/i }).click()

    await adminPage.getByRole("button", { name: /record voice message/i }).click()
    // wait for recording state
    await expect(adminPage.getByRole("button", { name: /stop recording/i })).toBeVisible()
    await adminPage.waitForTimeout(3000) // record 3s
    await adminPage.getByRole("button", { name: /stop recording/i }).click()
    await expect(adminPage.getByRole("button", { name: /send voice message/i })).toBeVisible()
    await adminPage.getByRole("button", { name: /send voice message/i }).click()

    // Audio bubble appears
    await expect(adminPage.locator("audio").last()).toBeVisible({ timeout: 15_000 })

    // --- client sees it ---
    const clientCtx = await browser.newContext()
    const clientPage = await clientCtx.newPage()
    await clientPage.goto("/login")
    await clientPage.getByLabel(/email/i).fill("client@example.test")
    await clientPage.getByLabel(/password/i).fill("test-password")
    await clientPage.getByRole("button", { name: /sign in/i }).click()

    await clientPage.goto("/client/form-reviews")
    await clientPage.getByRole("link", { name: /e2e seeded review/i }).click()

    await expect(clientPage.locator("audio").last()).toBeVisible({ timeout: 15_000 })

    await adminCtx.close()
    await clientCtx.close()
  })
})
```

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e -- form-review-voice`
Expected: green. If the seeded-user / seeded-review fixture names don't match the project's actual e2e setup, adapt selectors and credentials to whatever existing e2e tests use.

- [ ] **Step 4: Commit**

```bash
git add __tests__/e2e/form-review-voice.spec.ts playwright.config.ts
git commit -m "test(e2e): form review voice message happy path"
```

---

## Task 13: Final verification + audit log smoke check

- [ ] **Step 1: Full test run**

Run: `npm run test:run`
Expected: all unit + component tests pass; no regressions in pre-existing form-review tests.

- [ ] **Step 2: Lint + format**

Run: `npm run lint && npm run format:check`
Expected: clean.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual end-to-end smoke on dev server**

Run: `npm run dev` (port 3050). Sign in as admin, send a text message → confirm normal flow still works. Then send a voice message → confirm:

1. Recorder appears next to Send button
2. Recording shows live timer
3. Stops at 2:00 automatically (record for 2:00+ to verify)
4. Preview plays back
5. Upload completes, audio bubble appears in thread with duration label
6. Client opens review in another browser session, sees audio bubble with playable audio
7. Client receives email with `🎧 Voice message (M:SS)` preview line
8. `audit_logs` has a new row with `action = 'form_review.message.audio_sent'`

If anything fails, fix it before declaring done.

- [ ] **Step 5: Final commit (if anything was fixed in step 4)**

```bash
git add -A
git commit -m "chore(form-reviews): final fixes from smoke test"
```

---

## Self-review notes

- **Spec coverage:**
  - Data model → Task 1 ✓
  - Path-ownership server check → Tasks 5, 6 ✓
  - Discriminated-union validator → Task 3 ✓
  - Direct browser → Firebase upload → Task 10 (VoiceRecorder) ✓
  - Signed playback URLs at page load → Task 4 (DAL signs in `getFormReviewMessages`) ✓
  - Storage rule for `form-review-audio/*` → Task 7 ✓
  - Audit slug → Task 8 ✓
  - Email preview line → Task 9 ✓
  - Recorder UI + thread integration → Tasks 10, 11 ✓
  - E2E happy path → Task 12 ✓
  - Migration number `00156` → Task 1 ✓
  - 3 MB hard cap (storage rule + Zod + recorder check) → Tasks 7, 3, 10 ✓
  - 120 s cap (Zod + recorder timer) → Tasks 3, 10 ✓
  - No `/api/form-review-audio/sign` endpoint → intentional simplification; server-side `getSignedVideoUrl` is already used by the page for the video and works equally well for audio paths, removing a network round trip
- **Function signature drift:** `createFormReviewMessageWithAudio` takes a single object arg (Task 4). The admin/client POST handlers in Tasks 5 + 6 call it with exactly that shape. ✓
- **Type drift:** `FormReviewMessage.message` is `string | null` everywhere after Task 2; `FormReviewMessageAttachment.playback_url?: string | null` added in Task 4 step 4 and used in Task 11 step 3. ✓
- **Migration number:** verified against `supabase/migrations/` listing — latest is `00155_blog_post_cover_meta.sql`; `00156` is next free.

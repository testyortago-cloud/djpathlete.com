# Client Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realtime 1:1 coach↔client chat — bottom-right dock + full-page inbox, image/video attachments to 25 MB, emoji reactions, typing/presence/read receipts, and a delayed email when a message goes unread.

**Architecture:** Postgres is the source of truth. Every write goes through a Next.js route on the service-role client; the browser's Supabase client is **realtime-only** and never queries a table. `auth.uid()` works in the browser because a server route mints a short-lived HS256 JWT (`sub` = NextAuth user id, `role: authenticated`) that the client hands to `supabase.realtime.setAuth()`. Attachment bytes PUT straight to Firebase via server-signed v4 URLs and are verified server-side before any row is inserted.

**Tech Stack:** Next.js 16 App Router · Supabase Postgres + Realtime · `jose` (JWT signing) · Firebase Storage (`firebase-admin` server, `firebase` browser) · Resend · Vitest + Testing Library · Tailwind v4 + shadcn/ui.

**Spec:** [`docs/superpowers/specs/2026-08-04-client-messaging-design.md`](../specs/2026-08-04-client-messaging-design.md)

## Global Constraints

- **Max attachment size: 25 MB** (`25 * 1024 * 1024` bytes). Enforced at sign time on the *declared* size and again at send time on the object's **real** `getMetadata().size`.
- **Max 5 attachments per message.** Allowed mime: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/quicktime`, `video/webm`.
- **RLS grants `SELECT` only.** No `INSERT`/`UPDATE`/`DELETE` policy for `authenticated` on any messaging table.
- **`SUPABASE_JWT_SECRET` is server-only.** Never `NEXT_PUBLIC_`, never in a client component.
- **No raw signed GCS URL may become a durable `href`/`src`.** Attachments render via `/api/messaging/attachments/[id]?redirect=1`.
- **Colors/fonts:** semantic Tailwind classes only (`text-primary`, `bg-accent`, `text-muted-foreground`). No hex, no inline `fontFamily`.
- **Cron flag `cron_messaging_email_enabled` defaults to `false`.**
- Supabase client construction: drop the `Database` generic, cast in the DAL.
- Every new test must be **mutation-probed** — break the implementation, confirm the test fails, restore.
- Run targeted tests only (`npx vitest run <path>`), plus `npm run build` as a separate command — never chained behind the test run with `&&`.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/00199_client_messaging.sql` | 4 tables, 8 RLS policies, `is_messaging_admin()`, `create_message()` RPC, realtime publication, `realtime.messages` channel policies, flag seed |
| `lib/messaging/config.ts` | The 25 MB number, mime allowlist, attachment cap, email delay, storage prefix — one source |
| `lib/messaging/attachments.ts` | pure: `kindForMime`, `validateAttachmentSpecs`, `buildStoragePath` |
| `lib/messaging/reactions.ts` | pure: `isValidEmoji`, `MAX_REACTIONS_PER_USER` |
| `lib/messaging/unread.ts` | pure: `unreadCount`, `previewFor` |
| `lib/messaging/notify-select.ts` | pure: `messagesNeedingEmail` |
| `lib/messaging/realtime-token.ts` | server: `signRealtimeToken(userId)` |
| `lib/messaging/storage.ts` | server: sign upload, verify object, sign read, delete |
| `lib/messaging/email-new-message.ts` | server: `sendNewMessageEmail` |
| `lib/db/conversations.ts`, `lib/db/messages.ts` | DAL (service role) |
| `app/api/messaging/**` | 8 routes |
| `app/api/admin/internal/messaging-notify/route.ts` | cron receiver |
| `components/messaging/**` | Provider, dock, list, thread, bubble, composer, attachment, reactions, typing, presence |
| `hooks/use-messaging.ts` | subscription + optimistic send |
| `app/(admin)/admin/messages/page.tsx`, `app/(client)/client/messages/page.tsx` | full-page inboxes |

---

### Task 1: Migration — schema, RLS, RPC, realtime wiring

**Files:**
- Create: `supabase/migrations/00199_client_messaging.sql`
- Modify: `types/database.ts` (append messaging types)

**Interfaces:**
- Produces: tables `conversations`, `messages`, `message_attachments`, `message_reactions`; functions `public.is_messaging_admin()`, `public.create_message(...)` returning `TABLE(message_id uuid, created_at timestamptz)`; TS types `Conversation`, `Message`, `MessageAttachment`, `MessageReaction`, `MessageSenderRole`, `AttachmentKind`.

- [ ] **Step 1: Write the migration**

```sql
-- Client Messaging: 1:1 coach <-> client conversations
-- ============================================================================
-- One conversation per client (client_user_id is UNIQUE). The admin side is a
-- SHARED inbox: any admin sees every conversation and read state is per-SIDE,
-- not per-admin. Solo operator today; a second coach would share the inbox the
-- way a support inbox is shared.

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_sender_role TEXT CHECK (last_message_sender_role IN ('admin','client')),
  client_last_read_at TIMESTAMPTZ,
  admin_last_read_at TIMESTAMPTZ
);

CREATE INDEX idx_conversations_last_message ON conversations(last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('admin','client')),
  body TEXT,
  attachment_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_notified_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
-- Drives the notifier cron's only query.
CREATE INDEX idx_messages_pending_email ON messages(created_at) WHERE email_notified_at IS NULL;

CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INT NOT NULL,
  width INT,
  height INT,
  duration_seconds NUMERIC,
  original_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_attachments_message ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- PLAIN unique constraint: PostgREST onConflict only accepts plain uniques.
  CONSTRAINT message_reactions_unique UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_message_reactions_message ON message_reactions(message_id);

-- ============================================================================
-- Helper: is the current JWT an admin?
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_messaging_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin');
$$;

-- ============================================================================
-- RPC: insert message + attachments + denormalized conversation fields, atomically
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_message(
  p_conversation_id UUID,
  p_sender_user_id UUID,
  p_sender_role TEXT,
  p_body TEXT,
  p_preview TEXT,
  p_attachments JSONB
) RETURNS TABLE (message_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id UUID;
  v_created_at TIMESTAMPTZ;
  v_count INT;
BEGIN
  v_count := COALESCE(jsonb_array_length(p_attachments), 0);

  INSERT INTO messages (conversation_id, sender_user_id, sender_role, body, attachment_count)
  VALUES (p_conversation_id, p_sender_user_id, p_sender_role, p_body, v_count)
  RETURNING messages.id, messages.created_at INTO v_message_id, v_created_at;

  IF v_count > 0 THEN
    INSERT INTO message_attachments
      (message_id, kind, storage_path, mime_type, byte_size, width, height, duration_seconds, original_filename)
    SELECT
      v_message_id,
      a->>'kind',
      a->>'storage_path',
      a->>'mime_type',
      (a->>'byte_size')::INT,
      NULLIF(a->>'width','')::INT,
      NULLIF(a->>'height','')::INT,
      NULLIF(a->>'duration_seconds','')::NUMERIC,
      a->>'original_filename'
    FROM jsonb_array_elements(p_attachments) AS a;
  END IF;

  UPDATE conversations
     SET last_message_at = v_created_at,
         last_message_preview = p_preview,
         last_message_sender_role = p_sender_role
   WHERE id = p_conversation_id;

  RETURN QUERY SELECT v_message_id, v_created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_message FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_message TO service_role;

-- ============================================================================
-- RLS — SELECT ONLY. Every write goes through a service-role API route.
-- ============================================================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own or admin conversations" ON conversations FOR SELECT TO authenticated
  USING (client_user_id = auth.uid() OR public.is_messaging_admin());

CREATE POLICY "own or admin messages" ON messages FOR SELECT TO authenticated
  USING (
    public.is_messaging_admin() OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id AND c.client_user_id = auth.uid()
    )
  );

CREATE POLICY "own or admin attachments" ON message_attachments FOR SELECT TO authenticated
  USING (
    public.is_messaging_admin() OR EXISTS (
      SELECT 1 FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = message_attachments.message_id AND c.client_user_id = auth.uid()
    )
  );

CREATE POLICY "own or admin reactions" ON message_reactions FOR SELECT TO authenticated
  USING (
    public.is_messaging_admin() OR EXISTS (
      SELECT 1 FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = message_reactions.message_id AND c.client_user_id = auth.uid()
    )
  );

-- ============================================================================
-- Realtime
-- ============================================================================
-- message_reactions deliberately keeps its DEFAULT replica identity (PK only).
-- postgres_changes does NOT apply RLS to DELETE events, so REPLICA IDENTITY FULL
-- would broadcast user_id + emoji of every un-react to every subscriber. With the
-- default, a delete carries only the row id -- all the client needs, meaningless
-- to anyone else.
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;

-- Private channel `conversation:<uuid>` for typing + presence.
-- The regex guard runs BEFORE the ::uuid cast so a malformed topic is rejected
-- rather than raising a cast error inside the policy.
CREATE POLICY "participants read conversation channel"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.topic() ~ '^conversation:[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = split_part(realtime.topic(), ':', 2)::uuid
        AND (c.client_user_id = auth.uid() OR public.is_messaging_admin())
    )
  );

CREATE POLICY "participants write conversation channel"
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() ~ '^conversation:[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = split_part(realtime.topic(), ':', 2)::uuid
        AND (c.client_user_id = auth.uid() OR public.is_messaging_admin())
    )
  );

-- ============================================================================
-- Feature flag for the notifier cron (default OFF -- it emails clients)
-- ============================================================================
INSERT INTO system_settings (key, value)
VALUES ('cron_messaging_email_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Append TS types to `types/database.ts`**

```typescript
// Client messaging types
export type MessageSenderRole = "admin" | "client"
export type AttachmentKind = "image" | "video"

export interface Conversation {
  id: string
  client_user_id: string
  created_at: string
  last_message_at: string | null
  last_message_preview: string | null
  last_message_sender_role: MessageSenderRole | null
  client_last_read_at: string | null
  admin_last_read_at: string | null
}

export interface MessageAttachment {
  id: string
  message_id: string
  kind: AttachmentKind
  storage_path: string
  mime_type: string
  byte_size: number
  width: number | null
  height: number | null
  duration_seconds: number | null
  original_filename: string | null
  created_at: string
}

export interface MessageReaction {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface Message {
  id: string
  conversation_id: string
  sender_user_id: string
  sender_role: MessageSenderRole
  body: string | null
  attachment_count: number
  created_at: string
  email_notified_at: string | null
}

/** A message joined with everything the thread needs to render one bubble. */
export interface MessageWithExtras extends Message {
  attachments: MessageAttachment[]
  reactions: MessageReaction[]
}
```

- [ ] **Step 3: Verify the SQL parses**

Run: `npx tsc --noEmit types/database.ts 2>&1 | head -5` (types only — SQL is applied by the owner per the ops checklist).
Expected: no errors referencing `types/database.ts`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00199_client_messaging.sql types/database.ts
git commit -m "feat(messaging): schema, RLS, and realtime wiring for coach-client chat"
```

---

### Task 2: Pure config + attachment validation

**Files:**
- Create: `lib/messaging/config.ts`, `lib/messaging/attachments.ts`
- Test: `__tests__/lib/messaging/attachments.test.ts`

**Interfaces:**
- Produces:
  - `MAX_ATTACHMENT_BYTES = 26214400`, `MAX_ATTACHMENTS_PER_MESSAGE = 5`, `ALLOWED_MIME_TYPES: readonly string[]`, `EMAIL_DELAY_MS = 300000`, `MESSAGING_STORAGE_PREFIX = "messaging"`, `MAX_BODY_LENGTH = 5000`
  - `kindForMime(mime: string): AttachmentKind | null`
  - `validateAttachmentSpecs(specs: {mime_type: string; byte_size: number}[]): {ok: true} | {ok: false; error: string}`
  - `buildStoragePath(conversationId: string, uploadId: string, filename: string): string`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest"
import { kindForMime, validateAttachmentSpecs, buildStoragePath } from "@/lib/messaging/attachments"
import { MAX_ATTACHMENT_BYTES } from "@/lib/messaging/config"

describe("kindForMime", () => {
  it("maps images and video", () => {
    expect(kindForMime("image/png")).toBe("image")
    expect(kindForMime("video/mp4")).toBe("video")
  })

  // A permissive fallback on a path that decides what gets STORED is a
  // correctness hole, not a convenience. Unknown must be null, never a guess.
  it("returns null for anything not on the allowlist", () => {
    expect(kindForMime("application/pdf")).toBeNull()
    expect(kindForMime("text/plain")).toBeNull()
    expect(kindForMime("")).toBeNull()
  })
})

describe("validateAttachmentSpecs", () => {
  const img = (bytes: number) => ({ mime_type: "image/jpeg", byte_size: bytes })

  it("accepts a file of exactly the cap", () => {
    expect(validateAttachmentSpecs([img(MAX_ATTACHMENT_BYTES)]).ok).toBe(true)
  })

  it("rejects one byte over the cap", () => {
    const res = validateAttachmentSpecs([img(MAX_ATTACHMENT_BYTES + 1)])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/25 MB/)
  })

  it("rejects a disallowed mime type", () => {
    const res = validateAttachmentSpecs([{ mime_type: "application/pdf", byte_size: 100 }])
    expect(res.ok).toBe(false)
  })

  it("rejects more than 5 attachments", () => {
    expect(validateAttachmentSpecs(Array(6).fill(img(10))).ok).toBe(false)
    expect(validateAttachmentSpecs(Array(5).fill(img(10))).ok).toBe(true)
  })

  it("rejects a zero or negative size", () => {
    expect(validateAttachmentSpecs([img(0)]).ok).toBe(false)
    expect(validateAttachmentSpecs([img(-1)]).ok).toBe(false)
  })
})

describe("buildStoragePath", () => {
  it("sanitizes the filename and nests under the conversation", () => {
    expect(buildStoragePath("conv-1", "up-2", "my photo (1).png")).toBe(
      "messaging/conv-1/up-2/my_photo_1_.png",
    )
  })

  it("cannot be escaped with traversal segments", () => {
    const path = buildStoragePath("conv-1", "up-2", "../../etc/passwd")
    expect(path).toBe("messaging/conv-1/up-2/.._.._etc_passwd")
    expect(path).not.toContain("/../")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/messaging/attachments.test.ts`
Expected: FAIL — cannot resolve `@/lib/messaging/attachments`.

- [ ] **Step 3: Implement `lib/messaging/config.ts`**

```typescript
/**
 * Single source for every messaging limit. The 25 MB number appears in the
 * browser pre-check, the sign-URL route, and the post-upload verification —
 * three enforcement points that must never disagree.
 */
import type { AttachmentKind } from "@/types/database"

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
export const MAX_BODY_LENGTH = 5000

export const MIME_KINDS: Readonly<Record<string, AttachmentKind>> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
}

export const ALLOWED_MIME_TYPES = Object.keys(MIME_KINDS)

/** Delay before an unread message earns an email. */
export const EMAIL_DELAY_MS = 5 * 60 * 1000

export const MESSAGING_STORAGE_PREFIX = "messaging"

/** Signed upload URLs are short-lived: the browser PUTs immediately. */
export const UPLOAD_URL_TTL_MS = 15 * 60 * 1000
/** Read URLs are re-signed per hit through the redirect route, so keep short. */
export const READ_URL_TTL_MS = 60 * 60 * 1000
```

- [ ] **Step 4: Implement `lib/messaging/attachments.ts`**

```typescript
import type { AttachmentKind } from "@/types/database"
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MESSAGING_STORAGE_PREFIX,
  MIME_KINDS,
} from "./config"

export interface AttachmentSpec {
  mime_type: string
  byte_size: number
}

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Map a mime type onto a render kind. Returns null — never a default — for
 * anything unrecognized: this decides what may be STORED, and a permissive
 * fallback here would let a .txt be filed as an image that renders as nothing.
 */
export function kindForMime(mime: string): AttachmentKind | null {
  return MIME_KINDS[mime] ?? null
}

export function validateAttachmentSpecs(specs: AttachmentSpec[]): ValidationResult {
  if (specs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.` }
  }
  for (const spec of specs) {
    if (!kindForMime(spec.mime_type)) {
      return { ok: false, error: `${spec.mime_type || "That file type"} is not supported. Send an image or a video.` }
    }
    if (!Number.isFinite(spec.byte_size) || spec.byte_size <= 0) {
      return { ok: false, error: "That file looks empty." }
    }
    if (spec.byte_size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "Files must be 25 MB or smaller." }
    }
  }
  return { ok: true }
}

/** messaging/<conversationId>/<uploadId>/<safeFilename> */
export function buildStoragePath(conversationId: string, uploadId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120)
  return `${MESSAGING_STORAGE_PREFIX}/${conversationId}/${uploadId}/${safe}`
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run __tests__/lib/messaging/attachments.test.ts`
Expected: PASS (11 assertions).

- [ ] **Step 6: Mutation-probe**

Change `spec.byte_size > MAX_ATTACHMENT_BYTES` to `>=`. Re-run: "accepts a file of exactly the cap" must FAIL. Restore.
Change `kindForMime` to `?? "image"`. Re-run: the null test must FAIL. Restore.

- [ ] **Step 7: Commit**

```bash
git add lib/messaging/config.ts lib/messaging/attachments.ts __tests__/lib/messaging/attachments.test.ts
git commit -m "feat(messaging): attachment limits and validation"
```

---

### Task 3: Pure unread + email-selection + emoji validation

**Files:**
- Create: `lib/messaging/unread.ts`, `lib/messaging/notify-select.ts`, `lib/messaging/reactions.ts`
- Test: `__tests__/lib/messaging/unread.test.ts`, `__tests__/lib/messaging/notify-select.test.ts`

**Interfaces â€” Produces:**
- `unreadCount(messages: {created_at: string; sender_role: MessageSenderRole}[], lastReadAt: string | null, viewerRole: MessageSenderRole): number`
- `previewFor(body: string | null, attachmentCount: number, firstKind: AttachmentKind | null): string`
- `messagesNeedingEmail(input: NotifyInput): NotifyGroup[]`, `alreadyReadIds(input: NotifyInput): string[]`
  - `NotifyInput = { messages: Message[]; conversations: Conversation[]; now: number; delayMs: number }`
  - `NotifyGroup = { conversation_id: string; recipient_role: MessageSenderRole; recipient_user_id: string | null; message_ids: string[]; previews: string[] }`
- `isValidEmoji(value: string): boolean`, `MAX_REACTIONS_PER_USER = 6`

**Required behaviours (each is one test):**

`unreadCount` â€” counts only messages whose `sender_role !== viewerRole`; the
`last_read_at` comparison is **strict `>`**, because marking-read stamps `now`
and a `>=` boundary produces a phantom unread badge that reading can never
clear. Test both the exact-boundary case (0 unread) and one millisecond past it
(1 unread).

`previewFor` â€” body wins; truncates to 120 chars; attachment-only messages
render `"Photo"` / `"Video"` / `"3 photos"`.

`messagesNeedingEmail` â€” **fixture dates must use a year that differs from the
current year**, or a test passes against an implementation that ignores the
delay entirely. Cases: (a) before the delay â†’ nothing; (b) unread past the delay
â†’ one group addressed to the other side; (c) recipient read it in the meantime â†’
no email, but `alreadyReadIds` returns it so it is stamped and never
reconsidered; (d) `email_notified_at` already set â†’ skipped; (e) two unread
messages in one conversation â†’ **one** group with both ids in `created_at`
order; (f) a client's message routes to `recipient_role: "admin"` with
`recipient_user_id: null` (shared inbox); (g) an old and a fresh message in the
same conversation â†’ only the old one is due.

`isValidEmoji` â€” accepts multi-codepoint sequences (`ðŸ‘¨â€ðŸ‘©â€ðŸ‘§`, `ðŸ‹ï¸â€â™€ï¸`);
rejects text, empty string, bare digits, and anything over 16 chars.

**Implementation notes.** `split(input)` is the shared private helper: skip
already-notified, skip anything younger than `delayMs`, then partition into
`due` (recipient's `last_read_at` is null or older than the message) and `read`.
`messagesNeedingEmail` groups `due` by `conversation_id + recipient_role`;
`alreadyReadIds` returns `read`. Emoji regex:
`/^(?:\p{Extended_Pictographic}|\p{Emoji_Component})+$/u` with a
`/^[0-9#*]+$/` pre-rejection.

**Mutation probes:** `>` â†’ `>=` in `unreadCount` (boundary test must fail);
drop the `email_notified_at` guard (case d must fail); neuter the delay
comparison (case a must fail).

**Commit:** `feat(messaging): unread arithmetic, email selection, emoji validation`

---

### Task 4: Realtime token â€” signing + route

**Files:**
- Create: `lib/messaging/realtime-token.ts`, `app/api/messaging/realtime-token/route.ts`
- Test: `__tests__/api/messaging/realtime-token.test.ts`
- Modify: `package.json` (add `jose`), `.env.example`

**Interfaces â€” Produces:** `signRealtimeToken(userId: string): Promise<{token: string; expiresAt: number}>`;
`GET /api/messaging/realtime-token` â†’ `200 {token, expiresAt}` Â· `401` unauthenticated Â· `503` when `SUPABASE_JWT_SECRET` is unset.

**Implementation.** `npm install jose` (already transitive via next-auth â€”
make it direct). Sign HS256 with `{ role: "authenticated" }`, `.setSubject(userId)`,
`.setAudience("authenticated")`, 1 hour TTL, key `new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)`.
The route returns 503 rather than 500 on a missing secret so the dock can render
"live updates unavailable" instead of failing silently.

**Required behaviours:** 401 unauthenticated Â· 503 with the secret deleted Â·
decoded claims carry `sub` = session user id, `role`/`aud` = `authenticated`,
future `exp` Â· **`jwtVerify` with a different secret rejects, with the real
secret resolves** (this is what proves the token is actually signed, not just
shaped correctly).

**Mutation probe:** hardcode `.setSubject("anyone")` â€” the claims test must fail.

**Commit:** `feat(messaging): mint short-lived Supabase realtime tokens`

---

### Task 5: DAL â€” conversations + messages

**Files:**
- Create: `lib/db/conversations.ts`, `lib/db/messages.ts`

**Interfaces â€” Produces:**
```typescript
// lib/db/conversations.ts
getOrCreateConversation(clientUserId: string): Promise<Conversation>
getConversationById(id: string): Promise<Conversation | null>
getConversationForClient(clientUserId: string): Promise<Conversation | null>
listConversationsWithClients(): Promise<ConversationWithClient[]>
  // ConversationWithClient = Conversation & { client: { id, name, email, avatar_url } , unread_count: number }
listConversationsForNotify(): Promise<Conversation[]>
markRead(conversationId: string, side: MessageSenderRole, at?: string): Promise<void>

// lib/db/messages.ts
listMessages(conversationId: string, limit?: number, before?: string): Promise<MessageWithExtras[]>
getMessageWithExtras(messageId: string): Promise<MessageWithExtras | null>
createMessage(input: CreateMessageInput): Promise<{ message_id: string; created_at: string }>
  // CreateMessageInput = { conversation_id, sender_user_id, sender_role, body, preview, attachments: AttachmentRow[] }
getAttachmentById(id: string): Promise<(MessageAttachment & { conversation_id: string }) | null>
toggleReaction(messageId, userId, emoji): Promise<{ added: boolean }>
countReactionsByUser(messageId: string, userId: string): Promise<number>
listUnnotifiedMessages(): Promise<Message[]>
stampNotified(messageIds: string[]): Promise<void>
```

**Implementation notes.** Service-role client throughout (`createServiceRoleClient`),
matching every other file in `lib/db/`. `createMessage` calls the
`create_message` RPC â€” never a bare insert â€” so `conversations.last_message_*`
cannot drift from the thread. `listConversationsWithClients` derives
`unread_count` with `unreadCount()` from Task 3 rather than reading a stored
counter. `toggleReaction` deletes on conflict and inserts otherwise, returning
which happened so the optimistic UI can reconcile.

**No dedicated test file** â€” this layer is thin IO over Supabase and is
exercised through the route tests, which is how every other DAL file in this
repo is covered.

**Commit:** `feat(messaging): data access for conversations and messages`

---

### Task 6: Attachment storage + upload-url route

**Files:**
- Create: `lib/messaging/storage.ts`, `app/api/messaging/attachments/upload-url/route.ts`
- Test: `__tests__/api/messaging/attachments-upload-url.test.ts`

**Interfaces â€” Produces:**
```typescript
createAttachmentUploadUrl(input: {storagePath: string; contentType: string}): Promise<{uploadUrl: string; storagePath: string; expiresInSeconds: number}>
verifyUploadedObject(storagePath: string): Promise<{ok: true; size: number; contentType: string} | {ok: false; reason: "missing" | "too_large" | "wrong_type"}>
createAttachmentReadUrl(storagePath: string, ttlMs?: number): Promise<string>
deleteAttachmentObject(storagePath: string): Promise<void>
```
`POST /api/messaging/attachments/upload-url` body `{conversation_id, files: [{filename, mime_type, byte_size}]}`
â†’ `200 {uploads: [{upload_id, storage_path, upload_url, expires_in_seconds}]}` Â· `400` invalid Â· `401` Â· `403` not a participant.

**Implementation.** Mirrors `lib/storage/team-videos.ts` â€” `getAdminStorage().bucket().file(path).getSignedUrl({version:"v4", action:"write", contentType, expires})`.
`verifyUploadedObject` calls `getMetadata()` and checks the **real** size against
`MAX_ATTACHMENT_BYTES` and the real `contentType` against the allowlist.

**Required behaviours:** 401 unauthenticated Â· 403 when a client requests an
upload URL for someone else's conversation Â· 400 on an oversize *declared*
size Â· 400 on a disallowed mime Â· 200 returns one signed URL per file with the
sanitized `messaging/<conversationId>/<uploadId>/<name>` path.

**Mutation probe:** drop the declared-size check in the route â€” the oversize
test must fail.

**Commit:** `feat(messaging): signed upload URLs for chat attachments`

---

### Task 7: Conversation routes â€” list, thread, mark-read

**Files:**
- Create: `app/api/messaging/conversations/route.ts`, `app/api/messaging/conversations/[id]/route.ts`, `app/api/messaging/conversations/[id]/read/route.ts`
- Create: `lib/messaging/access.ts` â€” `resolveParticipant(session, conversationId)` â†’ `{ role: MessageSenderRole; conversation: Conversation } | null`
- Test: `__tests__/api/messaging/conversations.test.ts`

**Interfaces â€” Produces:**
- `GET /api/messaging/conversations` â†’ admin: every conversation with client + unread; client: their own (get-or-create so a first-time client has a thread to open).
- `POST /api/messaging/conversations` `{client_user_id}` â†’ admin-only get-or-create. Writes an audit row `messaging.conversation_created`.
- `GET /api/messaging/conversations/[id]` â†’ `{conversation, messages: MessageWithExtras[], participant_role}`.
- `POST /api/messaging/conversations/[id]/read` â†’ stamps the caller's side, returns `{read_at}`.

**`lib/messaging/access.ts` is the single authorization decision** for every
conversation-scoped route: admin â†’ `"admin"`; the owning client â†’ `"client"`;
anyone else â†’ `null` (403). Every route calls it; none re-derives the rule.

**Required behaviours:** 401 unauthenticated Â· **a client GETting another
client's conversation gets 403** Â· admin list includes `unread_count` Â· client
list auto-creates their conversation Â· mark-read stamps only the caller's side
(assert the *other* side's timestamp is untouched).

**Mutation probe:** make `resolveParticipant` return `"client"` for any
logged-in user â€” the cross-client 403 test must fail.

**Commit:** `feat(messaging): conversation list, thread, and read-state routes`

---

### Task 8: Send route â€” the one that verifies real object size

**Files:**
- Create: `app/api/messaging/messages/route.ts`
- Test: `__tests__/api/messaging/send-message.test.ts`

**Interfaces â€” Consumes:** `resolveParticipant`, `validateAttachmentSpecs`,
`verifyUploadedObject`, `deleteAttachmentObject`, `kindForMime`, `previewFor`,
`createMessage`.
**Produces:** `POST /api/messaging/messages` body
`{conversation_id, body?, attachments?: [{storage_path, mime_type, byte_size, original_filename?, width?, height?, duration_seconds?}]}`
â†’ `201 {message}` Â· `400` Â· `401` Â· `403` Â· `413` oversize.

**The critical behaviour.** A signed PUT URL constrains `Content-Type` but **not
length** â€” a client that lies about `byte_size` can upload a gigabyte and the
declared-size check in Task 6 will have waved it through. So before inserting
anything, the route calls `verifyUploadedObject` on every path and compares the
**real** metadata. On any failure: delete every object belonging to this send,
insert nothing, return 413 or 400.

**Required behaviours:** rejects a message with neither body nor attachments Â·
rejects a body over `MAX_BODY_LENGTH` Â· 403 for a non-participant Â·
**`verifyUploadedObject` reporting `too_large` deletes the stored object and
returns 413 with no message row created** Â· a valid send calls `createMessage`
with `sender_role` derived from the session (never from the request body) and a
`preview` from `previewFor` Â· attachment `kind` is derived server-side from the
**verified** content type, not the client's claim.

**Mutation probes:** (1) skip `verifyUploadedObject` â€” the too-large test must
fail; (2) take `sender_role` from the request body â€” add an assertion that a
client claiming `sender_role: "admin"` is still stored as `"client"`, and
confirm it fails.

**Commit:** `feat(messaging): send messages with server-verified attachments`

---

### Task 9: Reaction toggle + attachment redirect routes

**Files:**
- Create: `app/api/messaging/messages/[id]/reactions/route.ts`, `app/api/messaging/attachments/[id]/route.ts`
- Test: `__tests__/api/messaging/reactions.test.ts`, `__tests__/api/messaging/attachment-redirect.test.ts`

**Interfaces â€” Produces:**
- `POST /api/messaging/messages/[id]/reactions` `{emoji}` â†’ `200 {added: boolean}` Â· `400` invalid emoji Â· `403` Â· `429` over `MAX_REACTIONS_PER_USER`.
- `GET /api/messaging/attachments/[id]?redirect=1` â†’ `302` to a freshly signed read URL; without `redirect=1` â†’ `200 {url, kind, mime_type, width, height}`.

**Why the redirect exists.** A raw signed GCS URL written into a durable `src`
expires and becomes a broken image in a thread people scroll back through for
weeks. This route re-signs per hit, so the `src` stored in the DOM is a stable
app URL.

**Required behaviours:** a second identical POST removes the reaction
(`added: false`) Â· a non-emoji body is 400 Â· a client cannot react on another
client's message (403) Â· over the per-user cap returns 429 Â· the attachment
route 403s a non-participant and **302s to a URL containing a fresh signature**
(assert the `Location` header differs across two calls with a moved clock).

**Mutation probe:** return the same cached URL from `createAttachmentReadUrl` â€”
the freshness test must fail.

**Commit:** `feat(messaging): emoji reactions and durable attachment links`

---

### Task 10: MessagingProvider â€” socket, token refresh, subscriptions

**Files:**
- Create: `components/messaging/MessagingProvider.tsx`, `hooks/use-messaging.ts`
- Test: `__tests__/components/messaging/MessagingProvider.test.tsx`

**Interfaces â€” Produces:** `<MessagingProvider>` (client component) and
`useMessaging()` returning
`{conversations, totalUnread, activeConversationId, openConversation(id), closeConversation(), messages, sendMessage(input), toggleReaction(messageId, emoji), typingFromOther, isOtherOnline, connectionState, refresh()}`.

**Implementation.** On mount: `GET /api/messaging/realtime-token`, build a
Supabase client with `createClient(url, anonKey)`, call
`supabase.realtime.setAuth(token)`, then subscribe to **one unfiltered**
`postgres_changes` INSERT on `messages` and INSERT+DELETE on `message_reactions`
â€” RLS scopes both, so a client receives only their rows and an admin receives
all. Refresh the token at 50 minutes and on `visibilitychange`, calling
`setAuth` again on the live socket. A 503 from the token route sets
`connectionState: "unavailable"` and the UI degrades to fetch-on-open rather
than pretending to be live.

When an inserted message has `attachment_count > 0`, fetch that message's
descriptors; otherwise the realtime payload is the whole bubble.

**Required behaviours (component tests, socket mocked):** an inserted message
for the open conversation appends exactly once Â· an insert for a *different*
conversation bumps `totalUnread` without touching the open thread Â· a reaction
DELETE carrying only `{id}` removes that reaction Â· a 503 token response yields
`connectionState: "unavailable"` and does not throw.

**Commit:** `feat(messaging): realtime provider with token refresh`

---

### Task 11: Thread UI â€” bubble, attachments, reactions, composer

**Files:**
- Create: `components/messaging/MessageBubble.tsx`, `MessageAttachment.tsx`, `ReactionBar.tsx`, `EmojiPicker.tsx`, `MessageThread.tsx`, `MessageComposer.tsx`, `TypingIndicator.tsx`, `PresenceDot.tsx`
- Test: `__tests__/components/messaging/MessageThread.test.tsx`

**Emoji picker decision.** Try `emoji-picker-react` with `emojiStyle="native"`
and `lazyLoadEmojis={false}`. **Before committing, assert no external network
request:** if the package fetches its data from a CDN it needs a
`next.config.mjs` CSP entry, and a missing CSP host is invisible to tests unless
asserted. If it does hit a CDN, fall back to a bundled curated set
(`lib/messaging/emoji-data.ts`, ~8 groups) with zero network dependency.

**Rendering rules.** Images render **inline** â€” capped at `max-h-64`,
`object-cover`, click opens a lightbox â€” never as a "click to view" link; that
was the explicit ask. Video is `<video preload="metadata" controls>` so the
browser paints a first frame without a transcode. `width`/`height` from the
attachment row set an aspect ratio so the thread does not reflow as images load.
Own messages align right with `bg-primary text-primary-foreground`; the other
side aligns left with `bg-surface`. Semantic classes only.

**Composer.** Textarea + attach button + emoji button + Send. âŒ˜/Ctrl+Enter
sends. Attachments show per-file upload progress from the PUT's `onprogress`,
and Send stays disabled until every upload settles. A file over 25 MB is
rejected **before** any request with the message from `validateAttachmentSpecs`.
Typing broadcasts are throttled to one per 2 seconds.

**Required behaviours:** an image attachment renders an `<img>` (not a link) Â·
a video renders a `<video>` Â· a 26 MB file shows the size error and issues no
fetch Â· reacting calls `toggleReaction` and paints optimistically Â· the typing
indicator appears only for the other participant, never your own broadcast.

**Commit:** `feat(messaging): message thread, attachments, reactions, composer`

---

### Task 12: The dock + mounting in both shells

**Files:**
- Create: `components/messaging/MessagingDock.tsx`, `ConversationList.tsx`
- Modify: `components/client/ClientLayout.tsx`, `app/(admin)/admin/layout.tsx`
- Test: `__tests__/components/messaging/MessagingDock.test.tsx`

**Behaviour.** Collapsed: a bottom-right pill (`fixed bottom-4 right-4 z-40`)
with the total unread badge. Expanded: a 360Ã—480 panel switching between the
conversation list and a thread, with back / expand-to-full-page / close in the
header. On mobile it opens as a full-height sheet and sits **above** the
existing bottom tab bar (`bottom-20` on small screens) so it never covers
navigation.

Mounted inside `ClientLayout` and the admin layout, so it exists on every
authenticated page and is absent from marketing and auth routes by construction.

**Required behaviours:** renders the unread badge and hides it at zero Â·
clicking a conversation opens the thread and marks it read Â· the collapsed pill
does not render its panel content (assert the composer is absent until opened).

**Commit:** `feat(messaging): bottom-right messaging dock`

---

### Task 13: Full-page inboxes

**Files:**
- Create: `app/(admin)/admin/messages/page.tsx`, `app/(client)/client/messages/page.tsx`, `components/messaging/InboxPage.tsx`
- Modify: `components/client/ClientLayout.tsx` (nav item), admin sidebar nav
- Test: `__tests__/components/messaging/InboxPage.test.tsx`

`/admin/messages` is the two-pane layout â€” searchable conversation list left,
thread right, plus a "New message" client picker that calls
`POST /api/messaging/conversations`. `/client/messages` is **just the thread**: a
client has exactly one conversation, so a list would be a list of one.

**Commit:** `feat(messaging): full-page inbox for coach and client`

---

### Task 14: Delayed email notifier + cron

**Files:**
- Create: `lib/messaging/email-new-message.ts`, `app/api/admin/internal/messaging-notify/route.ts`
- Modify: `functions/src/index.ts` (add `messagingNotifyCron`), `lib/messaging/config.ts` (flag key)
- Test: `__tests__/api/messaging/notify-cron.test.ts`

**Route shape** mirrors `bookkeeping-close-nudge` exactly: bearer
`INTERNAL_CRON_TOKEN` â†’ `isCronSkipped({enabledKey: "cron_messaging_email_enabled", defaultEnabled: false})`
â†’ `logCronStart` â†’ work â†’ `logCronEnd`. The route is the **single** `cron_runs`
owner; the Firebase function must not log.

**Work:** `listUnnotifiedMessages()` + `listConversationsForNotify()` â†’
`messagesNeedingEmail({now: Date.now(), delayMs: EMAIL_DELAY_MS})` â†’
for each group, check `notification_preferences.email_notifications` â†’
`sendNewMessageEmail` â†’ `stampNotified([...emailed, ...alreadyReadIds(input)])`.
Admin-side groups go to `COACH_EMAIL`.

**Cron:** `onSchedule({schedule: "*/5 * * * *", timeZone: "Etc/UTC", timeoutSeconds: 120, memory: "256MiB", region: "us-central1", secrets: [internalCronToken, appUrl]})`,
a pure fetch-delegator.

**Required behaviours:** 401 without the bearer token Â· **skips entirely when
the flag is off** Â· emails one group and stamps its ids Â· stamps already-read
ids **without** emailing Â· a recipient with `email_notifications: false` is
skipped but still stamped (otherwise it is reconsidered forever).

**Mutation probe:** stamp only the emailed ids â€” the already-read stamping test
must fail.

**Commit:** `feat(messaging): delayed unread-message email + 5-minute cron`

---

## Self-Review

**Spec coverage:** dock (T12) Â· full page (T13) Â· realtime messages/reactions
(T1 publication, T10 subscriptions) Â· typing + presence (T1 channel policies,
T10 channel, T11 indicator) Â· read receipts (T3 arithmetic, T7 route, T11
display) Â· attachments 25 MB (T2 limits, T6 sign, T8 verify, T9 durable links,
T11 render) Â· emoji reactions (T3 validation, T9 route, T11 picker) Â· delayed
email (T3 selection, T14 cron) Â· JWT auth (T4) Â· RLS (T1) Â· audit on
conversation creation (T7). No spec section is unimplemented.

**Placeholder scan:** no TBD/TODO; every task names exact files, exact
signatures, and the specific behaviours its tests must assert.

**Type consistency:** `MessageSenderRole` / `AttachmentKind` (T1) are used
verbatim in T2, T3, T5, T7. `NotifyInput`/`NotifyGroup` (T3) match T14's usage.
`resolveParticipant` (T7) is consumed with the same signature in T8 and T9.
`MessageWithExtras` (T1) is what T5 returns and T10/T11 consume.

**Known ordering constraint:** T5 (DAL) has no test file of its own by design â€”
it is covered through T7/T8/T9 route tests, matching how every other
`lib/db/*.ts` in this repo is verified.

## Ops checklist (owner)

1. `SUPABASE_JWT_SECRET` â†’ Vercel (all environments) **and** `.env.local`.
2. Supabase â†’ Realtime settings â†’ turn **off** "Allow public access".
3. Apply `00199_client_messaging.sql`.
4. Flip `cron_messaging_email_enabled` once a test message renders correctly.


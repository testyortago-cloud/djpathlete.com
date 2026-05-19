# Form Review Voice Feedback — Design Spec

**Date:** 2026-05-19
**Author:** Claude (Opus 4.7) with tayawaaean
**Status:** Draft — awaiting approval
**Related:** [components/shared/FormReviewThread.tsx](../../../components/shared/FormReviewThread.tsx), [supabase/migrations/00042_form_reviews.sql](../../../supabase/migrations/00042_form_reviews.sql), [storage.rules](../../../storage.rules), [app/api/admin/form-reviews/[id]/messages/route.ts](../../../app/api/admin/form-reviews/[id]/messages/route.ts), [app/api/client/form-reviews/[id]/messages/route.ts](../../../app/api/client/form-reviews/[id]/messages/route.ts)

## Problem

Form-review threads in [FormReviewThread.tsx](../../../components/shared/FormReviewThread.tsx) currently support text messages only. Coaching feedback on movement quality is inherently verbal — cueing tempo, breath, and bracing in writing is slower to produce, less expressive, and harder for clients to absorb. Both the coach and clients should be able to send short voice messages inline in a review thread.

## Goals

- Either side (coach or client) can record and send a short voice message in a form-review thread.
- Voice messages render inline in the existing thread alongside text messages, in order.
- Reuse existing notification + email plumbing — voice messages trigger the same emails and in-app notifications, with a distinct preview line (🎧 voice message + duration).
- Mirror the existing form-review *video* upload pattern (direct browser → Firebase Storage upload, Next.js API enforces auth + writes the DB row) — no new media backend.
- Schema is extensible: adding image, file, or annotated-screenshot attachments later is additive, not a migration.

## Non-goals

- **Waveform visualization.** Plain `<audio controls>` only.
- **Pause / resume during recording.** Single contiguous take per message.
- **File upload fallback.** Live browser recording only; if `MediaRecorder` / `getUserMedia` is unavailable, the mic button is hidden.
- **Transcription.** Out of scope. Architecture allows a future `transcript TEXT` column on the attachments table, populated by a background job.
- **Text + audio in the same message ("caption + voice note").** A message is either text OR audio per send. The schema technically allows multiple attachments per message for future extension, but the recorder UI only ever sends one audio attachment, and the recorder + text input are mutually exclusive at the UI/API layer.
- **Tightening Firebase Storage read rules.** Storage rules stay `allow read: if true` for the new audio path (matching existing videos). Architecture supports a later flip to signed-URL-only reads without UI rework.
- **Feature flag.** Recorder ships to everyone in one deploy.

## Constraints

- **Max length:** 120 seconds per recording. MediaRecorder timer auto-stops at 2:00.
- **Max size:** 3 MB per audio blob (defense-in-depth — Firebase storage rule, Zod validator, and recorder bitrate all enforce).
- **Allowed mime types:** `audio/webm`, `audio/mp4`, `audio/ogg`. Browser picks the best available; iOS Safari falls back to `audio/mp4`.
- **Path namespace:** `form-review-audio/{userId}/{timestamp}.{ext}` in Firebase Storage. The leading `{userId}` is verified server-side against the session.

## Data model

### New table — `form_review_message_attachments`

```sql
CREATE TABLE form_review_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES form_review_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio')),  -- expands later: 'image', 'file', etc.
  storage_path TEXT NOT NULL,                    -- Firebase path
  mime_type TEXT NOT NULL,
  duration_seconds INT,                          -- nullable; populated for audio
  byte_size INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_form_review_attachments_message ON form_review_message_attachments(message_id);

ALTER TABLE form_review_messages
  ALTER COLUMN message DROP NOT NULL;
```

App-layer rule: a message row must have non-null `message` OR at least one attachment. (Not enforceable as a SQL CHECK because attachment-existence requires a subquery; enforced in the API route and DAL.)

### RLS policies (mirror `form_review_messages`)

- Clients can SELECT attachments on messages on their own reviews.
- Clients can INSERT attachments only when the parent message belongs to them on their own review.
- Admins can SELECT and INSERT attachments on any message.
- DELETE is not exposed (cascade-only via parent message).

### Type changes

`types/database.ts` adds:

```ts
export type FormReviewMessageAttachmentKind = 'audio'

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

`FormReviewMessage.message` becomes `string | null`.

## Upload + API flow

```
[Browser]                          [Firebase Storage]      [Next.js API]            [Supabase]
   │                                       │                    │                        │
   │ click mic → getUserMedia              │                    │                        │
   │ MediaRecorder.start()                 │                    │                        │
   │  ...up to 120s...                     │                    │                        │
   │ stop → blob                           │                    │                        │
   │ uploadBytesResumable(blob, path) ───→ │                    │                        │
   │                                       │ stored             │                        │
   │ ←──────────────────────────────────── │                    │                        │
   │ POST /messages { audio: {…} } ──────────────────────────→  │                        │
   │                                       │ verify path owner ─┤                        │
   │                                       │                    │ rpc(create_message…)─→ │
   │                                       │                    │                        │ insert msg + attachment
   │                                       │                    │ ←──────────────────────│
   │ ←─────────────────────────────────────────────────────────  │                        │
   │ append to thread state                │                    │                        │
```

### Path-ownership check (server-side)

The POST handler verifies the submitted `storage_path` begins with `form-review-audio/{session.user.id}/` before inserting. This prevents one user from attaching another user's audio file by passing a foreign path.

### Existing `messages` route changes

Both `app/api/client/form-reviews/[id]/messages/route.ts` and `app/api/admin/form-reviews/[id]/messages/route.ts` change their Zod validator to a discriminated union:

```ts
const messageSchema = z.union([
  z.object({ message: z.string().min(1).max(5000) }),
  z.object({
    audio: z.object({
      storage_path: z.string().regex(/^form-review-audio\/[^/]+\/[^/]+$/),
      mime_type: z.enum(['audio/webm', 'audio/mp4', 'audio/ogg']),
      duration_seconds: z.number().int().min(1).max(120),
      byte_size: z.number().int().min(1).max(3 * 1024 * 1024),
    }),
  }),
])
```

Handler branches:

- **Text branch:** inserts into `form_review_messages` as today — unchanged.
- **Audio branch:** verifies path ownership → inserts message row (`message = NULL`) + attachment row in a single Postgres function `create_form_review_message_with_attachment(p_review_id, p_user_id, p_kind, p_storage_path, p_mime_type, p_duration_seconds, p_byte_size)` invoked via `supabase.rpc(...)`. The function returns the new message row with the attachment joined in, matching the shape `getFormReviewMessages` already returns.

Status auto-update (`pending` → `in_progress`), in-app notification, and email — all unchanged code paths; they fire for both text and audio messages.

### Storage rules

Append to `storage.rules`:

```
match /form-review-audio/{userId}/{fileName} {
  allow read: if true;
  allow write: if request.resource.size < 3 * 1024 * 1024
               && request.resource.contentType.matches('audio/.*');
}
```

## UI components

### New: `VoiceRecorder` ([components/shared/VoiceRecorder.tsx](../../../components/shared/VoiceRecorder.tsx))

Self-contained recorder, used in both client and admin thread inputs.

**Props:**

```ts
interface VoiceRecorderProps {
  userId: string
  onSend(payload: { storage_path: string; mime_type: string; duration_seconds: number; byte_size: number }): Promise<void>
  disabled?: boolean
}
```

**State machine:**

```
idle ──click mic──→ requesting-permission ──granted──→ recording (0:00 → 2:00)
                                          ──denied──→ idle + toast
recording ──stop / 2:00 timer──→ stopped (preview: Play / Delete / Send)
stopped ──click Send──→ uploading (% progress) ──→ idle (parent appends message)
stopped ──click Delete──→ idle
```

**Implementation notes:**

- Feature-detect `window.MediaRecorder` and `navigator.mediaDevices.getUserMedia`; if either missing, render nothing (no mic button at all).
- Mime type detection: try `audio/webm;codecs=opus` first; if `MediaRecorder.isTypeSupported` returns false, fall back to `audio/mp4` (iOS Safari).
- Bitrate: 128 kbps (Opus or AAC depending on container).
- Auto-stop timer using `setTimeout(120_000)` on recording start; manual Stop button always present.
- Upload uses `uploadBytesResumable` from `firebase/storage` (already imported elsewhere in the codebase — see [components/client/FormReviewUploadForm.tsx](../../../components/client/FormReviewUploadForm.tsx)).
- Cleanup: `stream.getTracks().forEach(t => t.stop())` on unmount and on every state transition leaving `recording`.

### Edited: `FormReviewThread` ([components/shared/FormReviewThread.tsx](../../../components/shared/FormReviewThread.tsx))

- Extend the `Message` interface with optional `attachments: Array<{ kind: 'audio', storage_path: string, mime_type: string, duration_seconds: number | null }>`.
- When `message` is null and an audio attachment exists, render the bubble as an inline `<audio controls>` element. Source is a signed Firebase download URL fetched lazily from `/api/form-review-audio/sign?path=...` on first mount, cached in component state. Show `(M:SS)` duration label next to the player.
- Mount `<VoiceRecorder userId={currentUserId} onSend={handleSendAudio} disabled={sending} />` adjacent to the existing Send button. Both kinds of send funnel into the same `setMessages` append path.

### Edited: form review feedback email template

In whichever template `sendFormReviewFeedbackEmail` renders ([lib/email.ts](../../../lib/email.ts) → `components/emails/...`), branch on the latest message's kind:

- Text: existing preview snippet.
- Audio: literal string `🎧 Voice message (M:SS)`.

CTA button (`View review` linking to `/client/form-reviews/{id}` or admin equivalent) is unchanged.

## Playback signing endpoint

New route: `GET /api/form-review-audio/sign?path=<storage_path>`.

- Requires NextAuth session.
- Looks up the parent message via the attachment's `storage_path`. Authorizes if the requester is the message author, the parent review's client owner, or admin.
- Returns `{ url, expires_at }` — a Firebase signed download URL with 1 h TTL, generated via `getDownloadURL` with a custom token TTL.
- `FormReviewThread` caches the URL in component state per attachment so re-renders don't re-sign.

This indirection lets us later flip the Firebase storage rule from `allow read: if true` to `allow read: if false` without changing any UI code — signed URLs become the only read path.

## Audit log

Add to [lib/audit/actions.ts](../../../lib/audit/actions.ts):

- `form_review.message.audio_sent` — recorded in the existing `messages` POST handler when the audio branch succeeds.

Playback tracking (`audio_played`) is **not** added — playback events are high-volume client signals better suited to product analytics than the audit log.

## Testing

### Unit

- **Zod validator** ([app/api/client/form-reviews/[id]/messages/route.ts](../../../app/api/client/form-reviews/[id]/messages/route.ts) shared schema):
  - text-only ✓, audio-only ✓, both rejected, neither rejected
  - oversized byte_size rejected, duration > 120 rejected
  - bad mime rejected (e.g. `application/pdf`)
  - storage_path not matching `form-review-audio/...` rejected
- **DAL** ([lib/db/form-reviews.ts](../../../lib/db/form-reviews.ts)):
  - `createFormReviewMessage` text path unchanged
  - new `createFormReviewMessageWithAudio` calls the RPC and returns the joined shape
  - `getFormReviewMessages` returns attachments array on each message
- **Email template** renders audio preview vs text preview correctly.

### Component

- **VoiceRecorder** state machine using mocked `MediaRecorder` and `getUserMedia`:
  - idle → recording → stopped → uploading → idle (happy path)
  - permission denied → idle + toast
  - auto-stop at 120 s
  - browser without MediaRecorder support → renders nothing
- **FormReviewThread** renders correct bubble type per message; fetches signed URL on first render of audio bubble; caches URL across re-renders.

### E2E (Playwright)

One happy-path test: admin records a 5-second clip in `/admin/form-reviews/[id]`, switches to the client account, opens the corresponding `/client/form-reviews/[id]`, asserts an `<audio>` element with the expected `data-duration` attribute renders. Use Chromium's `--use-fake-device-for-media-stream` flag to inject a deterministic audio source.

## Migration + rollout

- **Migration:** `supabase/migrations/00156_form_review_message_attachments.sql` containing the table, indexes, RLS policies, `ALTER COLUMN message DROP NOT NULL`, and the `create_form_review_message_with_attachment` Postgres function. Apply via `mcp__supabase__apply_migration` per project memory.
- **Storage rules:** Manual `firebase deploy --only storage` step after merging the `storage.rules` change. Document in [docs/superpowers/runbooks/](../runbooks/) if a runbook exists for storage rule deploys, or note in the PR description.
- **No feature flag.** Recorder appears for everyone on first deploy. Rollback path is reverting the UI commit — the schema additions are forward-compatible (text-only messages keep working).
- **Type regeneration:** after migration, regenerate Supabase types and update [types/database.ts](../../../types/database.ts) with the new attachment interface and the nullable `message` change.

## File touch list

**New files:**

- `supabase/migrations/00156_form_review_message_attachments.sql`
- `components/shared/VoiceRecorder.tsx`
- `app/api/form-review-audio/sign/route.ts`
- Tests: `__tests__/components/VoiceRecorder.test.tsx`, `__tests__/lib/db/form-reviews-audio.test.ts`, `__tests__/api/form-review-audio-sign.test.ts`, `__tests__/e2e/form-review-voice.spec.ts`

**Edited files:**

- `components/shared/FormReviewThread.tsx` — attachment rendering, recorder integration
- `app/api/admin/form-reviews/[id]/messages/route.ts` — discriminated-union validator, audio branch
- `app/api/client/form-reviews/[id]/messages/route.ts` — same
- `lib/db/form-reviews.ts` — `createFormReviewMessageWithAudio`, attachment join in `getFormReviewMessages`
- `lib/validators/` — new attachment schema if a validators file for form reviews exists
- `lib/audit/actions.ts` — `form_review.message.audio_sent`
- `lib/email.ts` and the underlying email template — audio preview branch
- `storage.rules` — new `form-review-audio` block
- `types/database.ts` — `FormReviewMessageAttachment`, nullable `FormReviewMessage.message`

## Open questions

None at spec time. Surface during implementation if discovered.

# Client Messaging — realtime coach ↔ client chat

**Date:** 2026-08-04
**Status:** Design approved (transport + feature set chosen by the owner; remaining
detail decisions made autonomously and flagged below)

## Problem

There is no way for the coach and a client to have an ordinary conversation in the
app. The only threaded surface is `form_review_messages`, which is welded to a
single uploaded video: you cannot start a conversation, you cannot talk about
anything that is not a form review, and there is no unread state or notification.
Everything else goes out of band — text messages, GHL, email — so the coaching
record lives in three places and none of them is the app.

## Goals

A LinkedIn-style messaging experience:

- A **dock in the bottom-right corner** of both the admin shell and the client
  portal: collapsed pill with an unread badge → conversation list → thread, all
  without leaving the page you are on.
- A **full-page inbox** (`/admin/messages`, `/client/messages`) for long threads
  and larger media, built from the same components.
- **Realtime delivery** — messages, reactions, typing indicators, and an
  online dot, over Supabase Realtime.
- **Image and video attachments** up to 25 MB, stored in Firebase, rendered
  inline in the thread (not behind a click).
- **Emoji reactions** on any message, from a full picker.
- **An email** to the recipient when a message goes unread.

## Decisions

Chosen by the owner during brainstorming:

| Decision | Choice |
| --- | --- |
| Participants | Coach ↔ client, 1:1 only. No client-to-client, no group threads. |
| Email trigger | Only if still unread after a delay. Not one email per message. |
| Live extras | Read receipts, typing indicator, online/last-active dot — all three. |
| Reactions | Full emoji picker, any emoji. |
| Surfaces | Dock **and** full-page inbox. |
| Transport | Postgres as source of truth + Supabase Realtime, authorized by a server-minted JWT. |

Made autonomously while the owner was away, because each has an obvious default
and none changes the shape of the system:

| Decision | Choice | Why |
| --- | --- | --- |
| Admin side of a conversation | A **shared inbox** — any admin sees every conversation, and read state is per-side, not per-admin. | Solo operator. Modelling per-admin read state would add a participants table to serve a second coach who does not exist. If one is added later they share the inbox, which is how a support inbox behaves anyway. |
| Editing / deleting messages | Out of scope. | Not requested. Soft-delete plus its realtime and email interactions is its own feature. |
| Reply-by-email | Out of scope. | Needs an inbound mail route and reply-quote stripping; the notification email links into the app instead. |
| Attachment types | Images and video only. No PDFs or documents. | The request said "image video attachment". Widening the allowlist widens the render surface. |
| Attachments per message | 5 | A bound has to exist; 5 covers a photo set without letting one message hold 125 MB. |
| Audit logging | Messages are **not** written to `audit_logs`. | Same rule the codebase already applies to per-set workout logs and page visits: the `messages` table *is* the record, and per-message audit rows would swamp the trail. Conversation *creation* is audited. |

## Architecture

```
 browser                          Next.js (Vercel)                  Postgres
┌──────────────────┐   writes   ┌───────────────────────┐  service ┌──────────────┐
│ MessagingProvider├───────────►│ /api/messaging/*      ├─────────►│ conversations│
│                  │            │  validate, cap, store │   role   │ messages     │
│                  │◄───────────┤                       │          │ attachments  │
│                  │   reads    └───────────────────────┘          │ reactions    │
│                  │                                               └──────┬───────┘
│ supabase-js      │                    realtime (postgres_changes, RLS)  │
│ (realtime ONLY)  │◄──────────────────────────────────────────────────────┘
└────────┬─────────┘
         │ signed PUT (≤25 MB)          ┌─────────────────┐
         └─────────────────────────────►│ Firebase Storage│
                                        └─────────────────┘
```

Three rules hold this together:

1. **Every write goes through a Next.js route on the service-role client.**
   Validation, the size cap, the attachment allowlist, and email scheduling are
   server concerns. RLS therefore only ever has to grant `SELECT`.
2. **The browser's Supabase client is realtime-only.** It never queries a table.
   Reads come from our own API routes, which already know how to authorize a
   NextAuth session. This keeps the RLS surface to exactly what Realtime needs
   to evaluate, and means a bug in a policy cannot leak a table to the browser.
3. **Bytes never pass through Vercel.** The browser PUTs to a server-signed
   Firebase URL, exactly as [`lib/storage/team-videos.ts`](../../../lib/storage/team-videos.ts)
   already does for team videos.

## Data model

Migration `00199_client_messaging.sql`.

```sql
conversations
  id                  uuid pk
  client_user_id      uuid not null unique references users(id) on delete cascade
  created_at          timestamptz not null default now()
  last_message_at     timestamptz
  last_message_preview text            -- first ~120 chars, or '📷 Photo' / '🎥 Video'
  last_message_sender_role text        -- 'admin' | 'client'
  client_last_read_at timestamptz
  admin_last_read_at  timestamptz

messages
  id               uuid pk
  conversation_id  uuid not null references conversations(id) on delete cascade
  sender_user_id   uuid not null references users(id) on delete cascade
  sender_role      text not null check (sender_role in ('admin','client'))
  body             text                 -- nullable: attachment-only messages
  attachment_count int  not null default 0
  created_at       timestamptz not null default now()
  email_notified_at timestamptz         -- stamped by the notifier cron

message_attachments
  id             uuid pk
  message_id     uuid not null references messages(id) on delete cascade
  kind           text not null check (kind in ('image','video'))
  storage_path   text not null
  mime_type      text not null
  byte_size      int  not null
  width, height  int                    -- images: reserve layout space
  duration_seconds numeric              -- video, when the browser reports it
  original_filename text

message_reactions
  id          uuid pk
  message_id  uuid not null references messages(id) on delete cascade
  user_id     uuid not null references users(id) on delete cascade
  emoji       text not null
  created_at  timestamptz not null default now()
  unique (message_id, user_id, emoji)   -- PLAIN unique, so onConflict works
```

Notes on shape:

- `client_user_id` is **unique** — one conversation per client, so "open the
  conversation with this client" never has to disambiguate and the admin's
  "New message" flow is a get-or-create.
- `sender_role` is denormalized so a bubble can be aligned left or right without
  joining `users`.
- **Unread counts are derived, never stored.** A count column drifts the first
  time any path forgets to decrement it; `messages where created_at > <side>_last_read_at
  and sender_role <> <side>` cannot. At one coach and tens of clients the query
  is free.
- `last_message_at` / `_preview` / `_sender_role` *are* denormalized, because
  ordering and rendering the conversation list otherwise needs a lateral join
  PostgREST cannot express. They are written in the **same transaction** as the
  message by a `create_message` RPC — the pattern
  [`create_form_review_message_with_attachment`](../../../supabase/migrations/00156_form_review_message_attachments.sql)
  already establishes — so they cannot drift.
- The `unique (message_id, user_id, emoji)` constraint is a **plain** unique
  constraint, not a partial or `NULLS NOT DISTINCT` one, because PostgREST's
  `onConflict` only accepts plain unique constraints.

The migration also defines two helpers:

- `public.is_messaging_admin()` — a `STABLE SECURITY DEFINER` function returning
  whether `auth.uid()` is an admin. `form_reviews` inlines this `EXISTS` clause
  into every policy; there are eight policies here, and one definition that
  cannot be edited inconsistently is worth the function.
- `public.create_message(...)` — inserts the message, its attachments, and the
  denormalized `conversations.last_message_*` fields in one transaction, so the
  conversation-list preview cannot disagree with the thread.

### Realtime plumbing

```sql
alter publication supabase_realtime add table messages, message_reactions;
```

`message_reactions` deliberately keeps its **default replica identity** (primary
key only). Postgres-changes does not apply RLS to `DELETE` events, so with
`REPLICA IDENTITY FULL` every un-react would broadcast `user_id` and `emoji` to
every connected subscriber. With the default, a delete carries only the row `id` —
which is all the client needs to remove it from the DOM, and is meaningless to
anyone else.

## Security model

### The token

`GET /api/messaging/realtime-token` authenticates the NextAuth session, then signs
an HS256 JWT with the project's JWT secret:

```
{ sub: <users.id>, role: "authenticated", aud: "authenticated", exp: now + 1h }
```

The browser calls `supabase.realtime.setAuth(token)`, after which `auth.uid()`
resolves inside RLS. This is the documented Supabase mechanism for custom and
third-party JWTs (`supabase gen bearer-jwt --role authenticated --sub <uuid>`
generates the same shape).

- Signed with `SUPABASE_JWT_SECRET`, **server-only**, never `NEXT_PUBLIC_`.
- One hour TTL; the provider refreshes at 50 minutes and on tab re-focus, calling
  `setAuth` again on the live socket.
- The token authorizes *reading* only, because there are no INSERT/UPDATE
  policies for `authenticated` on any messaging table.
- **Migration caveat:** Supabase is moving projects from the shared legacy JWT
  secret to asymmetric signing keys. This project uses the legacy secret today
  and it remains supported. If the JWT secret is ever migrated or rotated in the
  dashboard, this route is the single place that needs updating.

### RLS

`SELECT`-only policies, same shape as `form_reviews`:

- **conversations / messages / message_attachments / message_reactions** — a
  client sees rows belonging to their own conversation; an admin sees all.
- No `INSERT`, `UPDATE`, or `DELETE` policy exists for `authenticated` on any of
  the four tables. The service-role client bypasses RLS, so server writes are
  unaffected, and a browser holding a valid token still cannot write a row.

### Private channel for typing and presence

Typing and presence are ephemeral and never touch a table, so they ride a
broadcast/presence channel with `config: { private: true }` on topic
`conversation:<uuid>`. Access is granted by RLS policies on `realtime.messages`:

```sql
create policy "participants can use their conversation channel"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() ~ '^conversation:[0-9a-f-]{36}$'
    and exists (
      select 1 from public.conversations c
      where c.id = split_part(realtime.topic(), ':', 2)::uuid
        and (c.client_user_id = auth.uid() or public.is_messaging_admin())
    )
  );
-- and the same predicate for `for insert` (permission to broadcast).
```

The regex guard runs before the `::uuid` cast, so a malformed topic is rejected
rather than raising a cast error inside a policy.

**Ops step, not code:** private channels are only enforced once *Allow public
access* is turned off in the project's Realtime settings. Nothing else in this
app uses Realtime, so flipping it is inert for existing features.

## Attachments

**Flow.** `POST /api/messaging/attachments/upload-url` (validates declared mime +
declared size, returns a v4 signed PUT URL) → browser PUTs straight to Firebase
with progress → `POST /api/messaging/messages` with the storage paths → server
verifies each object before inserting.

**The 25 MB cap is enforced three times, and the third one is the one that
matters.** A signed PUT URL constrains `Content-Type` but *not* length — a client
that lies about `byte_size` can upload a gigabyte. So:

1. Browser pre-check — instant feedback, not a control.
2. `upload-url` refuses to sign a declared size over the cap or a mime outside
   the allowlist — cheap rejection.
3. **Send** calls `getMetadata()` on each uploaded object and compares the *real*
   size and content type. Over the cap or wrong type → the object is deleted and
   the message is rejected. Nothing is inserted.

Any failure after storing bytes deletes the stored object, mirroring the
discipline in the receipt-attach route.

**Reading.** Attachments render through `GET /api/messaging/attachments/[id]?redirect=1`,
which authorizes the viewer and 302s to a freshly signed URL. Raw signed GCS URLs
are never written into a durable `src` — a thread is read for weeks and a stored
signed URL becomes an `ExpiredToken` broken image. This is a lesson already paid
for elsewhere in this codebase.

**Rendering.** Images display inline, capped in height, click to open a lightbox.
Video renders in a `<video preload="metadata">` so the browser paints a first
frame without a transcode step — there is no ffmpeg in this runtime and a 25 MB
clip does not need one.

## Realtime behaviour

Per session, the provider opens:

- one `postgres_changes` subscription on **`messages`** (INSERT), unfiltered —
  RLS scopes it: a client receives only their own rows, an admin receives all.
  This single subscription drives the dock badge, the conversation list ordering,
  and the open thread.
- one on **`message_reactions`** (INSERT + DELETE), same reasoning.
- a `conversation:<id>` private channel while a thread is open, carrying typing
  broadcasts and presence.

When an inserted message has `attachment_count > 0`, the client fetches that
message's attachment descriptors; otherwise the realtime payload is already
everything the bubble needs. Sends are optimistic, reconciled by id when the
row arrives.

**Read receipts** are the `<side>_last_read_at` timestamps, which the delayed
email already depends on — displaying them costs one more field on the wire.

## Email notification

`messages.email_notified_at` starts NULL. Every 5 minutes a Firebase
`onSchedule` cron POSTs `/api/admin/internal/messaging-notify`, which:

1. Selects messages with `email_notified_at IS NULL` and
   `created_at < now() - 5 minutes`.
2. Drops any whose recipient has since read them (`<recipient>_last_read_at >=
   created_at`) — stamping `email_notified_at` so they are never reconsidered.
   **A rapid back-and-forth in the widget therefore sends zero emails.**
3. Groups the survivors by conversation and recipient: **one email per recipient
   per conversation**, listing the unread messages.
4. Respects `notification_preferences.email_notifications`.
5. Stamps `email_notified_at` on everything included, so a retry cannot double-send.

Selection is a **pure function** (`messagesNeedingEmail({ messages, conversations,
now, delayMs })`) so the interesting logic is testable without a database.

Gated by `cron_messaging_email_enabled`, **default false**. The house rule is to
flag-gate only money and mass-email risk; a cron that emails clients on a
five-minute loop is squarely the second.

## Surfaces

**The dock** (`components/messaging/MessagingDock.tsx`) mounts inside
`ClientLayout` and the admin layout, so it is present on every authenticated page
and absent from marketing and auth routes by construction. Collapsed it is a pill
with an unread badge; expanded it is a 360×480 panel that switches between the
conversation list and a thread. On mobile it opens as a full-height sheet rather
than a floating panel, and yields to the existing bottom tab bar.

**The full page** reuses the same thread and composer components.
`/admin/messages` is the two-pane layout — list on the left, thread on the right,
plus a "New message" client picker. `/client/messages` is *just the thread*: a
client has exactly one conversation, so a list would be a list of one.

## Module boundaries

```
lib/messaging/
  config.ts          limits + path prefix (single source for the 25 MB number)
  attachments.ts     pure: kindForMime, validateSpec, buildStoragePath
  reactions.ts       pure: isValidEmoji (Extended_Pictographic), per-user cap
  unread.ts          pure: unreadCount(messages, lastReadAt, viewerRole)
  notify-select.ts   pure: messagesNeedingEmail(...)
  realtime-token.ts  server: signRealtimeToken(userId)
  storage.ts         server: sign upload, verify object, sign read, delete
  email-new-message.ts

lib/db/conversations.ts, lib/db/messages.ts     DAL (service role)

app/api/messaging/
  realtime-token/                GET   mint
  conversations/                 GET   list · POST get-or-create (admin)
  conversations/[id]/            GET   thread
  conversations/[id]/read/       POST  mark read
  messages/                      POST  send
  messages/[id]/reactions/       POST  toggle
  attachments/upload-url/        POST  sign
  attachments/[id]/              GET   ?redirect=1 → fresh signed URL
app/api/admin/internal/messaging-notify/   POST  cron

components/messaging/   MessagingProvider · MessagingDock · ConversationList ·
                        MessageThread · MessageBubble · MessageComposer ·
                        MessageAttachment · ReactionBar · EmojiPicker ·
                        TypingIndicator · PresenceDot
hooks/                  use-messaging · use-conversation · use-typing
```

The five pure modules carry the logic worth being sure about — the size cap, the
email predicate, unread arithmetic, emoji validation — and none of them imports a
client. Everything with IO around it stays thin enough to read in one screen.

## Testing

Unit, on the pure modules: the cap boundary at exactly 25 MB, mime allowlist
rejection, unread arithmetic across the `last_read_at` boundary, emoji validation
against a non-emoji string, and the email predicate — read-in-time, delay not yet
elapsed, already notified, preference off.

Route tests: `upload-url` refuses an oversize declaration; **send deletes the
stored object and rejects when the real object exceeds the cap** (the case the
declared size cannot catch); send rejects a message with neither body nor
attachments; reactions toggle off on a second identical POST; a client cannot
read another client's conversation.

Component tests: the dock renders an unread badge, an image attachment renders
inline rather than as a link, a reaction toggles.

Per the standing rule in this repo, every new assertion gets mutation-probed —
each test must be shown to fail against a deliberately broken implementation
before it is trusted. Date-derived assertions use a fixture year that differs
from the current year.

## Out of scope

Editing or deleting messages · reply-by-email · group threads · client-to-client
messaging · document attachments · voice notes · message search across
conversations (the full page filters the visible list only) · push notifications ·
message retention/pruning.

## Ops checklist (needs the owner)

1. `SUPABASE_JWT_SECRET` — copy from Supabase → Settings → JWT keys, add to
   Vercel for all environments **and** to `.env.local`. The runtime that needs it
   is Vercel; a secret that exists only in Firebase Secret Manager will not be
   visible to the app.
2. Supabase → Realtime settings → turn **off** "Allow public access".
3. Apply migration `00199_client_messaging.sql`.
4. Flip `cron_messaging_email_enabled` to true once a test message confirms the
   email renders correctly.

## Risks

- **The JWT secret is a real credential.** It signs tokens that Supabase accepts
  as any user. It stays server-side, tokens are short-lived and scoped to one
  `sub`, and RLS is the actual constraint — but it must not reach the bundle.
- **Emoji picker dependency.** A full picker needs emoji data. The plan is
  `emoji-picker-react` in native mode, which renders unicode rather than CDN
  images; if it turns out to fetch data from a CDN it would need a CSP entry in
  `next.config.mjs` — an addition that is invisible to tests unless asserted. The
  fallback, if that happens, is a bundled curated emoji set with no network
  dependency at all.
- **Realtime RLS latency.** Postgres-changes evaluates RLS per subscriber per
  change. At this scale it is nothing; at thousands of clients it would be worth
  moving to server-side broadcast on a per-conversation topic. The write path
  already funnels through one route, so that change would be local.

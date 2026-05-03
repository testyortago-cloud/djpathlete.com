# Team Invites & Video Review Workflow — Design

**Date:** 2026-05-03
**Status:** Design approved, awaiting implementation plan
**Author:** Darren (via brainstorming session)

## Goal

Let Darren invite team members (starting with a video editor) into a focused workspace where they can submit videos, receive timecoded comments and on-frame drawings as feedback, revise, and ultimately get approved videos into the existing Content Studio — without the editor seeing or touching anything else in the platform.

## Non-Goals

- Granular per-feature permission editor (role implies access).
- Auto-publishing approved videos to social platforms (approval is a status flag, not a pipeline trigger).
- Real-time multi-user editing of comments/drawings.
- Drawing layers, undo history beyond session, audio waveform, watermarks.
- In-app notification center (email only for v1).

## User Roles

Extend `UserRole` from `admin | client` to `admin | client | editor`.

- `admin` — Darren. Full access plus the new `/admin/team` and `/admin/team-videos` surfaces.
- `client` — Existing role. Unchanged.
- `editor` — New. Can only access `/editor/*`. Blocked from `/admin/*` and `/client/*` by middleware.

Admins can also load `/editor/*` for previewing the editor experience.

## Architecture Overview

Three new product surfaces, fully decoupled from Content Studio:

```
┌──────────────────────┐      ┌────────────────────────┐
│  /editor             │      │  /admin/team           │
│  (editor portal)     │      │  (invites & members)   │
│  - Upload videos     │      │  - Send invites        │
│  - View feedback     │      │  - Revoke / resend     │
│  - Re-upload versions│      └────────────────────────┘
└──────────┬───────────┘
           │ submission/version data
           ▼
┌──────────────────────────────────────────────────────┐
│  team_video_submissions / _versions / _comments /    │
│  _annotations  (new tables, RLS-protected)           │
└──────────────────────────────────────────────────────┘
           ▲
           │ review surface
┌──────────┴───────────┐         manual handoff        ┌─────────────────┐
│  /admin/team-videos  │  ─── "Send to Content        │  Content Studio │
│  (Darren reviews)    │       Studio" button ───────▶ │  (unchanged)    │
└──────────────────────┘                               └─────────────────┘
```

Approval ≠ publication. The bridge into Content Studio is an explicit manual action, not a trigger.

---

## 1. Invite System

### Flow

1. Darren visits `/admin/team` → list of pending/active members + "Invite member" button.
2. He enters email + role (`editor` for now). System creates a `team_invites` row with a 32-char random token, `expires_at = now() + 7 days`, `invited_by = darren_id`. Resend sends an email with `https://www.darrenjpaul.com/invite/<token>`.
3. Recipient lands on `/invite/[token]`, sets first/last name + password, system creates a `users` row with `role = editor`, marks invite `used_at`, signs them in, redirects to `/editor`.
4. Expired or used tokens render a "this invite is no longer valid, ask Darren for a new one" page.

### Admin team page

- Table of invites: email, role, status (pending / accepted / expired), invited date.
- Per-row actions: **Revoke** (sets `expires_at = now()`), **Resend** (rotates token + re-emails).
- No granular permission editor in v1 — role implies access.

### Schema

```sql
team_invites (
  id            uuid pk,
  email         text not null,
  role          text not null check (role in ('editor')),
  token         text not null unique,
  invited_by    uuid references users(id),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz default now()
)
```

### Middleware changes

In [middleware.ts](middleware.ts):

- Add `/editor/*` branch: requires `editor` or `admin` role; redirects to `/login` if anonymous, `/client/dashboard` if `client`.
- Editors hitting `/admin/*` or `/client/*` are redirected to `/editor`.

---

## 2. Editor Portal (`/editor/*`)

A focused, narrow workspace using the existing brand system (Green Azure, Lexend Exa headings). No admin sidebar, no client UI.

### Routes

- `/editor` — Dashboard. Two stacked sections:
  - **Needs your action** — submissions in `revision_requested` state.
  - **Awaiting Darren** — submissions in `submitted` or `in_review` state.
  - Collapsed sections: **Approved**, **Drafts**.
- `/editor/upload` — Drag-and-drop new video. Title (required), description (optional). Direct-to-Supabase Storage upload via signed URL so multi-GB files don't traverse Next.js. On success, creates `team_video_submissions` + first `team_video_versions` (v1) with status `submitted`.
- `/editor/videos/[id]` — Video player on the left, review thread on the right. Read-only annotation overlay; clicking a comment jumps the player to that timestamp. "Upload new version" button at the bottom, enabled only when status = `revision_requested`.

### Data scoping

Editors see only `team_video_submissions` rows where `submitted_by = auth.uid()`. Enforced via Supabase RLS policy, not just app-level filtering.

---

## 3. Admin Review Surface (`/admin/team-videos/*`)

New top-level admin nav item: "Team Videos." Deliberately separate from `/admin/content` (Content Studio).

### Routes

- `/admin/team-videos` — Table of submissions. Filters: by editor, by status. Sidebar badge shows count of items in `submitted` state.
- `/admin/team-videos/[id]` — Review interface. Same player + thread layout as the editor, but with **commenting tools enabled**: timeline "Add comment at current time" button, drawing tools, "Resolve" buttons on each comment.

### Status actions (top of review page)

- **Request revision** — Status → `revision_requested`. Editor gets an email with comment count.
- **Approve** — Status → `approved`, `approved_at = now()`, `approved_by = darren_id`. Editor gets an "approved" email. The **Send to Content Studio** button appears.
- **Reopen** (visible only when approved and not yet sent to Content Studio) — Status → `revision_requested`, locks lift, editor gets an email.

### Approval handoff

"Send to Content Studio" is the only bridge between this workspace and Content Studio. Clicking it:

1. Inserts into the existing `video_uploads` table with `storage_path` from the approved version, `uploaded_by = darren_id`, `title` from the submission.
2. Marks submission status `locked` — editor can no longer modify; she sees a "Used in Content Studio" badge.
3. Redirects Darren to `/admin/content?tab=videos` with the new record highlighted.

Nothing automatic. Darren still configures captions, schedules, etc. in Content Studio as he does today.

---

## 4. Data Model

Four new tables, all RLS-protected. All `updated_at` columns wired to `public.update_updated_at()` trigger (existing convention from migration 00012).

```sql
team_video_submissions (
  id                  uuid pk,
  title               text not null,
  description         text,
  submitted_by        uuid not null references users(id) on delete cascade,
  status              text not null default 'draft' check (status in (
                        'draft','submitted','in_review',
                        'revision_requested','approved','locked'
                      )),
  current_version_id  uuid references team_video_versions(id),
  approved_at         timestamptz,
  approved_by         uuid references users(id),
  locked_at           timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
)

team_video_versions (
  id                  uuid pk,
  submission_id       uuid not null references team_video_submissions(id) on delete cascade,
  version_number      int not null,
  storage_path        text not null,
  original_filename   text not null,
  duration_seconds    numeric,
  size_bytes          bigint,
  mime_type           text,
  status              text not null default 'uploaded' check (status in (
                        'uploaded','processing','ready','failed'
                      )),
  uploaded_at         timestamptz default now(),
  unique (submission_id, version_number)
)

team_video_comments (
  id                  uuid pk,
  version_id          uuid not null references team_video_versions(id) on delete cascade,
  author_id           uuid not null references users(id),
  timecode_seconds    numeric,            -- null = general comment, not pinned to a frame
  comment_text        text not null,
  status              text not null default 'open' check (status in ('open','resolved')),
  resolved_at         timestamptz,
  resolved_by         uuid references users(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
)

team_video_annotations (
  id                  uuid pk,
  comment_id          uuid not null references team_video_comments(id) on delete cascade,
  drawing_json        jsonb not null,     -- normalized 0-1 coords, see §5
  created_at          timestamptz default now()
)
```

Annotations are 1:1 with comments (not standalone). Resolving a comment hides its drawing. No orphan drawings on the frame.

### RLS policies

- `team_video_submissions`: editor can read/write own rows; admin can read/write all.
- `team_video_versions`: same scoping via parent submission.
- `team_video_comments`: editor can read all comments on her own submissions; **write is admin-only**. Editor communicates back through version uploads (her response = the next version). Keeps the UI single-purpose: editor consumes feedback, doesn't reply inline. Add a future enhancement if she needs to ask clarifying questions.
- `team_video_annotations`: read follows comment scoping; write is admin-only.

### Storage

New private Supabase Storage bucket: `team-video-submissions`. Path: `<submission_id>/v<n>/<original_filename>`. Signed URLs only, never public. Direct upload from browser via signed POST.

---

## 5. Player & Annotation UI

The heaviest piece. Scope: "good enough for Darren to give clear feedback," not Frame.io parity.

### Library choices

- **Player:** native HTML `<video>` wrapped in a thin custom controller. Full control over `currentTime`, frame-accurate seeking, overlay positioning. No `react-player` (too opinionated for our overlay needs).
- **Drawing canvas:** [`react-konva`](https://konvajs.org/docs/react/) — handles pen, arrow, rectangle out of the box, serializes to JSON cleanly, doesn't fight React reconciliation. Lighter than Fabric.js.
- **Timeline:** custom horizontal bar with comment markers positioned by `timecode / duration`. Hover shows preview; click seeks the player.

### Layout (review page)

```
┌─────────────────────────────────────┬──────────────────────┐
│  ┌──────────────────────────────┐   │  Comments (12)       │
│  │                              │   │  ┌────────────────┐  │
│  │   <video> + <Konva canvas>   │   │  │ 0:42 Darren    │  │
│  │                              │   │  │ tighten this cut│  │
│  └──────────────────────────────┘   │  │ [drawing icon] │  │
│  ▶ ───●──●─────●──── 2:34 / 5:12    │  └────────────────┘  │
│  [Tools: Pen Arrow Rect | 🟢🔴🟡⚫] │  ...                 │
│  [+ Add comment at current time]    │  [General comment ⌄] │
└─────────────────────────────────────┴──────────────────────┘
```

### Annotation workflow (admin side)

1. Darren scrubs to a frame, picks a drawing tool, draws on the canvas overlay.
2. A floating "Add comment" prompt appears with a text field; he types a note and hits Enter.
3. System saves: `team_video_comments` row with `timecode_seconds = video.currentTime` + `team_video_annotations` row with the Konva JSON.
4. The drawing now sticks to that timestamp — when the video reaches `timecode ± 0.5s` during playback, the overlay re-appears. Outside that window, the canvas is blank.

### Annotation workflow (editor side)

- Read-only canvas. She can scrub, see Darren's drawings appear at their timestamps, click any comment in the right panel to jump there.

### Drawing JSON shape (normalized for any player size)

```json
{
  "paths": [
    {
      "tool": "arrow",
      "color": "#FF3B30",
      "width": 3,
      "points": [[0.42, 0.31], [0.58, 0.47]]
    }
  ]
}
```

Coords are 0-1 fractions of player width/height, so resizing the player on different screens re-projects them.

### Deliberately not built (YAGNI)

Layers, undo history beyond current session, frame-by-frame stepping, audio waveform overlay, watermarks, multi-user simultaneous editing.

---

## 6. Notifications

Email-only via Resend (existing setup). No in-app notification system in v1.

| Trigger | Recipient | Subject |
|---|---|---|
| Editor uploads new version | Darren | "New video from [editor]: [title]" |
| Darren clicks "Request revision" | Editor | "Darren has feedback on [title] (N comments)" |
| Darren clicks "Approve" | Editor | "Darren approved [title]" |
| Darren clicks "Reopen" | Editor | "Darren reopened [title] for revision" |
| Invite sent | Recipient | "Darren invited you to the team" |

Sidebar badge on `/admin/team-videos` shows count of submissions in `submitted` state. Editor's `/editor` dashboard groups submissions by state — no separate badge needed.

---

## Open Questions / Future Work

- **Multi-editor scaling:** schema supports it (submissions are scoped by `submitted_by`), but the UI ranks editors flat. If team grows past ~5, may want to group dashboard sections by editor.
- **Video processing pipeline:** the `team_video_versions.status` enum includes `processing` for future thumbnail/transcode work, but v1 uploads are `uploaded → ready` immediately.
- **Comment threading:** comments are flat. If Darren wants to reply to himself or have editor reply with questions, that's a v2 enhancement.
- **Audit trail:** `approved_by`, `resolved_by`, `invited_by` capture key actions. No general activity log table in v1.

## Implementation Order (rough)

1. Migrations (`team_invites`, four `team_video_*` tables, RLS policies, storage bucket).
2. Auth/role plumbing (extend `UserRole`, update middleware, update NextAuth callbacks).
3. Invite system (admin page, public claim page, Resend email template).
4. Editor portal shell (`/editor` layout, dashboard, upload page).
5. Player + read-only annotation rendering (shared component used by both editor and admin).
6. Admin review surface with comment + annotation tooling.
7. Approval handoff to Content Studio.
8. Notification emails (after the workflows are stable).

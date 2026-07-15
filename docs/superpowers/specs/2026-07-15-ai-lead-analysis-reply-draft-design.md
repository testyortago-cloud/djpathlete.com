# AI Lead Analysis + Draft Reply — Design

## Problem

When a lead submits the inquiry form (`/in-person`, etc.), the coach gets a
notification email whose "reply" affordance is tied to a system address, not
the lead — confusing, and the coach has no fast way to gauge the lead or
start a response. This spec adds automatic AI analysis (priority signal) and
an AI-drafted reply, surfaced both in the notification email and on the
lead's admin client page, plus unambiguous "Email"/"Call" actions that always
go straight to the lead.

## Decisions made with the user

- Generation timing: **automatic**, at form-submission time (not an on-demand
  button) — the notification email and admin page should already have the
  analysis/draft ready.
- Analysis content: **priority/fit signal + one-line reason**, alongside the
  summary and draft reply. (Injury-flagging and call talking-points were
  considered and explicitly deferred — YAGNI for v1; the priority reason can
  naturally mention an injury if relevant since the model sees the raw form
  data.)
- Where it's shown: **both** — a compact version (priority + draft preview +
  Email/Call buttons) in the notification email for fast phone triage, and a
  full editable version on the lead's `/admin/clients/[id]` page.
- Send mechanism: **`mailto:`**, not an in-app send. Clicking "Email Lead"
  opens the coach's own default mail client (Gmail) with the draft
  pre-filled and editable; the coach hits Send from their real account. This
  fully sidesteps the reply-to/deliverability problem that started this
  request — all future replies from the lead land in the coach's normal
  inbox, permanently, with zero new send infrastructure.

## Architecture

```
POST /api/inquiry
  → insert lead_inquiries row (raw form fields, persisted — today these
    fields are NOT stored anywhere; they only ever existed transiently in
    the email body)
  → generateLeadAnalysis() [lib/ai/lead-analysis.ts]
      - callAgent(), MODEL_SONNET, structured output:
        { priority: high|medium|low, priority_reason, summary, draft_reply }
      - logged via ai_generation_log (existing pattern: pending → completed/
        failed, requested_by = first admin's user id since this runs with no
        admin session, generation_trigger = "lead_inquiry")
  → update lead_inquiries row with the AI fields
  → recordAudit("lead.ai_analysis_generated", category: automation)
  → sendInquiryEmail(..., aiAnalysis)   [existing call, new param]
  → (unchanged: sendInquiryAutoReply, GHL sync)

/admin/clients/[id] page
  → getLeadInquiryByUserId(id) [lib/db/lead-inquiries.ts]
  → renders <LeadInquiryPanel> when a row exists: raw fields, priority
    badge, editable draft textarea, Email/Call buttons, Regenerate button

POST /api/admin/leads/[id]/regenerate-analysis  (new, admin-gated)
  → same generateLeadAnalysis(), same logging/audit (actor = the admin
    session instead of the system fallback)
  → used by both the "Regenerate" button and the "Generate Analysis"
    fallback button (shown if the automatic run failed or is still missing)
```

`generateLeadAnalysis()` is a pure generation function with no DB writes —
callable identically from the inquiry route (system-triggered) and the
regenerate route (admin-triggered), so there's exactly one code path for
"how the AI looks at a lead."

## Data model

New table `lead_inquiries` (migration `00182_lead_inquiries.sql`):

- Raw submission: `lead_user_id` (FK → users, nullable), `name`, `email`,
  `phone`, `service`, `sport`, `experience`, `goals`, `injuries`,
  `how_heard`, `gclid`.
- AI output: `ai_priority` (`high|medium|low`, nullable until generated),
  `ai_priority_reason`, `ai_summary`, `ai_draft_reply`, `ai_generated_at`,
  `ai_generation_log_id` (FK → ai_generation_log, nullable).
- `created_at`.

This is deliberately separate from `client_profiles` — that table is the
client's own later self-reported onboarding profile; `lead_inquiries` is an
immutable record of "what they said when they applied," one row per
submission. No backfill: this only covers inquiries submitted after this
ships (existing/historical leads, including the one that prompted this
request, won't retroactively get an AI section).

## Email template changes (`lib/email.ts`)

`sendInquiryEmail` gains an optional `aiAnalysis: { priority, priorityReason,
summary, draftReply } | null` param.

- **When present:** a priority badge (green/amber/gray for high/medium/low,
  matching the existing badge styling already used elsewhere in this file)
  with the one-line reason, then a "Suggested Reply" card holding the draft
  text, then two buttons — "Email {FirstName}" (`mailto:` with URL-encoded
  subject + body) and "Call {FirstName}" (`tel:`, omitted if no phone).
- **When null** (AI failed, or this is a pre-migration code path): falls
  back to exactly today's behavior — the plain "Reply directly to X" line.
  The email never regresses below current behavior.
- The system prompt instructs the model to keep `draft_reply` under ~120
  words specifically so the encoded `mailto:` body stays well inside mail
  clients' URL-length limits; a hard length cap is applied defensively
  before encoding regardless of what the model returns.

## Admin UI changes

New `components/admin/clients/LeadInquiryPanel.tsx` (client component),
rendered on `/admin/clients/[id]/page.tsx` (near the top, alongside
`ProfileSection`) only when a `lead_inquiries` row exists for that user:

- Raw inquiry fields, styled consistently with the page's existing
  `InfoRow`/card patterns.
- Priority badge + reason.
- An editable `<textarea>` pre-filled with `ai_draft_reply`.
- "Email Lead" — builds the `mailto:` href from the **current textarea
  value** at click time, so any edits the coach makes carry through.
- "Call Lead" (if phone present).
- "Regenerate" (or "Generate Analysis" if none exists yet) — calls the new
  regenerate route, then refreshes the page data.

## Error handling

- AI generation failure at submit time is non-blocking (matches the existing
  try/catch pattern around `sendInquiryEmail`/`sendInquiryAutoReply`/GHL in
  `app/api/inquiry/route.ts`): the lead/notification flow completes
  regardless, `lead_inquiries` row exists with null AI fields, admin page
  shows "Generate Analysis" as a manual fallback.
- No phone → Call button omitted, both places.
- Regenerate is idempotent and reuses the exact same generation path as the
  automatic run, so there's no behavioral drift between "first try" and
  "manual retry."

## Testing

- Unit tests for `generateLeadAnalysis` (mock `callAgent`, assert schema
  shape and word-count guidance is present in the prompt).
- Unit tests for the mailto-link builder (encoding correctness, length
  capping).
- DAL tests for `lib/db/lead-inquiries.ts` CRUD, following this repo's
  existing DAL test conventions.
- Manual click-through: submit a real test inquiry against the dev server,
  confirm the notification email renders the AI section and buttons, and
  confirm the admin panel renders, the draft is editable, Email/Call open
  correctly, and Regenerate works.

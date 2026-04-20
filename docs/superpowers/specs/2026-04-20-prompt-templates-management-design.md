# Prompt Templates Management + AI Enhancement

**Status:** Approved design — ready for implementation plan
**Date:** 2026-04-20
**Author:** brainstormed with tayawaaean

## Goal

Let admins manage their own library of AI generation prompt templates (add / edit / delete) from the UI instead of editing [lib/prompt-templates.ts](../../lib/prompt-templates.ts). Add AI-assisted authoring so admins can polish draft prompts or generate full templates from a short seed idea.

## Non-goals

- No categories CRUD — the 7 existing categories stay fixed.
- No template sharing/export between workspaces.
- No versioning or edit history.
- No favorites / pinning.
- No rate limiting on `/enhance` beyond the existing admin auth gate.

## Decisions (captured from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Existing 30 hardcoded templates | **Keep as read-only "Built-in"** — custom templates live in DB alongside |
| 2 | Ownership model | **Global shared library** — all admins see/edit all custom templates |
| 3 | Management UI location | **Both** — inline quick-save in dropdown + full page at `/admin/ai-templates` |
| 4 | AI assistance modes | **Both** — polish current draft AND generate full template from idea |
| 5 | Review UX for AI output | **Preview modal** — "Use this / Keep original / Try again" |

## Architecture

### Data model

New Supabase table `prompt_templates`:

```
id            uuid PK DEFAULT gen_random_uuid()
name          text NOT NULL
category      text NOT NULL CHECK (category IN (
                'structure', 'session', 'periodization',
                'sport', 'rehab', 'conditioning', 'specialty'
              ))
scope         text NOT NULL CHECK (scope IN ('week', 'day', 'both'))
description   text NOT NULL
prompt        text NOT NULL
created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
created_at    timestamptz NOT NULL DEFAULT now()
updated_at    timestamptz NOT NULL DEFAULT now()
```

Indexes: `(scope)`, `(category)`, `(updated_at DESC)` for listing.

**RLS:** admins (role = 'admin') can SELECT/INSERT/UPDATE/DELETE any row. Clients have no access.

The hardcoded templates in [lib/prompt-templates.ts](../../lib/prompt-templates.ts) are unchanged. The dropdown merges built-ins + custom at render time. Built-ins never touch the DB and cannot be deleted through the UI.

### API endpoints

All under `app/api/admin/ai-templates/` — admin-only (existing role check).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/ai-templates` | List all custom templates (optional `?scope=week\|day`) |
| `POST` | `/api/admin/ai-templates` | Create template |
| `PATCH` | `/api/admin/ai-templates/[id]` | Update template fields |
| `DELETE` | `/api/admin/ai-templates/[id]` | Delete template |
| `POST` | `/api/admin/ai-templates/enhance` | AI enhance — polish or generate |

**`/enhance` request:**
```ts
{
  mode: "polish" | "generate",
  input: string,               // textarea content (polish) or seed idea (generate)
  target_scope?: "week" | "day" // hint for style (not enforced)
}
```

**`/enhance` response:**
```ts
// mode: "polish"
{ prompt: string }

// mode: "generate"
{
  name: string,
  description: string,
  category: "structure" | "session" | "periodization" | "sport" | "rehab" | "conditioning" | "specialty",
  scope: "week" | "day" | "both",
  prompt: string
}
```

**AI model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — cheap (~10× less than Sonnet), fast (~1–2s), sufficient for short structured prose. If quality proves inadequate in practice, switch to Sonnet 4.6 by changing the model constant.

**System prompt** encodes the house style:
- Reference canonical slot roles (`warm_up`, `primary_compound`, `secondary_compound`, `accessory`, `isolation`, `cool_down`, `power`, `conditioning`, `activation`, `testing`)
- Reference canonical techniques (`straight_set`, `superset`, `dropset`, `giant_set`, `circuit`, `rest_pause`, `amrap`, `cluster_set`, `complex`, `emom`, `wave_loading`)
- Specific sets / reps / RPE / rest / tempo numbers (not vague guidance)
- Bulleted structure; explicit overrides worded as imperatives
- Reverse-engineered from [lib/prompt-templates.ts](../../lib/prompt-templates.ts) + architect rules in [functions/src/ai/week-orchestrator.ts:136-170](../../functions/src/ai/week-orchestrator.ts#L136-L170)

Server-side fallback: if `generate` returns a `category` outside the 7-value set, coerce to `"structure"` and include a `warning` field in the response.

### Files

**New files:**
- `supabase/migrations/<timestamp>_prompt_templates.sql`
- `lib/db/prompt-templates.ts` — DAL (list, create, update, delete, getById)
- `lib/validators/prompt-template.ts` — Zod schemas for template + enhance request/response
- `lib/ai/enhance-template.ts` — Haiku call + system prompts for polish/generate modes
- `app/api/admin/ai-templates/route.ts` — GET/POST
- `app/api/admin/ai-templates/[id]/route.ts` — PATCH/DELETE
- `app/api/admin/ai-templates/enhance/route.ts` — POST
- `app/(admin)/admin/ai-templates/page.tsx` — full management page
- `components/admin/ai-templates/templates-table.tsx` — list view with filters
- `components/admin/ai-templates/template-editor-modal.tsx` — shared create/edit form (with inline ✨ Enhance on prompt field)
- `components/admin/ai-templates/enhance-preview-modal.tsx` — preview AI output with Use/Keep/Try-again
- `components/admin/ai-templates/create-from-idea-modal.tsx` — seed input → generate flow

**Modified files:**
- `types/database.ts` — add `PromptTemplate` type + insert/update types
- The existing template dropdown component used in AI Generate Week/Day dialogs — grep for usages of `PROMPT_TEMPLATES` to find it. Changes: fetch custom via React Query, render Built-in + Custom sections, add footer actions (Save current / Manage), add ✨ Enhance button next to coach-instructions textarea
- Admin sidebar nav — add "AI Templates" link

## Frontend components

### `TemplateDropdown` (existing, modified)
Two sections: `Built-in` (from `PROMPT_TEMPLATES`) + `Custom` (React Query from `/api/admin/ai-templates?scope=…`). Footer: `➕ Save current as template` (opens editor modal prefilled with textarea content) | `⚙ Manage templates` (links to `/admin/ai-templates`). Custom rows show ✏/🗑 on hover for quick inline edit/delete.

### `EnhanceButton` (new, in Generate Week/Day dialogs)
Sits next to coach-instructions textarea. Disabled when textarea is empty. Click → POST `/enhance` with `mode: "polish"` → opens `EnhancePreviewModal`.

### `EnhancePreviewModal` (new, shared)
Read-only preview of AI output. Buttons: **Use this** (replace source), **Keep original** (close), **Try again** (re-run, optionally with a "more specific about X" refinement hint). Handles both polish result (string) and generate result (structured template).

### `TemplateEditorModal` (new, shared — create + edit)
Form fields: name, description, category (select, 7 options), scope (select: week/day/both), prompt (textarea). Prompt field has a small ✨ Enhance button inline.

### `/admin/ai-templates` page (new)
Table: Name | Category badge | Scope badge | Updated | Actions. Top bar: search, category filter, scope filter, `➕ New template`, `✨ Create from idea`. Row click opens `TemplateEditorModal`; trash icon triggers confirm-delete.

### `CreateFromIdeaModal` (new)
Single seed input. On submit → POST `/enhance` with `mode: "generate"` → shows generated template in `EnhancePreviewModal` → "Use this" opens `TemplateEditorModal` prefilled for final tweaks → Save.

## User flows

**A. Use a template** — existing flow, now shows Built-in + Custom sections.

**B. Quick-save from dialog** — Type in textarea → dropdown footer `➕ Save as template` → editor modal prefilled → fill metadata → Save → appears in Custom section.

**C. Enhance current draft** — Type rough prompt → `✨ Enhance` → preview modal → Use this / Try again / Keep original.

**D. Full library management** — `⚙ Manage templates` or `/admin/ai-templates` → table → inline create/edit/delete.

**E. Generate from idea** — Management page → `✨ Create from idea` → seed input → AI generates full template → preview → edit final → save.

## Edge cases & error handling

- Empty textarea + Enhance click → button disabled.
- AI request fails / times out → toast error, source content untouched.
- Template deletion invalidates React Query cache → open dropdowns refetch.
- AI returns invalid `category` in `generate` mode → server coerces to `"structure"` + returns warning.
- Duplicate names allowed (admins may want variants: "Push Day — High Volume", "Push Day — Strength").
- Scope mismatch — templates with `scope: "day"` don't appear in Week dialog (mirrors existing behavior).
- Concurrent edits — last write wins (no optimistic locking; low-collision risk for a small admin team).

## Testing

- Unit: Zod validator for template shape; DAL CRUD (Vitest with test DB or mocked supabase).
- Integration: `/enhance` endpoint with both modes (mock Haiku response).
- E2E (Playwright): create → edit → delete template flow; use built-in vs custom from dropdown; quick-save from dialog.
- Manual: enhance button in both Week and Day dialogs; "Create from idea" flow end-to-end; category coercion on bad AI response.

## Rollout

Single PR. No feature flag — this is purely additive (hardcoded templates still work; dropdown remains functional if the custom-templates fetch fails).

## Open questions

None — all decisions resolved in brainstorm.

# Admin Permissions & Team Invites — Design

**Date:** 2026-08-07
**Status:** Design approved (sections 1 confirmed by Darren; remainder decided autonomously per standing instruction)
**Supersedes the "no granular permissions" non-goal** in [2026-05-03-team-invites-and-video-review-design.md](2026-05-03-team-invites-and-video-review-design.md)

## Goal

Let Darren invite people into the admin panel with access to only the areas they need — a coach who sees clients and programs but not the books, a bookkeeper who sees the books and nothing else, a marketer who runs the blog and ads but never touches a client record.

## Non-Goals

- Self-serve signup. Invite-only, owner-initiated.
- Teammates inviting other teammates, or editing anyone's permissions (including their own).
- Per-record permissions beyond client assignment (no "this program only").
- Time-boxed or scheduled access grants.
- SSO / SCIM / directory sync.

---

## 1. Roles

`UserRole` goes from `admin | client | editor` to `admin | client | editor | staff`.

| Role | Meaning |
|---|---|
| `admin` | Darren. Everything, always. Not invitable — there is exactly one owner tier. |
| `staff` | **New.** Invited teammate. Reaches `/admin/*`, but only the areas their permission set allows. |
| `editor` | Unchanged. Video editor, `/editor/*` portal only, no admin panel. |
| `client` | Unchanged. |

`staff` is deliberately a *different role string* from `admin`, not an admin with subtractions. Every one of the 289 existing `session.user.role !== "admin"` guards rejects `staff` on day one, so access has to be opened deliberately. The alternative — inviting people as `admin` and subtracting — fails **open**: one route missed from the deny-list is a silent leak.

---

## 2. Permission catalogue

Permissions live in one pure module, `lib/permissions/registry.ts`. Two value shapes:

- **Boolean** — `true` / absent.
- **Tiered** — `"none" | "view" | "manage"` (and `"none" | "view"` for Analytics, which has nothing to manage).

### Boolean permissions

| Key | Label | Covers |
|---|---|---|
| `clients` | Clients | Client roster & profiles, program assignments — **scoped to assigned clients** (§5) |
| `programs` | Programs & Exercises | Program builder, week generation, exercise library |
| `schedule` | Schedule & Bookings | Calendar, sessions, check-ins, bookings |
| `form_reviews` | Form Reviews & Assessments | Video form reviews, performance assessments, test reports |
| `messages` | Client Messages | Coach↔client chat |
| `blog` | Blog & Newsletter | Blog, newsletter, testimonials, topic suggestions, Google reviews |
| `social` | Social & Content | Social scheduling, Content Studio, videos, team media, content calendar |
| `website` | Website Pages | FAQs, About, Athletes, Step Up, legal pages, lead magnets, marketing products |
| `seo` | SEO & Strategy | GSC console, SEO memos, strategy briefs |
| `leads` | Leads Inbox | Lead inquiries (distinct from client chat) |
| `ai_tools` | AI Tools | AI assistant, insights, templates, usage |

### Tiered permissions

| Key | Label | `view` | `manage` |
|---|---|---|---|
| `payments` | Payments | See transactions | Refund, change status |
| `accounting` | Accounting | See the books | Import, categorize, post, close |
| `commerce` | Shop, Packs & Memberships | See products & orders | **Set prices**, fulfil orders |
| `ads` | Ads | See spend & performance | **Change budgets**, pause/launch |
| `analytics` | Analytics | See dashboards | *(no manage tier)* |

Ads and Commerce carry tiers because both move real money — ad budgets and product prices — even though neither looks like a payments screen.

### Owner-only — not grantable by any preset or checkbox

`/admin/settings` · `/admin/team` · `/admin/audit-logs` · `/admin/automation` · `/admin/platform-connections` · `/admin/reset-data` · `/admin/dashboard`

This closes privilege escalation: a teammate can never widen their own access, connect a new integration, or read/erase the audit trail. `/admin/guide` is open to every signed-in staff member.

---

## 3. Presets

A preset is a **starting template**, not a binding. Picking one fills the checkboxes; Darren can then tick or untick anything before sending. What is stored on the user is the resolved permission map — the preset name is kept for display only, so editing a preset later never silently re-grants access to existing members.

| Preset | Permissions |
|---|---|
| **Coach** | `clients`, `programs`, `schedule`, `form_reviews`, `messages` |
| **Marketing Manager** | `blog`, `social`, `website`, `seo`, `leads`, `analytics: view` |
| **Bookkeeper** | `accounting: manage`, `payments: view`, `analytics: view` |
| **Front Desk** | `clients`, `schedule`, `messages`, `leads` |
| **Video Editor** | *(none — creates a `role: editor` user for the `/editor` portal, not a staff user)* |
| **Custom** | Starts empty; tick what you want |

---

## 4. Enforcement

### The problem this shape solves

All 103 admin pages inherit their access check from a single `requireAdmin()` in `app/(admin)/admin/layout.tsx`; the pages themselves have no individual guards and read the data layer directly. So admitting a non-owner past that layout would render *every* page unless something else stops it. Enforcement therefore has to be **default-deny and path-aware**, in more than one place.

### Three layers, one registry

Everything below reads `lib/permissions/registry.ts`. It is pure — no DB, no network, no `next/*` imports — so it is unit-testable in isolation, and the gate, the navigation, and the refusal message can never drift apart.

```
                   lib/permissions/registry.ts
                   ├── PERMISSIONS (catalogue)
                   ├── PRESETS
                   ├── PATH_PERMISSIONS  (path prefix → required permission + tier)
                   ├── OWNER_ONLY_PREFIXES
                   └── hasPermission() / canAccessPath() / staffHomePath()
                              │
      ┌───────────────────────┼───────────────────────┬──────────────────┐
      ▼                       ▼                       ▼                  ▼
  proxy.ts               page guard             API route guard      AdminSidebar
  (pages + API,        requirePermission()    canAccessAdminPath()   (filters nav)
   path-aware,          in each grantable       in each grantable
   default-deny)             page                    route
```

**Layer 1 — `proxy.ts` (middleware).** The universal, path-aware gate.

- `/admin/*` — `admin` passes. `staff` is checked against the registry: permitted → through; not permitted → redirect to their home (§4.1). Unmapped `/admin/*` path → **deny**.
- `/api/admin/*` — added to the matcher (it is excluded today). **Only `staff` sessions are evaluated here**; anonymous, `admin`, `client` and `editor` requests fall through exactly as they do now. That keeps cron/webhook traffic to `/api/admin/internal/*` — which authenticates with a shared secret and has no session — working untouched, and means this change introduces *zero* behavioural difference for every actor that exists today.
- Attribution capture short-circuits before any `/api/*` path, so the existing "don't re-enter our own track endpoint" property holds.

**Layer 2 — pages.** Grantable pages call `await requirePermission("clients")`, which resolves the session and redirects on failure. Cheap, and it means a middleware matcher regression cannot silently expose a page.

**Layer 3 — API routes.** The inline guard changes shape:

```ts
// before
if (!session?.user?.id || session.user.role !== "admin") {

// after
if (!session?.user?.id || !canAccessAdminPath(session.user, request)) {
```

`canAccessAdminPath` returns `true` for `admin` unconditionally — so **Darren's behaviour is provably unchanged**, which is the entire regression surface — and for `staff` resolves the pathname against the registry. 96% of the existing guards are one of two identical single-line forms, so this is a mechanical sweep verified by `tsc`, not 290 judgement calls.

A route that is *missed* by the sweep keeps `!== "admin"` and returns 403 to staff. That is the correct failure direction: an unmigrated route is inconvenient, never leaky.

### 4.1 Where staff land

There is no shared home — `/admin/dashboard` is owner-only because it surfaces revenue. `staffHomePath(permissions)` returns the first permitted path in a fixed priority order, or `/admin/no-access` if the set is empty.

`/admin/no-access` is a real page explaining that the area isn't part of their access and naming who to ask. A permissions gate that silently bounces someone reads as a broken app; it must say what happened.

### 4.2 Navigation

`getAdminNav()` takes the actor's permissions and drops items they cannot reach; a section whose items are all dropped disappears. Same registry as the gate, so a visible link always works.

---

## 5. Client scoping

Staff with `clients` see **only clients assigned to them**. Darren sees everyone.

```sql
team_member_clients (
  staff_user_id uuid not null references users(id) on delete cascade,
  client_id     uuid not null references users(id) on delete cascade,
  assigned_by   uuid references users(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  primary key (staff_user_id, client_id)
)
```

One module owns this, `lib/permissions/client-scope.ts`:

- `resolveClientScope(user)` → `{ mode: "all" }` for admin, `{ mode: "assigned", clientIds }` for staff.
- `assertClientVisible(user, clientId)` → `boolean`, for detail routes.

Every client-touching admin surface funnels through those two functions rather than reimplementing the filter: the client list and detail pages, program assignments, training sessions, messages threads, form reviews, and assessments. `mode: "assigned"` with an empty array must yield **zero rows**, never "unfiltered" — that inversion is the classic scoping bug and gets an explicit test.

Assignment happens on `/admin/team/[id]`, owner-only.

---

## 6. Invite flow

Extends what exists rather than replacing it. `team_invites` gains the permission payload:

```sql
ALTER TABLE team_invites
  DROP CONSTRAINT team_invites_role_check,
  ADD  CONSTRAINT team_invites_role_check CHECK (role IN ('editor','staff'));
ALTER TABLE team_invites
  ADD COLUMN permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN staff_role  text;
```

1. Darren opens `/admin/team` → "Invite teammate" → email, preset, permission checkboxes.
2. The invite row stores the **resolved permission map**, validated server-side against the registry. Unknown keys and owner-only keys are rejected, not ignored — a silently dropped permission is indistinguishable from a granted one in the UI.
3. Recipient claims at `/invite/<token>`, sets name + password. The claim route copies `permissions` and `staff_role` onto the new `users` row with `role = 'staff'`.
4. Expired/used tokens keep the existing "no longer valid" page.

Permissions live on the user, not the invite, once claimed:

```sql
ALTER TABLE users
  ADD COLUMN permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN staff_role  text;
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','client','editor','staff'));
```

### Changing access later

`/admin/team` lists members with their preset badge and permission summary. Per member: **Edit permissions**, **Assign clients**, **Suspend** (sets `users.status`, blocks login), **Remove**.

Revocation is effective on the **next request** — the NextAuth `jwt` callback already re-reads the user row on every request, so `permissions` joins that select. No 24-hour stale-token window.

---

## 7. Audit

New action slugs in `lib/audit/actions.ts`:

| Slug | Category |
|---|---|
| `team.invite_sent` / `team.invite_revoked` / `team.invite_resent` | `admin_write` |
| `team.member_permissions_changed` | `admin_write` |
| `team.member_suspended` / `team.member_removed` | `admin_write` |
| `team.client_assigned` / `team.client_unassigned` | `admin_write` |
| `permission.denied` | `compliance` |

`team.member_permissions_changed` records before/after maps so the trail answers "who could see the books in March". `permission.denied` is sampled at the middleware layer — it is the signal that someone is probing, or that a preset is wrong.

---

## 8. Testing

The pure registry carries the load, because it is where correctness actually lives:

- `hasPermission` — boolean and tiered, `view` does not imply `manage`, absent key denies.
- `canAccessPath` — **unmapped path denies** (the default-deny property, asserted directly).
- Owner-only prefixes deny for every possible staff permission map, including a map with every grantable permission set to `manage`.
- Longest-prefix resolution: `/api/admin/sessions/fees` → `commerce`, not `schedule`.
- `canAccessAdminPath` returns `true` for `admin` on every path in the map plus unmapped ones — the no-regression guarantee, asserted rather than assumed.
- Preset resolution never yields an owner-only key.
- `resolveClientScope` — empty assignment list yields zero rows, not all rows.

Each of these fails if the corresponding line of production code is removed. Gate: targeted Vitest runs plus `npm run build`, per the repo's targeted-testing rule.

---

## 9. Build order

1. Migration `00201` — role constraint, `users.permissions` / `staff_role`, `team_invites` columns, `team_member_clients`.
2. `lib/permissions/registry.ts` + tests. Pure, no dependencies, everything downstream reads it.
3. Types (`UserRole`, `next-auth.d.ts`) and the NextAuth `jwt`/`session` callbacks carrying `permissions`.
4. `proxy.ts` — page + API gating.
5. Page guard, `/admin/no-access`, sidebar filtering.
6. API route sweep (`canAccessAdminPath`), verified with `tsc`.
7. Client scoping module + wiring into client-touching surfaces.
8. `/admin/team` UI — invite dialog, member list, edit permissions, assign clients.
9. Invite claim path carries permissions through.
10. Audit slugs + `permission.denied` sampling.

## Open questions for Darren

- **Ads and Commerce as tiered rather than on/off** — flagged at design time, decided as tiered because both move money. Easy to flatten later.
- **`/admin/dashboard` is owner-only** because its widgets include revenue. If a staff landing dashboard is wanted, it needs a permission-filtered variant — deliberately not built now.
- **Client scoping is assignment-based**, so a newly invited coach sees an empty roster until clients are assigned. That is the safe default but it does need a step after the invite.

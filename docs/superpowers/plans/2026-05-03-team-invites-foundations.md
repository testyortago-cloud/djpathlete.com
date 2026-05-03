# Team Invites — Foundations & Invite System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the auth/invite plumbing for the team-member feature: a new `editor` role, a reusable invite system at `/admin/team`, a public claim page at `/invite/[token]`, and an empty `/editor` portal shell ready for the video workflow plan to build on.

**Architecture:** New role `editor` added to `UserRole`. New `team_invites` table with single-use tokens (32 random chars, 7-day expiry). Invite emails sent via existing `lib/email.ts` Resend setup. New route group `(editor)/` mirrors the `(admin)/`/`(client)/` pattern. Middleware extended with a third branch for `/editor/*`.

**Tech Stack:** Next.js 16 App Router · Supabase Postgres · NextAuth v5 (Credentials, JWT) · Zod · React Hook Form · Resend · Vitest + Playwright · shadcn/ui · bcryptjs

**Spec:** [docs/superpowers/specs/2026-05-03-team-invites-and-video-review-design.md](docs/superpowers/specs/2026-05-03-team-invites-and-video-review-design.md)

---

## File Map

**New files:**
- `supabase/migrations/00113_team_invites_and_editor_role.sql` — schema
- `lib/db/team-invites.ts` — DAL
- `lib/validators/team-invite.ts` — Zod schemas
- `app/(admin)/admin/team/page.tsx` — admin team page (RSC)
- `components/admin/team/InviteList.tsx` — table + row actions (client)
- `components/admin/team/InviteFormDialog.tsx` — send invite dialog (client)
- `app/api/admin/team/invites/route.ts` — POST create, GET list
- `app/api/admin/team/invites/[id]/revoke/route.ts` — POST revoke
- `app/api/admin/team/invites/[id]/resend/route.ts` — POST resend
- `app/(auth)/invite/[token]/page.tsx` — public claim page (RSC)
- `components/auth/InviteClaimForm.tsx` — claim form (client)
- `app/api/public/invite/[token]/claim/route.ts` — POST claim
- `app/(editor)/layout.tsx` — editor route group layout
- `app/(editor)/editor/page.tsx` — empty dashboard placeholder
- `components/editor/EditorShell.tsx` — header + nav
- `__tests__/lib/db/team-invites.test.ts`
- `__tests__/lib/validators/team-invite.test.ts`
- `__tests__/api/admin/team/invites.test.ts`
- `__tests__/api/public/invite-claim.test.ts`
- `__tests__/e2e/team-invite-flow.spec.ts`

**Modified files:**
- `types/database.ts` — extend `UserRole`, add `TeamInvite` type
- `types/next-auth.d.ts` — extend role union
- `lib/auth.ts` — JWT callback role typing
- `lib/email.ts` — add `sendTeamInviteEmail`
- `middleware.ts` — add `/editor` branch + editor redirect
- `components/admin/AdminSidebar.tsx` (or whatever owns the nav) — add "Team" link

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/00113_team_invites_and_editor_role.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/00113_team_invites_and_editor_role.sql`:

```sql
-- 1. Extend the users.role check constraint to include 'editor'
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'client', 'editor'));

-- 2. Create team_invites table
CREATE TABLE public.team_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('editor')),
  token       text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_invites_token ON public.team_invites(token);
CREATE INDEX idx_team_invites_email ON public.team_invites(email);
CREATE INDEX idx_team_invites_status_created
  ON public.team_invites(used_at, expires_at, created_at DESC);

-- 3. RLS — service-role bypasses; admin policy for completeness
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all team_invites"
  ON public.team_invites FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u
            WHERE u.id = auth.uid() AND u.role = 'admin')
  );
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with `name: "team_invites_and_editor_role"` and the SQL body above. (CLI is not linked — see `supabase_migrations_via_mcp.md` memory.)

Expected: success response, no errors.

- [ ] **Step 3: Verify the table exists**

Use `mcp__supabase__execute_sql` with:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'team_invites' ORDER BY ordinal_position;
```

Expected: 8 columns matching the schema above.

- [ ] **Step 4: Verify role constraint accepts 'editor'**

Use `mcp__supabase__execute_sql`:

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'users_role_check';
```

Expected: `CHECK (role = ANY (ARRAY['admin'::text, 'client'::text, 'editor'::text]))`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00113_team_invites_and_editor_role.sql
git commit -m "feat(db): add editor role and team_invites table"
```

---

## Task 2: Extend TypeScript Role Types

**Files:**
- Modify: `types/database.ts:1`
- Modify: `types/next-auth.d.ts`

- [ ] **Step 1: Update `UserRole`**

In `types/database.ts`, line 1:

```ts
export type UserRole = "admin" | "client" | "editor"
```

- [ ] **Step 2: Add `TeamInviteRole` and `TeamInvite` types**

Append to `types/database.ts` (place near other entity types — search for where `User` is defined and put near it):

```ts
export type TeamInviteRole = "editor"

export interface TeamInvite {
  id: string
  email: string
  role: TeamInviteRole
  token: string
  invited_by: string | null
  expires_at: string
  used_at: string | null
  created_at: string
}

export type TeamInviteStatus = "pending" | "accepted" | "expired" | "revoked"
```

- [ ] **Step 3: Update `next-auth.d.ts`**

Replace `types/next-auth.d.ts` with:

```ts
import type { DefaultSession, DefaultUser } from "next-auth"
import type { DefaultJWT } from "next-auth/jwt"
import type { UserRole } from "./database"

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string
      role: UserRole
    } & DefaultSession["user"]
  }

  interface User extends DefaultUser {
    role: UserRole
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string
    role: UserRole
  }
}
```

- [ ] **Step 4: Update `lib/auth.ts` role cast**

In `lib/auth.ts`, replace both occurrences of `"admin" | "client"` with `UserRole`. Add the import at the top:

```ts
import type { UserRole } from "@/types/database"
```

Lines to change:
- Line ~71: `token.role = user.role as UserRole`
- Line ~84: `token.role = data.role as UserRole`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors). If existing files reference `"admin" | "client"` directly and break, fix those occurrences to use `UserRole`.

- [ ] **Step 6: Commit**

```bash
git add types/database.ts types/next-auth.d.ts lib/auth.ts
git commit -m "feat(types): add editor role and TeamInvite type"
```

---

## Task 3: Validator for Invite Forms

**Files:**
- Create: `lib/validators/team-invite.ts`
- Create: `__tests__/lib/validators/team-invite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/validators/team-invite.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { sendInviteSchema, claimInviteSchema } from "@/lib/validators/team-invite"

describe("sendInviteSchema", () => {
  it("accepts a valid editor invite", () => {
    const r = sendInviteSchema.safeParse({ email: "kate@example.com", role: "editor" })
    expect(r.success).toBe(true)
  })
  it("rejects unknown roles", () => {
    const r = sendInviteSchema.safeParse({ email: "kate@example.com", role: "admin" })
    expect(r.success).toBe(false)
  })
  it("rejects bad email", () => {
    const r = sendInviteSchema.safeParse({ email: "not-an-email", role: "editor" })
    expect(r.success).toBe(false)
  })
})

describe("claimInviteSchema", () => {
  it("accepts a valid claim", () => {
    const r = claimInviteSchema.safeParse({
      firstName: "Kate", lastName: "Doe", password: "Sup3rstrong!",
    })
    expect(r.success).toBe(true)
  })
  it("rejects short passwords", () => {
    const r = claimInviteSchema.safeParse({
      firstName: "Kate", lastName: "Doe", password: "short",
    })
    expect(r.success).toBe(false)
  })
  it("rejects missing firstName", () => {
    const r = claimInviteSchema.safeParse({
      firstName: "", lastName: "Doe", password: "Sup3rstrong!",
    })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- team-invite`
Expected: FAIL with module-not-found error.

- [ ] **Step 3: Implement the validator**

Create `lib/validators/team-invite.ts`:

```ts
import { z } from "zod"

export const sendInviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(["editor"]),
})

export type SendInviteInput = z.infer<typeof sendInviteSchema>

export const claimInviteSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(60),
  lastName: z.string().min(1, "Last name is required").max(60),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(120, "Password is too long"),
})

export type ClaimInviteInput = z.infer<typeof claimInviteSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- team-invite`
Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validators/team-invite.ts __tests__/lib/validators/team-invite.test.ts
git commit -m "feat(validators): add team invite schemas"
```

---

## Task 4: Team Invites Data Access Layer

**Files:**
- Create: `lib/db/team-invites.ts`
- Create: `__tests__/lib/db/team-invites.test.ts`

The DAL talks to Supabase via the service-role client (matches the convention in [lib/db/users.ts](lib/db/users.ts)). The unit test mocks `createServiceRoleClient`; an end-to-end check happens in Task 15.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/db/team-invites.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()
const selectMock = vi.fn()
const updateMock = vi.fn()
const eqMock = vi.fn()
const singleMock = vi.fn()
const orderMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
      select: selectMock,
      update: updateMock,
    }),
  }),
}))

import {
  generateInviteToken,
  createInvite,
  getInviteByToken,
  listInvites,
  markInviteUsed,
  revokeInvite,
} from "@/lib/db/team-invites"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("generateInviteToken", () => {
  it("returns a 32+ character base64url-style token", () => {
    const t = generateInviteToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(t.length).toBeGreaterThanOrEqual(32)
  })
  it("returns a different token each call", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken())
  })
})

describe("createInvite", () => {
  it("inserts an invite with a 7-day expiry", async () => {
    const fakeRow = { id: "inv-1", email: "k@example.com", role: "editor" }
    insertMock.mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: fakeRow, error: null }) }),
    })
    const result = await createInvite({
      email: "k@example.com", role: "editor", invitedBy: "user-1",
    })
    expect(result).toEqual(fakeRow)
    const args = insertMock.mock.calls[0][0]
    expect(args.email).toBe("k@example.com")
    expect(args.role).toBe("editor")
    expect(args.invited_by).toBe("user-1")
    const expiresAt = new Date(args.expires_at).getTime()
    const now = Date.now()
    expect(expiresAt - now).toBeGreaterThan(6.9 * 86400 * 1000)
    expect(expiresAt - now).toBeLessThan(7.1 * 86400 * 1000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- team-invites`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the DAL**

Create `lib/db/team-invites.ts`:

```ts
import { randomBytes } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import type { TeamInvite, TeamInviteRole, TeamInviteStatus } from "@/types/database"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getClient() {
  return createServiceRoleClient()
}

export function generateInviteToken(): string {
  // 24 random bytes -> 32 base64url chars (no padding)
  return randomBytes(24).toString("base64url")
}

export async function createInvite(input: {
  email: string
  role: TeamInviteRole
  invitedBy: string
}): Promise<TeamInvite> {
  const supabase = getClient()
  const token = generateInviteToken()
  const expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from("team_invites")
    .insert({
      email: input.email.toLowerCase().trim(),
      role: input.role,
      token,
      invited_by: input.invitedBy,
      expires_at,
    })
    .select()
    .single()
  if (error) throw error
  return data as TeamInvite
}

export async function getInviteByToken(token: string): Promise<TeamInvite | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_invites")
    .select("*")
    .eq("token", token)
    .single()
  if (error) return null
  return data as TeamInvite
}

export async function getInviteById(id: string): Promise<TeamInvite | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_invites")
    .select("*")
    .eq("id", id)
    .single()
  if (error) return null
  return data as TeamInvite
}

export async function listInvites(): Promise<TeamInvite[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("team_invites")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as TeamInvite[]
}

export async function markInviteUsed(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

/** Revoke = expire immediately. Keeps the row for audit. */
export async function revokeInvite(id: string): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase
    .from("team_invites")
    .update({ expires_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

/** Resend = rotate token + extend expiry. Returns the new token for emailing. */
export async function rotateInviteToken(id: string): Promise<{ token: string; expiresAt: string }> {
  const supabase = getClient()
  const token = generateInviteToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const { error } = await supabase
    .from("team_invites")
    .update({ token, expires_at: expiresAt, used_at: null })
    .eq("id", id)
  if (error) throw error
  return { token, expiresAt }
}

export function inviteStatus(invite: TeamInvite): TeamInviteStatus {
  if (invite.used_at) return "accepted"
  const now = Date.now()
  const expires = new Date(invite.expires_at).getTime()
  if (expires <= now) return "expired"
  return "pending"
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- team-invites`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/team-invites.ts __tests__/lib/db/team-invites.test.ts
git commit -m "feat(db): team invites DAL with token generation and lifecycle helpers"
```

---

## Task 5: Send Invite Email

**Files:**
- Modify: `lib/email.ts` (append a new exported function)

The existing pattern: each email function builds an HTML body, wraps it in `emailLayout()`, and calls `resend.emails.send()`. See `sendVerificationEmail` at `lib/email.ts:338` for the closest analogue.

- [ ] **Step 1: Inspect the existing template style**

Read [lib/email.ts:338-380](lib/email.ts#L338-L380) (the `sendVerificationEmail` function) to see the body format, button styling, and how the URL is interpolated. Match that style.

- [ ] **Step 2: Add `sendTeamInviteEmail`**

Append to `lib/email.ts`:

```ts
export async function sendTeamInviteEmail(params: {
  to: string
  inviteUrl: string
  inviterName: string
  expiresAt: string  // ISO string
}) {
  const { to, inviteUrl, inviterName, expiresAt } = params
  const expiresFormatted = new Date(expiresAt).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  })

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:48px 48px 32px;">
          <h2 style="margin:0 0 16px; font-family:'Lexend Exa', Georgia, serif; font-size:22px; color:#0E3F50; font-weight:600;">
            You've been invited to the DJP Athlete team
          </h2>
          <p style="margin:0 0 24px; font-family:'Lexend Deca', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.6; color:#333;">
            ${inviterName} has invited you to collaborate as a video editor on DJP Athlete.
            Click the button below to set your password and access your editor workspace.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background-color:#0E3F50; border-radius:2px;">
                <a href="${inviteUrl}"
                   style="display:inline-block; padding:14px 28px; font-family:'Lexend Exa', Georgia, serif; font-size:13px; color:#ffffff; text-decoration:none; letter-spacing:2px; text-transform:uppercase;">
                  Accept Invitation
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0; font-family:'Lexend Deca', Helvetica, Arial, sans-serif; font-size:13px; color:#777;">
            This invitation expires on <strong>${expiresFormatted}</strong>.
            If you weren't expecting this email, you can safely ignore it.
          </p>
        </td>
      </tr>
    </table>
  `

  return resend.emails.send({
    from: FROM_EMAIL,
    to,
    cc: ADMIN_CC,
    subject: `${inviterName} invited you to the DJP Athlete team`,
    html: emailLayout(body),
  })
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/email.ts
git commit -m "feat(email): add sendTeamInviteEmail for editor onboarding"
```

---

## Task 6: Update Middleware for `/editor/*`

**Files:**
- Modify: `middleware.ts:62-88`

- [ ] **Step 1: Update the middleware logic**

Replace the inner block of the `auth((req) => { ... })` callback in `middleware.ts`. The current block (lines 73-85) should become:

```ts
  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) {
      res = redirectToLogin(req)
    } else if (userRole !== "admin") {
      // Editors and clients sent to their own home
      const home = userRole === "editor" ? "/editor" : "/client/dashboard"
      res = NextResponse.redirect(new URL(home, req.url))
    } else {
      res = NextResponse.next()
    }
  } else if (pathname.startsWith("/editor")) {
    if (!isLoggedIn) {
      res = redirectToLogin(req)
    } else if (userRole !== "editor" && userRole !== "admin") {
      res = NextResponse.redirect(new URL("/client/dashboard", req.url))
    } else {
      res = NextResponse.next()
    }
  } else if (pathname.startsWith("/client")) {
    if (!isLoggedIn) {
      res = redirectToLogin(req)
    } else if (userRole === "editor") {
      res = NextResponse.redirect(new URL("/editor", req.url))
    } else {
      res = NextResponse.next()
    }
  } else {
    res = NextResponse.next()
  }
```

- [ ] **Step 2: Manual smoke check**

Start dev server (`npm run dev`). Open an incognito window:
- Visit `/admin/dashboard` → should redirect to `/login`.
- Visit `/editor` → should redirect to `/login`.
- (Full role-based redirects verified in the E2E test in Task 15.)

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(middleware): route editor role to /editor and isolate from admin/client"
```

---

## Task 7: Send-Invite API Route

**Files:**
- Create: `app/api/admin/team/invites/route.ts`
- Create: `__tests__/api/admin/team/invites.test.ts`

This route is admin-only; it gates on `auth()` and the `admin` role.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin/team/invites.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))
vi.mock("@/lib/db/team-invites", () => ({
  createInvite: vi.fn(),
  listInvites: vi.fn(),
}))
vi.mock("@/lib/email", () => ({
  sendTeamInviteEmail: vi.fn().mockResolvedValue({}),
}))

import { auth } from "@/lib/auth"
import { createInvite, listInvites } from "@/lib/db/team-invites"
import { POST, GET } from "@/app/api/admin/team/invites/route"

beforeEach(() => {
  vi.clearAllMocks()
})

function makeReq(body: unknown) {
  return new Request("http://localhost/api/admin/team/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/admin/team/invites", () => {
  it("returns 401 when not authenticated", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(makeReq({ email: "k@example.com", role: "editor" }))
    expect(res.status).toBe(401)
  })

  it("returns 403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "client" },
    })
    const res = await POST(makeReq({ email: "k@example.com", role: "editor" }))
    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid input", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    const res = await POST(makeReq({ email: "not-email", role: "editor" }))
    expect(res.status).toBe(400)
  })

  it("creates invite + sends email when admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin", name: "Darren Paul" },
    })
    ;(createInvite as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv1",
      email: "k@example.com",
      token: "tok123",
      expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    })
    const res = await POST(makeReq({ email: "k@example.com", role: "editor" }))
    expect(res.status).toBe(201)
    expect(createInvite).toHaveBeenCalledWith({
      email: "k@example.com", role: "editor", invitedBy: "u1",
    })
  })
})

describe("GET /api/admin/team/invites", () => {
  it("returns 403 for non-admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "client" },
    })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it("returns the list for admin", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "u1", role: "admin" },
    })
    ;(listInvites as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "inv1", email: "k@example.com" },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.invites).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- invites.test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the route**

Create `app/api/admin/team/invites/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createInvite, listInvites } from "@/lib/db/team-invites"
import { sendTeamInviteEmail } from "@/lib/email"
import { sendInviteSchema } from "@/lib/validators/team-invite"

function getBaseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = sendInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const invite = await createInvite({
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: session.user.id,
  })

  // Fire-and-forget email; we surface a 201 even if email transport blips.
  try {
    const inviteUrl = `${getBaseUrl()}/invite/${invite.token}`
    await sendTeamInviteEmail({
      to: invite.email,
      inviteUrl,
      inviterName: session.user.name ?? "Darren Paul",
      expiresAt: invite.expires_at,
    })
  } catch (err) {
    console.error("[invite-email] failed:", err)
  }

  return NextResponse.json({ invite }, { status: 201 })
}

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const invites = await listInvites()
  return NextResponse.json({ invites })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- invites.test`
Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/team/invites/route.ts __tests__/api/admin/team/invites.test.ts
git commit -m "feat(api): admin endpoint to create and list team invites"
```

---

## Task 8: Revoke and Resend API Routes

**Files:**
- Create: `app/api/admin/team/invites/[id]/revoke/route.ts`
- Create: `app/api/admin/team/invites/[id]/resend/route.ts`

- [ ] **Step 1: Implement revoke route**

Create `app/api/admin/team/invites/[id]/revoke/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getInviteById, revokeInvite } from "@/lib/db/team-invites"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const invite = await getInviteById(id)
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 })

  await revokeInvite(id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Implement resend route**

Create `app/api/admin/team/invites/[id]/resend/route.ts`:

```ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getInviteById, rotateInviteToken } from "@/lib/db/team-invites"
import { sendTeamInviteEmail } from "@/lib/email"

function getBaseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await ctx.params
  const invite = await getInviteById(id)
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 })
  if (invite.used_at) {
    return NextResponse.json({ error: "Invite already accepted" }, { status: 409 })
  }

  const { token, expiresAt } = await rotateInviteToken(id)
  const inviteUrl = `${getBaseUrl()}/invite/${token}`
  try {
    await sendTeamInviteEmail({
      to: invite.email,
      inviteUrl,
      inviterName: session.user.name ?? "Darren Paul",
      expiresAt,
    })
  } catch (err) {
    console.error("[invite-resend] email failed:", err)
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Manual smoke check**

Start dev server (`npm run dev`). With an admin session cookie, run from a terminal:

```bash
curl -X POST http://localhost:3050/api/admin/team/invites \
  -H "content-type: application/json" \
  -H "cookie: <copy from browser>" \
  -d '{"email":"selftest@example.com","role":"editor"}'
```

Expected: `201` with `{ invite: { id, email, token, ... } }`. Then call revoke + resend with that `id`. (Full coverage via E2E in Task 15.)

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/team/invites/[id]/revoke/route.ts \
        app/api/admin/team/invites/[id]/resend/route.ts
git commit -m "feat(api): revoke and resend endpoints for team invites"
```

---

## Task 9: Admin Team Page (Server Component)

**Files:**
- Create: `app/(admin)/admin/team/page.tsx`
- Create: `components/admin/team/InviteList.tsx`

- [ ] **Step 1: Create the page**

Create `app/(admin)/admin/team/page.tsx`:

```tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listInvites } from "@/lib/db/team-invites"
import { InviteList } from "@/components/admin/team/InviteList"

export const metadata = { title: "Team" }

export default async function TeamPage() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login")
  }
  const invites = await listInvites()
  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-primary">Team</h1>
          <p className="font-body text-sm text-muted-foreground">
            Invite editors and manage team access.
          </p>
        </div>
      </header>
      <InviteList initialInvites={invites} />
    </div>
  )
}
```

- [ ] **Step 2: Create the list component (client)**

Create `components/admin/team/InviteList.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { InviteFormDialog } from "./InviteFormDialog"
import type { TeamInvite, TeamInviteStatus } from "@/types/database"

function statusOf(invite: TeamInvite): TeamInviteStatus {
  if (invite.used_at) return "accepted"
  return new Date(invite.expires_at).getTime() <= Date.now() ? "expired" : "pending"
}

const STATUS_STYLES: Record<TeamInviteStatus, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  accepted: "bg-success/10 text-success border-success/30",
  expired: "bg-muted text-muted-foreground border-border",
  revoked: "bg-error/10 text-error border-error/30",
}

export function InviteList({ initialInvites }: { initialInvites: TeamInvite[] }) {
  const [invites, setInvites] = useState(initialInvites)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  async function refresh() {
    const res = await fetch("/api/admin/team/invites")
    if (res.ok) {
      const json = await res.json()
      setInvites(json.invites)
    }
  }

  function revoke(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/admin/team/invites/${id}/revoke`, { method: "POST" })
      if (res.ok) {
        toast.success("Invite revoked")
        refresh()
      } else toast.error("Failed to revoke invite")
    })
  }

  function resend(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/admin/team/invites/${id}/resend`, { method: "POST" })
      if (res.ok) {
        toast.success("Invite re-sent")
        refresh()
      } else toast.error("Failed to resend invite")
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)}>Invite member</Button>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Sent</th>
              <th className="px-4 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 && (
              <tr><td className="px-4 py-6 text-center text-muted-foreground" colSpan={5}>
                No invites yet. Click "Invite member" to send the first one.
              </td></tr>
            )}
            {invites.map((inv) => {
              const status = statusOf(inv)
              return (
                <tr key={inv.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-mono">{inv.email}</td>
                  <td className="px-4 py-3 capitalize">{inv.role}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inv.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {status === "pending" && (
                      <>
                        <Button size="sm" variant="outline" disabled={pending}
                                onClick={() => resend(inv.id)}>Resend</Button>
                        <Button size="sm" variant="ghost" disabled={pending}
                                onClick={() => revoke(inv.id)}>Revoke</Button>
                      </>
                    )}
                    {status === "expired" && (
                      <Button size="sm" variant="outline" disabled={pending}
                              onClick={() => resend(inv.id)}>Resend</Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <InviteFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={refresh}
      />
    </div>
  )
}
```

- [ ] **Step 3: Commit (the dialog comes in Task 10)**

```bash
git add app/(admin)/admin/team/page.tsx components/admin/team/InviteList.tsx
git commit -m "feat(admin): team page with invite list, revoke, and resend actions"
```

---

## Task 10: Invite Form Dialog (Client Component)

**Files:**
- Create: `components/admin/team/InviteFormDialog.tsx`

- [ ] **Step 1: Implement the dialog**

Create `components/admin/team/InviteFormDialog.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { sendInviteSchema, type SendInviteInput } from "@/lib/validators/team-invite"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function InviteFormDialog({ open, onOpenChange, onCreated }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const { register, handleSubmit, formState: { errors }, reset } = useForm<SendInviteInput>({
    resolver: zodResolver(sendInviteSchema),
    defaultValues: { email: "", role: "editor" },
  })

  async function onSubmit(data: SendInviteInput) {
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/team/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? "Failed to send invite")
        return
      }
      toast.success(`Invite sent to ${data.email}`)
      reset()
      onCreated()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They'll get an email with a link to set their password and access the editor portal.
            The link expires in 7 days.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="off" {...register("email")} />
            {errors.email && <p className="text-xs text-error">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <select id="role" {...register("role")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="editor">Video Editor</option>
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Smoke check**

Run `npm run dev`, log in as admin, visit `/admin/team`. Click "Invite member," fill in your own email, hit Send. Verify:
- Success toast appears, dialog closes, new row appears in the table.
- An email arrives at the address you used (check spam).

- [ ] **Step 3: Commit**

```bash
git add components/admin/team/InviteFormDialog.tsx
git commit -m "feat(admin): invite form dialog with validation and toast feedback"
```

---

## Task 11: Add "Team" Link to Admin Sidebar

**Files:**
- Modify: existing admin sidebar component (located in step 1)

- [ ] **Step 1: Locate the sidebar**

Run: `Grep` for `"/admin/dashboard"` in `components/admin/` to find the file that defines the nav links. (Most likely `components/admin/AdminSidebar.tsx` or `components/shared/AdminLayout.tsx`.)

- [ ] **Step 2: Add the Team item**

Add a new nav item next to Settings or Users (whichever exists). Use the `Users2` icon from `lucide-react`:

```tsx
{ href: "/admin/team", label: "Team", icon: Users2 }
```

Match the existing style/casing in that file exactly — copy a sibling item and modify only the three fields.

- [ ] **Step 3: Smoke check**

Reload `/admin/dashboard` — confirm "Team" appears in the sidebar and clicking it navigates to `/admin/team`.

- [ ] **Step 4: Commit**

```bash
git add components/admin/<the file>
git commit -m "feat(admin): add Team link to admin sidebar"
```

---

## Task 12: Public Claim Page (Server Component)

**Files:**
- Create: `app/(auth)/invite/[token]/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/(auth)/invite/[token]/page.tsx`:

```tsx
import { getInviteByToken, inviteStatus } from "@/lib/db/team-invites"
import { InviteClaimForm } from "@/components/auth/InviteClaimForm"
import Link from "next/link"

export const metadata = { title: "Accept Invitation" }

interface Props {
  params: Promise<{ token: string }>
}

export default async function InviteClaimPage({ params }: Props) {
  const { token } = await params
  const invite = await getInviteByToken(token)

  if (!invite || inviteStatus(invite) !== "pending") {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8 text-center">
        <h1 className="font-heading text-xl text-primary">Invitation unavailable</h1>
        <p className="font-body text-sm text-muted-foreground">
          This invite link is no longer valid. Ask Darren to send a new one.
        </p>
        <Link href="/login" className="text-sm underline">Return to login</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-8">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl text-primary">Welcome to DJP Athlete</h1>
        <p className="font-body text-sm text-muted-foreground">
          You're joining as a <strong>video editor</strong>. Set your name and password below.
        </p>
        <p className="font-mono text-xs text-muted-foreground">{invite.email}</p>
      </div>
      <InviteClaimForm token={token} email={invite.email} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(auth)/invite/[token]/page.tsx
git commit -m "feat(auth): public invite claim page with token validation"
```

---

## Task 13: Claim Form + Claim API

**Files:**
- Create: `components/auth/InviteClaimForm.tsx`
- Create: `app/api/public/invite/[token]/claim/route.ts`
- Create: `__tests__/api/public/invite-claim.test.ts`

- [ ] **Step 1: Write the failing API test**

Create `__tests__/api/public/invite-claim.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/team-invites", () => ({
  getInviteByToken: vi.fn(),
  inviteStatus: vi.fn(),
  markInviteUsed: vi.fn(),
}))
vi.mock("@/lib/db/users", () => ({
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
}))

import { getInviteByToken, inviteStatus, markInviteUsed } from "@/lib/db/team-invites"
import { getUserByEmail, createUser } from "@/lib/db/users"
import { POST } from "@/app/api/public/invite/[token]/claim/route"

beforeEach(() => vi.clearAllMocks())

const ok = (body: unknown) =>
  new Request("http://localhost/api/public/invite/tok/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const params = Promise.resolve({ token: "tok" })

describe("POST /api/public/invite/[token]/claim", () => {
  it("404s if invite missing", async () => {
    ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(
      ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }),
      { params },
    )
    expect(res.status).toBe(404)
  })

  it("410s if invite expired", async () => {
    ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "i1", email: "k@example.com", role: "editor",
      expires_at: "2000-01-01", used_at: null,
    })
    ;(inviteStatus as ReturnType<typeof vi.fn>).mockReturnValue("expired")
    const res = await POST(
      ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }),
      { params },
    )
    expect(res.status).toBe(410)
  })

  it("409s if email already exists", async () => {
    ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "i1", email: "k@example.com", role: "editor",
      expires_at: "2099-01-01", used_at: null,
    })
    ;(inviteStatus as ReturnType<typeof vi.fn>).mockReturnValue("pending")
    ;(getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" })
    const res = await POST(
      ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }),
      { params },
    )
    expect(res.status).toBe(409)
  })

  it("creates user, marks invite used, returns 201", async () => {
    ;(getInviteByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "i1", email: "k@example.com", role: "editor",
      expires_at: "2099-01-01", used_at: null,
    })
    ;(inviteStatus as ReturnType<typeof vi.fn>).mockReturnValue("pending")
    ;(getUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(createUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "newU", email: "k@example.com", role: "editor",
    })
    const res = await POST(
      ok({ firstName: "K", lastName: "D", password: "Strongpass1!" }),
      { params },
    )
    expect(res.status).toBe(201)
    expect(createUser).toHaveBeenCalled()
    expect(markInviteUsed).toHaveBeenCalledWith("i1")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- invite-claim`
Expected: FAIL.

- [ ] **Step 3: Implement the claim route**

Create `app/api/public/invite/[token]/claim/route.ts`:

```ts
import { NextResponse } from "next/server"
import { hash } from "bcryptjs"
import { getInviteByToken, inviteStatus, markInviteUsed } from "@/lib/db/team-invites"
import { getUserByEmail, createUser } from "@/lib/db/users"
import { claimInviteSchema } from "@/lib/validators/team-invite"

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params

  const invite = await getInviteByToken(token)
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 })

  const status = inviteStatus(invite)
  if (status === "accepted") {
    return NextResponse.json({ error: "Invite already used" }, { status: 410 })
  }
  if (status === "expired") {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = claimInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const existing = await getUserByEmail(invite.email)
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists. Please sign in instead." },
      { status: 409 },
    )
  }

  const password_hash = await hash(parsed.data.password, 12)
  const user = await createUser({
    email: invite.email,
    password_hash,
    first_name: parsed.data.firstName,
    last_name: parsed.data.lastName,
    role: invite.role, // 'editor'
  })

  await markInviteUsed(invite.id)

  return NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- invite-claim`
Expected: 4/4 PASS.

- [ ] **Step 5: Implement the claim form**

Create `components/auth/InviteClaimForm.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter, useParams } from "next/navigation"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { claimInviteSchema, type ClaimInviteInput } from "@/lib/validators/team-invite"

export function InviteClaimForm({ token, email }: { token: string; email: string }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors } } = useForm<ClaimInviteInput>({
    resolver: zodResolver(claimInviteSchema),
  })

  async function onSubmit(data: ClaimInviteInput) {
    setSubmitting(true)
    setServerError(null)
    try {
      const res = await fetch(`/api/public/invite/${token}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setServerError(json.error ?? "Failed to claim invite")
        return
      }
      // Auto sign-in
      const signInRes = await signIn("credentials", {
        email, password: data.password, redirect: false,
      })
      if (signInRes?.error) {
        toast.error("Account created. Please sign in.")
        router.push("/login")
      } else {
        router.push("/editor")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {serverError && (
        <div className="rounded border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {serverError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" autoComplete="given-name" {...register("firstName")} />
          {errors.firstName && <p className="text-xs text-error">{errors.firstName.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" autoComplete="family-name" {...register("lastName")} />
          {errors.lastName && <p className="text-xs text-error">{errors.lastName.message}</p>}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        {errors.password && <p className="text-xs text-error">{errors.password.message}</p>}
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Creating account..." : "Accept and continue"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add components/auth/InviteClaimForm.tsx \
        app/api/public/invite/[token]/claim/route.ts \
        __tests__/api/public/invite-claim.test.ts
git commit -m "feat(auth): invite claim form and API with auto sign-in"
```

---

## Task 14: Editor Route Group Shell

**Files:**
- Create: `app/(editor)/layout.tsx`
- Create: `app/(editor)/editor/page.tsx`
- Create: `components/editor/EditorShell.tsx`

- [ ] **Step 1: Create the layout**

Create `app/(editor)/layout.tsx`:

```tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { EditorShell } from "@/components/editor/EditorShell"

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor")
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    redirect("/client/dashboard")
  }
  return <EditorShell user={{ name: session.user.name ?? "Editor", email: session.user.email ?? "" }}>
    {children}
  </EditorShell>
}
```

- [ ] **Step 2: Create the shell component**

Create `components/editor/EditorShell.tsx`:

```tsx
"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Video } from "lucide-react"

export function EditorShell({
  user, children,
}: { user: { name: string; email: string }; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Video className="size-5 text-accent" />
            <h1 className="font-heading text-sm uppercase tracking-widest">DJP Editor</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right leading-tight">
              <div className="font-medium">{user.name}</div>
              <div className="font-mono text-xs opacity-70">{user.email}</div>
            </div>
            <Button size="sm" variant="ghost"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="text-primary-foreground hover:bg-primary-foreground/10">
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Create the placeholder dashboard**

Create `app/(editor)/editor/page.tsx`:

```tsx
export const metadata = { title: "Editor Dashboard" }

export default function EditorDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl text-primary">Welcome</h2>
        <p className="font-body text-sm text-muted-foreground">
          Your video upload and review workspace will appear here.
        </p>
      </div>
      <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center">
        <p className="font-body text-sm text-muted-foreground">
          Video workflow coming soon.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Smoke check**

Sign in as an editor (use the invite flow, or temporarily set a user's role to `editor` in Supabase). Visit `/editor` — verify the shell renders, sign-out works, and `/admin/*` redirects back to `/editor`.

- [ ] **Step 5: Commit**

```bash
git add app/(editor) components/editor/EditorShell.tsx
git commit -m "feat(editor): editor route group shell with auth guard"
```

---

## Task 15: E2E Happy-Path Test

**Files:**
- Create: `__tests__/e2e/team-invite-flow.spec.ts`

This walks the full flow: admin sends an invite, recipient claims it, editor lands on `/editor`. The test reads the invite token directly from the DB to skip mailbox simulation.

- [ ] **Step 1: Write the spec**

Create `__tests__/e2e/team-invite-flow.spec.ts`:

```ts
import { test, expect } from "@playwright/test"
import { createServiceRoleClient } from "@/lib/supabase"

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL!
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD!
const INVITEE_EMAIL = `e2e-invitee-${Date.now()}@example.com`

test.describe("Team invite flow", () => {
  test.afterAll(async () => {
    const supabase = createServiceRoleClient()
    await supabase.from("team_invites").delete().eq("email", INVITEE_EMAIL)
    await supabase.from("users").delete().eq("email", INVITEE_EMAIL)
  })

  test("admin can invite an editor and the invitee can claim it", async ({ page }) => {
    // 1. Admin signs in
    await page.goto("/login")
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL)
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD)
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("**/admin/**")

    // 2. Send the invite
    await page.goto("/admin/team")
    await page.getByRole("button", { name: /invite member/i }).click()
    await page.getByLabel(/email/i).fill(INVITEE_EMAIL)
    await page.getByRole("button", { name: /send invite/i }).click()
    await expect(page.getByText(INVITEE_EMAIL)).toBeVisible()

    // 3. Look up the token from the DB (bypasses email)
    const supabase = createServiceRoleClient()
    const { data: invite } = await supabase
      .from("team_invites")
      .select("token")
      .eq("email", INVITEE_EMAIL)
      .single()
    expect(invite?.token).toBeTruthy()

    // 4. Sign out, then claim as the invitee
    await page.goto("/api/auth/signout")
    await page.getByRole("button", { name: /sign out/i }).click().catch(() => {})

    const claimContext = await page.context()
    await claimContext.clearCookies()

    await page.goto(`/invite/${invite!.token}`)
    await page.getByLabel(/first name/i).fill("E2E")
    await page.getByLabel(/last name/i).fill("Editor")
    await page.getByLabel(/password/i).fill("E2eTestPass!23")
    await page.getByRole("button", { name: /accept and continue/i }).click()

    // 5. Land on /editor
    await page.waitForURL("**/editor")
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible()
  })
})
```

- [ ] **Step 2: Add E2E env vars**

Confirm `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` exist in `.env.local`. If not, add them pointing to a real admin account.

- [ ] **Step 3: Run the test**

Run: `npm run test:e2e -- team-invite-flow`
Expected: PASS in Chromium.

- [ ] **Step 4: Commit**

```bash
git add __tests__/e2e/team-invite-flow.spec.ts
git commit -m "test(e2e): full team invite happy path"
```

---

## Final Verification

- [ ] **Run the full test suite**

```bash
npm run test:run
```

Expected: all unit tests green; no regressions in existing files.

- [ ] **Run the linter**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Push to remote**

```bash
git push
```

(Working directly on `main` per project convention.)

---

## What's Next

This plan ships the auth/invite plumbing and an empty `/editor` shell. With this in production, Plan 2 (the video review workflow) will:

- Add the four `team_video_*` tables and the `team-video-submissions` storage bucket.
- Build the `/editor/upload` and `/editor/videos/[id]` pages.
- Build the `/admin/team-videos` review surface with the player + react-konva annotation tools.
- Wire the "Send to Content Studio" handoff into the existing `video_uploads` pipeline.
- Add the email notification triggers (uploaded, revision requested, approved, reopened).

Plan 2 will be written once Plan 1 is implemented, so it can reference real file paths and the actual editor shell.

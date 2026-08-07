import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { TeamTable } from "@/components/admin/team/TeamTable"
import type { TeamMember } from "@/lib/db/team-members"
import type { TeamInvite } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const FUTURE = new Date(Date.now() + 5 * 86400_000).toISOString()
const PAST = new Date(Date.now() - 86400_000).toISOString()

function member(over: Partial<TeamMember> = {}): TeamMember {
  return {
    id: "m1",
    email: "coach@example.com",
    first_name: "Casey",
    last_name: "Coach",
    role: "staff",
    status: "active",
    staff_role: "coach",
    permissions: { clients: true },
    created_at: "2026-05-01T00:00:00Z",
    assigned_client_count: 2,
    ...over,
  }
}

function invite(over: Partial<TeamInvite> = {}): TeamInvite {
  return {
    id: "i1",
    email: "someone@example.com",
    role: "editor",
    token: "tok",
    invited_by: null,
    expires_at: FUTURE,
    used_at: null,
    created_at: "2026-05-04T00:00:00Z",
    permissions: {},
    staff_role: null,
    ...over,
  }
}

function renderTable(members: TeamMember[] = [], invites: TeamInvite[] = []) {
  return render(<TeamTable initialMembers={members} initialInvites={invites} clients={[]} />)
}

/** The row containing the given text, so button lookups don't leak across rows. */
function rowFor(text: string) {
  const cell = screen.getByText(text)
  const row = cell.closest("tr")
  if (!row) throw new Error(`No row for "${text}"`)
  return within(row)
}

describe("TeamTable", () => {
  it("lists members and open invites in the same table", () => {
    renderTable([member()], [invite({ email: "pending@example.com" })])

    expect(screen.getByText("Casey Coach")).toBeInTheDocument()
    expect(screen.getByText("pending@example.com")).toBeInTheDocument()
    expect(screen.getAllByRole("row")).toHaveLength(3) // header + 2
  })

  it("offers Edit access on a video editor — they are a member, not a separate kind of row", () => {
    // The bug this replaces: the permissions button was hidden for role
    // "editor", so an editor could never be given admin access at all.
    renderTable([member({ role: "editor", staff_role: null, permissions: {} })])

    expect(rowFor("Casey Coach").getByRole("button", { name: "Edit access" })).toBeInTheDocument()
  })

  it("hides client assignment from an editor, who has no client list to scope", () => {
    renderTable([member({ role: "editor", staff_role: null, permissions: {} })])

    expect(rowFor("Casey Coach").queryByRole("button", { name: /^Clients/ })).not.toBeInTheDocument()
  })

  it("offers client assignment to a staff member, with their current count", () => {
    renderTable([member()])

    expect(rowFor("Casey Coach").getByRole("button", { name: "Clients (2)" })).toBeInTheDocument()
  })

  it("hides accepted invites — that person is already listed as a member", () => {
    renderTable(
      [member({ email: "accepted@example.com" })],
      [
        invite({ id: "a", email: "accepted@example.com", used_at: "2026-06-14T00:00:00Z" }),
        invite({ id: "p", email: "pending@example.com" }),
      ],
    )

    expect(screen.queryByText("Hasn't accepted yet")).toBeInTheDocument() // the pending one
    expect(screen.getAllByRole("row")).toHaveLength(3) // header + member + pending invite
    expect(screen.getByText("pending@example.com")).toBeInTheDocument()
  })

  it("offers Resend and Revoke on a pending invite", () => {
    renderTable([], [invite({ email: "pending@example.com" })])

    const row = rowFor("pending@example.com")
    expect(row.getByRole("button", { name: "Resend" })).toBeInTheDocument()
    expect(row.getByRole("button", { name: "Revoke" })).toBeInTheDocument()
  })

  it("offers Resend but not Revoke on an expired invite", () => {
    renderTable([], [invite({ email: "old@example.com", expires_at: PAST })])

    const row = rowFor("old@example.com")
    expect(screen.getByText("Invite expired")).toBeInTheDocument()
    expect(row.getByRole("button", { name: "Resend" })).toBeInTheDocument()
    expect(row.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument()
  })

  it("never offers Suspend on an invite — there is no account to suspend yet", () => {
    renderTable([], [invite({ email: "pending@example.com" })])

    expect(rowFor("pending@example.com").queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument()
  })

  it("offers Reactivate rather than Suspend on a suspended member", () => {
    renderTable([member({ status: "suspended" })])

    const row = rowFor("Casey Coach")
    expect(row.getByRole("button", { name: "Reactivate" })).toBeInTheDocument()
    expect(row.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument()
  })

  it("shows one empty state covering both members and invites", () => {
    renderTable()

    expect(screen.getByText(/No one on the team yet/)).toBeInTheDocument()
  })

  it("always offers the invite button", () => {
    renderTable()

    expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument()
  })
})

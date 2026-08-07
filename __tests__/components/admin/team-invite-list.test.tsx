import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { InviteList } from "@/components/admin/team/InviteList"
import type { TeamInvite } from "@/types/database"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const FUTURE = new Date(Date.now() + 5 * 86400_000).toISOString()
const PAST = new Date(Date.now() - 86400_000).toISOString()

function invite(over: Partial<TeamInvite>): TeamInvite {
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

describe("InviteList", () => {
  it("hides accepted invites — they have no action left and belong under Members", () => {
    render(
      <InviteList
        initialInvites={[
          invite({ id: "a", email: "accepted@example.com", used_at: "2026-06-14T00:00:00Z" }),
          invite({ id: "p", email: "pending@example.com" }),
        ]}
      />,
    )

    expect(screen.queryByText("accepted@example.com")).not.toBeInTheDocument()
    expect(screen.getByText("pending@example.com")).toBeInTheDocument()
  })

  it("offers Resend and Revoke on a pending invite", () => {
    render(<InviteList initialInvites={[invite({ email: "pending@example.com" })]} />)

    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument()
  })

  it("offers Resend but not Revoke on an expired invite", () => {
    render(<InviteList initialInvites={[invite({ email: "old@example.com", expires_at: PAST })]} />)

    expect(screen.getByText("expired")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument()
  })

  it("says where accepted invites went when nothing is open", () => {
    render(<InviteList initialInvites={[invite({ used_at: "2026-06-14T00:00:00Z" })]} />)

    expect(screen.getByText(/Accepted ones move up to Members/)).toBeInTheDocument()
  })
})

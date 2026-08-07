import { describe, it, expect } from "vitest"
import { buildTeamRows } from "@/lib/team/rows"
import type { TeamMember } from "@/lib/db/team-members"
import type { TeamInvite } from "@/types/database"

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
    permissions: { clients: true, programs: true },
    created_at: "2026-05-01T00:00:00Z",
    assigned_client_count: 0,
    ...over,
  }
}

function invite(over: Partial<TeamInvite> = {}): TeamInvite {
  return {
    id: "i1",
    email: "invited@example.com",
    role: "staff",
    token: "tok",
    invited_by: null,
    expires_at: FUTURE,
    used_at: null,
    created_at: "2026-05-04T00:00:00Z",
    permissions: { blog: true },
    staff_role: "marketing",
    ...over,
  }
}

describe("buildTeamRows", () => {
  it("puts members and open invites in one list, members first", () => {
    const rows = buildTeamRows([member()], [invite()])

    expect(rows.map((r) => r.kind)).toEqual(["member", "invite"])
    expect(rows.map((r) => r.email)).toEqual(["coach@example.com", "invited@example.com"])
  })

  it("drops an accepted invite so the person is not listed twice", () => {
    const rows = buildTeamRows(
      [member({ email: "accepted@example.com" })],
      [invite({ email: "accepted@example.com", used_at: "2026-05-06T00:00:00Z" })],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe("member")
  })

  it("keys rows so an invite and the member it became cannot collide", () => {
    const rows = buildTeamRows([member({ id: "shared" })], [invite({ id: "shared" })])

    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it("marks a pending invite pending and an expired one expired", () => {
    const rows = buildTeamRows([], [invite({ id: "p" }), invite({ id: "e", expires_at: PAST })])

    expect(rows.map((r) => r.status)).toEqual(["pending", "expired"])
  })

  it("reports a suspended member as suspended", () => {
    const [row] = buildTeamRows([member({ status: "suspended" })], [])

    expect(row.status).toBe("suspended")
  })

  describe("access column", () => {
    it("labels a staff member with their preset and summarises the grants", () => {
      const [row] = buildTeamRows([member()], [])

      expect(row.roleLabel).toBe("Coach")
      expect(row.reachesAdminPanel).toBe(true)
      expect(row.accessSummary).toContain("Clients")
      expect(row.accessSummary).toContain("Programs")
    })

    it("labels an editor Video Editor and says the admin panel is not theirs", () => {
      const [row] = buildTeamRows([member({ role: "editor", staff_role: null, permissions: {} })], [])

      expect(row.roleLabel).toBe("Video Editor")
      expect(row.reachesAdminPanel).toBe(false)
      expect(row.accessSummary).toMatch(/editor portal only/i)
    })

    it("stops badging someone Coach once their access no longer says so", () => {
      // The preset key is a leftover from how they were invited; the row has to
      // describe what they can reach now, or the table asserts access they lost.
      const [row] = buildTeamRows(
        [member({ role: "editor", staff_role: "coach", permissions: {} })],
        [],
      )

      expect(row.roleLabel).toBe("Video Editor")
    })

    it("falls back to Custom for a staff member with no preset", () => {
      const [row] = buildTeamRows([member({ staff_role: null })], [])

      expect(row.roleLabel).toBe("Custom")
    })

    it("never labels an admin-panel member with the editor preset", () => {
      const [row] = buildTeamRows([member({ staff_role: "editor" })], [])

      expect(row.roleLabel).toBe("Custom")
    })

    it("describes an invite's access the same way it will describe the member", () => {
      const [row] = buildTeamRows([], [invite()])

      expect(row.roleLabel).toBe("Marketing Manager")
      expect(row.reachesAdminPanel).toBe(true)
      expect(row.accessSummary).toContain("Blog")
    })

    it("treats an editor invite as editor-portal only", () => {
      const [row] = buildTeamRows([], [invite({ role: "editor", staff_role: null, permissions: {} })])

      expect(row.roleLabel).toBe("Video Editor")
      expect(row.reachesAdminPanel).toBe(false)
    })
  })

  it("has no name for someone who has not accepted yet", () => {
    const [row] = buildTeamRows([], [invite()])

    expect(row.name).toBeNull()
  })

  it("uses the member's name once they have one", () => {
    const [row] = buildTeamRows([member()], [])

    expect(row.name).toBe("Casey Coach")
  })
})

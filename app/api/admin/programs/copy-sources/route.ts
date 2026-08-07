import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { canAccessAdminPath } from "@/lib/permissions/guard"

interface CopySource {
  programId: string
  programName: string
  durationWeeks: number
  assignees: { id: string; name: string }[]
}

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const excludeId = searchParams.get("exclude")

    const supabase = createServiceRoleClient()

    const [programsRes, assignmentsRes] = await Promise.all([
      supabase
        .from("programs")
        .select("id, name, duration_weeks")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase.from("program_assignments").select("program_id, user_id").eq("status", "active"),
    ])
    if (programsRes.error) throw programsRes.error
    if (assignmentsRes.error) throw assignmentsRes.error

    const userIds = Array.from(new Set((assignmentsRes.data ?? []).map((a) => a.user_id as string)))
    let userMap = new Map<string, string>()
    if (userIds.length > 0) {
      const { data: users, error: usersErr } = await supabase
        .from("users")
        .select("id, first_name, last_name")
        .in("id", userIds)
      if (usersErr) throw usersErr
      userMap = new Map(
        (users ?? []).map((u) => [
          u.id as string,
          (`${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || "Unnamed client") as string,
        ]),
      )
    }

    const byProgram = new Map<string, { id: string; name: string }[]>()
    for (const row of assignmentsRes.data ?? []) {
      const name = userMap.get(row.user_id as string)
      if (!name) continue
      const list = byProgram.get(row.program_id as string) ?? []
      list.push({ id: row.user_id as string, name })
      byProgram.set(row.program_id as string, list)
    }

    const sources: CopySource[] = (programsRes.data ?? [])
      .filter((p) => p.id !== excludeId)
      .map((p) => ({
        programId: p.id as string,
        programName: p.name as string,
        durationWeeks: (p.duration_weeks ?? 1) as number,
        assignees: byProgram.get(p.id as string) ?? [],
      }))

    return NextResponse.json({ sources })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load copy sources."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

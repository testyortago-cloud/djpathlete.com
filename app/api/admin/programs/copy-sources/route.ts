import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"

interface CopySource {
  programId: string
  programName: string
  durationWeeks: number
  assignees: { id: string; name: string }[]
}

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const excludeId = searchParams.get("exclude")

    const supabase = createServiceRoleClient()

    const { data: programs, error: progErr } = await supabase
      .from("programs")
      .select("id, name, duration_weeks")
      .eq("is_active", true)
      .order("name", { ascending: true })
    if (progErr) throw progErr

    const { data: assignments, error: assignErr } = await supabase
      .from("program_assignments")
      .select("program_id, user_id, status, users(id, first_name, last_name)")
      .eq("status", "active")
    if (assignErr) throw assignErr

    type AssignmentRow = {
      program_id: string
      user_id: string
      users: { id: string; first_name: string | null; last_name: string | null } | null
    }
    const byProgram = new Map<string, { id: string; name: string }[]>()
    for (const row of (assignments ?? []) as unknown as AssignmentRow[]) {
      if (!row.users) continue
      const name = `${row.users.first_name ?? ""} ${row.users.last_name ?? ""}`.trim() || "Unnamed client"
      const list = byProgram.get(row.program_id) ?? []
      list.push({ id: row.users.id, name })
      byProgram.set(row.program_id, list)
    }

    const sources: CopySource[] = (programs ?? [])
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

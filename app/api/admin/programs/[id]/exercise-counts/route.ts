import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id } = await params
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("program_exercises")
      .select("week_number, day_of_week")
      .eq("program_id", id)
    if (error) throw error

    const byWeek: Record<number, number> = {}
    const byWeekDay: Record<string, number> = {}
    for (const row of (data ?? []) as { week_number: number; day_of_week: number }[]) {
      byWeek[row.week_number] = (byWeek[row.week_number] ?? 0) + 1
      const key = `${row.week_number}:${row.day_of_week}`
      byWeekDay[key] = (byWeekDay[key] ?? 0) + 1
    }

    return NextResponse.json({ total: (data ?? []).length, byWeek, byWeekDay })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load exercise counts."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

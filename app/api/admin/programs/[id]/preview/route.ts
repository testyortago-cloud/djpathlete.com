import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export interface PreviewExercise {
  week: number
  day: number
  orderIndex: number
  name: string
  sets: number | null
  reps: string | null
  durationSeconds: number | null
  rpe: number | null
  groupTag: string | null
  technique: string | null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const { id } = await params
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("program_exercises")
      .select(
        "week_number, day_of_week, order_index, sets, reps, duration_seconds, rpe_target, group_tag, technique, exercises(name)",
      )
      .eq("program_id", id)
      .order("week_number")
      .order("day_of_week")
      .order("order_index")
    if (error) throw error

    type Row = {
      week_number: number
      day_of_week: number
      order_index: number
      sets: number | null
      reps: string | null
      duration_seconds: number | null
      rpe_target: number | null
      group_tag: string | null
      technique: string | null
      exercises: { name: string } | { name: string }[] | null
    }
    const exercises: PreviewExercise[] = ((data ?? []) as Row[]).map((r) => {
      const ex = Array.isArray(r.exercises) ? r.exercises[0] : r.exercises
      return {
        week: r.week_number,
        day: r.day_of_week,
        orderIndex: r.order_index,
        name: ex?.name ?? "Unknown exercise",
        sets: r.sets,
        reps: r.reps,
        durationSeconds: r.duration_seconds,
        rpe: r.rpe_target,
        groupTag: r.group_tag,
        technique: r.technique,
      }
    })

    return NextResponse.json({ exercises })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load preview."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

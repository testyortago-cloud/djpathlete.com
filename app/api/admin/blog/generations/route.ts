import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const supabase = createServiceRoleClient()

    const { data, error } = await supabase
      .from("ai_generation_log")
      .select(
        "id, status, input_params, output_summary, error_message, model_used, tokens_used, duration_ms, created_at",
      )
      .contains("input_params", { feature: "blog_generation" })
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      console.error("[Blog Generations] DB error:", error)
      return NextResponse.json({ error: "Failed to fetch generation history." }, { status: 500 })
    }

    return NextResponse.json({ generations: data ?? [] })
  } catch (error) {
    console.error("[Blog Generations] Error:", error)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}

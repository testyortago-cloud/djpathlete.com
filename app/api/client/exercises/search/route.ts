import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get("q")?.trim() ?? ""

    const supabase = createServiceRoleClient()

    let dbQuery = supabase
      .from("exercises")
      .select("id, name, muscle_group, equipment, category")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(20)

    if (query) {
      dbQuery = dbQuery.ilike("name", `%${query}%`)
    }

    const { data, error } = await dbQuery
    if (error) throw error

    return NextResponse.json(data ?? [])
  } catch (error) {
    console.error("Exercise search error:", error)
    return NextResponse.json({ error: "Failed to search exercises" }, { status: 500 })
  }
}

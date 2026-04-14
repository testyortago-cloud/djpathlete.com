import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createServiceRoleClient } from "@/lib/supabase"
import { compare } from "bcryptjs"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const body = await request.json()
    const { password } = body

    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password is required." }, { status: 400 })
    }

    const supabase = createServiceRoleClient()

    // Verify admin password
    const { data: admin, error: userError } = await supabase
      .from("users")
      .select("password_hash")
      .eq("id", session.user.id)
      .single()

    if (userError || !admin) {
      return NextResponse.json({ error: "Failed to verify identity." }, { status: 500 })
    }

    const isValid = await compare(password, admin.password_hash)
    if (!isValid) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 })
    }

    // Delete data in dependency order (children before parents)
    // Keep: users (admin account), exercises (library), programs (templates)
    // Reset: all client-generated / transactional data

    const tables = [
      "ai_response_feedback",
      "ai_outcome_tracking",
      "ai_conversation_history",
      "ai_generation_log",
      "achievements",
      "tracked_exercises",
      "exercise_progress",
      "program_assignments",
      "notifications",
      "notification_preferences",
      "password_reset_tokens",
      "email_verification_tokens",
      "payments",
      "reviews",
      "google_reviews",
      "testimonials",
    ]

    const errors: string[] = []

    for (const table of tables) {
      const { error } = await supabase.from(table).delete().gte("id", "0")
      if (error) {
        // For UUID-based tables, try neq filter instead
        const { error: retryError } = await supabase.from(table).delete().not("id", "is", null)
        if (retryError) {
          errors.push(`${table}: ${retryError.message}`)
        }
      }
    }

    // Delete non-admin users (clients)
    const { error: clientsError } = await supabase.from("client_profiles").delete().not("user_id", "is", null)

    if (clientsError) errors.push(`client_profiles: ${clientsError.message}`)

    const { error: usersError } = await supabase.from("users").delete().eq("role", "client")

    if (usersError) errors.push(`users (clients): ${usersError.message}`)

    if (errors.length > 0) {
      console.error("Reset data partial failures:", errors)
      return NextResponse.json({ success: true, warnings: errors }, { status: 200 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Reset data error:", error)
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 })
  }
}

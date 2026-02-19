import { NextResponse } from "next/server"
import { hash } from "bcryptjs"
import { registerSchema } from "@/lib/validators/register"
import { createServiceRoleClient } from "@/lib/supabase"
import type { User } from "@/types/database"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = registerSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { firstName, lastName, email, password } = result.data
    const supabase = createServiceRoleClient()

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      )
    }

    // Hash password
    const password_hash = await hash(password, 12)

    // Create user
    const { data: user, error: userError } = await supabase
      .from("users")
      .insert({
        email,
        password_hash,
        first_name: firstName,
        last_name: lastName,
        role: "client" as const,
        status: "active" as const,
        avatar_url: null,
        phone: null,
      })
      .select()
      .single()

    if (userError || !user) {
      console.error("Failed to create user:", userError)
      return NextResponse.json(
        { error: "Failed to create account. Please try again." },
        { status: 500 }
      )
    }

    const typedUser = user as User

    // Create empty client profile
    const { error: profileError } = await supabase
      .from("client_profiles")
      .insert({
        user_id: typedUser.id,
        date_of_birth: null,
        gender: null,
        sport: null,
        position: null,
        experience_level: null,
        goals: null,
        injuries: null,
        height_cm: null,
        weight_kg: null,
        emergency_contact_name: null,
        emergency_contact_phone: null,
      })

    if (profileError) {
      console.error("Failed to create client profile:", profileError)
      // User was created but profile failed — don't block registration
    }

    // Return user without password_hash
    const { password_hash: _, ...safeUser } = typedUser

    return NextResponse.json(safeUser, { status: 201 })
  } catch (error) {
    console.error("Registration error:", error)
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    )
  }
}

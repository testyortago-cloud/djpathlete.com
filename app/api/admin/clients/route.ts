import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { hash } from "bcryptjs"
import { auth } from "@/lib/auth"
import { addClientSchema } from "@/lib/validators/add-client"
import { getUserByEmail, createUser } from "@/lib/db/users"
import { createServiceRoleClient } from "@/lib/supabase"
import { createEmailVerificationToken } from "@/lib/db/email-verification-tokens"
import { sendAccountCreatedEmail, sendVerificationEmail } from "@/lib/email"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import type { User } from "@/types/database"

export async function POST(request: Request) {
  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
    }

    const body = await request.json()
    const result = addClientSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { firstName, lastName, email, phone } = result.data

    // Check duplicate email
    const existingUser = await getUserByEmail(email)
    if (existingUser) {
      return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 })
    }

    // Generate random temporary password
    const tempPassword = randomBytes(9).toString("base64url")
    const password_hash = await hash(tempPassword, 12)

    // Create user
    const user = await createUser({
      email,
      password_hash,
      first_name: firstName,
      last_name: lastName,
      role: "client",
    })

    const typedUser = user as User

    // Create empty client profile
    const supabase = createServiceRoleClient()
    const { error: profileError } = await supabase.from("client_profiles").insert({
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
    }

    // Update phone if provided
    if (phone) {
      await supabase.from("users").update({ phone }).eq("id", typedUser.id)
    }

    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

    const loginUrl = `${baseUrl}/login`

    // Send account-created email (blocking — admin must know if it fails)
    let emailSent = false
    try {
      await sendAccountCreatedEmail(typedUser.email, tempPassword, typedUser.first_name, loginUrl)
      emailSent = true
    } catch (err) {
      console.error("Failed to send account created email:", err)
    }

    // Non-blocking: send verification email
    createEmailVerificationToken(typedUser.id)
      .then((token) => {
        const verifyUrl = `${baseUrl}/verify-email?token=${token}`
        return sendVerificationEmail(typedUser.email, verifyUrl, typedUser.first_name)
      })
      .catch((err) => console.error("Failed to send verification email:", err))

    // Non-blocking: sync to GoHighLevel CRM
    ghlCreateContact({
      email: typedUser.email,
      firstName: typedUser.first_name,
      lastName: typedUser.last_name,
      phone: phone ?? undefined,
      tags: ["admin-added-client"],
      source: "admin-panel",
    })
      .then((contact) => {
        if (contact?.id && process.env.GHL_WORKFLOW_NEW_CLIENT) {
          return ghlTriggerWorkflow(contact.id, process.env.GHL_WORKFLOW_NEW_CLIENT)
        }
      })
      .catch(() => {
        // GHL sync failure should not affect client creation
      })

    // Return user without password_hash
    const { password_hash: _, ...safeUser } = typedUser

    return NextResponse.json({ ...safeUser, emailSent, ...(emailSent ? {} : { tempPassword }) }, { status: 201 })
  } catch (error) {
    console.error("Add client error:", error)
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 })
  }
}

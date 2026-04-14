import { NextResponse } from "next/server"
import { hash } from "bcryptjs"
import { registerSchema, calculateAge } from "@/lib/validators/register"
import { createServiceRoleClient } from "@/lib/supabase"
import { createEmailVerificationToken } from "@/lib/db/email-verification-tokens"
import { sendVerificationEmail, sendNewRegistrationEmail } from "@/lib/email"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import { getActiveDocument } from "@/lib/db/legal-documents"
import { createConsent } from "@/lib/db/consents"
import type { User } from "@/types/database"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const result = registerSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid form data", details: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { firstName, lastName, email, password, dateOfBirth, guardianName, guardianEmail } = result.data
    const supabase = createServiceRoleClient()
    const age = calculateAge(dateOfBirth)
    const isMinor = age < 18

    // Check if email already exists
    const { data: existingUser } = await supabase.from("users").select("id").eq("email", email).single()

    if (existingUser) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 })
    }

    // Hash password
    const password_hash = await hash(password, 12)

    // Create user
    const now = new Date().toISOString()
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
        terms_accepted_at: now,
        privacy_accepted_at: now,
      })
      .select()
      .single()

    if (userError || !user) {
      console.error("Failed to create user:", userError)
      return NextResponse.json({ error: "Failed to create account. Please try again." }, { status: 500 })
    }

    const typedUser = user as User

    // Create client profile with DOB and guardian info
    const { error: profileError } = await supabase.from("client_profiles").insert({
      user_id: typedUser.id,
      date_of_birth: dateOfBirth,
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
      is_minor: isMinor,
      guardian_name: isMinor ? guardianName || null : null,
      guardian_email: isMinor ? guardianEmail || null : null,
      parental_consent_at: isMinor ? now : null,
    })

    if (profileError) {
      console.error("Failed to create client profile:", profileError)
      // User was created but profile failed — don't block registration
    }

    // Record legal consents (non-blocking)
    try {
      const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null
      const userAgent = request.headers.get("user-agent") || null

      const [tosDoc, privacyDoc] = await Promise.all([
        getActiveDocument("terms_of_service"),
        getActiveDocument("privacy_policy"),
      ])

      const consentPromises = [
        createConsent({
          user_id: typedUser.id,
          consent_type: "terms_of_service",
          legal_document_id: tosDoc?.id || null,
          ip_address: ipAddress,
          user_agent: userAgent,
        }),
        createConsent({
          user_id: typedUser.id,
          consent_type: "privacy_policy",
          legal_document_id: privacyDoc?.id || null,
          ip_address: ipAddress,
          user_agent: userAgent,
        }),
      ]

      if (isMinor) {
        consentPromises.push(
          createConsent({
            user_id: typedUser.id,
            consent_type: "parental_consent",
            ip_address: ipAddress,
            user_agent: userAgent,
            guardian_name: guardianName || null,
            guardian_email: guardianEmail || null,
          }),
        )
      }

      await Promise.all(consentPromises)
    } catch (consentError) {
      console.error("Failed to record consents:", consentError)
      // Don't block registration if consent recording fails
    }

    // Send verification email (non-blocking — don't fail registration if this fails)
    try {
      const token = await createEmailVerificationToken(typedUser.id)
      const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
      const verifyUrl = `${baseUrl}/verify-email?token=${token}`
      await sendVerificationEmail(typedUser.email, verifyUrl, typedUser.first_name)
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError)
      // Don't block registration if email fails
    }

    // Sync to GoHighLevel (non-blocking)
    try {
      const contact = await ghlCreateContact({
        email: typedUser.email,
        firstName: typedUser.first_name,
        lastName: typedUser.last_name,
        tags: ["registered-client"],
        source: "website-registration",
      })
      if (contact?.id && process.env.GHL_WORKFLOW_NEW_CLIENT) {
        await ghlTriggerWorkflow(contact.id, process.env.GHL_WORKFLOW_NEW_CLIENT)
      }
    } catch {
      // GHL sync failure should not affect registration
    }

    // Notify admins (non-blocking)
    try {
      const { data: admins } = await supabase.from("users").select("id").eq("role", "admin")

      if (admins && admins.length > 0) {
        await supabase.from("notifications").insert(
          admins.map((admin) => ({
            user_id: admin.id,
            type: "info" as const,
            title: "New Client Registration",
            message: `${firstName} ${lastName} (${email}) has created an account.`,
            is_read: false,
            link: null,
          })),
        )
      }

      await sendNewRegistrationEmail({
        firstName,
        lastName,
        email,
      })
    } catch {
      // Notification failure should not affect registration
    }

    // Return user without password_hash
    const { password_hash: _, ...safeUser } = typedUser

    return NextResponse.json(safeUser, { status: 201 })
  } catch (error) {
    console.error("Registration error:", error)
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 })
  }
}

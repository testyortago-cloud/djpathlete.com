import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getProfileByUserId, updateProfile, createProfile } from "@/lib/db/client-profiles"
import { z } from "zod"

const profileSchema = z.object({
  sport: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  experience_level: z
    .enum(["beginner", "intermediate", "advanced", "elite"])
    .nullable()
    .optional(),
  goals: z.string().nullable().optional(),
  injuries: z.string().nullable().optional(),
  height_cm: z.number().nullable().optional(),
  weight_kg: z.number().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  gender: z
    .enum(["male", "female", "other", "prefer_not_to_say"])
    .nullable()
    .optional(),
  emergency_contact_name: z.string().nullable().optional(),
  emergency_contact_phone: z.string().nullable().optional(),
  weight_unit: z.enum(["kg", "lbs"]).optional(),
})

export async function PATCH(request: Request) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const parsed = profileSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const updates = parsed.data

    // Check if profile exists; if not, create one first
    const existingProfile = await getProfileByUserId(userId)

    if (!existingProfile) {
      const newProfile = await createProfile({
        user_id: userId,
        date_of_birth: updates.date_of_birth ?? null,
        gender: updates.gender ?? null,
        sport: updates.sport ?? null,
        position: updates.position ?? null,
        experience_level: updates.experience_level ?? null,
        goals: updates.goals ?? null,
        injuries: updates.injuries ?? null,
        height_cm: updates.height_cm ?? null,
        weight_kg: updates.weight_kg ?? null,
        emergency_contact_name: updates.emergency_contact_name ?? null,
        emergency_contact_phone: updates.emergency_contact_phone ?? null,
        available_equipment: [],
        preferred_day_names: [],
        preferred_session_minutes: null,
        preferred_training_days: null,
        time_efficiency_preference: null,
        preferred_techniques: [],
        injury_details: [],
        training_years: null,
        sleep_hours: null,
        stress_level: null,
        occupation_activity_level: null,
        movement_confidence: null,
        exercise_likes: null,
        exercise_dislikes: null,
        training_background: null,
        additional_notes: null,
        weight_unit: "lbs",
      })
      return NextResponse.json(newProfile)
    }

    const updated = await updateProfile(userId, updates)
    return NextResponse.json(updated)
  } catch (error) {
    console.error("Profile update error:", error)
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    )
  }
}

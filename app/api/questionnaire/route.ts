import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getProfileByUserId,
  updateProfile,
  createProfile,
} from "@/lib/db/client-profiles"
import { questionnaireSchema } from "@/lib/validators/questionnaire"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const profile = await getProfileByUserId(session.user.id)
    if (!profile) {
      return NextResponse.json({ profile: null })
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error("Questionnaire GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const parsed = questionnaireSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const data = parsed.data

    // Store goals as a clean comma-separated list (no more pipe-delimited mess)
    const profileUpdates = {
      goals: data.goals.join(", "),
      sport: data.sport || null,
      date_of_birth: data.date_of_birth ? `${data.date_of_birth}-01-01` : null,
      gender: data.gender ?? null,
      experience_level: data.experience_level,
      movement_confidence: data.movement_confidence ?? null,
      sleep_hours: data.sleep_hours ?? null,
      stress_level: data.stress_level ?? null,
      occupation_activity_level: data.occupation_activity_level ?? null,
      training_years: data.training_years ?? null,
      training_background: data.training_background || null,
      injuries: data.injuries_text || null,
      injury_details: data.injury_details,
      available_equipment: data.available_equipment as string[],
      preferred_day_names: data.preferred_day_names,
      preferred_training_days: data.preferred_day_names.length,
      preferred_session_minutes: data.preferred_session_minutes,
      time_efficiency_preference: data.time_efficiency_preference ?? null,
      preferred_techniques: data.preferred_techniques ?? [],
      exercise_likes: data.exercise_likes || null,
      exercise_dislikes: data.exercise_dislikes || null,
      additional_notes: data.additional_notes || null,
    }

    // Check if profile exists; if not, create one first
    const existingProfile = await getProfileByUserId(userId)

    if (!existingProfile) {
      const newProfile = await createProfile({
        user_id: userId,
        date_of_birth: profileUpdates.date_of_birth,
        gender: profileUpdates.gender,
        sport: profileUpdates.sport,
        position: null,
        experience_level: profileUpdates.experience_level,
        movement_confidence: profileUpdates.movement_confidence,
        goals: profileUpdates.goals,
        injuries: profileUpdates.injuries,
        height_cm: null,
        weight_kg: null,
        emergency_contact_name: null,
        emergency_contact_phone: null,
        available_equipment: profileUpdates.available_equipment,
        preferred_day_names: profileUpdates.preferred_day_names,
        preferred_session_minutes: profileUpdates.preferred_session_minutes,
        preferred_training_days: profileUpdates.preferred_training_days,
        time_efficiency_preference: profileUpdates.time_efficiency_preference,
        preferred_techniques: profileUpdates.preferred_techniques,
        injury_details: profileUpdates.injury_details,
        training_years: profileUpdates.training_years,
        sleep_hours: profileUpdates.sleep_hours,
        stress_level: profileUpdates.stress_level,
        occupation_activity_level: profileUpdates.occupation_activity_level,
        exercise_likes: profileUpdates.exercise_likes,
        exercise_dislikes: profileUpdates.exercise_dislikes,
        training_background: profileUpdates.training_background,
        additional_notes: profileUpdates.additional_notes,
        weight_unit: "kg",
      })
      return NextResponse.json({ profile: newProfile })
    }

    const updated = await updateProfile(userId, profileUpdates)
    return NextResponse.json({ profile: updated })
  } catch (error) {
    console.error("Questionnaire POST error:", error)
    return NextResponse.json(
      { error: "Failed to save questionnaire" },
      { status: 500 }
    )
  }
}

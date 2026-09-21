import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getProfileByUserId, updateProfile, createProfile } from "@/lib/db/client-profiles"
import { questionnaireSchema } from "@/lib/validators/questionnaire"
import { ghlCreateContact, ghlTriggerWorkflow } from "@/lib/ghl"
import { recordAudit } from "@/lib/audit/record"
import { captureLead } from "@/lib/lead-engine/capture"
import { platformBusinessId } from "@/lib/tenancy/platform"

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
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 })
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
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 })
    }

    const data = parsed.data

    // G20. Join the contact spine. Before this, a completed questionnaire --
    // one of the richest statements of intent this product collects -- wrote
    // `client_profiles` and pushed the person to GoHighLevel and left NO trace
    // on the contact timeline at all, so the engine could neither see it nor
    // follow it up.
    //
    // Declared here and called on BOTH write branches below. The create branch
    // returns early, so a single call placed after it would miss every
    // RE-submission -- and re-submitting a questionnaire is the ordinary case,
    // not the edge one.
    //
    // `captureLead` never throws (lib/lead-engine/capture.ts swallows and logs
    // its own failures), so a spine failure can never cost the submitter the
    // answers they just filled in.
    //
    // THE ASSESSMENT ROUTE NOW MATCHES THIS ONE. It used to be the
    // deliberate exception -- app/api/assessment/submit/route.ts is equally
    // session-gated and, under the 8 Sept ruling, attached ONLY to a contact
    // that already existed. G21 reversed that ruling on 2026-09-21 and both
    // routes now mint through `captureLead`. The two are no longer allowed
    // to drift: if one of them changes how it joins the spine, the other is
    // part of that change.
    const joinContactSpine = async (clientProfileId: string | null) => {
      await captureLead({
        source: "questionnaire",
        email: session.user.email,
        // The account's name, not something typed on this form -- so it fills
        // a contact that has none and never replaces a name the same person
        // gave a different surface. See `namePatch` in lib/db/contacts.ts.
        name: session.user.name,
        nameFillOnly: true,
        userId,
        // The session carries a userId only; `users` has no `business_id` and
        // there is no per-coach relationship to resolve a client's own tenant
        // from today. Same seam, for the same reason, as the assessment
        // submission's contact lookup -- inventoried in lib/tenancy/platform.ts.
        businessId: platformBusinessId(),
        metadata: { client_profile_id: clientProfileId },
      })
    }

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
        is_minor: false,
        guardian_name: null,
        guardian_email: null,
        parental_consent_at: null,
      })
      // Sync to GoHighLevel (non-blocking)
      try {
        const contact = await ghlCreateContact({
          email: session.user.email ?? "",
          firstName: session.user.name?.split(" ")[0],
          lastName: session.user.name?.split(" ").slice(1).join(" "),
          tags: ["questionnaire-completed"],
          source: "questionnaire",
        })
        if (contact?.id && process.env.GHL_WORKFLOW_QUESTIONNAIRE_COMPLETE) {
          await ghlTriggerWorkflow(contact.id, process.env.GHL_WORKFLOW_QUESTIONNAIRE_COMPLETE)
        }
      } catch {
        // GHL sync failure should not affect questionnaire submission
      }

      await joinContactSpine(newProfile.id ?? null)

      await recordAudit({
        action: "questionnaire.submitted",
        category: "client_action",
        target: { type: "questionnaire", id: newProfile.id ?? userId },
        metadata: {
          answers_count: Object.keys(data ?? {}).length,
          mode: "created",
          experience_level: data.experience_level ?? null,
        },
        request,
      })

      return NextResponse.json({ profile: newProfile })
    }

    const updated = await updateProfile(userId, profileUpdates)

    // Sync to GoHighLevel (non-blocking)
    try {
      const contact = await ghlCreateContact({
        email: session.user.email ?? "",
        firstName: session.user.name?.split(" ")[0],
        lastName: session.user.name?.split(" ").slice(1).join(" "),
        tags: ["questionnaire-completed"],
        source: "questionnaire",
      })
      if (contact?.id && process.env.GHL_WORKFLOW_QUESTIONNAIRE_COMPLETE) {
        await ghlTriggerWorkflow(contact.id, process.env.GHL_WORKFLOW_QUESTIONNAIRE_COMPLETE)
      }
    } catch {
      // GHL sync failure should not affect questionnaire submission
    }

    await joinContactSpine(updated?.id ?? null)

    await recordAudit({
      action: "questionnaire.submitted",
      category: "client_action",
      target: { type: "questionnaire", id: updated?.id ?? userId },
      metadata: {
        answers_count: Object.keys(data ?? {}).length,
        mode: "updated",
        experience_level: data.experience_level ?? null,
      },
      request,
    })

    return NextResponse.json({ profile: updated })
  } catch (error) {
    console.error("Questionnaire POST error:", error)
    return NextResponse.json({ error: "Failed to save questionnaire" }, { status: 500 })
  }
}

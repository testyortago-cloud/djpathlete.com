import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { logProgress, getProgress, getWorkoutStreak } from "@/lib/db/progress"
import { createAchievement } from "@/lib/db/achievements"
import { getExerciseById } from "@/lib/db/exercises"
import { detectPRs, checkStreakMilestones, checkWorkoutMilestones } from "@/lib/pr-detection"
import { createServiceRoleClient } from "@/lib/supabase"
import { workoutLogSchema } from "@/lib/validators/workout-log"
import type { Achievement } from "@/types/database"

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const parsed = workoutLogSchema.safeParse(body)

    if (!parsed.success) {
      console.error("Workout log validation failed:", parsed.error.flatten())
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const userId = session.user.id
    const {
      exercise_id,
      assignment_id,
      sets_completed,
      reps_completed,
      weight_kg,
      rpe,
      duration_seconds,
      notes,
      set_details,
    } = parsed.data

    // Log the workout progress
    const record = await logProgress({
      user_id: userId,
      exercise_id,
      assignment_id,
      sets_completed,
      reps_completed,
      weight_kg,
      rpe,
      duration_seconds,
      notes,
      set_details: set_details ?? null,
      completed_at: new Date().toISOString(),
      is_pr: false,
      pr_type: null,
    })

    // ─── PR Detection ──────────────────────────────────────────────────────────
    const newAchievements: Achievement[] = []

    // Fetch exercise name for PR titles
    let exerciseName = "Exercise"
    try {
      const exercise = await getExerciseById(exercise_id)
      exerciseName = exercise.name
    } catch {
      // If exercise lookup fails, use generic name — don't block the log
    }

    // 1. Run PR detection for this exercise
    const prs = await detectPRs(userId, exercise_id, exerciseName, {
      weight_kg: weight_kg ?? null,
      reps_completed,
      sets_completed,
      set_details: set_details ?? null,
    })

    // 2. For each PR found, create an achievement and mark the progress record
    for (const pr of prs) {
      if (pr.isPr) {
        const achievement = await createAchievement({
          user_id: userId,
          achievement_type: "pr",
          title: pr.title,
          description: pr.description,
          exercise_id,
          metric_value: pr.metricValue,
          icon: "trophy",
          celebrated: false,
          earned_at: new Date().toISOString(),
        })
        newAchievements.push(achievement)

        // Update the logged progress record to mark is_pr = true and pr_type
        try {
          const supabase = createServiceRoleClient()
          await supabase
            .from("exercise_progress")
            .update({ is_pr: true, pr_type: pr.prType })
            .eq("id", record.id)
        } catch (updateError) {
          console.error("Failed to update PR flag on progress record:", updateError)
        }
      }
    }

    // 3. Check streak and workout milestones
    const [streak, allProgress] = await Promise.all([
      getWorkoutStreak(userId),
      getProgress(userId),
    ])

    const streakResult = await checkStreakMilestones(userId, streak)
    const workoutResult = await checkWorkoutMilestones(userId, allProgress.length)

    if (streakResult?.isPr) {
      const achievement = await createAchievement({
        user_id: userId,
        achievement_type: "streak",
        title: streakResult.title,
        description: streakResult.description,
        exercise_id: null,
        metric_value: streakResult.metricValue,
        icon: "flame",
        celebrated: false,
        earned_at: new Date().toISOString(),
      })
      newAchievements.push(achievement)
    }

    if (workoutResult?.isPr) {
      const achievement = await createAchievement({
        user_id: userId,
        achievement_type: "milestone",
        title: workoutResult.title,
        description: workoutResult.description,
        exercise_id: null,
        metric_value: workoutResult.metricValue,
        icon: "activity",
        celebrated: false,
        earned_at: new Date().toISOString(),
      })
      newAchievements.push(achievement)
    }

    // 4. Return the logged record AND any new achievements
    return NextResponse.json(
      { progress: record, achievements: newAchievements },
      { status: 201 }
    )
  } catch (error) {
    console.error("Workout log POST error:", error)
    return NextResponse.json(
      { error: "Failed to log workout" },
      { status: 500 }
    )
  }
}

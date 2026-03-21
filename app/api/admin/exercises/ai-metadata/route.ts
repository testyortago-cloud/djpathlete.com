import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { callAgent, MODEL_HAIKU } from "@/lib/ai/anthropic"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import {
  MOVEMENT_PATTERNS,
  FORCE_TYPES,
  LATERALITY_OPTIONS,
  MUSCLE_OPTIONS,
  EQUIPMENT_OPTIONS,
} from "@/lib/validators/exercise"

export const maxDuration = 15

// ─── Input validation ───────────────────────────────────────────────────────

const requestSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.array(z.string()).min(1),
  difficulty: z.string().optional(),
  description: z.string().max(2000).optional(),
  equipment: z.string().max(200).optional(),
})

// ─── AI output schema (structured output) ───────────────────────────────────

const aiMetadataSchema = z.object({
  movement_pattern: z.enum(MOVEMENT_PATTERNS).nullable(),
  force_type: z.enum(FORCE_TYPES).nullable(),
  laterality: z.enum(LATERALITY_OPTIONS).nullable(),
  primary_muscles: z.array(z.enum(MUSCLE_OPTIONS)),
  secondary_muscles: z.array(z.enum(MUSCLE_OPTIONS)),
  equipment_required: z.array(z.enum(EQUIPMENT_OPTIONS)),
  is_bodyweight: z.boolean(),
  training_intent: z.array(z.enum(["build", "shape", "express"])),
  difficulty_score: z.number(),
})

// ─── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an exercise science expert. Given basic exercise information, predict the detailed metadata fields. Be accurate and consistent with standard exercise classification.

Available values for each field:
- movement_pattern: ${MOVEMENT_PATTERNS.join(", ")}
- force_type: ${FORCE_TYPES.join(", ")}
- laterality: ${LATERALITY_OPTIONS.join(", ")}
- primary_muscles / secondary_muscles: ${MUSCLE_OPTIONS.join(", ")}
- equipment_required: ${EQUIPMENT_OPTIONS.join(", ")}
- is_bodyweight: true if no external resistance is needed
- training_intent: array of one or more of ["build", "shape", "express"]:
  - build = developing tissue capacity, isolated or focused work
  - shape = movement control, neural challenge, dynamic, or compound
  - express = speed, power, sport-specific components
- difficulty_score: 1-10 scale (1-2 foundational, 3-4 beginner, 5-6 intermediate, 7-8 advanced, 9-10 elite)

Rules:
- primary_muscles: select 1-3 muscles that are the PRIMARY movers
- secondary_muscles: select 0-3 muscles that ASSIST (must not overlap with primary_muscles)
- equipment_required: only list equipment that is ESSENTIAL (not optional accessories)
- If the exercise name implies the movement pattern (e.g. "squat" → squat, "bench press" → push), use that
- For cardio exercises like running/cycling, use "locomotion" as movement_pattern and "dynamic" as force_type
- For stretches/mobility, use null for movement_pattern and "static" for force_type
- For isometric holds (planks, wall sits), use "isometric" as movement_pattern and "static" as force_type`

// ─── Route handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { name, category, difficulty, description, equipment } = parsed.data

    const userMessage = `Exercise: ${name}
Category: ${category.join(", ")}${difficulty ? `\nDifficulty: ${difficulty}` : ""}${description ? `\nDescription: ${description}` : ""}${equipment ? `\nEquipment: ${equipment}` : ""}`

    const result = await callAgent(
      SYSTEM_PROMPT,
      userMessage,
      aiMetadataSchema,
      { model: MODEL_HAIKU }
    )

    // Log usage (fire-and-forget)
    createGenerationLog({
      program_id: null,
      client_id: null,
      requested_by: session.user.id,
      status: "completed",
      input_params: { feature: "exercise_ai_metadata", name },
      output_summary: null,
      error_message: null,
      model_used: MODEL_HAIKU,
      tokens_used: result.tokens_used,
      duration_ms: Date.now() - startTime,
      completed_at: new Date().toISOString(),
      current_step: 0,
      total_steps: 0,
    }).catch(() => {})

    return NextResponse.json(result.content)
  } catch (error) {
    console.error("[Exercise AI Metadata] Error:", error)
    return NextResponse.json(
      { error: "Failed to generate metadata predictions" },
      { status: 500 }
    )
  }
}

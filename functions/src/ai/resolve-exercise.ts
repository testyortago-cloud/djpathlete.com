import { getSupabase } from "../lib/supabase.js"
import { embedText, embedExercise } from "./embeddings.js"
import { stringSimilarity } from "string-similarity-js"
import type { CompressedExercise } from "./types.js"

const SEMANTIC_MIN = 0.62
const FUZZY_MIN = 0.72

export interface ResolvedExercise {
  raw_name: string
  exercise_id: string
  exercise_name: string
  method: "exact" | "semantic" | "fuzzy" | "created"
  confidence: number
  created: boolean
}

export interface ResolveDeps {
  listLibrary: () => Promise<{ id: string; name: string }[]>
  matchByEmbedding: (name: string) => Promise<{ id: string; similarity: number }[]>
  insertExercise: (name: string) => Promise<{ id: string; name: string }>
  embed: (id: string, name: string) => Promise<void>
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

function defaultDeps(): ResolveDeps {
  return {
    listLibrary: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase.from("exercises").select("id, name").eq("is_active", true)
      if (error) throw new Error(`listLibrary failed: ${error.message}`)
      return (data ?? []) as { id: string; name: string }[]
    },
    matchByEmbedding: async (name: string) => {
      const supabase = getSupabase()
      const emb = await embedText(name)
      const { data } = await supabase.rpc("match_exercises", {
        query_embedding: JSON.stringify(emb),
        match_threshold: 0.5,
        match_count: 5,
      })
      return (data ?? []) as { id: string; similarity: number }[]
    },
    insertExercise: async (name: string) => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("exercises")
        .insert({ name, category: ["strength"], description: "Imported from Excel — review metadata." })
        .select("id, name")
        .single()
      if (error) throw new Error(`insertExercise failed: ${error.message}`)
      return data as { id: string; name: string }
    },
    embed: async (id: string, name: string) => {
      const supabase = getSupabase()
      const placeholder: CompressedExercise = {
        id,
        name,
        category: ["strength"],
        difficulty: "intermediate",
        difficulty_score: null,
        muscle_group: null,
        movement_pattern: null,
        primary_muscles: [],
        secondary_muscles: [],
        force_type: null,
        laterality: null,
        equipment_required: [],
        is_bodyweight: false,
        training_intent: ["build"],
        sport_tags: [],
        plane_of_motion: [],
        joints_loaded: [],
      }
      const vec = await embedExercise(placeholder)
      await supabase.from("exercises").update({ embedding: JSON.stringify(vec) }).eq("id", id)
    },
  }
}

export async function resolveExerciseNames(
  rawNames: string[],
  overrides: Partial<ResolveDeps> = {},
): Promise<Map<string, ResolvedExercise>> {
  const deps = { ...defaultDeps(), ...overrides }
  const library = await deps.listLibrary()
  const byNorm = new Map(library.map((e) => [normalize(e.name), e]))
  const result = new Map<string, ResolvedExercise>()

  for (const raw of rawNames) {
    const key = normalize(raw)
    if (result.has(key)) continue

    const exact = byNorm.get(key)
    if (exact) {
      result.set(key, {
        raw_name: raw,
        exercise_id: exact.id,
        exercise_name: exact.name,
        method: "exact",
        confidence: 1,
        created: false,
      })
      continue
    }

    let matched = false
    try {
      const cands = await deps.matchByEmbedding(raw)
      if (cands.length && cands[0].similarity >= SEMANTIC_MIN) {
        const hit = library.find((e) => e.id === cands[0].id)
        if (hit) {
          result.set(key, {
            raw_name: raw,
            exercise_id: hit.id,
            exercise_name: hit.name,
            method: "semantic",
            confidence: cands[0].similarity,
            created: false,
          })
          matched = true
        }
      }
    } catch (e) {
      console.warn(`[resolve] semantic match failed for "${raw}":`, e)
    }
    if (matched) continue

    let best = { id: "", name: "", score: 0 }
    for (const e of library) {
      const score = stringSimilarity(key, normalize(e.name))
      if (score > best.score) best = { id: e.id, name: e.name, score }
    }
    if (best.score >= FUZZY_MIN) {
      result.set(key, {
        raw_name: raw,
        exercise_id: best.id,
        exercise_name: best.name,
        method: "fuzzy",
        confidence: best.score,
        created: false,
      })
      continue
    }

    try {
      const created = await deps.insertExercise(raw)
      deps.embed(created.id, created.name).catch((err) => console.warn(`[resolve] embed failed for "${raw}":`, err))
      result.set(key, {
        raw_name: raw,
        exercise_id: created.id,
        exercise_name: created.name,
        method: "created",
        confidence: 0,
        created: true,
      })
      library.push(created)
      byNorm.set(normalize(created.name), created)
    } catch (e) {
      if (best.id) {
        result.set(key, {
          raw_name: raw,
          exercise_id: best.id,
          exercise_name: best.name,
          method: "fuzzy",
          confidence: best.score,
          created: false,
        })
      } else {
        console.error(`[resolve] could not resolve or create "${raw}":`, e)
      }
    }
  }

  return result
}

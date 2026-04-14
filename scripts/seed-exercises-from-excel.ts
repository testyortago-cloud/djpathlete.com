/**
 * Seed exercises from Excel — Reads "DJP_Exercise_Template (1).xlsx" from the
 * project root and upserts all 899 exercises into Supabase.
 *
 * Run:   npx tsx scripts/seed-exercises-from-excel.ts
 * Dry:   npx tsx scripts/seed-exercises-from-excel.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import ExcelJS from "exceljs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: resolve(__dirname, "../.env.local") })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const DRY_RUN = process.argv.includes("--dry-run")
const BATCH_SIZE = 50

// ─── Category Mapping ────────────────────────────────────────────────────────

function mapCategories(raw: string | undefined | null): string[] {
  if (!raw || !raw.trim()) return ["strength"]

  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const mapped = new Set<string>()
  const warnings: string[] = []

  for (const part of parts) {
    const cat = mapSingleCategory(part)
    if (cat === null) {
      warnings.push(part)
      mapped.add("strength") // fallback
    } else {
      mapped.add(cat)
    }
  }

  if (warnings.length > 0) {
    unmappedCategories.push(...warnings)
  }

  return mapped.size > 0 ? Array.from(mapped) : ["strength"]
}

const unmappedCategories: string[] = []

function mapSingleCategory(val: string): string | null {
  const v = val.trim().toLowerCase()

  // Direct matches
  if (["strength", "strengh", "strenth"].includes(v)) return "strength"
  if (["speed", "agility / speed"].includes(v)) return "speed"
  if (["power", "power / agility"].includes(v)) return "power"
  if (v === "plyometric") return "plyometric"
  if (v === "flexibility") return "flexibility"
  if (["mobility", "hip mobility"].includes(v)) return "mobility"
  if (
    [
      "motor control",
      "motorc control",
      "mobility / motor control",
      "strength / motor control",
      "speed / motor control",
      "strength motor control",
    ].includes(v)
  )
    return "motor_control"
  if (v === "strength endurance") return "strength_endurance"
  if (["relative strength", "realtive strength"].includes(v)) return "relative_strength"
  if (v === "cardio") return "strength_endurance"

  // Core / stability → motor_control
  if (
    [
      "core stability",
      "rotational core stability",
      "shoulder stability",
      "back stability",
      "hip control",
      "hip activation",
      "calf activation",
      "adductor stability",
    ].includes(v)
  )
    return "motor_control"

  // Full body / body part categories → strength
  if (v === "full body") return "strength"
  if (
    [
      "chest",
      "back",
      "arms",
      "triceps",
      "quadriceps",
      "hamstring",
      "hip",
      "calves",
      "calf",
      "posterior delts",
      "upper body",
      "abductors",
    ].includes(v)
  )
    return "strength"

  return null
}

// ─── Training Intent Mapping ─────────────────────────────────────────────────

function mapTrainingIntent(raw: string | undefined | null): string[] {
  if (!raw || !raw.trim()) return ["build"]

  const parts = raw
    .split("/")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const mapped = new Set<string>()

  for (const part of parts) {
    const intent = mapSingleIntent(part)
    if (intent) mapped.add(intent)
  }

  return mapped.size > 0 ? Array.from(mapped) : ["build"]
}

function mapSingleIntent(val: string): string | null {
  const v = val.trim().toLowerCase()
  if (["build", "buil", "bui;d", "buils", "build"].includes(v)) return "build"
  if (["shape"].includes(v)) return "shape"
  if (["express", "expression", "exprss"].includes(v)) return "express"
  return null
}

// ─── Difficulty Mapping ──────────────────────────────────────────────────────

function mapDifficulty(raw: string | undefined | null): {
  difficulty: string
  difficulty_max: string | null
} {
  if (!raw || !raw.trim()) return { difficulty: "intermediate", difficulty_max: null }

  const v = raw.trim().toLowerCase()

  // Junk values
  if (v.includes("shit exercise") || v.includes("may take out"))
    return { difficulty: "intermediate", difficulty_max: null }

  // Normalize advanced misspellings
  const norm = v
    .replace(/advanecd|advaned|advanved/g, "advanced")
    .replace(/\s+/g, " ")
    .trim()

  // Range patterns with dash/en-dash
  if (/^beginner[\s–-]+intermediate$/i.test(norm)) return { difficulty: "beginner", difficulty_max: "intermediate" }
  if (/^intermediate[\s–-]+advanced$/i.test(norm)) return { difficulty: "intermediate", difficulty_max: "advanced" }

  // "OR" patterns
  if (/beginner\s+or\s+intermediate\s+or\s+advanced/i.test(norm))
    return { difficulty: "beginner", difficulty_max: "advanced" }
  if (/intermediate\s+or\s+advanced/i.test(norm)) return { difficulty: "intermediate", difficulty_max: "advanced" }

  // Comma-separated lists
  const commaParts = norm
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ["beginner", "intermediate", "advanced"].includes(s))

  if (commaParts.length >= 3) return { difficulty: "beginner", difficulty_max: "advanced" }

  if (commaParts.length === 2) {
    const sorted = commaParts.sort((a, b) => {
      const order = { beginner: 0, intermediate: 1, advanced: 2 }
      return (order[a as keyof typeof order] ?? 1) - (order[b as keyof typeof order] ?? 1)
    })
    return { difficulty: sorted[0], difficulty_max: sorted[1] }
  }

  // "intermediate, strength" and similar — just take the valid difficulty
  if (commaParts.length === 1) return { difficulty: commaParts[0], difficulty_max: null }

  // Single values
  if (/^\s*beginner\s*$/.test(norm)) return { difficulty: "beginner", difficulty_max: null }
  if (/^\s*intermediate\s*$/.test(norm)) return { difficulty: "intermediate", difficulty_max: null }
  if (/^\s*advanced\s*$/.test(norm)) return { difficulty: "advanced", difficulty_max: null }

  // Default
  return { difficulty: "intermediate", difficulty_max: null }
}

// ─── Equipment Mapping ───────────────────────────────────────────────────────

const EQUIPMENT_MAP: [RegExp, string][] = [
  [/\bbarbell landmine attachment\b/i, "landmine"],
  [/\blat pulldown machine\b/i, "lat_pulldown_machine"],
  [/\blat pull down machine\b/i, "lat_pulldown_machine"],
  [/\blat machine\b/i, "lat_pulldown_machine"],
  [/\bcable machine pulley system\b/i, "cable_machine"],
  [/\bfunctional trainer\s*\/?\s*dual adjustable pulley machine\b/i, "cable_machine"],
  [/\bcable machine\b/i, "cable_machine"],
  [/\bCable machine\b/i, "cable_machine"],
  [/\bsmith machine\b/i, "smith_machine"],
  [/\bSmith machine\b/i, "smith_machine"],
  [/\bresistance band\b/i, "resistance_band"],
  [/\bResistance Band\b/i, "resistance_band"],
  [/\bresistance cable\b/i, "resistance_band"],
  [/\biso bar\b/i, "resistance_band"],
  [/\bmedicine ball\b/i, "medicine_ball"],
  [/\bMedicine ball\b/i, "medicine_ball"],
  [/\bmed ?ball\b/i, "medicine_ball"],
  [/\bmedball\b/i, "medicine_ball"],
  [/\bswiss ball\b/i, "stability_ball"],
  [/\bSwiss ball\b/i, "stability_ball"],
  [/\bfoam roll(?:er|)\b/i, "foam_roller"],
  [/\bfoam roler\b/i, "foam_roller"],
  [/\bweight plates?\b/i, "weight_plate"],
  [/\bWeight plates?\b/i, "weight_plate"],
  [/\bbattle ropes?\b/i, "battle_ropes"],
  [/\bTRX suspension trainers?\b/i, "trx"],
  [/\bTRX\b/, "trx"],
  [/\bplyo box\b/i, "plyo_box"],
  [/\bPlyo box\b/i, "plyo_box"],
  [/\bjump box\b/i, "plyo_box"],
  [/\bbox\b/i, "plyo_box"],
  [/\bslant board\b/i, "box"],
  [/\bshort barbell\b/i, "short_barbell"],
  [/\blandmine\b/i, "landmine"],
  [/\bbarbell\b/i, "barbell"],
  [/\bBarbell\b/i, "barbell"],
  [/\bdumm?bells?\b/i, "dumbbell"],
  [/\bDumbbells?\b/i, "dumbbell"],
  [/\bkettler?bell\b/i, "kettlebell"],
  [/\bKettlebell\b/i, "kettlebell"],
  [/\bcable\b/i, "cable_machine"],
  [/\bband\b/i, "resistance_band"],
  [/\bbench(?:es)?\b/i, "bench"],
  [/\bBench\b/i, "bench"],
  [/\bmat\b/i, "yoga_mat"],
  [/\bMat\b/i, "yoga_mat"],
  [/\bgliders?\b/i, "gliders"],
  [/\bGliders?\b/i, "gliders"],
  [/\bwall\b/i, "wall"],
  [/\bWall\b/i, "wall"],
]

// Terms to skip (bodyweight synonyms)
const SKIP_EQUIPMENT = /\b(body\s*weight|bodyweight|body)\b/i

function mapEquipment(raw: string | undefined | null): string[] {
  if (!raw || !raw.trim()) return []

  const result = new Set<string>()

  // Process the whole string against patterns (order matters — longer phrases first)
  let remaining = raw
  for (const [regex, mapped] of EQUIPMENT_MAP) {
    if (regex.test(remaining)) {
      if (!SKIP_EQUIPMENT.test(mapped)) {
        result.add(mapped)
      }
      // Remove matched portion to avoid double-matching substrings
      remaining = remaining.replace(regex, " ")
    }
  }

  return Array.from(result)
}

// ─── Bodyweight Mapping ──────────────────────────────────────────────────────

function mapBodyweight(raw: unknown): boolean {
  if (raw === true || raw === "TRUE" || raw === "true") return true
  return false
}

// ─── Cell value helper ───────────────────────────────────────────────────────

function cellText(cell: ExcelJS.Cell): string {
  const val = cell.value
  if (val === null || val === undefined) return ""
  if (typeof val === "object" && "text" in val) return String(val.text).trim()
  if (typeof val === "object" && "hyperlink" in val) {
    // Rich text or hyperlink — extract the hyperlink URL
    return String((val as { hyperlink: string }).hyperlink ?? "").trim()
  }
  return String(val).trim()
}

function cellHyperlink(cell: ExcelJS.Cell): string {
  const val = cell.value
  if (val === null || val === undefined) return ""
  // ExcelJS hyperlink value shape
  if (typeof val === "object" && val !== null && "hyperlink" in val) {
    return String((val as { hyperlink: string }).hyperlink).trim()
  }
  // Sometimes it's just a URL string
  const text = cellText(cell)
  if (text.startsWith("http")) return text
  return ""
}

function cellBool(cell: ExcelJS.Cell): unknown {
  const val = cell.value
  if (typeof val === "boolean") return val
  return cellText(cell)
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface ExerciseRow {
  video_url: string | null
  name: string
  description: string | null
  instructions: string | null
  muscle_group: string | null
  category: string[]
  training_intent: string[]
  difficulty: string
  difficulty_max: string | null
  equipment: string | null
  equipment_required: string[]
  is_bodyweight: boolean
  is_active: boolean
  created_by: null
  primary_muscles: string[]
  secondary_muscles: string[]
  movement_pattern: null
  force_type: null
  laterality: null
}

async function main() {
  console.log(DRY_RUN ? "🏃 DRY RUN — no database changes\n" : "")

  const excelPath = resolve(__dirname, "../DJP_Exercise_Template (1).xlsx")
  console.log(`Reading: ${excelPath}\n`)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(excelPath)

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error("No worksheet found in Excel file")

  const exercises: ExerciseRow[] = []
  let skipped = 0

  // Data starts at row 5 (row 1 = headers, rows 2-4 = skip)
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 5) return

    const name = cellText(row.getCell(2)) // Col B
    if (!name) {
      skipped++
      return
    }

    const videoUrl = cellHyperlink(row.getCell(1)) || null // Col A
    const description = cellText(row.getCell(3)) || null // Col C
    const instructions = cellText(row.getCell(4)) || null // Col D
    const muscleGroup = cellText(row.getCell(5)) || null // Col E
    const categoryRaw = cellText(row.getCell(6)) // Col F
    const intentRaw = cellText(row.getCell(7)) // Col G
    const difficultyRaw = cellText(row.getCell(8)) // Col H
    const equipmentRaw = cellText(row.getCell(9)) // Col I
    const bodyweightRaw = cellBool(row.getCell(10)) // Col J

    const { difficulty, difficulty_max } = mapDifficulty(difficultyRaw)

    exercises.push({
      video_url: videoUrl,
      name,
      description,
      instructions,
      muscle_group: muscleGroup,
      category: mapCategories(categoryRaw),
      training_intent: mapTrainingIntent(intentRaw),
      difficulty,
      difficulty_max,
      equipment: equipmentRaw || null,
      equipment_required: mapEquipment(equipmentRaw),
      is_bodyweight: mapBodyweight(bodyweightRaw),
      is_active: true,
      created_by: null,
      primary_muscles: [],
      secondary_muscles: [],
      movement_pattern: null,
      force_type: null,
      laterality: null,
    })
  })

  // ── Stats ──────────────────────────────────────────────────────────────────

  console.log("═══ Parsing Stats ═══")
  console.log(`  Total rows parsed:    ${exercises.length}`)
  console.log(`  Rows skipped (no name): ${skipped}`)

  // Category distribution
  const catCounts: Record<string, number> = {}
  for (const ex of exercises) {
    for (const c of ex.category) catCounts[c] = (catCounts[c] ?? 0) + 1
  }
  console.log("\n  Category distribution:")
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count}`)
  }

  // Training intent distribution
  const intentCounts: Record<string, number> = {}
  for (const ex of exercises) {
    for (const i of ex.training_intent) intentCounts[i] = (intentCounts[i] ?? 0) + 1
  }
  console.log("\n  Training intent distribution:")
  for (const [intent, count] of Object.entries(intentCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${intent}: ${count}`)
  }

  // Difficulty distribution
  const diffCounts: Record<string, number> = {}
  for (const ex of exercises) {
    const key = ex.difficulty_max ? `${ex.difficulty}–${ex.difficulty_max}` : ex.difficulty
    diffCounts[key] = (diffCounts[key] ?? 0) + 1
  }
  console.log("\n  Difficulty distribution:")
  for (const [d, count] of Object.entries(diffCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${d}: ${count}`)
  }

  // Equipment distribution
  const equipCounts: Record<string, number> = {}
  for (const ex of exercises) {
    for (const e of ex.equipment_required) equipCounts[e] = (equipCounts[e] ?? 0) + 1
  }
  console.log("\n  Equipment distribution (top 15):")
  for (const [eq, count] of Object.entries(equipCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)) {
    console.log(`    ${eq}: ${count}`)
  }

  // Unmapped category warnings
  if (unmappedCategories.length > 0) {
    const unique = [...new Set(unmappedCategories)].sort()
    console.log(`\n  ⚠ Unmapped category values (${unique.length} unique):`)
    for (const u of unique) console.log(`    - "${u}"`)
  }

  const bwCount = exercises.filter((e) => e.is_bodyweight).length
  console.log(`\n  Bodyweight exercises: ${bwCount}`)
  console.log(`  With video URL: ${exercises.filter((e) => e.video_url).length}`)

  if (DRY_RUN) {
    console.log("\n✅ Dry run complete — no database changes made.")

    // Print a few sample rows for verification
    console.log("\n═══ Sample Exercises (first 5) ═══")
    for (const ex of exercises.slice(0, 5)) {
      console.log(`  ${ex.name}`)
      console.log(`    category: [${ex.category.join(", ")}]`)
      console.log(`    intent: [${ex.training_intent.join(", ")}]`)
      console.log(`    difficulty: ${ex.difficulty}${ex.difficulty_max ? `–${ex.difficulty_max}` : ""}`)
      console.log(`    equipment: ${ex.equipment ?? "(none)"}`)
      console.log(`    equipment_required: [${ex.equipment_required.join(", ")}]`)
      console.log(`    bodyweight: ${ex.is_bodyweight}`)
      console.log(`    video: ${ex.video_url ?? "(none)"}`)
      console.log()
    }
    return
  }

  // ── Delete existing data ───────────────────────────────────────────────────

  console.log("\n═══ Clearing existing exercises ═══")

  console.log("  Deleting exercise_relationships...")
  const { error: relErr } = await supabase
    .from("exercise_relationships")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (relErr) console.warn(`  ⚠ exercise_relationships: ${relErr.message}`)

  console.log("  Deleting program_exercises...")
  const { error: peErr } = await supabase
    .from("program_exercises")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
  if (peErr) console.warn(`  ⚠ program_exercises: ${peErr.message}`)

  console.log("  Deleting exercises...")
  const { error: exErr } = await supabase.from("exercises").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  if (exErr) throw new Error(`Failed to delete exercises: ${exErr.message}`)

  console.log("  ✓ Cleared\n")

  // ── Insert in batches ──────────────────────────────────────────────────────

  console.log(`═══ Inserting ${exercises.length} exercises (batch size ${BATCH_SIZE}) ═══`)

  let inserted = 0
  let failed = 0

  for (let i = 0; i < exercises.length; i += BATCH_SIZE) {
    const batch = exercises.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(exercises.length / BATCH_SIZE)

    const { error } = await supabase.from("exercises").insert(batch)

    if (error) {
      console.error(`  ✗ Batch ${batchNum}/${totalBatches} failed: ${error.message}`)
      failed += batch.length
    } else {
      inserted += batch.length
      if (batchNum % 5 === 0 || batchNum === totalBatches) {
        console.log(`  ✓ Batch ${batchNum}/${totalBatches} — ${inserted} inserted so far`)
      }
    }
  }

  console.log(`\n═══ Done ═══`)
  console.log(`  ✓ Inserted: ${inserted}`)
  if (failed > 0) console.log(`  ✗ Failed:   ${failed}`)
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err)
  process.exit(1)
})

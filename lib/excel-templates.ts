import ExcelJS from "exceljs"

const CATEGORIES = [
  "strength",
  "speed",
  "power",
  "plyometric",
  "flexibility",
  "mobility",
  "motor_control",
  "strength_endurance",
  "relative_strength",
]
const DIFFICULTIES = ["beginner", "intermediate", "advanced"]
const BOOL_OPTIONS = ["TRUE", "FALSE"]
const TRAINING_INTENT_OPTIONS = ["Build", "Shape", "Express", "Build/Shape", "Shape/Express", "Build/Shape/Express"]

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0E3F50" },
}

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
}

const HINT_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF5F5F4" },
}

const HINT_FONT: Partial<ExcelJS.Font> = {
  italic: true,
  color: { argb: "FF9CA3AF" },
  size: 10,
}

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFE5E7EB" } },
  bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
  left: { style: "thin", color: { argb: "FFE5E7EB" } },
  right: { style: "thin", color: { argb: "FFE5E7EB" } },
}

interface ColumnDef {
  header: string
  key: string
  width: number
  hint: string
  dropdown?: string[]
}

const EXERCISE_COLUMNS: ColumnDef[] = [
  { header: "Exercise Name *", key: "name", width: 30, hint: "e.g. Barbell Back Squat" },
  { header: "Description *", key: "description", width: 45, hint: "Short description of the exercise" },
  { header: "Category *", key: "category", width: 18, hint: "Select from dropdown", dropdown: CATEGORIES },
  { header: "Difficulty *", key: "difficulty", width: 16, hint: "Select from dropdown", dropdown: DIFFICULTIES },
  { header: "Muscle Group", key: "muscle_group", width: 22, hint: "e.g. Quadriceps / Glutes" },
  { header: "Equipment", key: "equipment", width: 25, hint: "e.g. Barbell / Squat Rack" },
  { header: "Instructions", key: "instructions", width: 55, hint: "Step-by-step coaching cues" },
  { header: "Bodyweight?", key: "is_bodyweight", width: 14, hint: "Select from dropdown", dropdown: BOOL_OPTIONS },
  {
    header: "Training Intent",
    key: "training_intent",
    width: 20,
    hint: "Select from dropdown",
    dropdown: TRAINING_INTENT_OPTIONS,
  },
  { header: "Video URL", key: "video_url", width: 35, hint: "YouTube link (optional)" },
]

const EXAMPLE_ROWS = [
  {
    name: "Barbell Back Squat",
    description: "Compound lower body movement targeting quads and glutes",
    category: "strength",
    difficulty: "intermediate",
    muscle_group: "Quadriceps / Glutes",
    equipment: "Barbell / Squat Rack",
    instructions:
      "1. Set bar on upper traps. 2. Unrack and step back. 3. Brace core, squat to parallel. 4. Drive through heels to stand.",
    is_bodyweight: "FALSE",
    training_intent: "Build/Shape",
    video_url: "",
  },
  {
    name: "Romanian Deadlift",
    description: "Hip hinge targeting posterior chain",
    category: "strength",
    difficulty: "intermediate",
    muscle_group: "Hamstrings / Glutes",
    equipment: "Barbell",
    instructions:
      "1. Hold barbell at hip height. 2. Push hips back, lowering bar along shins. 3. Feel stretch in hamstrings. 4. Drive hips forward to stand.",
    is_bodyweight: "FALSE",
    training_intent: "Build",
    video_url: "",
  },
  {
    name: "Pull-Up",
    description: "Vertical pulling bodyweight exercise",
    category: "strength",
    difficulty: "intermediate",
    muscle_group: "Lats / Biceps",
    equipment: "Pull-up Bar",
    instructions: "1. Hang from bar with overhand grip. 2. Pull chin above bar. 3. Lower with control.",
    is_bodyweight: "TRUE",
    training_intent: "Build/Shape",
    video_url: "",
  },
]

const RELATIONSHIP_COLUMNS: ColumnDef[] = [
  { header: "Exercise Name *", key: "exercise_name", width: 30, hint: "e.g. Barbell Back Squat" },
  { header: "Related Exercise *", key: "related_exercise_name", width: 30, hint: "e.g. Goblet Squat" },
  {
    header: "Relationship Type *",
    key: "relationship_type",
    width: 20,
    hint: "Select from dropdown",
    dropdown: ["progression", "regression", "alternative", "variation"],
  },
  { header: "Notes", key: "notes", width: 50, hint: "Why are these exercises related?" },
]

const RELATIONSHIP_EXAMPLES = [
  {
    exercise_name: "Barbell Back Squat",
    related_exercise_name: "Goblet Squat",
    relationship_type: "regression",
    notes: "Simpler squat pattern for beginners learning mechanics",
  },
  {
    exercise_name: "Barbell Back Squat",
    related_exercise_name: "Front Squat",
    relationship_type: "variation",
    notes: "Shifts emphasis to quads and upper back",
  },
  {
    exercise_name: "Pull-Up",
    related_exercise_name: "Lat Pulldown",
    relationship_type: "regression",
    notes: "Machine alternative when pull-ups are too difficult",
  },
]

function applySheetFormatting(sheet: ExcelJS.Worksheet, columns: ColumnDef[], examples: Record<string, string>[]) {
  // Set columns
  sheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }))

  // Style header row
  const headerRow = sheet.getRow(1)
  headerRow.height = 28
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    cell.border = BORDER
  })

  // Add hint row (row 2)
  const hintRow = sheet.getRow(2)
  columns.forEach((col, i) => {
    const cell = hintRow.getCell(i + 1)
    cell.value = col.hint
    cell.fill = HINT_FILL
    cell.font = HINT_FONT
    cell.alignment = { vertical: "middle", wrapText: true }
    cell.border = BORDER
  })
  hintRow.height = 22

  // Add example rows
  examples.forEach((example, rowIdx) => {
    const row = sheet.getRow(rowIdx + 3)
    columns.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1)
      cell.value = example[col.key] || ""
      cell.alignment = { vertical: "top", wrapText: true }
      cell.border = BORDER
    })
  })

  // Apply dropdowns to data rows (rows 3 to 200)
  columns.forEach((col, i) => {
    if (!col.dropdown) return
    const colLetter = String.fromCharCode(65 + i)
    for (let row = 3; row <= 200; row++) {
      sheet.getCell(`${colLetter}${row}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${col.dropdown.join(",")}"`],
        showErrorMessage: true,
        errorTitle: "Invalid value",
        error: `Please select from: ${col.dropdown.join(", ")}`,
      }
    }
  })

  // Freeze header + hint row
  sheet.views = [{ state: "frozen", ySplit: 2, xSplit: 0 }]
}

export async function generateExerciseTemplate(): Promise<Blob> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "DJP Athlete"

  // Exercise sheet
  const exerciseSheet = workbook.addWorksheet("Exercises", {
    properties: { tabColor: { argb: "FF0E3F50" } },
  })
  applySheetFormatting(exerciseSheet, EXERCISE_COLUMNS, EXAMPLE_ROWS)

  // Relationships sheet
  const relSheet = workbook.addWorksheet("Relationships", {
    properties: { tabColor: { argb: "FFC49B7A" } },
  })
  applySheetFormatting(relSheet, RELATIONSHIP_COLUMNS, RELATIONSHIP_EXAMPLES)

  // Instructions sheet
  const instructionsSheet = workbook.addWorksheet("Instructions", {
    properties: { tabColor: { argb: "FF6B7280" } },
  })
  instructionsSheet.columns = [
    { header: "Field", key: "field", width: 20 },
    { header: "Required", key: "required", width: 12 },
    { header: "Description", key: "description", width: 60 },
    { header: "Valid Values", key: "values", width: 50 },
  ]

  const instrHeaderRow = instructionsSheet.getRow(1)
  instrHeaderRow.height = 28
  instrHeaderRow.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: "middle", horizontal: "center" }
    cell.border = BORDER
  })

  const instructionRows = [
    { field: "Exercise Name", required: "Yes", description: "The name of the exercise", values: "Free text" },
    {
      field: "Description",
      required: "Yes",
      description: "Short description of the exercise purpose",
      values: "Free text",
    },
    { field: "Category", required: "Yes", description: "Exercise type classification", values: CATEGORIES.join(", ") },
    { field: "Difficulty", required: "Yes", description: "Skill level required", values: DIFFICULTIES.join(", ") },
    {
      field: "Muscle Group",
      required: "No",
      description: "Target muscles (free text for your reference)",
      values: "e.g. Quadriceps / Glutes",
    },
    {
      field: "Equipment",
      required: "No",
      description: "Equipment needed to perform the exercise",
      values: "Free text, e.g. Barbell / Squat Rack",
    },
    { field: "Instructions", required: "No", description: "Step-by-step coaching cues", values: "Numbered steps" },
    { field: "Bodyweight?", required: "No", description: "Is this a bodyweight exercise?", values: "TRUE or FALSE" },
    {
      field: "Training Intent",
      required: "No",
      description: "Training intent classification for the exercise",
      values: TRAINING_INTENT_OPTIONS.join(", "),
    },
    {
      field: "Video URL",
      required: "No",
      description: "YouTube video link for exercise demo",
      values: "Full YouTube URL",
    },
    { field: "", required: "", description: "", values: "" },
    {
      field: "AI METADATA",
      required: "",
      description: "The following fields are generated by AI — you do NOT need to fill these in",
      values: "",
    },
    {
      field: "movement_pattern",
      required: "Auto",
      description: "Movement classification for programming",
      values: "push, pull, squat, hinge, lunge, carry, rotation, isometric, locomotion",
    },
    {
      field: "primary_muscles",
      required: "Auto",
      description: "Primary muscles targeted",
      values:
        "chest, upper_back, lats, shoulders, biceps, triceps, forearms, core, obliques, lower_back, glutes, quadriceps, hamstrings, calves, hip_flexors, adductors, abductors, traps, neck",
    },
    {
      field: "secondary_muscles",
      required: "Auto",
      description: "Secondary muscles involved",
      values: "Same as primary_muscles",
    },
    {
      field: "force_type",
      required: "Auto",
      description: "Type of force produced",
      values: "push, pull, static, dynamic",
    },
    {
      field: "laterality",
      required: "Auto",
      description: "Bilateral or unilateral movement",
      values: "bilateral, unilateral, alternating",
    },
    {
      field: "equipment_required",
      required: "Auto",
      description: "Specific equipment tags for filtering",
      values: "barbell, dumbbell, kettlebell, cable_machine, bench, squat_rack, pull_up_bar, resistance_band, etc.",
    },
  ]

  instructionRows.forEach((data, i) => {
    const row = instructionsSheet.getRow(i + 2)
    row.getCell(1).value = data.field
    row.getCell(2).value = data.required
    row.getCell(3).value = data.description
    row.getCell(4).value = data.values
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true }
      cell.border = BORDER
    })
    // Bold the AI METADATA separator row
    if (data.field === "AI METADATA") {
      row.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFC49B7A" } }
      })
    }
  })

  instructionsSheet.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }]

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

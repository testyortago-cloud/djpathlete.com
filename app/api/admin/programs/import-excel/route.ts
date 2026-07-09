import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getSetting } from "@/lib/db/system-settings"
import { parseWorkbookToSheet } from "@/lib/excel/parse-program-sheet"
import { programImportOptionsSchema } from "@/lib/validators/program-import"
import { getAdminFirestore, getAdminRtdb } from "@/lib/firebase-admin"
import { FieldValue } from "firebase-admin/firestore"
import { createGenerationLog } from "@/lib/db/ai-generation-log"
import { withAudit } from "@/lib/audit/with-audit"

const ALLOWED_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]
const MAX_SIZE = 5 * 1024 * 1024 // 5 MB

export const POST = withAudit(
  {
    action: "program.imported",
    category: "admin_write",
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { target_id: id } : {}
    },
  },
  async (request) => {
    try {
      // Auth check
      const session = await auth()
      if (!session?.user?.id || session.user.role !== "admin") {
        return NextResponse.json({ error: "Unauthorized. Admin access required." }, { status: 403 })
      }

      // Feature flag gate — invisible when off
      const enabled = await getSetting<boolean>("feature_program_excel_import_enabled", true)
      if (!enabled) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }

      const formData = await request.formData()
      const file = formData.get("file") as File | null

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 })
      }

      const nameLower = file.name.toLowerCase()
      const hasAllowedExtension = nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls")
      if (!ALLOWED_TYPES.includes(file.type) && !hasAllowedExtension) {
        return NextResponse.json(
          { error: "Invalid file type. Upload a .xlsx or .xls spreadsheet." },
          { status: 400 },
        )
      }

      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: "File too large. Maximum 5 MB" }, { status: 400 })
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      let parsedSheet
      try {
        parsedSheet = await parseWorkbookToSheet(buffer)
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 })
      }

      const optResult = programImportOptionsSchema.safeParse({
        client_id: formData.get("client_id") || undefined,
        is_public: formData.get("is_public") || undefined,
        name_override: formData.get("name_override") || undefined,
        notify_email: formData.get("notify_email") || undefined,
      })

      if (!optResult.success) {
        return NextResponse.json(
          { error: "Invalid import options", details: optResult.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      const options = optResult.data

      // Create Supabase log entry first so we can return log_id for polling
      const log = await createGenerationLog({
        program_id: null,
        client_id: options.client_id,
        requested_by: session.user.id,
        status: "pending",
        input_params: { source: "excel_import", file_name: file.name, options },
        output_summary: null,
        error_message: null,
        model_used: "sonnet",
        tokens_used: null,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        duration_ms: null,
        completed_at: null,
        current_step: 0,
        total_steps: 4,
      })

      // Create Firestore job doc — Firebase Function picks it up via onDocumentCreated
      const firestoreDb = getAdminFirestore()
      const jobRef = firestoreDb.collection("ai_jobs").doc()

      await jobRef.set({
        type: "program_from_excel",
        status: "pending",
        input: {
          parsedSheet,
          options,
          fileName: file.name,
          requestedBy: session.user.id,
          logId: log.id,
          notify_email: options.notify_email,
        },
        result: null,
        error: null,
        userId: session.user.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

      // Seed RTDB node so client listener gets immediate data
      try {
        const rtdb = getAdminRtdb()
        await rtdb.ref(`ai_jobs/${jobRef.id}`).set({
          status: "pending",
          progress: { status: "queued", current_step: 0, total_steps: 4 },
          result: null,
          error: null,
          updatedAt: Date.now(),
        })
      } catch (rtdbErr) {
        console.warn("[import-excel] Failed to seed RTDB node:", rtdbErr)
      }

      const response = NextResponse.json(
        {
          jobId: jobRef.id,
          log_id: log.id,
          status: "pending",
        },
        { status: 202 },
      )
      response.headers.set("x-audit-target-id", jobRef.id)
      return response
    } catch (error) {
      console.error("[import-excel] Failed to start import:", error)
      return NextResponse.json({ error: "Failed to start import" }, { status: 500 })
    }
  },
)

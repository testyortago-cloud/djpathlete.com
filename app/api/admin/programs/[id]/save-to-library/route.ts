import { NextResponse } from "next/server"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { getProgramFolder } from "@/lib/db/program-folders"
import { getProgramById } from "@/lib/db/programs"
import { copyProgram } from "@/lib/services/copy-program"
import { saveToLibrarySchema } from "@/lib/validators/program-library"

/** Copies any program (a client's, or another library program) into a library folder. The source is untouched. */
export const POST = withAudit(
  {
    action: "program.saved_to_library",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "program", id: ((await ctx.params) as { id: string }).id }),
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { copy_program_id: id } : {}
    },
  },
  async (request, context) => {
    try {
      const { id } = await (context as { params: Promise<{ id: string }> }).params
      const parsed = saveToLibrarySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return NextResponse.json({ error: "Pick a folder." }, { status: 400 })
      const { businessId } = await resolveAdminTenantForRequest(request)
      const folder = await getProgramFolder(businessId, parsed.data.folder_id)
      if (!folder) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      const source = await getProgramById(id)
      const program = await copyProgram(id, {
        is_template: true,
        folder_id: folder.id,
        is_public: false,
        name: parsed.data.name ?? source.name,
      })
      const res = NextResponse.json({ program }, { status: 201 })
      res.headers.set("x-audit-target-id", program.id)
      return res
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      console.error("[save-to-library]", err)
      return NextResponse.json({ error: "Couldn't save to the library. Nothing was saved." }, { status: 500 })
    }
  },
)

import { NextResponse } from "next/server"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { getProgramFolder } from "@/lib/db/program-folders"
import { getProgramById, updateProgram } from "@/lib/db/programs"
import { moveToFolderSchema } from "@/lib/validators/program-library"

/** Moves a library program to another of this business's folders. */
export const PATCH = withAudit(
  {
    action: "program.updated",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "program", id: ((await ctx.params) as { id: string }).id }),
  },
  async (request, context) => {
    try {
      const { id } = await (context as { params: Promise<{ id: string }> }).params
      const parsed = moveToFolderSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return NextResponse.json({ error: "Pick a folder." }, { status: 400 })
      const program = await getProgramById(id)
      if (!program.is_template || !program.folder_id) {
        return NextResponse.json({ error: "Only a library program can be moved between folders." }, { status: 400 })
      }
      const { businessId } = await resolveAdminTenantForRequest(request)
      // Both ends must be this business's: the folder is a template's only tenant marker.
      const [from, to] = await Promise.all([
        getProgramFolder(businessId, program.folder_id),
        getProgramFolder(businessId, parsed.data.folder_id),
      ])
      if (!from || !to) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      return NextResponse.json({ program: await updateProgram(id, { folder_id: to.id }) })
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      console.error("[program folder PATCH]", err)
      return NextResponse.json({ error: "Couldn't move the program." }, { status: 500 })
    }
  },
)

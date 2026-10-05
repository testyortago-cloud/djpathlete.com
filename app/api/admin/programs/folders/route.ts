import { NextResponse } from "next/server"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { createProgramFolder, listProgramFolders, pgErrorCode } from "@/lib/db/program-folders"
import { folderNameSchema } from "@/lib/validators/program-library"

export async function GET(request: Request) {
  try {
    const { businessId } = await resolveAdminTenantForRequest(request)
    return NextResponse.json({ folders: await listProgramFolders(businessId) })
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
    console.error("[program-folders GET]", err)
    return NextResponse.json({ error: "Couldn't load your folders." }, { status: 500 })
  }
}

export const POST = withAudit(
  {
    action: "program_folder.created",
    category: "admin_write",
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { target_id: id } : {}
    },
  },
  async (request) => {
    try {
      const parsed = folderNameSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json({ error: "Give the folder a name (up to 80 characters)." }, { status: 400 })
      }
      const { businessId } = await resolveAdminTenantForRequest(request)
      const folder = await createProgramFolder(businessId, parsed.data.name)
      const res = NextResponse.json({ folder }, { status: 201 })
      res.headers.set("x-audit-target-id", folder.id)
      return res
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      if (pgErrorCode(err) === "23505") {
        return NextResponse.json({ error: "You already have a folder with that name." }, { status: 409 })
      }
      console.error("[program-folders POST]", err)
      return NextResponse.json({ error: "Couldn't create the folder." }, { status: 500 })
    }
  },
)

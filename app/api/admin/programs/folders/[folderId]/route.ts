import { NextResponse } from "next/server"
import { z } from "zod"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { deleteProgramFolder, pgErrorCode, renameProgramFolder } from "@/lib/db/program-folders"
import { folderNameSchema } from "@/lib/validators/program-library"

const idSchema = z.string().uuid()

async function folderIdFrom(context: unknown): Promise<string | null> {
  const { params } = context as { params: Promise<{ folderId: string }> }
  const parsed = idSchema.safeParse((await params).folderId)
  return parsed.success ? parsed.data : null
}

export const PATCH = withAudit(
  {
    action: "program_folder.updated",
    category: "admin_write",
    target: async (_req, ctx) => ({
      type: "program_folder",
      id: ((await ctx.params) as { folderId: string }).folderId,
    }),
  },
  async (request, context) => {
    try {
      const folderId = await folderIdFrom(context)
      if (!folderId) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      const parsed = folderNameSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json({ error: "Give the folder a name (up to 80 characters)." }, { status: 400 })
      }
      const { businessId } = await resolveAdminTenantForRequest(request)
      const folder = await renameProgramFolder(businessId, folderId, parsed.data.name)
      if (!folder) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      return NextResponse.json({ folder })
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      if (pgErrorCode(err) === "23505") {
        return NextResponse.json({ error: "You already have a folder with that name." }, { status: 409 })
      }
      console.error("[program-folders PATCH]", err)
      return NextResponse.json({ error: "Couldn't rename the folder." }, { status: 500 })
    }
  },
)

export const DELETE = withAudit(
  {
    action: "program_folder.deleted",
    category: "admin_write",
    target: async (_req, ctx) => ({
      type: "program_folder",
      id: ((await ctx.params) as { folderId: string }).folderId,
    }),
  },
  async (request, context) => {
    try {
      const folderId = await folderIdFrom(context)
      if (!folderId) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      const { businessId } = await resolveAdminTenantForRequest(request)
      const deleted = await deleteProgramFolder(businessId, folderId)
      if (!deleted) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
      return NextResponse.json({ ok: true })
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      if (pgErrorCode(err) === "23503") {
        return NextResponse.json(
          { error: "This folder still has programs in it. Move or delete them first." },
          { status: 409 },
        )
      }
      console.error("[program-folders DELETE]", err)
      return NextResponse.json({ error: "Couldn't delete the folder." }, { status: 500 })
    }
  },
)

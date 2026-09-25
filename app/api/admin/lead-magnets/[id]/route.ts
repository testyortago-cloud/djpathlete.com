import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { leadMagnetFormSchema } from "@/lib/validators/lead-magnet"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import {
  getLeadMagnetById,
  updateLeadMagnet,
  deleteLeadMagnet,
} from "@/lib/db/lead-magnets"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }

  const { id } = await params
  try {
    const magnet = await getLeadMagnetById(businessId, id)
    if (!magnet) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ magnet })
  } catch (err) {
    console.error("[GET /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = leadMagnetFormSchema.partial().safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    )
  }
  try {
    const updated = await updateLeadMagnet(businessId, id, parsed.data)
    return NextResponse.json({ magnet: updated })
  } catch (err) {
    console.error("[PATCH /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    throw err
  }

  const { id } = await params
  try {
    await deleteLeadMagnet(businessId, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[DELETE /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

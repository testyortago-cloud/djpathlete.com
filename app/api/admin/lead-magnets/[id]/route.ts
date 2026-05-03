import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { leadMagnetFormSchema } from "@/lib/validators/lead-magnet"
import {
  getLeadMagnetById,
  updateLeadMagnet,
  deleteLeadMagnet,
} from "@/lib/db/lead-magnets"

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  try {
    const magnet = await getLeadMagnetById(id)
    if (!magnet) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ magnet })
  } catch (err) {
    console.error("[GET /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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
    const updated = await updateLeadMagnet(id, parsed.data)
    return NextResponse.json({ magnet: updated })
  } catch (err) {
    console.error("[PATCH /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  try {
    await deleteLeadMagnet(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[DELETE /api/admin/lead-magnets/[id]]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

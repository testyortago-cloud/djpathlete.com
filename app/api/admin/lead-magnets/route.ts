import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { leadMagnetFormSchema } from "@/lib/validators/lead-magnet"
import { listLeadMagnets, createLeadMagnet } from "@/lib/db/lead-magnets"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  try {
    const magnets = await listLeadMagnets(true)
    return NextResponse.json({ magnets })
  } catch (err) {
    console.error("[GET /api/admin/lead-magnets]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  const parsed = leadMagnetFormSchema.safeParse(body)
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
    const created = await createLeadMagnet({
      slug: parsed.data.slug,
      title: parsed.data.title,
      description: parsed.data.description,
      asset_url: parsed.data.asset_url,
      category: parsed.data.category,
      tags: parsed.data.tags,
      active: parsed.data.active,
    })
    return NextResponse.json({ magnet: created }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ error: "Slug already in use" }, { status: 409 })
    }
    console.error("[POST /api/admin/lead-magnets]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

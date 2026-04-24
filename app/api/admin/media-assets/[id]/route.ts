import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getMediaAssetById } from "@/lib/db/media-assets"
import { createServiceRoleClient } from "@/lib/supabase"
import { mediaAssetPatchSchema } from "@/lib/validators/media-asset"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const raw = (await request.json().catch(() => null)) as unknown
  const parsed = mediaAssetPatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    )
  }

  const existing = await getMediaAssetById(id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from("media_assets")
    .update(parsed.data)
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

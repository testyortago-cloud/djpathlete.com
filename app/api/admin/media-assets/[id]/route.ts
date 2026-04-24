import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteMediaAsset, getMediaAssetById, updateMediaAsset } from "@/lib/db/media-assets"
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

  try {
    await updateMediaAsset(id, parsed.data)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const existing = await getMediaAssetById(id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  try {
    await deleteMediaAsset(id)
  } catch (err) {
    const message = (err as Error).message ?? ""
    // Supabase / Postgres FK violation bubbles up as a message mentioning the
    // foreign-key constraint. Surface a clear 409 for admin UX.
    if (/foreign key/i.test(message) || /still referenced/i.test(message)) {
      return NextResponse.json(
        { error: "Asset is in use by one or more posts. Detach it from those posts before deleting." },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: message || "Delete failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { uploadReportPhoto, deleteReportPhoto } from "@/lib/storage"
import { updateProfile } from "@/lib/db/client-profiles"

const MAX_SIZE = 8 * 1024 * 1024 // 8 MB — a full-bleed cover shot, not a thumbnail
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

/**
 * Cover photo for a client's public test report. ADMIN ONLY — the report is a
 * public, sales-facing document, so the coach decides what image goes on it.
 * (The avatar route deliberately allows self-service; this one does not.)
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const userId = formData.get("userId") as string | null

    if (!userId) {
      return NextResponse.json({ error: "No userId provided" }, { status: 400 })
    }
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Use JPEG, PNG, or WebP." }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 8 MB." }, { status: 400 })
    }

    const url = await uploadReportPhoto(userId, file, file.name)
    await updateProfile(userId, { report_photo_url: url })

    return NextResponse.json({ url })
  } catch (error) {
    console.error("Report photo upload error:", error)
    return NextResponse.json({ error: "Failed to upload report photo" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { userId } = await request.json()
    if (!userId) {
      return NextResponse.json({ error: "No userId provided" }, { status: 400 })
    }

    await deleteReportPhoto(userId)
    await updateProfile(userId, { report_photo_url: null })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Report photo delete error:", error)
    return NextResponse.json({ error: "Failed to remove report photo" }, { status: 500 })
  }
}

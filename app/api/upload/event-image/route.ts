import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { uploadEventImage } from "@/lib/event-storage"

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum 5 MB" }, { status: 400 })
    }

    const ext = file.name.split(".").pop() ?? "jpg"
    const eventId = (formData.get("eventId") as string | null) ?? crypto.randomUUID()
    const path = `hero/${eventId}.${ext}`
    const url = await uploadEventImage(file, path)
    return NextResponse.json({ url })
  } catch (error) {
    console.error("Event image upload error:", error)
    return NextResponse.json({ error: "Failed to upload image" }, { status: 500 })
  }
}

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { randomBytes } from "node:crypto"
import { getAdminStorage } from "@/lib/firebase-admin"

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!file || typeof (file as File).arrayBuffer !== "function") {
    return NextResponse.json({ error: "Missing file" }, { status: 400 })
  }
  const uploadedFile = file as File
  if (uploadedFile.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 413 })
  }
  if (!ALLOWED_TYPES.has(uploadedFile.type)) {
    return NextResponse.json({ error: "Unsupported type" }, { status: 415 })
  }

  const bucket = getAdminStorage().bucket()
  const ext = uploadedFile.type === "image/jpeg" ? "jpg" : uploadedFile.type === "image/png" ? "png" : "webp"
  const path = `shop/${randomBytes(16).toString("hex")}.${ext}`
  const buffer = Buffer.from(await uploadedFile.arrayBuffer())

  const ref = bucket.file(path)
  await ref.save(buffer, {
    metadata: { contentType: uploadedFile.type, cacheControl: "public, max-age=31536000" },
    resumable: false,
  })
  await ref.makePublic()
  const url = `https://storage.googleapis.com/${bucket.name}/${path}`
  return NextResponse.json({ url })
}

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { getPrivateBucket } from "@/lib/firebase-admin"
import crypto from "node:crypto"

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/zip",
  "video/mp4",
  "audio/mpeg",
])
const MAX_BYTES = 500 * 1024 * 1024 // 500 MB

export async function POST(req: Request) {
  await requireAdmin()

  const formData = await req.formData()
  const file = formData.get("file")
  if (!file || typeof (file as File).arrayBuffer !== "function") {
    return NextResponse.json({ error: "Missing file" }, { status: 400 })
  }
  const uploaded = file as File
  if (uploaded.size > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 500MB" }, { status: 413 })
  }
  if (!ALLOWED_MIMES.has(uploaded.type)) {
    return NextResponse.json(
      { error: `unsupported mime type: ${uploaded.type}` },
      { status: 415 },
    )
  }

  const safeName = uploaded.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const prefix = crypto.randomUUID()
  const storage_path = `shop-downloads/${prefix}/${safeName}`

  try {
    const bucket = getPrivateBucket()
    const buffer = Buffer.from(await uploaded.arrayBuffer())
    await bucket.file(storage_path).save(buffer, {
      metadata: { contentType: uploaded.type },
      resumable: false,
    })
  } catch (err) {
    const e = err as { message?: string }
    return NextResponse.json(
      { error: e.message ?? "Failed to upload file" },
      { status: 500 },
    )
  }

  return NextResponse.json({
    storage_path,
    file_name: uploaded.name,
    file_size_bytes: uploaded.size,
    mime_type: uploaded.type,
  })
}

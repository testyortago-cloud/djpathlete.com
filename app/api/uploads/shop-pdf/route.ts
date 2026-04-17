import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-helpers"
import { generateSignedUploadUrl } from "@/lib/shop/downloads"
import { z } from "zod"
import crypto from "node:crypto"

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/zip",
  "video/mp4",
  "audio/mpeg",
])
const MAX_BYTES = 500 * 1024 * 1024 // 500 MB

const bodySchema = z.object({
  file_name: z.string().min(1).max(200),
  content_type: z.string().min(1),
  file_size_bytes: z.number().int().positive(),
})

export async function POST(req: Request) {
  await requireAdmin()
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const v = parsed.data
  if (!ALLOWED_MIMES.has(v.content_type)) {
    return NextResponse.json({ error: "unsupported mime type" }, { status: 400 })
  }
  if (v.file_size_bytes > MAX_BYTES) {
    return NextResponse.json({ error: "file exceeds 500MB" }, { status: 400 })
  }
  const safeName = v.file_name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const prefix = crypto.randomUUID()
  const storage_path = `shop-downloads/${prefix}/${safeName}`
  const upload_url = await generateSignedUploadUrl(
    storage_path,
    v.content_type,
    600,
  )
  return NextResponse.json({ upload_url, storage_path })
}

// POST /api/upload/funnel-image — one image for a funnel page's media slot.
//
// Mirrors the shape of the sibling upload routes (`event-image`, `blog-image`):
// multipart body, allowlisted content types, size cap, admin only. It differs
// in where the bytes land — Firebase Storage, at a path `storage.rules` makes
// publicly readable — because a funnel page's `media.src` is published to
// anonymous visitors and must never be a URL that expires. See
// `lib/funnel-storage.ts` for why that is a hard requirement here.
//
// WIDTH AND HEIGHT ARE THE CLIENT'S TO SUPPLY, and the route insists on them.
// `heroMediaSchema` requires positive integers for both, so an upload that
// omitted them would produce a `media` object `applyOps` refuses — the owner
// would pick a photo, watch nothing happen, and get an error about a field no
// UI ever showed them. The browser already has the decoded image, so it is the
// cheapest correct place to measure; the alternative is an image-processing
// dependency on the server to re-derive what the picker already knew.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { uploadFunnelImage } from "@/lib/funnel-storage"

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]

/** Matches `sectionIdSchema`'s character class, applied to the step id path segment. */
const SAFE_STEP_ID = /^[a-zA-Z0-9_-]{1,64}$/

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF, AVIF" },
        { status: 400 },
      )
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "That image is over the 5 MB limit." }, { status: 400 })
    }

    // Never interpolated raw into the storage path. It becomes a path segment,
    // so a value containing `../` or a slash would write outside the prefix the
    // storage rule grants read on.
    const stepId = formData.get("stepId")
    if (typeof stepId !== "string" || !SAFE_STEP_ID.test(stepId)) {
      return NextResponse.json({ error: "Invalid step" }, { status: 400 })
    }

    const width = Number(formData.get("width"))
    const height = Number(formData.get("height"))
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      return NextResponse.json(
        { error: "That image's dimensions could not be read. Try a different file." },
        { status: 400 },
      )
    }

    const { url } = await uploadFunnelImage(file, stepId, file.name)
    return NextResponse.json({ url, width, height })
  } catch (error) {
    console.error("[POST /api/upload/funnel-image]", error)
    return NextResponse.json({ error: "That image could not be uploaded." }, { status: 500 })
  }
}

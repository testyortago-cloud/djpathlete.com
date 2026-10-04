// Hands the quiz editor a signed WRITE url so a clip goes straight from the
// browser to Firebase Storage. Proxying the bytes through this route is not
// an option: Vercel caps a request body at 4.5 MB, and a phone clip is ten
// times that.
//
// The object lands under quiz-media/<quizKey>/, the only prefix storage.rules
// makes publicly readable, and the editor stores the DURABLE download url this
// returns, never the signed one (see lib/quiz-media-storage.ts for why).
//
// Same guard as PATCH /api/admin/quizzes/[id]: admin, the caller's business,
// and a foreign quiz reads as absent.
//
// No Cache-Control is signed. An extra signed header also has to pass the
// bucket's CORS config, which nothing here verifies, and a CORS refusal is a
// silent dead upload. Editor uploads get Firebase's default caching instead
// of the upload script's "immutable" — the timestamp in the name already
// makes every re-upload a new object.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getQuizDefinition } from "@/lib/db/quizzes"
import { getAdminStorage } from "@/lib/firebase-admin"
import { quizMediaPublicUrl, quizMediaStoragePath } from "@/lib/quiz-media-storage"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"

const UPLOAD_URL_EXPIRY_MS = 15 * 60 * 1000

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.enum(["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/png"]),
})

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "admin") return notFound()

  let businessId: string
  try {
    ;({ businessId } = await resolveAdminTenantForRequest(request))
  } catch (err) {
    if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    throw err
  }

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return notFound()

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "That file type cannot be used for a quiz clip." }, { status: 400 })

  const quiz = await getQuizDefinition(businessId, id)
  if (!quiz) return notFound()

  const storagePath = quizMediaStoragePath(quiz.key, `${Date.now()}-${parsed.data.filename}`)
  const bucket = getAdminStorage().bucket()
  const [uploadUrl] = await bucket.file(storagePath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_EXPIRY_MS,
    contentType: parsed.data.contentType,
  })

  return NextResponse.json({ uploadUrl, publicUrl: quizMediaPublicUrl(bucket.name, storagePath) })
}

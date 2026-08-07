import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listAssetsWithPostCounts } from "@/lib/db/media-assets"
import { signImageAssetThumbnails } from "@/lib/content-studio/asset-thumbnails"
import type { MediaAsset } from "@/types/database"
import { canAccessAdminPath } from "@/lib/permissions/guard"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const kindParam = request.nextUrl.searchParams.get("kind")
  const kind: MediaAsset["kind"] | undefined =
    kindParam === "image" || kindParam === "video" ? kindParam : undefined

  const assets = await listAssetsWithPostCounts(kind ? { kind } : {})
  const thumbnailUrls =
    kind === "image" || !kind ? await signImageAssetThumbnails(assets) : {}

  return NextResponse.json({ assets, thumbnailUrls })
}

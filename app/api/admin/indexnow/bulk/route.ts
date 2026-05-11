import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import sitemap from "@/app/sitemap"
import { submitToIndexNow } from "@/lib/indexnow"

/**
 * One-shot bulk IndexNow submission — pings Bing/Yandex with every URL in the
 * sitemap in a single request. Use this once after launch (and any time you
 * want a full re-crawl push). Day-to-day, IndexNow fires automatically from
 * the blog/event publish handlers — you don't need this for new content.
 *
 * Admin-only. POST with no body.
 *
 * Returns: { submitted, indexNowStatus, urls }
 *   indexNowStatus: 200 = accepted, 403 = key mismatch, 422 = host mismatch,
 *   429 = rate-limited, null = network error.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const entries = await sitemap()
  const urls = entries
    .map((e) => (typeof e.url === "string" ? e.url : String(e.url)))
    .filter((u) => u.startsWith("https://"))

  const indexNowStatus = await submitToIndexNow(urls)

  return NextResponse.json({
    submitted: urls.length,
    indexNowStatus,
    accepted: indexNowStatus === 200,
    urls,
  })
}

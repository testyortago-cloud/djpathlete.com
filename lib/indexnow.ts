import { SITE_URL } from "@/lib/constants"

/**
 * IndexNow — instant URL submission to Bing, Yandex, and other participating
 * search engines. When content is published/updated/deleted, calling this
 * tells engines to prioritize re-crawling those URLs instead of waiting for
 * the natural crawl cycle.
 *
 * Setup: the key verification file lives at
 * https://www.darrenjpaul.com/85ac9c784c294c3f9593fa169e918730.txt
 * (in public/). The key is intentionally public — it proves domain ownership.
 *
 * Docs: https://www.indexnow.org/documentation
 */

const INDEXNOW_KEY = "85ac9c784c294c3f9593fa169e918730"
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"

/** Host without protocol, e.g. "www.darrenjpaul.com" */
const HOST = SITE_URL.replace(/^https?:\/\//, "")
const KEY_LOCATION = `${SITE_URL}/${INDEXNOW_KEY}.txt`

/**
 * Submit one or more URLs to IndexNow. Pass absolute URLs on this host
 * (e.g. `https://www.darrenjpaul.com/blog/my-post`) — relative paths are
 * normalized to absolute.
 *
 * Fails silently (logs a warning) — IndexNow is a best-effort signal, never
 * block a publish flow on it. Returns the HTTP status, or null on network error.
 */
export async function submitToIndexNow(urlsOrPaths: string[]): Promise<number | null> {
  const urlList = urlsOrPaths
    .filter(Boolean)
    .map((u) => (u.startsWith("http") ? u : `${SITE_URL}${u.startsWith("/") ? "" : "/"}${u}`))

  if (urlList.length === 0) return null

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: KEY_LOCATION,
        urlList: urlList.slice(0, 10000), // IndexNow caps at 10k URLs per request
      }),
    })
    if (!res.ok && res.status !== 200) {
      // 400 invalid format, 403 key mismatch, 422 URL/host mismatch, 429 rate limit
      console.warn(`[indexnow] submission returned ${res.status} for ${urlList.length} URL(s)`)
    }
    return res.status
  } catch (err) {
    console.warn(`[indexnow] submission failed:`, err)
    return null
  }
}

/** Convenience: submit a single URL or path. */
export function submitUrlToIndexNow(urlOrPath: string): Promise<number | null> {
  return submitToIndexNow([urlOrPath])
}

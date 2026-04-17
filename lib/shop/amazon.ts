const AMAZON_HOST_REGEX = /^(?:www\.)?amazon\.[a-z.]{2,6}$/i
const ASIN_REGEX = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/

export function buildAffiliateUrl(rawUrl: string, tag: string): string {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error(`invalid affiliate URL: ${rawUrl}`)
  }
  if (!AMAZON_HOST_REGEX.test(u.hostname)) {
    throw new Error(`non-amazon host in affiliate URL: ${u.hostname}`)
  }
  u.searchParams.delete("tag")
  u.searchParams.set("tag", tag)
  return u.toString()
}

export function extractAsin(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl)
    const m = u.pathname.match(ASIN_REGEX)
    return m ? m[1] : null
  } catch {
    return null
  }
}

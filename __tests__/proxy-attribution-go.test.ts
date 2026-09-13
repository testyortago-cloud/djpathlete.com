// @vitest-environment node
//
// __tests__/proxy-attribution-go.test.ts — audit §3.5, part 1.
//
// THE DEFECT: `captureAttribution` in proxy.ts returned before stamping the
// djp_attr cookie unless the URL carried one of the nine tracking identifiers
// (gclid/gbraid/wbraid/fbclid/utm_*). An organic visitor to a funnel landing
// — someone who typed the URL, followed a link in a text, or scanned a QR
// code — therefore got no session at all, so their submission carried a null
// `attribution_session_id` and their contact's `first_touch_session_id` stayed
// null forever. On production that was 0 of 170 contacts linked to a session.
//
// THE RULE these tests pin: /go/<slug> is the ONE untagged path that earns a
// session, because it is the only public path that exists solely to convert —
// every /go visit is a landing on a funnel we published for that purpose. The
// rest of the site (/programs, /blog, the marketing pages) keeps the old
// tagged-only behaviour, which is why the /programs case below is not padding:
// it is the presence control that proves the new branch is /go-scoped and not
// "stamp everyone".
//
// `auth` (next-auth's middleware wrapper) is mocked to identity so the
// callback under test can be invoked directly with a plain NextRequest, the
// same harness __tests__/proxy-admin-headers.test.ts uses.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ auth: (handler: unknown) => handler }))

import middleware from "@/proxy"
import { ATTR_COOKIE_NAME } from "@/lib/marketing/cookies"

type Handler = (req: NextRequest) => Response | Promise<Response>

const GO_PATH = "/go/off-season-speed-camp-dxf8"

// The track POST is deliberately NEVER awaited by the middleware (a landing
// must not block on our own analytics write), so these assertions read the
// call that was made synchronously during captureAttribution rather than
// awaiting anything. Stubbing it also keeps the suite off the network.
const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))

function visit(path: string, cookie?: string): NextRequest {
  // Cookies must be passed in the init: NextRequest builds its cookie jar
  // from the headers it was constructed with.
  const req = new NextRequest(new URL(path, "http://localhost"), {
    method: "GET",
    headers: cookie ? { cookie } : {},
  })
  Object.defineProperty(req, "auth", { value: undefined, configurable: true })
  return req
}

function setCookieHeader(res: Response): string {
  return res.headers.get("set-cookie") ?? ""
}

function trackBody(call: unknown[] | undefined): Record<string, unknown> {
  if (!call) throw new Error("no track POST was fired")
  const init = call[1] as { body?: string }
  return JSON.parse(init.body ?? "{}")
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("proxy.ts — attribution on a /go landing", () => {
  it("stamps djp_attr on an organic /go landing carrying no tracking param at all", async () => {
    // MUTANT KILLED: restoring `if (!hasAnyTrackingParam(params)) return res`
    // (dropping the `&& !funnelLanding` half) — this visitor has none of the
    // nine keys, so the old guard returns before the cookie is ever set.
    const res = await (middleware as Handler)(visit(GO_PATH))
    expect(setCookieHeader(res)).toContain(`${ATTR_COOKIE_NAME}=`)
  })

  it("fires the track POST for that organic landing with a landing_url and no tracking keys", async () => {
    // MUTANT KILLED: dropping the `params.landing_url = landingUrlFor(...)`
    // assignment — extractTrackingParamsFromUrl only sets landing_url when one
    // of the nine keys is present, so without it the body would carry a bare
    // session_id and the track route (which requires one or the other) would
    // 400 it away.
    await (middleware as Handler)(visit(GO_PATH))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method?: string }]
    expect(url).toContain("/api/public/attribution/track")
    expect(init.method).toBe("POST")

    const body = trackBody(fetchMock.mock.calls[0] as unknown as unknown[])
    expect(typeof body.session_id).toBe("string")
    expect((body.session_id as string).length).toBeGreaterThanOrEqual(8)
    expect(body.landing_url).toBe(`http://localhost${GO_PATH}`)
    for (const key of [
      "gclid",
      "gbraid",
      "wbraid",
      "fbclid",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ]) {
      expect(body[key]).toBeUndefined()
    }
  })

  it("does not re-issue the cookie when the visitor already carries a valid one, and tracks under it", async () => {
    // First touch wins at the cookie layer too: re-issuing would mint a new
    // session id for a returning visitor and orphan everything already
    // recorded against the old one.
    const res = await (middleware as Handler)(visit(GO_PATH, `${ATTR_COOKIE_NAME}=sessexisting01`))
    expect(setCookieHeader(res)).not.toContain(`${ATTR_COOKIE_NAME}=`)

    const body = trackBody(fetchMock.mock.calls[0] as unknown as unknown[])
    expect(body.session_id).toBe("sessexisting01")
  })

  it("PRESENCE CONTROL: an untagged non-/go page still gets no cookie and no track POST", async () => {
    // MUTANT KILLED: widening the new branch to every path (e.g. dropping the
    // pathname test, or using `startsWith("/")`). The brief's rule is /go-only;
    // stamping the whole site is a different — and unrequested — product
    // decision about tracking every visitor.
    const res = await (middleware as Handler)(visit("/programs"))
    expect(setCookieHeader(res)).not.toContain(`${ATTR_COOKIE_NAME}=`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("PRESENCE CONTROL: a tagged non-/go page still gets the cookie (old behaviour intact)", async () => {
    const res = await (middleware as Handler)(visit("/programs?gclid=abc123"))
    expect(setCookieHeader(res)).toContain(`${ATTR_COOKIE_NAME}=`)
    const body = trackBody(fetchMock.mock.calls[0] as unknown as unknown[])
    expect(body.gclid).toBe("abc123")
    expect(body.landing_url).toBe("http://localhost/programs")
  })
})

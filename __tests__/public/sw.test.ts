// @vitest-environment node
/**
 * Service-worker caching strategy.
 *
 * `public/sw.js` is plain JS served straight to the browser — no import graph,
 * so nothing else in the suite can reach it. It is loaded here into a fake
 * ServiceWorkerGlobalScope and driven with synthetic events.
 *
 * What this pins: a client's session balance must never be answered from a
 * cache. The API strategy used to be stale-while-revalidate, so every visit to
 * the check-in link rendered the PREVIOUS visit's number — a real client saw
 * "5 sessions left" on a pack that held 3, and only the check-in POST (which
 * the cache never touched) showed the true figure.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

type SwEvent = { request: Request; respondWith: (p: Promise<Response> | Response) => void }
type Listener = (event: SwEvent | { waitUntil: (p: Promise<unknown>) => void }) => void

const ORIGIN = "https://app.test"

function loadSw(opts: { cached?: Record<string, unknown>; network?: () => Promise<Response>; cacheNames?: string[] }) {
  const listeners = new Map<string, Listener[]>()
  const cacheStore = new Map<string, Response>()
  const deleted: string[] = []
  const putCalls: string[] = []

  for (const [url, body] of Object.entries(opts.cached ?? {})) {
    cacheStore.set(url, new Response(JSON.stringify(body), { status: 200 }))
  }

  const keyOf = (req: Request | string) => (typeof req === "string" ? req : req.url)

  const caches = {
    match: async (req: Request | string) => cacheStore.get(keyOf(req)),
    open: async () => ({
      put: async (req: Request | string, res: Response) => {
        putCalls.push(keyOf(req))
        cacheStore.set(keyOf(req), res)
      },
      add: async () => {},
    }),
    keys: async () => opts.cacheNames ?? [],
    delete: async (name: string) => {
      deleted.push(name)
      return true
    },
  }

  let skipWaitingCalls = 0
  const self = {
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    location: { origin: ORIGIN },
    clients: { claim: async () => {} },
    skipWaiting: async () => {
      skipWaitingCalls += 1
    },
  }

  const impl: (req: Request) => Promise<Response> =
    opts.network ?? (async () => new Response(JSON.stringify({ remaining: 3 }), { status: 200 }))
  const networkFetch = vi.fn(impl)

  const src = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8")
  new Function("self", "caches", "fetch", "console", src)(self, caches, networkFetch, {
    log: () => {},
    warn: () => {},
  })

  /**
   * Drive one GET the way a browser would: hand it to the worker's fetch
   * listener, and if the worker declines to answer (no respondWith), fall
   * through to the network exactly as the browser does.
   */
  const get = async (url: string) => {
    const request = new Request(url)
    let answer: Promise<Response> | Response | undefined
    const event: SwEvent = { request, respondWith: (p) => (answer = p) }
    for (const fn of listeners.get("fetch") ?? []) fn(event)
    const handledBySw = answer !== undefined
    const response = await (answer ?? networkFetch(request))
    return { handledBySw, response, body: await response.clone().json() }
  }

  const install = async () => {
    const waits: Promise<unknown>[] = []
    for (const fn of listeners.get("install") ?? []) fn({ waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
    return skipWaitingCalls
  }

  const activate = async () => {
    const waits: Promise<unknown>[] = []
    for (const fn of listeners.get("activate") ?? []) fn({ waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
    return deleted
  }

  return { get, install, activate, networkFetch, putCalls, cacheStore }
}

const BALANCE = `${ORIGIN}/api/checkin/personal?token=tok`
const OTHER_API = `${ORIGIN}/api/client/workouts`

describe("service worker — API caching", () => {
  it("serves the LIVE balance, never the copy cached on the previous visit", async () => {
    const sw = loadSw({
      cached: { [BALANCE]: { firstName: "Sandeep", remaining: 5 } },
      network: async () => new Response(JSON.stringify({ firstName: "Sandeep", remaining: 3 }), { status: 200 }),
    })

    const { body } = await sw.get(BALANCE)

    // 5 is what the pack held at the last visit; 3 is what it holds now.
    expect(body.remaining).toBe(3)
    expect(sw.networkFetch).toHaveBeenCalled()
  })

  it("does not fall back to a cached balance when the network is down", async () => {
    const sw = loadSw({
      cached: { [BALANCE]: { firstName: "Sandeep", remaining: 5 } },
      network: async () => {
        throw new Error("offline")
      },
    })

    // Offline, the page must fail visibly rather than render a stale number the
    // client would act on — the check-in POST could not have gone through anyway.
    await expect(sw.get(BALANCE)).rejects.toThrow(/offline/)
  })

  it("never writes a balance into the cache at all", async () => {
    const sw = loadSw({ network: async () => new Response(JSON.stringify({ remaining: 3 }), { status: 200 }) })
    await sw.get(BALANCE)
    expect(sw.putCalls).toEqual([])
  })

  it("answers other API reads from the network first, refreshing the cache", async () => {
    const sw = loadSw({
      cached: { [OTHER_API]: { items: ["stale"] } },
      network: async () => new Response(JSON.stringify({ items: ["fresh"] }), { status: 200 }),
    })

    const { body } = await sw.get(OTHER_API)

    expect(body.items).toEqual(["fresh"])
    expect(sw.putCalls).toEqual([OTHER_API])
  })

  it("still falls back to the cache for other API reads when offline", async () => {
    const sw = loadSw({
      cached: { [OTHER_API]: { items: ["stale"] } },
      network: async () => {
        throw new Error("offline")
      },
    })

    const { body } = await sw.get(OTHER_API)

    expect(body.items).toEqual(["stale"])
  })
})

describe("service worker — install", () => {
  it("takes over from the previous worker instead of waiting for its tabs to close", async () => {
    // Nothing in the app sends SKIP_WAITING, so without this a corrected worker
    // sits in "waiting" and the old one keeps answering — on exactly the phones
    // that never close a tab, which is the population a caching fix is for.
    const sw = loadSw({})

    expect(await sw.install()).toBe(1)
  })
})

describe("service worker — activate", () => {
  it("evicts the old API cache, whose entries were written stale-while-revalidate", async () => {
    const sw = loadSw({ cacheNames: ["djp-api-v2", "djp-api-v3", "djp-static-v1"] })

    const deleted = await sw.activate()

    expect(deleted).toContain("djp-api-v2")
    expect(deleted).not.toContain("djp-api-v3")
  })
})

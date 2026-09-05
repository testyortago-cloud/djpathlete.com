// @vitest-environment jsdom
// Regression cover for a SHIPPED component, written before this branch touched
// it. `components/public/StickyApplyCTA.tsx` has been on every marketing page
// for months and had no tests; Stage 3 adds a second action to its bar (the
// chat launcher), and everything below is the behaviour that must survive
// that. These are a safety net, not a red test — they passed against the
// unmodified component before the launcher existed.
//
// The three properties, and why each is worth pinning:
//
//   * 800px of scroll. It is a strict `>`, so 800 itself is still hidden. An
//     off-by-one here puts the bar over the hero on every page.
//   * The per-session dismiss. It is `sessionStorage`, so it must survive a
//     remount within the session and must not survive into a new one.
//   * Both hide lists. Those routes already host an apply form, so the bar
//     would be offering a second one. The lists are read OUT OF THE SOURCE and
//     compared with the copies below, so adding a route to the component
//     without adding it here fails rather than quietly going uncovered.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §6.1
import { readFileSync } from "fs"

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { StickyApplyCTA } from "@/components/public/StickyApplyCTA"
import { renderChatMarketingWording } from "@/lib/lead-engine/chat/consent-wording"

// __tests__/setup.tsx pins `usePathname` to "/" for the whole suite, and both
// hide lists are exactly what this file has to move it around for. A
// file-level mock wins over the setup one.
let pathname = "/"
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

const DISMISS_KEY = "djp.stickyCta.dismissed"
const SHOW_AFTER_SCROLL_PX = 800

/** A route on neither list, so "hidden" in the tests below means the list did it. */
const VISIBLE_PATH = "/philosophy"

const HIDE_ON_PATHS = ["/contact", "/online", "/in-person", "/assessment"]
const HIDE_ON_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/shop/cart",
  "/shop/checkout",
  "/coming-soon",
  "/unsubscribe",
]

const SOURCE = readFileSync("components/public/StickyApplyCTA.tsx", "utf8")

/** The component keeps both lists private, so they are read back off disk rather than assumed. */
function listFromSource(name: string): string[] {
  const match = SOURCE.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))
  if (!match) throw new Error(`${name} is no longer a literal array in StickyApplyCTA.tsx`)
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/**
 * Set the scroll position the component reads. `window.scrollY` is a getter in
 * jsdom, so it is redefined rather than assigned. Called before `render` to set
 * the position the mount handler sees; called after to fire a real scroll.
 */
function setScroll(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true })
}

function scrollTo(y: number) {
  setScroll(y)
  fireEvent.scroll(window)
}

function bar() {
  return screen.queryByRole("region", { name: "Apply for coaching" })
}

/**
 * The launcher's on/off switch is fetched, not baked in — so a component
 * rendered with no props WILL reach for `/api/ask/config`. Every test gets a
 * fetch that refuses, both so nothing in this suite can touch the network and
 * so "no launcher" is the honest resting state; the tests that care stub a
 * real answer over the top.
 */
beforeEach(() => {
  pathname = VISIBLE_PATH
  sessionStorage.clear()
  setScroll(0)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no fetch stubbed for this test")
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("StickyApplyCTA — behaviour that shipped before the chat launcher", () => {
  it("stays hidden until 800px of scroll", () => {
    render(<StickyApplyCTA />)
    expect(bar()).toBeNull()

    // The threshold is strict: 800 exactly is still the hero.
    scrollTo(SHOW_AFTER_SCROLL_PX)
    expect(bar()).toBeNull()

    scrollTo(SHOW_AFTER_SCROLL_PX + 1)
    expect(bar()).not.toBeNull()

    // ...and it goes away again when the visitor scrolls back up.
    scrollTo(0)
    expect(bar()).toBeNull()
  })

  it("stays hidden for the rest of the session once dismissed", () => {
    setScroll(900)
    render(<StickyApplyCTA />)
    expect(bar()).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(bar()).toBeNull()
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe("1")

    // A fresh mount on the next page of the same session must not bring it back.
    cleanup()
    render(<StickyApplyCTA />)
    expect(bar()).toBeNull()

    // A new session is a new decision.
    cleanup()
    sessionStorage.clear()
    render(<StickyApplyCTA />)
    expect(bar()).not.toBeNull()
  })

  it("renders on none of HIDE_ON_PATHS", () => {
    expect(listFromSource("HIDE_ON_PATHS")).toEqual(HIDE_ON_PATHS)

    for (const path of HIDE_ON_PATHS) {
      pathname = path
      setScroll(900)
      render(<StickyApplyCTA />)
      expect(bar(), `${path} should not show the apply bar`).toBeNull()
      cleanup()
    }

    // The control: same scroll, same everything, a route on neither list.
    pathname = VISIBLE_PATH
    setScroll(900)
    render(<StickyApplyCTA />)
    expect(bar()).not.toBeNull()
  })

  it("renders on none of HIDE_ON_PATH_PREFIXES", () => {
    expect(listFromSource("HIDE_ON_PATH_PREFIXES")).toEqual(HIDE_ON_PATH_PREFIXES)

    for (const prefix of HIDE_ON_PATH_PREFIXES) {
      for (const path of [prefix, `${prefix}/anything`]) {
        pathname = path
        setScroll(900)
        render(<StickyApplyCTA />)
        expect(bar(), `${path} should not show the apply bar`).toBeNull()
        cleanup()
      }
    }

    pathname = VISIBLE_PATH
    setScroll(900)
    render(<StickyApplyCTA />)
    expect(bar()).not.toBeNull()
  })

  it("still renders the Apply link once the Ask launcher is added", () => {
    setScroll(900)
    render(<StickyApplyCTA />)

    const apply = screen.getByRole("link", { name: /apply for coaching/i })
    expect(apply).toHaveAttribute("href", "/online#apply")
  })
})

// ── The chat launcher, added by this branch ──────────────────────────────────
//
// It lives INSIDE this bar rather than in its own corner because there is no
// corner left: the bar is `fixed bottom-4 right-4` on desktop and spans
// `left-4 right-4` on mobile, so a bubble would collide on one and be entirely
// covered on the other (spec §1.3).
describe("StickyApplyCTA — the Ask launcher", () => {
  it("does not offer the launcher until something says the assistant is on", () => {
    setScroll(900)
    render(<StickyApplyCTA />)

    // Nothing has answered yet, and the resting state is OFF. A launcher that
    // renders while the routes answer 404 is a dead button; one that renders
    // when nobody has turned the feature on is worse.
    expect(screen.queryByRole("button", { name: "Ask a question" })).toBeNull()
    // ...and the bar it lives in is untouched.
    expect(screen.getByRole("link", { name: /apply for coaching/i })).toBeInTheDocument()
  })

  it("opens the panel from the bar when the assistant is switched on", () => {
    setScroll(900)
    render(<StickyApplyCTA askEnabled displayName="Bay Performance" />)

    // Both actions, in the one bar.
    expect(screen.getByRole("link", { name: /apply for coaching/i })).toBeInTheDocument()
    const launcher = screen.getByRole("button", { name: "Ask a question" })

    expect(screen.queryByLabelText("Your question")).toBeNull()
    fireEvent.click(launcher)

    expect(screen.getByLabelText("Your question")).toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: /ask a question/i })).toBeInTheDocument()
  })

  it("closes the panel and leaves the bar behind", () => {
    setScroll(900)
    render(<StickyApplyCTA askEnabled displayName="Bay Performance" />)

    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    expect(screen.queryByLabelText("Your question")).toBeNull()
    expect(screen.getByRole("button", { name: "Ask a question" })).toBeInTheDocument()
  })

  /**
   * Drive a real turn through the launcher-opened panel so a DETAILS CARD is
   * actually on screen. The first version of the test below asserted "no
   * checkbox" against a panel that had not had a conversation yet — where no
   * card, and therefore no tick, exists whatever name is threaded. It passed
   * with the prop replaced by a hardcoded name, which is the mutation it is
   * supposed to catch.
   */
  async function openPanelAndAskForDetails(displayName: string) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        conversationId: "3f1b7c5e-1111-4222-8333-444444444444",
        reply: "Leave your details and someone will come back to you.",
        cards: [{ kind: "capture", reason: "so a coach can come back to you" }],
        verdict: "ok",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    setScroll(900)
    render(<StickyApplyCTA askEnabled displayName={displayName} />)
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }))
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Can someone call me?" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    // The details card really is on screen, so "no tick" is a decision rather
    // than an absence.
    await screen.findByLabelText("Your name")
  }

  it("threads the business name through to the panel, so a blank one draws no consent tick", async () => {
    // `''` is the production and dev-clone value. The card asks
    // `hasChatConsentDisplayName` — the same gate /api/ask/capture asks before
    // it will file a consent row.
    await openPanelAndAskForDetails("")

    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("threads a configured business name through, and the tick names it", async () => {
    await openPanelAndAskForDetails("Bay Performance")

    expect(screen.getByRole("checkbox", { name: renderChatMarketingWording("Bay Performance") })).toBeInTheDocument()
  })
})

// ── Where the launcher's answer comes from ───────────────────────────────────
//
// It used to come from `app/(marketing)/layout.tsx` as a prop, read on the
// server. That layout wraps the whole public site and those pages are
// STATICALLY GENERATED — `initialRevalidateSeconds: false` on /faq,
// /testimonials, /philosophy, /services, /glossary, /education, /contact,
// /athletes/*, /privacy-policy, /terms-of-service and /sports — so the answer
// was frozen at build time. Switching the assistant OFF could not take this
// button down: the visitor still saw it, opened it, typed their question, and
// got an error back from a route that had correctly gated itself.
//
// So the browser asks `GET /api/ask/config` instead, and every test below is
// about not undoing that. Each names the mutant it kills.
describe("StickyApplyCTA — the launcher asks the server, not the page", () => {
  const CONFIG_URL = "/api/ask/config"
  const TURN_URL = "/api/ask"

  type Answer = { ok?: boolean; status?: number; body?: unknown; reject?: boolean }

  /** A fetch that answers by URL, so a test can say one thing about the config and another about a turn. */
  function stubFetch(answers: Record<string, Answer>) {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      const answer = answers[url]
      if (!answer) throw new Error(`no stub for ${url}`)
      if (answer.reject) throw new TypeError("Failed to fetch")
      return {
        ok: answer.ok ?? true,
        status: answer.status ?? 200,
        json: async () => answer.body,
      } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  function config(body: unknown, init: Omit<Answer, "body"> = {}) {
    return stubFetch({ [CONFIG_URL]: { ...init, body } })
  }

  /** The config lands in a microtask after the request; let React apply it. */
  async function settle(fetchMock: ReturnType<typeof vi.fn>) {
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {})
  }

  function launcher() {
    return screen.queryByRole("button", { name: "Ask a question" })
  }

  it("asks for nothing until the bar is actually on screen", async () => {
    const fetchMock = config({ enabled: true, displayName: "" })
    render(<StickyApplyCTA />)

    // MUTANT: fetch on mount. This component is on EVERY marketing page, and
    // the launcher it configures only appears after 800px of scroll — a
    // request per page load buys a button most visitors never see.
    expect(fetchMock).not.toHaveBeenCalled()

    scrollTo(900)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(CONFIG_URL, expect.anything()))
  })

  it("asks once, however much the visitor scrolls", async () => {
    const fetchMock = config({ enabled: true, displayName: "" })
    render(<StickyApplyCTA />)

    scrollTo(900)
    scrollTo(0)
    scrollTo(1200)
    scrollTo(50)
    scrollTo(2000)

    // MUTANT: drop the "already asked" guard. The bar mounts and unmounts with
    // the scroll position, so a per-appearance fetch is a request per flick.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it("never asks on a route where the bar cannot appear", () => {
    const fetchMock = config({ enabled: true, displayName: "" })
    pathname = "/contact"
    setScroll(900)
    render(<StickyApplyCTA />)

    // /contact already hosts an apply form, so the bar is suppressed there —
    // and a request for a button that is not going to render is pure waste.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows the launcher when the server says the assistant is on", async () => {
    config({ enabled: true, displayName: "" })
    setScroll(900)
    render(<StickyApplyCTA />)

    // The kill switch now works without a deploy in BOTH directions; this is
    // the "on" one, and it is the control for the "off" tests below.
    expect(await screen.findByRole("button", { name: "Ask a question" })).toBeInTheDocument()
  })

  it("leaves the launcher off when the server says the assistant is off", async () => {
    const fetchMock = config({ enabled: false, displayName: "" })
    setScroll(900)
    render(<StickyApplyCTA />)
    await settle(fetchMock)

    // MUTANT: render the launcher regardless of the answer. This is the
    // emergency stop — the previous build baked `askEnabled":true` into pages
    // that could not be told otherwise without a redeploy.
    expect(launcher()).toBeNull()
    expect(screen.getByRole("link", { name: /apply for coaching/i })).toBeInTheDocument()
  })

  it("stays closed when the config request fails outright", async () => {
    const fetchMock = config(undefined, { reject: true })
    setScroll(900)
    render(<StickyApplyCTA />)
    await settle(fetchMock)

    // MUTANT: `catch { setEnabled(true) }`, or no catch at all. "We could not
    // tell" is not "yes" — a request that never arrived must not open a public
    // box that collects free text from strangers.
    expect(launcher()).toBeNull()
    expect(screen.getByRole("link", { name: /apply for coaching/i })).toBeInTheDocument()
  })

  it("stays closed when the config request answers an error with a body", async () => {
    // The body SAYS yes. Anything that parses it without looking at the status
    // opens the feature off the back of an error page.
    const fetchMock = config({ enabled: true, displayName: "" }, { ok: false, status: 500 })
    setScroll(900)
    render(<StickyApplyCTA />)
    await settle(fetchMock)

    // MUTANT: drop the `response.ok` check.
    expect(launcher()).toBeNull()
  })

  it("applies an answer that lands while the bar is scrolled out of view", async () => {
    // FOUND BY MUTATION, not by reasoning. The bar mounts and unmounts with the
    // scroll position, so an effect cleanup keyed on that is a cleanup that
    // fires mid-flight — and this component asks exactly once. Throwing the
    // answer away leaves the launcher off for the rest of the page, for a
    // visitor who did nothing worse than scroll up and back down.
    let land!: () => void
    const inFlight = new Promise<void>((resolve) => {
      land = resolve
    })
    const fetchMock = vi.fn(async () => {
      await inFlight
      return {
        ok: true,
        status: 200,
        json: async () => ({ enabled: true, displayName: "" }),
      } as unknown as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<StickyApplyCTA />)
    scrollTo(900)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    scrollTo(0)
    await act(async () => {
      land()
    })
    scrollTo(900)

    expect(await screen.findByRole("button", { name: "Ask a question" })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("takes the business name from the server too, so the consent tick names it", async () => {
    // THE STALE-NAME BUG. The card renders the marketing wording from this
    // name and /api/ask/capture re-renders it from a FRESH read before filing
    // `wording_shown`. While the name was baked into a static page, a renamed
    // business meant the visitor read one sentence and the record kept another.
    const fetchMock = stubFetch({
      [CONFIG_URL]: { body: { enabled: true, displayName: "Bay Performance" } },
      [TURN_URL]: {
        body: {
          conversationId: "3f1b7c5e-1111-4222-8333-444444444444",
          reply: "Leave your details and someone will come back to you.",
          cards: [{ kind: "capture", reason: "so a coach can come back to you" }],
          verdict: "ok",
        },
      },
    })

    setScroll(900)
    render(<StickyApplyCTA />)
    fireEvent.click(await screen.findByRole("button", { name: "Ask a question" }))
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Can someone call me?" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await screen.findByLabelText("Your name")

    // MUTANT: hardcode `displayName=""` into the panel. The card would then
    // draw no tick at all, which is the state a BLANK name is supposed to mean.
    expect(screen.getByRole("checkbox", { name: renderChatMarketingWording("Bay Performance") })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(CONFIG_URL, expect.anything())
  })
})

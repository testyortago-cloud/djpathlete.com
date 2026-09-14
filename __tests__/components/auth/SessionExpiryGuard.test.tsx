// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { SessionExpiryGuard, loginRedirectUrl } from "@/components/auth/SessionExpiryGuard"
import { SESSION_WARN_BEFORE_MS } from "@/lib/session-policy"

const useSessionMock = vi.fn()
const getSessionMock = vi.fn()
vi.mock("next-auth/react", () => ({
  useSession: (...args: unknown[]) => useSessionMock(...args),
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))

const pathnameMock = vi.fn(() => "/admin/clients")
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}))

/** Answers the liveness endpoint. Kept separate from getSession on purpose:
 *  the whole point of /api/session/alive is that it is NOT getSession. */
const aliveMock = vi.fn(async () => true)
const fetchMock = vi.fn(async (url: string) => {
  if (String(url).startsWith("/api/session/alive")) {
    return { ok: true, json: async () => ({ alive: await aliveMock() }) } as unknown as Response
  }
  throw new Error(`unexpected fetch: ${url}`)
})

const hardNavigateMock = vi.fn()
vi.mock("@/lib/hard-navigate", () => ({
  hardNavigate: (...args: unknown[]) => hardNavigateMock(...args),
}))

function futureIso(ms: number) {
  return new Date(Date.now() + ms).toISOString()
}

beforeEach(() => {
  vi.useFakeTimers()
  useSessionMock.mockReset()
  getSessionMock.mockReset()
  hardNavigateMock.mockReset()
  pathnameMock.mockReset()
  pathnameMock.mockReturnValue("/admin/clients")
  aliveMock.mockReset()
  aliveMock.mockResolvedValue(true)
  fetchMock.mockClear()
  global.fetch = fetchMock as never
})

afterEach(() => {
  vi.useRealTimers()
})

describe("loginRedirectUrl", () => {
  it("encodes the current path and query as callbackUrl with the expired flag", () => {
    expect(loginRedirectUrl("/admin/clients", "?tab=active")).toBe(
      "/login?expired=1&callbackUrl=%2Fadmin%2Fclients%3Ftab%3Dactive",
    )
  })
})

describe("SessionExpiryGuard", () => {
  it("does nothing while the session is valid", async () => {
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(60 * 60 * 1000) },
      status: "authenticated",
    })
    render(<SessionExpiryGuard />)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(hardNavigateMock).not.toHaveBeenCalled()
  })

  it("redirects to login after the grace period when the session becomes unauthenticated", async () => {
    useSessionMock.mockReturnValue({ data: null, status: "unauthenticated" })
    render(<SessionExpiryGuard />)
    expect(hardNavigateMock).not.toHaveBeenCalled() // grace still running
    await vi.advanceTimersByTimeAsync(500)
    expect(hardNavigateMock).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).toHaveBeenCalledWith(expect.stringContaining("/login?expired=1&callbackUrl="))
  })

  it("does not redirect when unmounted during the grace period (deliberate sign-out navigation wins)", async () => {
    useSessionMock.mockReturnValue({ data: null, status: "unauthenticated" })
    const { unmount } = render(<SessionExpiryGuard />)
    unmount()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(hardNavigateMock).not.toHaveBeenCalled()
  })

  it("confirms with the server and redirects when a visible tab outlives its session", async () => {
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(30_000) }, // expires before the first interval tick
      status: "authenticated",
    })
    aliveMock.mockResolvedValue(false)
    render(<SessionExpiryGuard />)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledWith("/api/session/alive", expect.anything())
    expect(hardNavigateMock).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).toHaveBeenCalledWith(expect.stringContaining("/login?expired=1&callbackUrl="))
  })

  it("NEVER confirms through getSession, which would renew the session it is measuring", async () => {
    // Reading the session re-signs the JWT and re-sets the cookie. A poll that
    // asked getSession "am I out of time?" pushed a cookie with 1 second left
    // back out to 55, every cycle — the idle timeout could never fire. Measured
    // on the real app before this was changed.
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(30_000) },
      status: "authenticated",
    })
    aliveMock.mockResolvedValue(true)
    render(<SessionExpiryGuard />)

    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it("stays put when the server still has a live session (cookie rolled elsewhere)", async () => {
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(30_000) },
      status: "authenticated",
    })
    aliveMock.mockResolvedValue(true)
    render(<SessionExpiryGuard />)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hardNavigateMock).not.toHaveBeenCalled()

    // It keeps asking rather than assuming a fresh full window — the real
    // expiry is unknown, and guessing one would leave a dead tab looking
    // signed in for hours.
    const asked = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(asked)
    expect(hardNavigateMock).not.toHaveBeenCalled()

    // ...and it does end once the server says the session is gone.
    aliveMock.mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(hardNavigateMock).toHaveBeenCalledTimes(1)
  })

  it("does not sign anyone out when the liveness check itself fails", async () => {
    // A network blip is not proof of a dead session.
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(30_000) },
      status: "authenticated",
    })
    fetchMock.mockRejectedValue(new Error("offline"))
    render(<SessionExpiryGuard />)

    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(hardNavigateMock).not.toHaveBeenCalled()
  })

  it("warns before signing the user out, with the time left on screen", async () => {
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(SESSION_WARN_BEFORE_MS + 30_000) },
      status: "authenticated",
    })
    render(<SessionExpiryGuard />)

    expect(screen.queryByText(/about to be signed out/i)).toBeNull()

    await vi.advanceTimersByTimeAsync(45_000) // now inside the warning window
    expect(screen.getByText(/about to be signed out/i)).toBeInTheDocument()
    expect(screen.getByText(/^1:4[0-9]$|^1:3[0-9]$|^2:00$/)).toBeInTheDocument()
    // Warning is a LOCAL-clock decision: asking the server how long is left
    // would re-sign the token and slide the very window being measured, so the
    // idle timeout could never fire on an open tab.
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it("extends the session when the user says stay signed in", async () => {
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(30_000) },
      status: "authenticated",
    })
    getSessionMock.mockResolvedValue({ expires: futureIso(2 * 60 * 60 * 1000) })
    render(<SessionExpiryGuard />)

    await vi.advanceTimersByTimeAsync(0)
    const button = screen.getByRole("button", { name: /stay signed in/i })
    await act(async () => {
      button.click()
    })

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/about to be signed out/i)).toBeNull()
    // And the extension really took: later ticks stay quiet.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(hardNavigateMock).not.toHaveBeenCalled()
  })

  it("cannot be saved by stay-signed-in once the absolute cap has passed", async () => {
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(30_000) },
      status: "authenticated",
    })
    // Past the cap the jwt callback returns null, so the server hands back no
    // session however hard the user clicks.
    getSessionMock.mockResolvedValue(null)
    render(<SessionExpiryGuard />)

    await vi.advanceTimersByTimeAsync(0)
    await act(async () => {
      screen.getByRole("button", { name: /stay signed in/i }).click()
    })

    expect(hardNavigateMock).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).toHaveBeenCalledWith(expect.stringContaining("/login?expired=1&callbackUrl="))
  })

  it("clears the warning when the user navigates, because that slid the cookie", async () => {
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(30_000) },
      status: "authenticated",
    })
    const { rerender } = render(<SessionExpiryGuard />)

    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText(/about to be signed out/i)).toBeInTheDocument()

    // A soft navigation: the request went through proxy.ts, which re-set the
    // cookie with a fresh idle window, but useSession does not refetch.
    pathnameMock.mockReturnValue("/admin/programs")
    rerender(<SessionExpiryGuard />)

    expect(screen.queryByText(/about to be signed out/i)).toBeNull()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(hardNavigateMock).not.toHaveBeenCalled()
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it("only redirects once even if both triggers fire", async () => {
    useSessionMock.mockReturnValue({ data: { expires: futureIso(30_000) }, status: "unauthenticated" })
    getSessionMock.mockResolvedValue(null)
    render(<SessionExpiryGuard />)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(hardNavigateMock).toHaveBeenCalledTimes(1)
  })
})

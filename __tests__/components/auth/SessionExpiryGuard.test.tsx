// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render } from "@testing-library/react"
import { SessionExpiryGuard, loginRedirectUrl } from "@/components/auth/SessionExpiryGuard"

const useSessionMock = vi.fn()
const getSessionMock = vi.fn()
vi.mock("next-auth/react", () => ({
  useSession: (...args: unknown[]) => useSessionMock(...args),
  getSession: (...args: unknown[]) => getSessionMock(...args),
}))

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
    getSessionMock.mockResolvedValue(null)
    render(<SessionExpiryGuard />)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).toHaveBeenCalledWith(expect.stringContaining("/login?expired=1&callbackUrl="))
  })

  it("stays put when the server still has a live session (cookie rolled elsewhere)", async () => {
    useSessionMock.mockReturnValue({
      data: { expires: futureIso(30_000) },
      status: "authenticated",
    })
    getSessionMock.mockResolvedValue({ expires: futureIso(24 * 60 * 60 * 1000) })
    render(<SessionExpiryGuard />)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).not.toHaveBeenCalled()
    // Re-armed from the fresh expiry — later ticks stay quiet until it passes.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).not.toHaveBeenCalled()
  })

  it("only redirects once even if both triggers fire", async () => {
    useSessionMock.mockReturnValue({ data: { expires: futureIso(30_000) }, status: "unauthenticated" })
    getSessionMock.mockResolvedValue(null)
    render(<SessionExpiryGuard />)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(hardNavigateMock).toHaveBeenCalledTimes(1)
  })
})

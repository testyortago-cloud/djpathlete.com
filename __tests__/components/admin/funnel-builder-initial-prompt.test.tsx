// The hand-off that makes a new page start building itself. The danger is not
// that it fails to fire — it is that it fires twice, or fires over work that
// already exists, so most of these tests exist to catch a send that should not
// have happened. Each one is a paid model turn.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { FunnelBuilder } from "@/components/admin/funnels/FunnelBuilder"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const baseProps = {
  funnelId: "f1",
  funnelName: "Free Trial",
  stepId: "s1",
  stepName: "Landing page",
  publicUrl: "/go/free-trial",
  funnelStatus: "draft",
  funnelKind: "funnel",
  initialDoc: null,
  initialRevision: 0,
  docInvalid: false,
  resetToRevision: null,
  initialUnresolved: [],
  initialDanglingAnchors: [],
  initialCompile: null,
  initialResolutionError: null,
  initialMessages: [],
  maxMessageLength: 2000,
  renderForPublish: vi.fn(),
} as unknown as React.ComponentProps<typeof FunnelBuilder>

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch
})

describe("FunnelBuilder initialPrompt", () => {
  it("sends the prompt exactly once on a brand-new page", async () => {
    // MUTANT KILLED: an effect without a fired-ref, which re-sends on every
    // re-render and spends a paid model turn each time.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const { rerender } = render(<FunnelBuilder {...baseProps} initialPrompt="Build a free trial page." />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender(<FunnelBuilder {...baseProps} initialPrompt="Build a free trial page." />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.message).toBe("Build a free trial page.")
  })

  it("never sends when the page already has turns", async () => {
    // MUTANT KILLED: guarding on the doc alone. A page whose first build FAILED
    // has a null doc and a real transcript; re-firing would silently replay the
    // creation prompt over whatever the owner typed since.
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(
      <FunnelBuilder
        {...baseProps}
        initialPrompt="Build a free trial page."
        initialMessages={[{ id: "turn-1", role: "owner", text: "make it green" }]}
      />,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never sends when there is no prompt", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<FunnelBuilder {...baseProps} initialPrompt={null} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockToastMessage = vi.fn()
vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError, message: mockToastMessage },
}))

// useAiJob talks to the Firebase client (onSnapshot) — stub it to a controllable
// status so the panel's progress/done transitions are driven from the test.
const aiJob = vi.hoisted(() => ({ status: "pending" as string, error: null as string | null }))
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({ status: aiJob.status, error: aiJob.error }),
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("CaptionedCutPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiJob.status = "pending"
    aiJob.error = null
  })

  async function importComp() {
    const mod = await import("@/components/admin/content-studio/drawer/CaptionedCutPanel")
    return mod.CaptionedCutPanel
  }

  it("shows the Generate button (enabled) once state loads with no cut", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ inFlightJobId: null, cut: null })))
    const Comp = await importComp()
    render(<Comp videoUploadId="v1" hasTranscript />)
    const btn = await screen.findByRole("button", { name: /generate captioned cut/i })
    expect(btn).not.toBeDisabled()
  })

  it("disables Generate when there is no transcript", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ inFlightJobId: null, cut: null })))
    const Comp = await importComp()
    render(<Comp videoUploadId="v1" hasTranscript={false} />)
    const btn = await screen.findByRole("button", { name: /generate captioned cut/i })
    expect(btn).toBeDisabled()
  })

  it("renders an inline player and draft-post links when a cut exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          inFlightJobId: null,
          cut: {
            assetId: "a1",
            signedUrl: "https://example.test/cut.mp4",
            width: 1080,
            height: 1920,
            durationMs: 90750,
            createdAt: "2026-05-31T07:25:42Z",
            posts: [{ id: "p1", platform: "instagram", approvalStatus: "draft" }],
          },
        }),
      ),
    )
    const Comp = await importComp()
    const { container } = render(<Comp videoUploadId="v1" hasTranscript />)
    await waitFor(() => expect(container.querySelector("video")).toBeInTheDocument())
    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://example.test/cut.mp4")
    const link = await screen.findByRole("link", { name: /instagram draft/i })
    expect(link).toHaveAttribute("href", "/admin/content/post/p1")
    expect(screen.getByRole("button", { name: /re-render/i })).toBeInTheDocument()
  })

  it("fills the hook input with an AI suggestion when Suggest is clicked", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (typeof url === "string" && url.includes("/suggest-hook")) {
        return jsonResponse({ hook: "5 Mistakes Athletes Make" })
      }
      return jsonResponse({ inFlightJobId: null, cut: null })
    })
    vi.stubGlobal("fetch", fetchMock)
    const Comp = await importComp()
    render(<Comp videoUploadId="v1" hasTranscript />)

    const suggestBtn = await screen.findByRole("button", { name: /suggest/i })
    fireEvent.click(suggestBtn)

    const input = screen.getByRole("textbox")
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("5 Mistakes Athletes Make"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/content-studio/captioned-cut/suggest-hook",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("disables Suggest when there is no transcript", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ inFlightJobId: null, cut: null })))
    const Comp = await importComp()
    render(<Comp videoUploadId="v1" hasTranscript={false} />)
    expect(await screen.findByRole("button", { name: /suggest/i })).toBeDisabled()
  })

  it("shows persistent progress when the server reports an in-flight render", async () => {
    aiJob.status = "processing"
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ inFlightJobId: "job-1", cut: null })))
    const Comp = await importComp()
    render(<Comp videoUploadId="v1" hasTranscript />)
    expect(await screen.findByText(/rendering captioned cut/i)).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { GenerateCaptionedCutButton } from "@/components/admin/content-studio/drawer/GenerateCaptionedCutButton"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))
// Mirror the real useAiJob(null) behavior: status defaults to "pending" and is
// never reset while no job is running. The component must NOT treat that as
// "rendering" before a render is started.
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({ status: "pending", result: null, error: null }),
}))

beforeEach(() => vi.clearAllMocks())

describe("GenerateCaptionedCutButton", () => {
  it("is enabled and labeled 'Generate Captioned Cut' before any render (regression: not stuck on 'Rendering…')", () => {
    render(<GenerateCaptionedCutButton videoUploadId="v1" hasTranscript />)
    const btn = screen.getByRole("button", { name: /generate captioned cut/i })
    expect(btn).toBeTruthy()
    expect(btn.textContent).toContain("Generate Captioned Cut")
    expect(btn.textContent).not.toContain("Rendering")
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it("is disabled when there is no transcript", () => {
    render(<GenerateCaptionedCutButton videoUploadId="v1" hasTranscript={false} />)
    const btn = screen.getByRole("button", { name: /generate captioned cut/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})

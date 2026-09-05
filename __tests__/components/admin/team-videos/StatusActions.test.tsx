// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatusActions } from "@/components/admin/team-videos/StatusActions"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))
vi.mock("@/lib/firebase-client-thumbnail", () => ({
  generateVideoThumbnailFromUrl: vi.fn(),
  uploadThumbnailFor: vi.fn(),
}))
// Stub the job-status hook so the component doesn't load the Firebase client.
vi.mock("@/hooks/use-ai-job", () => ({
  useAiJob: () => ({ status: "pending", result: null, error: null }),
}))

beforeEach(() => vi.clearAllMocks())

describe("StatusActions — captioned cut", () => {
  it("shows Send to Content Studio for an approved item", () => {
    render(<StatusActions submission={{ id: "s2", status: "approved" } as never} videoUrl={null} />)
    expect(screen.getByText("Send to Content Studio")).toBeTruthy()
  })

  it("hides Generate Captioned Cut when the flag is off", () => {
    render(<StatusActions submission={{ id: "s3", status: "approved" } as never} videoUrl={null} />)
    expect(screen.queryByText("Generate Captioned Cut")).toBeNull()
  })

  it("shows Generate Captioned Cut on an approved item when the flag is on", () => {
    render(
      <StatusActions
        submission={{ id: "s4", status: "approved" } as never}
        videoUrl={null}
        captionedCutEnabled
      />,
    )
    expect(screen.getByText("Generate Captioned Cut")).toBeTruthy()
  })

  it("shows Generate Captioned Cut on a locked item when the flag is on", () => {
    render(
      <StatusActions
        submission={{ id: "s5", status: "locked" } as never}
        videoUrl={null}
        captionedCutEnabled
      />,
    )
    expect(screen.getByText("Generate Captioned Cut")).toBeTruthy()
  })

  it("does not show Generate Captioned Cut on a non-approved item even when the flag is on", () => {
    render(
      <StatusActions
        submission={{ id: "s6", status: "submitted" } as never}
        videoUrl={null}
        captionedCutEnabled
      />,
    )
    expect(screen.queryByText("Generate Captioned Cut")).toBeNull()
  })
})

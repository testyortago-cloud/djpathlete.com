// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"

const captureMock = vi.fn()
const commitMock = vi.fn()
const revertMock = vi.fn()
const refreshMock = vi.fn()

vi.mock("@/lib/firebase-client-thumbnail", () => ({
  captureFrameFromUrlAt: (...a: unknown[]) => captureMock(...a),
  commitThumbnail: (...a: unknown[]) => commitMock(...a),
  revertThumbnailToAuto: (...a: unknown[]) => revertMock(...a),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

import { ThumbnailPanel } from "@/components/admin/content-studio/detail/ThumbnailPanel"

function renderPanel(overrides: Partial<React.ComponentProps<typeof ThumbnailPanel>> = {}) {
  const videoRef = createRef<HTMLVideoElement>()
  // createRef() returns a plain object whose `current` starts writable — a
  // direct assignment is simpler than Object.defineProperty and works the
  // same way a real ref attach would.
  videoRef.current = {
    videoWidth: 1920,
    videoHeight: 1080,
    currentTime: 5,
    currentSrc: "https://storage.googleapis.com/bucket/video.mp4?sig=abc",
  } as HTMLVideoElement
  return render(
    <ThumbnailPanel
      videoUploadId="v1"
      videoRef={videoRef}
      thumbnailUrl="https://signed/thumb.jpg"
      thumbnailSource={null}
      {...overrides}
    />,
  )
}

describe("ThumbnailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captureMock.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }))
    commitMock.mockResolvedValue(true)
    revertMock.mockResolvedValue(true)
  })

  it("shows the current thumbnail", () => {
    renderPanel()
    expect(screen.getByAltText("Current video thumbnail")).toHaveAttribute("src", "https://signed/thumb.jpg")
  })

  it("captures the frame from an offscreen copy at the element's current time, then commits it as source=frame", async () => {
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: /use this frame/i }))
    await waitFor(() =>
      expect(captureMock).toHaveBeenCalledWith("https://storage.googleapis.com/bucket/video.mp4?sig=abc", 5),
    )
    await waitFor(() => expect(commitMock).toHaveBeenCalledWith("v1", expect.any(Blob), "frame"))
    expect(refreshMock).toHaveBeenCalled()
  })

  it("does not refresh when the commit fails", async () => {
    commitMock.mockResolvedValue(false)
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: /use this frame/i }))
    await waitFor(() => expect(commitMock).toHaveBeenCalled())
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("offers Revert only when a custom thumbnail is set", () => {
    const { unmount } = renderPanel({ thumbnailSource: "frame" })
    expect(screen.getByRole("button", { name: /revert to auto/i })).toBeInTheDocument()
    unmount()
    renderPanel({ thumbnailSource: null })
    expect(screen.queryByRole("button", { name: /revert to auto/i })).not.toBeInTheDocument()
  })

  it("says so with an actionable, jargon-free message when the frame cannot be read", async () => {
    captureMock.mockResolvedValue(null)
    const { toast } = await import("sonner")
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: /use this frame/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't save that picture. This usually means the video store needs to allow this site — send this to whoever set up the app.",
      ),
    )
    const message = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(message.toLowerCase()).not.toMatch(/cors|canvas|taint|origin/)
    expect(commitMock).not.toHaveBeenCalled()
  })
})

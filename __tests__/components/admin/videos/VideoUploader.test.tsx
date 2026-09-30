// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

const uploadVideoFile = vi.fn()
vi.mock("@/lib/firebase-client-upload", () => ({
  uploadVideoFile: (...a: unknown[]) => uploadVideoFile(...a),
}))
vi.mock("@/lib/firebase-client-thumbnail", () => ({ generateAndUploadThumbnail: vi.fn() }))

import { VideoUploader } from "@/components/admin/videos/VideoUploader"

function chooseFile(container: HTMLElement, name: string) {
  const input = container.querySelector("input[type=file]") as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "video/mp4" })] } })
}

describe("VideoUploader preview", () => {
  let n = 0
  const createObjectURL = vi.fn(() => `blob:local-${++n}`)
  const revokeObjectURL = vi.fn()
  beforeEach(() => {
    n = 0
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    uploadVideoFile.mockReset()
    uploadVideoFile.mockResolvedValue({ videoUploadId: "vid-1", storagePath: "p" })
    Object.assign(URL, { createObjectURL, revokeObjectURL })
  })

  it("plays the chosen file from the computer once it has uploaded", async () => {
    const { container } = render(<VideoUploader onUploaded={() => {}} showPreview />)
    chooseFile(container, "reel.mp4")
    const video = await screen.findByLabelText("Preview of reel.mp4")
    expect(video.tagName).toBe("VIDEO")
    expect(video.getAttribute("src")).toBe("blob:local-1")
  })

  it("shows no player unless asked", async () => {
    const { container } = render(<VideoUploader onUploaded={() => {}} />)
    chooseFile(container, "reel.mp4")
    await screen.findByText("reel.mp4 uploaded")
    expect(container.querySelector("video")).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it("a failed upload shows no player", async () => {
    uploadVideoFile.mockRejectedValue(new Error("boom"))
    const { container } = render(<VideoUploader onUploaded={() => {}} showPreview />)
    chooseFile(container, "reel.mp4")
    await screen.findByText("boom")
    expect(container.querySelector("video")).toBeNull()
  })

  it("choosing another video swaps the player and frees the old file", async () => {
    const { container, unmount } = render(<VideoUploader onUploaded={() => {}} showPreview />)
    chooseFile(container, "first.mp4")
    await screen.findByLabelText("Preview of first.mp4")
    chooseFile(container, "second.mp4")
    const video = await screen.findByLabelText("Preview of second.mp4")
    expect(video.getAttribute("src")).toBe("blob:local-2")
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-1")
    unmount()
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-2"))
  })
})

describe("VideoUploader edit-gate toggle", () => {
  it("renders the 'Needs editing' checkbox checked by default", () => {
    render(<VideoUploader onUploaded={() => {}} />)
    expect(screen.getByRole("checkbox", { name: /needs editing/i })).toBeChecked()
  })

  it("hides the toggle when showNeedsEditToggle is false", () => {
    render(<VideoUploader onUploaded={() => {}} showNeedsEditToggle={false} />)
    expect(screen.queryByRole("checkbox", { name: /needs editing/i })).toBeNull()
  })
})

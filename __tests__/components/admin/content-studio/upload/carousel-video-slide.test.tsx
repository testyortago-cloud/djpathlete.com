// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/firebase-client-upload", () => ({
  uploadImageFile: vi.fn(async () => ({ mediaAssetId: "v1", storagePath: "media-videos/u/1-b.mp4" })),
}))

import { uploadImageFile } from "@/lib/firebase-client-upload"
import { CarouselComposer } from "@/components/admin/content-studio/upload/CarouselComposer"

const createObjectURL = vi.fn(() => "blob:preview-1")
const revokeObjectURL = vi.fn()

function pick(file: File) {
  const input = screen.getAllByLabelText(/photo/i, { selector: 'input[type="file"]' })[0] as HTMLInputElement
  Object.defineProperty(input, "files", { value: [file] })
  fireEvent.change(input)
}

describe("CarouselComposer video slides", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
  })

  it("takes an MP4, previews it, and revokes the preview on remove", async () => {
    const onChange = vi.fn()
    render(<CarouselComposer onChange={onChange} allowVideo />)
    pick(new File([new Uint8Array([1])], "b.mp4", { type: "video/mp4" }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(["v1"], { hasVideo: true }))
    const video = screen.getByLabelText("Preview of 1-b.mp4")
    expect(video.tagName).toBe("VIDEO")
    expect(video).toHaveAttribute("src", "blob:preview-1")
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1")
  })

  it("rejects a WebM without uploading it", async () => {
    render(<CarouselComposer onChange={vi.fn()} allowVideo />)
    pick(new File([new Uint8Array([1])], "b.webm", { type: "video/webm" }))
    expect(await screen.findByText("Videos must be MP4 or MOV.")).toBeInTheDocument()
    expect(uploadImageFile).not.toHaveBeenCalled()
  })

  it("accepts photos only unless allowVideo is set", () => {
    render(<CarouselComposer onChange={vi.fn()} />)
    const input = screen.getAllByLabelText(/photo/i, { selector: 'input[type="file"]' })[0]
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp")
  })
})

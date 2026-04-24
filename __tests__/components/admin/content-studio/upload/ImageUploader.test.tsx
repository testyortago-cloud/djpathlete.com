import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/firebase-client-upload", () => ({
  uploadImageFile: vi.fn(async () => ({
    mediaAssetId: "asset-1",
    storagePath: "images/u/1-photo.jpg",
  })),
}))

describe("ImageUploader", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders file input accepting image mime types", async () => {
    const { ImageUploader } = await import("@/components/admin/content-studio/upload/ImageUploader")
    render(<ImageUploader onUploaded={() => {}} />)
    const input = screen.getByLabelText(/photo/i, { selector: 'input[type="file"]' })
    expect(input).toHaveAttribute("accept", expect.stringContaining("image/"))
  })

  it("calls onUploaded with mediaAssetId on success", async () => {
    const { ImageUploader } = await import("@/components/admin/content-studio/upload/ImageUploader")
    const onUploaded = vi.fn()
    render(<ImageUploader onUploaded={onUploaded} />)

    const file = new File([new Uint8Array([0])], "photo.jpg", { type: "image/jpeg" })
    const input = screen.getByLabelText(/photo/i, { selector: 'input[type="file"]' }) as HTMLInputElement
    Object.defineProperty(input, "files", { value: [file] })
    fireEvent.change(input)

    await new Promise((r) => setTimeout(r, 50))
    expect(onUploaded).toHaveBeenCalledWith({
      mediaAssetId: "asset-1",
      storagePath: "images/u/1-photo.jpg",
    })
  })

  it("rejects non-image files client-side", async () => {
    const { ImageUploader } = await import("@/components/admin/content-studio/upload/ImageUploader")
    const onUploaded = vi.fn()
    render(<ImageUploader onUploaded={onUploaded} />)

    const file = new File([new Uint8Array([0])], "video.mp4", { type: "video/mp4" })
    const input = screen.getByLabelText(/photo/i, { selector: 'input[type="file"]' }) as HTMLInputElement
    Object.defineProperty(input, "files", { value: [file] })
    fireEvent.change(input)

    await new Promise((r) => setTimeout(r, 50))
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.getByText(/must be an image/i)).toBeInTheDocument()
  })
})

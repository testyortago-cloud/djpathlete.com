import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/firebase-client-upload", () => ({
  uploadImageFile: vi.fn(),
}))

import { uploadImageFile } from "@/lib/firebase-client-upload"

describe("CarouselComposer", () => {
  beforeEach(() => vi.clearAllMocks())

  async function uploadIntoSlot(index: number, filename: string, assetId: string) {
    ;(uploadImageFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      mediaAssetId: assetId,
      storagePath: `images/u/${filename}`,
    })
    const inputs = screen.getAllByLabelText(/photo/i, { selector: 'input[type="file"]' })
    const input = inputs[index] as HTMLInputElement
    const file = new File([new Uint8Array([1])], filename, { type: "image/jpeg" })
    Object.defineProperty(input, "files", { value: [file] })
    fireEvent.change(input)
    // allow the async upload chain to settle
    await new Promise((r) => setTimeout(r, 30))
  }

  it("starts with one empty slot and emits an empty array", async () => {
    const { CarouselComposer } = await import("@/components/admin/content-studio/upload/CarouselComposer")
    const onChange = vi.fn()
    render(<CarouselComposer onChange={onChange} />)
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(screen.getAllByLabelText(/photo/i, { selector: 'input[type="file"]' })).toHaveLength(1)
  })

  it("add-slide appends slots up to the maxSlides limit", async () => {
    const { CarouselComposer } = await import("@/components/admin/content-studio/upload/CarouselComposer")
    render(<CarouselComposer onChange={() => {}} maxSlides={3} />)
    const addBtn = screen.getByRole("button", { name: /add slide/i })
    fireEvent.click(addBtn)
    fireEvent.click(addBtn)
    expect(screen.getAllByLabelText(/photo/i, { selector: 'input[type="file"]' })).toHaveLength(3)
    expect(addBtn).toBeDisabled()
  })

  it("uploads into a slot, replaces uploader with a compact row, and emits the assetId", async () => {
    const { CarouselComposer } = await import("@/components/admin/content-studio/upload/CarouselComposer")
    const onChange = vi.fn()
    render(<CarouselComposer onChange={onChange} />)
    await uploadIntoSlot(0, "a.jpg", "asset-a")
    expect(screen.getByText("a.jpg")).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(["asset-a"])
  })

  it("reorders filled slots via move-up / move-down", async () => {
    const { CarouselComposer } = await import("@/components/admin/content-studio/upload/CarouselComposer")
    const onChange = vi.fn()
    render(<CarouselComposer onChange={onChange} />)

    // slot 0 upload
    await uploadIntoSlot(0, "a.jpg", "asset-a")
    // add slot, slot 1 upload
    fireEvent.click(screen.getByRole("button", { name: /add slide/i }))
    await uploadIntoSlot(0 /* only one empty uploader remains */, "b.jpg", "asset-b")
    expect(onChange).toHaveBeenLastCalledWith(["asset-a", "asset-b"])

    // Move slot 1 (b.jpg) up — there are two move-up buttons rendered, one per filled row; the
    // first is disabled (slot 0) and the second is enabled (slot 1). Click the enabled one.
    const upButtons = screen.getAllByRole("button", { name: /move up/i })
    fireEvent.click(upButtons[1])

    expect(onChange).toHaveBeenLastCalledWith(["asset-b", "asset-a"])
  })

  it("removes a filled slot and drops it from the emitted array", async () => {
    const { CarouselComposer } = await import("@/components/admin/content-studio/upload/CarouselComposer")
    const onChange = vi.fn()
    render(<CarouselComposer onChange={onChange} />)
    await uploadIntoSlot(0, "a.jpg", "asset-a")
    fireEvent.click(screen.getByRole("button", { name: /add slide/i }))
    await uploadIntoSlot(0, "b.jpg", "asset-b")

    const removeButtons = screen.getAllByRole("button", { name: /remove/i })
    fireEvent.click(removeButtons[0]) // remove slot 0 (a.jpg)

    expect(onChange).toHaveBeenLastCalledWith(["asset-b"])
    expect(screen.queryByText("a.jpg")).not.toBeInTheDocument()
  })

  it("shows a guidance message when below minSlides", async () => {
    const { CarouselComposer } = await import("@/components/admin/content-studio/upload/CarouselComposer")
    render(<CarouselComposer onChange={() => {}} minSlides={2} />)
    expect(screen.getByText(/at least 2 more slide/i)).toBeInTheDocument()
  })
})

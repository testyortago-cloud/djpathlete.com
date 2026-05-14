import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PhotoSubmitDialog } from "@/components/editor/PhotoSubmitDialog"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/firebase-client-upload", () => ({
  uploadToSignedUrl: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn() as unknown as typeof fetch
})

function fileOf(name: string, type = "image/jpeg", size = 1000) {
  return new File([new ArrayBuffer(size)], name, { type })
}

describe("PhotoSubmitDialog", () => {
  it("rejects > 10 files", async () => {
    render(<PhotoSubmitDialog open onClose={() => {}} />)
    const input = screen.getByLabelText(/Add photos/i) as HTMLInputElement
    const files = Array.from({ length: 11 }, (_, i) => fileOf(`p${i}.jpg`))
    fireEvent.change(input, { target: { files } })
    expect(await screen.findByText(/up to 10/i)).toBeInTheDocument()
  })

  it("rejects unsupported mime types", async () => {
    render(<PhotoSubmitDialog open onClose={() => {}} />)
    const input = screen.getByLabelText(/Add photos/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [fileOf("p.heic", "image/heic")] } })
    expect(await screen.findByText(/Unsupported/i)).toBeInTheDocument()
  })

  it("submits, uploads each file in parallel, finalizes", async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          submission: { id: "sub1" },
          version: { id: "v1" },
          uploads: [
            { position: 0, uploadUrl: "https://p0", storagePath: "team-videos/sub1/v1/0_a.jpg", expiresInSeconds: 900 },
            { position: 1, uploadUrl: "https://p1", storagePath: "team-videos/sub1/v1/1_b.jpg", expiresInSeconds: 900 },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })

    render(<PhotoSubmitDialog open onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: "Test set" } })
    fireEvent.change(screen.getByLabelText(/Add photos/i), {
      target: { files: [fileOf("a.jpg"), fileOf("b.jpg")] },
    })
    fireEvent.click(screen.getByRole("button", { name: /Submit/i }))

    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/editor/submissions/photos",
      )
    })
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(
        "/api/editor/submissions/sub1/finalize",
      )
    })
  })
})

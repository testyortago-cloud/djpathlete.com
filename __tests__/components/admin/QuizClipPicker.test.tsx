// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const grabPosterFrame = vi.fn()
vi.mock("@/lib/quizzes/poster-frame", () => ({ grabPosterFrame: (...a: unknown[]) => grabPosterFrame(...a) }))

import { QuizClipPicker } from "@/components/admin/quizzes/QuizClipPicker"

const QUIZ_ID = "1b93a8c7-c08f-4716-a6e0-226d61bdf820"
const clip = new File([new Uint8Array(10)], "copenhagen.mp4", { type: "video/mp4" })

function stubFetch(putStatus = 200) {
  let n = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/media-upload-url")) {
      n += 1
      return new Response(JSON.stringify({ uploadUrl: `https://signed/${n}`, publicUrl: `https://public/${n}` }), { status: 200 })
    }
    expect(init?.method).toBe("PUT")
    return new Response(null, { status: putStatus })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => vi.clearAllMocks())

describe("QuizClipPicker", () => {
  it("uploads the clip and its poster, then reports both public urls", async () => {
    grabPosterFrame.mockResolvedValue(new Blob(["jpg"], { type: "image/jpeg" }))
    const fetchMock = stubFetch()
    const onChange = vi.fn()
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Demo clip"), { target: { files: [clip] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ url: "https://public/1", posterUrl: "https://public/2" }))
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/quizzes/${QUIZ_ID}/media-upload-url`, expect.anything())
  })

  it("uploads the clip even when no poster can be grabbed", async () => {
    grabPosterFrame.mockResolvedValue(null)
    stubFetch()
    const onChange = vi.fn()
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Demo clip"), { target: { files: [clip] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ url: "https://public/1", posterUrl: null }))
  })

  it("a failed PUT shows the error and changes nothing", async () => {
    grabPosterFrame.mockResolvedValue(null)
    stubFetch(403)
    const onChange = vi.fn()
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Demo clip"), { target: { files: [clip] } })
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Upload failed \(403\)/))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("warns, but still uploads, above 25 MB", async () => {
    grabPosterFrame.mockResolvedValue(null)
    stubFetch()
    const onChange = vi.fn()
    const big = new File([new Uint8Array(10)], "big.mp4", { type: "video/mp4" })
    Object.defineProperty(big, "size", { value: 40 * 1024 * 1024 })
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Demo clip"), { target: { files: [big] } })
    expect(screen.getByText(/40 MB/)).toBeTruthy()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it("Remove clears the clip and the poster", () => {
    const onChange = vi.fn()
    render(<QuizClipPicker quizId={QUIZ_ID} label="Demo clip" url="https://public/x.mp4" onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Remove Demo clip" }))
    expect(onChange).toHaveBeenCalledWith({ url: null, posterUrl: null })
  })
})

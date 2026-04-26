import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ManualPostDialog } from "@/components/admin/content-studio/calendar/ManualPostDialog"

vi.mock("@/lib/firebase-client-upload", () => ({
  uploadImageFile: vi.fn(),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  Object.assign(global, { fetch: fetchMock })
})

describe("<ManualPostDialog>", () => {
  it("renders platform checkboxes and caption textarea for the given day", () => {
    render(<ManualPostDialog dayKey="2026-04-20" onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText(/2026-04-20/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Post to instagram/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Post to facebook/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Caption/i)).toBeInTheDocument()
  })

  it("creates one post per checked supported platform", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "post-x" }), { status: 200 })),
    )
    render(<ManualPostDialog dayKey="2099-02-02" onClose={vi.fn()} onCreated={vi.fn()} />)
    // instagram is pre-selected; add facebook
    fireEvent.click(screen.getByLabelText(/Post to facebook/i))
    fireEvent.click(screen.getByRole("button", { name: /create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const platforms = fetchMock.mock.calls.map(
      (c: unknown[]) => JSON.parse((c[1] as { body: string }).body).platform,
    )
    expect(platforms).toEqual(expect.arrayContaining(["instagram", "facebook"]))
  })

  it("skips platforms that don't support the chosen post type", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "post-y" }), { status: 200 })),
    )
    render(
      <ManualPostDialog
        dayKey="2099-03-03"
        onClose={vi.fn()}
        onCreated={vi.fn()}
        multimediaEnabled
      />,
    )
    // Switch to carousel — tiktok doesn't support it
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "carousel" } })
    // instagram stays selected, also tick tiktok (unsupported for carousel)
    fireEvent.click(screen.getByLabelText(/Post to tiktok/i))
    expect(screen.getByText(/tiktok.*skipped/i)).toBeInTheDocument()
  })

  it("submits to the manual-post API and calls onCreated", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "new-1" }), { status: 200 }))
    const onCreated = vi.fn()
    render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText(/Caption/i), { target: { value: "hello" } })
    fireEvent.click(screen.getByRole("button", { name: /Create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.platform).toBe("instagram")
    expect(body.caption).toBe("hello")
    expect(body.scheduled_at).toMatch(/^2099-01-/)
    expect(onCreated).toHaveBeenCalledWith("new-1")
  })

  it("hides the post-type picker when multimediaEnabled is false", () => {
    render(<ManualPostDialog dayKey="2026-05-01" onClose={() => {}} onCreated={() => {}} />)
    expect(screen.queryByLabelText(/post type/i)).not.toBeInTheDocument()
  })

  it("shows the post-type picker when multimediaEnabled is true", () => {
    render(
      <ManualPostDialog
        dayKey="2026-05-01"
        onClose={() => {}}
        onCreated={() => {}}
        multimediaEnabled
      />,
    )
    expect(screen.getByLabelText(/post type/i)).toBeInTheDocument()
  })

  it("shows the CarouselComposer when postType=carousel and flag is on", () => {
    render(
      <ManualPostDialog
        dayKey="2026-05-01"
        onClose={() => {}}
        onCreated={() => {}}
        multimediaEnabled
      />,
    )
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "carousel" } })
    expect(screen.getByRole("button", { name: /add slide/i })).toBeInTheDocument()
  })

  it("carousel submit is disabled until 2+ slides uploaded", () => {
    render(
      <ManualPostDialog
        dayKey="2026-05-01"
        onClose={() => {}}
        onCreated={() => {}}
        multimediaEnabled
      />,
    )
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "carousel" } })
    const submit = screen.getByRole("button", { name: /create/i })
    expect(submit).toBeDisabled()
  })

  it("shows the image uploader when postType=story and flag is on", () => {
    render(
      <ManualPostDialog
        dayKey="2026-05-01"
        onClose={() => {}}
        onCreated={() => {}}
        multimediaEnabled
      />,
    )
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "story" } })
    expect(screen.getByText(/captions are ignored/i)).toBeInTheDocument()
  })

  it("story submit is disabled until an image is uploaded", () => {
    render(
      <ManualPostDialog
        dayKey="2026-05-01"
        onClose={() => {}}
        onCreated={() => {}}
        multimediaEnabled
      />,
    )
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "story" } })
    const submit = screen.getByRole("button", { name: /create/i })
    expect(submit).toBeDisabled()
  })
})

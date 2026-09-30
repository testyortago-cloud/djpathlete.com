// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ManualPostDialog } from "@/components/admin/content-studio/calendar/ManualPostDialog"

vi.mock("@/lib/firebase-client-upload", () => ({
  uploadImageFile: vi.fn(),
}))
// The real uploader PUTs to Firebase; this stand-in reports a finished upload on click.
vi.mock("@/components/admin/videos/VideoUploader", () => ({
  VideoUploader: ({ onUploaded, showPreview }: { onUploaded: (id: string) => void; showPreview?: boolean }) => (
    <button type="button" data-preview={String(showPreview === true)} onClick={() => onUploaded("vid-1")}>
      Fake video upload
    </button>
  ),
}))

vi.mock("@/components/admin/content-studio/upload/CarouselComposer", () => ({
  CarouselComposer: ({
    onChange,
    allowVideo,
  }: {
    onChange: (ids: string[], meta: { hasVideo: boolean }) => void
    allowVideo?: boolean
  }) => (
    <div data-testid="carousel-composer" data-allow-video={String(allowVideo === true)}>
      <button type="button" onClick={() => onChange(["i1", "i2"], { hasVideo: false })}>Fake two photos</button>
      <button type="button" onClick={() => onChange(["i1", "v1"], { hasVideo: true })}>Fake photo and video</button>
    </div>
  ),
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
    fireEvent.click(screen.getByRole("button", { name: /fake video upload/i }))
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
    fireEvent.click(screen.getByRole("button", { name: /fake video upload/i }))
    fireEvent.click(screen.getByRole("button", { name: /Create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.platform).toBe("instagram")
    expect(body.caption).toBe("hello")
    expect(body.scheduled_at).toMatch(/^2099-01-/)
    expect(onCreated).toHaveBeenCalledWith("new-1")
  })

  // Reported 2026-09-30: Photo had an upload box, Video had none, and the post was
  // created anyway with nothing attached.
  it("video offers an upload, and Create waits for it — with or without the multimedia flag", () => {
    for (const multimediaEnabled of [false, true]) {
      const { unmount } = render(
        <ManualPostDialog
          dayKey="2099-01-01"
          onClose={vi.fn()}
          onCreated={vi.fn()}
          multimediaEnabled={multimediaEnabled}
        />,
      )
      expect((screen.getByLabelText(/post type/i) as HTMLSelectElement).value).toBe("video")
      const submit = screen.getByRole("button", { name: /create/i })
      expect(submit).toBeDisabled()
      fireEvent.click(screen.getByRole("button", { name: /fake video upload/i }))
      expect(submit).not.toBeDisabled()
      unmount()
    }
  })

  it("asks the uploader for a player, for Video and for Story → Video", () => {
    render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={vi.fn()} multimediaEnabled />)
    expect(screen.getByRole("button", { name: /fake video upload/i })).toHaveAttribute("data-preview", "true")
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "story" } })
    fireEvent.change(screen.getByLabelText(/story media type/i), { target: { value: "video" } })
    expect(screen.getByRole("button", { name: /fake video upload/i })).toHaveAttribute("data-preview", "true")
  })

  it("sends the uploaded video with every video post", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "post-v" }), { status: 200 })),
    )
    render(<ManualPostDialog dayKey="2099-02-02" onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByLabelText(/Post to facebook/i))
    fireEvent.click(screen.getByRole("button", { name: /fake video upload/i }))
    fireEvent.click(screen.getByRole("button", { name: /create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call[1] as { body: string }).body)
      expect(body.postType).toBe("video")
      expect(body.source_video_id).toBe("vid-1")
    }
  })

  it("switching away from Video drops the uploaded video", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t-2" }), { status: 200 }))
    render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /fake video upload/i }))
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "text" } })
    fireEvent.click(screen.getByLabelText(/Post to instagram/i))
    fireEvent.click(screen.getByLabelText(/Post to facebook/i))
    fireEvent.change(screen.getByLabelText(/Caption/i), { target: { value: "Just words" } })
    fireEvent.click(screen.getByRole("button", { name: /create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.postType).toBe("text")
    expect(body.source_video_id).toBeUndefined()
  })

  // Retargeted: the picker is always shown (spec §7); it used to be hidden when the flag was off.
  it("shows the post-type picker with only Video and Text when multimediaEnabled is false", () => {
    render(<ManualPostDialog dayKey="2026-05-01" onClose={() => {}} onCreated={() => {}} />)
    const select = screen.getByLabelText(/post type/i) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Video", "Text"])
  })

  it("shows Video, Text, Photo, Carousel, Story when multimediaEnabled is true", () => {
    render(
      <ManualPostDialog
        dayKey="2026-05-01"
        onClose={() => {}}
        onCreated={() => {}}
        multimediaEnabled
      />,
    )
    const select = screen.getByLabelText(/post type/i) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Video",
      "Text",
      "Photo",
      "Carousel",
      "Story",
    ])
  })

  it("posts postType text for LinkedIn without the multimedia flag", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t-1" }), { status: 200 }))
    render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "text" } })
    fireEvent.click(screen.getByLabelText(/Post to instagram/i))
    fireEvent.click(screen.getByLabelText(/Post to linkedin/i))
    fireEvent.change(screen.getByLabelText(/Caption/i), { target: { value: "Hello LinkedIn" } })
    fireEvent.click(screen.getByRole("button", { name: /create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.platform).toBe("linkedin")
    expect(body.postType).toBe("text")
    expect(body.caption).toBe("Hello LinkedIn")
  })

  it("text submit is disabled until there is post text", () => {
    render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "text" } })
    fireEvent.click(screen.getByLabelText(/Post to instagram/i))
    fireEvent.click(screen.getByLabelText(/Post to linkedin/i))
    const submit = screen.getByRole("button", { name: /create/i })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Caption/i), { target: { value: "   " } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Caption/i), { target: { value: "Hi" } })
    expect(submit).not.toBeDisabled()
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
    expect(screen.getByRole("button", { name: "Fake two photos" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Fake photo and video" })).toBeInTheDocument()
    expect(screen.getByTestId("carousel-composer")).toHaveAttribute("data-allow-video", "true")
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

  it("a carousel with a video posts to Instagram only and says why Facebook is skipped", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "c-1" }), { status: 200 }))
    render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={vi.fn()} multimediaEnabled />)
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "carousel" } })
    fireEvent.click(screen.getByLabelText(/Post to facebook/i))
    fireEvent.click(screen.getByRole("button", { name: "Fake photo and video" }))
    expect(screen.getByText("facebook doesn't support videos in a carousel and will be skipped.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).platform).toBe("instagram")
  })

  it("a photo-only carousel still posts to Facebook too", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "c-2" }), { status: 200 }))
    render(<ManualPostDialog dayKey="2099-01-01" onClose={vi.fn()} onCreated={vi.fn()} multimediaEnabled />)
    fireEvent.change(screen.getByLabelText(/post type/i), { target: { value: "carousel" } })
    fireEvent.click(screen.getByLabelText(/Post to facebook/i))
    fireEvent.click(screen.getByRole("button", { name: "Fake two photos" }))
    fireEvent.click(screen.getByRole("button", { name: /^create/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

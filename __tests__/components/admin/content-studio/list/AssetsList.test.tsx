import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { AssetsList } from "@/components/admin/content-studio/list/AssetsList"
import type { AssetWithPostCount } from "@/lib/db/media-assets"

function makeAsset(overrides: Partial<AssetWithPostCount> = {}): AssetWithPostCount {
  return {
    id: overrides.id ?? "asset-x",
    kind: "image",
    storage_path: "images/u/1-photo.jpg",
    public_url: "images/u/1-photo.jpg",
    mime_type: "image/jpeg",
    width: 1080,
    height: 1080,
    duration_ms: null,
    bytes: 123456,
    derived_from_video_id: null,
    ai_alt_text: null,
    ai_analysis: null,
    created_by: null,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    post_count: 0,
    ...overrides,
  }
}

describe("AssetsList", () => {
  it("renders one row per asset with kind and post count", () => {
    const assets = [
      makeAsset({ id: "a-1", storage_path: "images/u/one.jpg", post_count: 3 }),
      makeAsset({ id: "a-2", kind: "video", storage_path: "videos/u/two.mp4", post_count: 0 }),
    ]
    render(<AssetsList assets={assets} />)
    expect(screen.getByText("one.jpg")).toBeInTheDocument()
    expect(screen.getByText("two.mp4")).toBeInTheDocument()
    expect(screen.getByText(/3 posts?/i)).toBeInTheDocument()
    expect(screen.getByText(/0 posts?/i)).toBeInTheDocument()
  })

  it("filters by kind when the kind select changes", () => {
    const assets = [
      makeAsset({ id: "img-1", kind: "image", storage_path: "images/pic.jpg" }),
      makeAsset({ id: "vid-1", kind: "video", storage_path: "videos/clip.mp4" }),
    ]
    render(<AssetsList assets={assets} />)
    fireEvent.change(screen.getByLabelText(/kind/i), { target: { value: "image" } })
    expect(screen.getByText("pic.jpg")).toBeInTheDocument()
    expect(screen.queryByText("clip.mp4")).not.toBeInTheDocument()
  })

  it("labels AI quote-card assets as 'AI quote-card'", () => {
    const assets = [
      makeAsset({
        id: "qc-1",
        storage_path: "images/quotecard.png",
        derived_from_video_id: "video-7",
        ai_analysis: { origin: "quote_card", quote: "Train the pattern." },
      }),
    ]
    render(<AssetsList assets={assets} />)
    expect(screen.getByText(/ai quote-card/i)).toBeInTheDocument()
  })

  it("labels video-derived non-quote assets as 'Video-derived'", () => {
    const assets = [
      makeAsset({
        id: "vd-1",
        kind: "image",
        storage_path: "images/still.jpg",
        derived_from_video_id: "video-3",
        ai_analysis: null,
      }),
    ]
    render(<AssetsList assets={assets} />)
    expect(screen.getByText(/^video-derived$/i)).toBeInTheDocument()
  })

  it("labels uploaded assets as 'Uploaded'", () => {
    const assets = [
      makeAsset({ id: "up-1", storage_path: "images/manual.jpg", derived_from_video_id: null }),
    ]
    render(<AssetsList assets={assets} />)
    expect(screen.getByText(/^uploaded$/i)).toBeInTheDocument()
  })

  it("filters by origin when the origin select changes", () => {
    const assets = [
      makeAsset({ id: "a", storage_path: "images/uploaded.jpg", derived_from_video_id: null }),
      makeAsset({
        id: "b",
        storage_path: "images/quote.png",
        derived_from_video_id: "video-1",
        ai_analysis: { origin: "quote_card", quote: "X" },
      }),
    ]
    render(<AssetsList assets={assets} />)
    fireEvent.change(screen.getByLabelText(/origin/i), { target: { value: "quote_card" } })
    expect(screen.getByText("quote.png")).toBeInTheDocument()
    expect(screen.queryByText("uploaded.jpg")).not.toBeInTheDocument()
  })

  it("shows ai_alt_text when present", () => {
    const assets = [
      makeAsset({ id: "alt", ai_alt_text: "A gym athlete performing a squat." }),
    ]
    render(<AssetsList assets={assets} />)
    expect(screen.getByText(/a gym athlete performing a squat/i)).toBeInTheDocument()
  })

  it("shows a clear empty state when no assets match the filters", () => {
    render(<AssetsList assets={[]} />)
    expect(screen.getByText(/no assets/i)).toBeInTheDocument()
  })
})

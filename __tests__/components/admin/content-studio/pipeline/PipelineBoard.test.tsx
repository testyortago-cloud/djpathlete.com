import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PipelineBoard } from "@/components/admin/content-studio/pipeline/PipelineBoard"
import type { PipelineData } from "@/lib/content-studio/pipeline-data"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams(""),
}))

const data: PipelineData = {
  videos: [
    {
      id: "v1",
      storage_path: "",
      original_filename: "a.mp4",
      duration_seconds: 10,
      size_bytes: 1,
      mime_type: null,
      title: "A",
      uploaded_by: null,
      status: "uploaded",
      thumbnail_path: null,
      created_at: "",
      updated_at: "",
    },
  ],
  posts: [],
  postCountsByVideo: {},
  thumbnailUrlsByVideo: {},
}

describe("<PipelineBoard>", () => {
  it("renders both lanes", () => {
    render(<PipelineBoard initialData={data} />)
    expect(screen.getByRole("region", { name: /Videos/ })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: /Posts/ })).toBeInTheDocument()
  })
})

import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LeftFilters } from "@/components/admin/content-studio/calendar/LeftFilters"

const replaceMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/content",
  useSearchParams: () => new URLSearchParams("tab=calendar"),
}))

describe("<LeftFilters>", () => {
  it("renders platform checkboxes", () => {
    render(<LeftFilters videos={[]} />)
    expect(screen.getByLabelText(/Instagram/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/TikTok/i)).toBeInTheDocument()
  })

  it("toggling a checkbox updates the URL", () => {
    replaceMock.mockClear()
    render(<LeftFilters videos={[]} />)
    fireEvent.click(screen.getByLabelText(/Instagram/i))
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringMatching(/platform=instagram/),
      { scroll: false },
    )
  })

  it("source video search filters the dropdown list", () => {
    render(
      <LeftFilters
        videos={[
          {
            id: "v1",
            storage_path: "",
            original_filename: "clip-alpha.mp4",
            duration_seconds: 1,
            size_bytes: 1,
            mime_type: null,
            title: "Alpha",
            uploaded_by: null,
            status: "transcribed",
            created_at: "",
            updated_at: "",
          },
          {
            id: "v2",
            storage_path: "",
            original_filename: "clip-beta.mp4",
            duration_seconds: 1,
            size_bytes: 1,
            mime_type: null,
            title: "Beta",
            uploaded_by: null,
            status: "transcribed",
            created_at: "",
            updated_at: "",
          },
        ]}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/Search videos/i), {
      target: { value: "alpha" },
    })
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.queryByText(/Beta/)).not.toBeInTheDocument()
  })
})

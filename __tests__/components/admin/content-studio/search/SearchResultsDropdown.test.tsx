import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SearchResultsDropdown } from "@/components/admin/content-studio/search/SearchResultsDropdown"
import type { SearchResults } from "@/lib/content-studio/search"

const results: SearchResults = {
  videos: [
    {
      id: "v1",
      title: "Rotational Reboot",
      original_filename: "rotate.mp4",
      status: "transcribed",
    },
  ],
  transcripts: [
    {
      id: "t1",
      video_upload_id: "v1",
      snippet: "…rotational reboot…",
      video_filename: "rotate.mp4",
    },
  ],
  posts: [
    {
      id: "p1",
      platform: "instagram",
      content: "stay rotational",
      approval_status: "approved",
      source_video_id: "v1",
      source_video_filename: "rotate.mp4",
    },
  ],
}

describe("<SearchResultsDropdown>", () => {
  it("groups results by type with headers", () => {
    render(
      <SearchResultsDropdown
        q="rotate"
        results={results}
        loading={false}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText(/Videos/)).toBeInTheDocument()
    expect(screen.getByText(/Transcripts/)).toBeInTheDocument()
    expect(screen.getByText(/Posts/)).toBeInTheDocument()
  })

  it("each row is a link to the drawer", () => {
    render(
      <SearchResultsDropdown
        q="rotate"
        results={results}
        loading={false}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole("link", { name: /Rotational Reboot/ })).toHaveAttribute(
      "href",
      "/admin/content/v1",
    )
    expect(screen.getByRole("link", { name: /stay rotational/ })).toHaveAttribute(
      "href",
      "/admin/content/post/p1",
    )
  })

  it("shows a loading indicator", () => {
    render(
      <SearchResultsDropdown
        q="rotate"
        results={{ videos: [], transcripts: [], posts: [] }}
        loading
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText(/Searching/i)).toBeInTheDocument()
  })

  it("shows a no-results state", () => {
    render(
      <SearchResultsDropdown
        q="nothingmatches"
        results={{ videos: [], transcripts: [], posts: [] }}
        loading={false}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText(/No results/i)).toBeInTheDocument()
  })
})

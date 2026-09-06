// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/firebase-client-upload", () => ({ uploadVideoFile: vi.fn() }))
vi.mock("@/lib/firebase-client-thumbnail", () => ({ generateAndUploadThumbnail: vi.fn() }))

import { VideoUploader } from "@/components/admin/videos/VideoUploader"

describe("VideoUploader edit-gate toggle", () => {
  it("renders the 'Needs editing' checkbox checked by default", () => {
    render(<VideoUploader onUploaded={() => {}} />)
    expect(screen.getByRole("checkbox", { name: /needs editing/i })).toBeChecked()
  })

  it("hides the toggle when showNeedsEditToggle is false", () => {
    render(<VideoUploader onUploaded={() => {}} showNeedsEditToggle={false} />)
    expect(screen.queryByRole("checkbox", { name: /needs editing/i })).toBeNull()
  })
})

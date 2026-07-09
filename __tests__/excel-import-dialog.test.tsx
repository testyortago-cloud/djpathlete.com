import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
vi.mock("@/lib/firebase", () => ({ rtdb: {} }))
vi.mock("firebase/database", () => ({ ref: vi.fn(), onValue: vi.fn(), off: vi.fn() }))
vi.mock("@/hooks/use-ai-jobs-dock", () => ({ useAiJobsDock: () => ({ addJob: vi.fn(), markResolved: vi.fn() }) }))
import { ExcelImportDialog } from "@/components/admin/ExcelImportDialog"

describe("ExcelImportDialog", () => {
  it("renders the upload step with a template download link", () => {
    render(<ExcelImportDialog open={true} onOpenChange={() => {}} clients={[]} />)
    expect(screen.getByText(/import from excel/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /template/i })).toHaveAttribute(
      "href",
      "/api/admin/programs/import-excel/template",
    )
  })
})

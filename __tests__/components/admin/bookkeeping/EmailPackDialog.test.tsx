// The send dialog is the last screen the coach reads before a workbook leaves
// the building, so its description of that workbook has to match what the
// workbook says about itself (lib/bookkeeping/email-pack.ts cover copy, the
// Reports header, the print header). It drifted once: every sibling gained the
// net-after-fees line and this one still called the pack gross-only.
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { EmailPackDialog } from "@/components/admin/bookkeeping/EmailPackDialog"
import { accountantPackEmailHtml } from "@/lib/bookkeeping/email-pack"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function open() {
  render(
    <EmailPackDialog
      open
      onOpenChange={() => {}}
      from="2026-01-01"
      to="2026-03-31"
      defaultRecipient="cpa@example.com"
    />,
  )
}

describe("<EmailPackDialog> pre-send description", () => {
  it("names the window it is about to send", () => {
    open()
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument()
    expect(screen.getByText(/2026-03-31/)).toBeInTheDocument()
  })

  it("describes the pack as gross-primary WITH a net-after-fees line, like the pack itself does", () => {
    open()
    const blurb = screen.getByText(/Sends the accountant pack/)
    expect(blurb).toHaveTextContent(/gross/i)
    // The claim that drifted: the workbook carries a labeled net line, so the
    // dialog may not present it as gross-only.
    expect(blurb).toHaveTextContent(/net line|net-after-fees|net income after/i)
    expect(blurb).toHaveTextContent(/CPA files/i)

    // Same three claims the email body makes about the same attachment.
    const cover = accountantPackEmailHtml("2026-01-01", "2026-03-31")
    expect(cover).toMatch(/GROSS/)
    expect(cover).toMatch(/net-after-fees/i)
    expect(cover).toMatch(/the CPA files/i)
  })
})

import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { AthleteProfileLinkDialog } from "@/components/admin/profile-share/AthleteProfileLinkDialog"

describe("AthleteProfileLinkDialog", () => {
  it("opens and shows the share URL + QR", () => {
    render(
      <AthleteProfileLinkDialog
        qrDataUrl="data:image/png;base64,AAAA"
        profileUrl="https://www.darrenjpaul.com/athlete/tok123"
        clientName="Marcus Johnson"
        testCount={8}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share test report/i }))
    expect(screen.getByText(/darrenjpaul\.com\/athlete\/tok123/)).toBeInTheDocument()
    expect(screen.getByAltText(/test report QR/i)).toBeInTheDocument()
  })

  it("copies the link", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <AthleteProfileLinkDialog
        qrDataUrl="data:image/png;base64,AAAA"
        profileUrl="https://x/athlete/t"
        clientName="M J"
        testCount={8}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share test report/i }))
    fireEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith("https://x/athlete/t")
  })

  it("warns before sharing a report with too few logged tests", () => {
    render(
      <AthleteProfileLinkDialog
        qrDataUrl="data:image/png;base64,AAAA"
        profileUrl="https://x/athlete/t"
        clientName="Marcus Johnson"
        testCount={1}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share test report/i }))
    expect(screen.getByText(/only 1 logged test/i)).toBeInTheDocument()
    expect(screen.getByText(/look thin/i)).toBeInTheDocument()
  })

  it("says 'no logged tests' rather than 'only 0 tests' when there are none", () => {
    render(
      <AthleteProfileLinkDialog
        qrDataUrl="data:image/png;base64,AAAA"
        profileUrl="https://x/athlete/t"
        clientName="Marcus Johnson"
        testCount={0}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share test report/i }))
    expect(screen.getByText(/no logged tests/i)).toBeInTheDocument()
  })

  it("does NOT warn once the client has enough tests", () => {
    render(
      <AthleteProfileLinkDialog
        qrDataUrl="data:image/png;base64,AAAA"
        profileUrl="https://x/athlete/t"
        clientName="Marcus Johnson"
        testCount={5}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share test report/i }))
    expect(screen.queryByText(/look thin/i)).not.toBeInTheDocument()
  })
})

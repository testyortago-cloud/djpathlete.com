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
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share profile/i }))
    expect(screen.getByText(/darrenjpaul\.com\/athlete\/tok123/)).toBeInTheDocument()
    expect(screen.getByAltText(/athlete profile QR/i)).toBeInTheDocument()
  })

  it("copies the link", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <AthleteProfileLinkDialog qrDataUrl="data:image/png;base64,AAAA" profileUrl="https://x/athlete/t" clientName="M J" />,
    )
    fireEvent.click(screen.getByRole("button", { name: /share profile/i }))
    fireEvent.click(screen.getByRole("button", { name: /copy/i }))
    expect(writeText).toHaveBeenCalledWith("https://x/athlete/t")
  })
})

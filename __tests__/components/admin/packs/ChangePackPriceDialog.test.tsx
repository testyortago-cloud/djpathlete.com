// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ChangePackPriceDialog } from "@/components/admin/packs/ChangePackPriceDialog"
const saved = vi.fn()
beforeEach(() => {
  vi.restoreAllMocks()
  saved.mockClear()
})
const open = () => {
  render(<ChangePackPriceDialog packId="pack-1" priceCents={150000} cardPayment onSaved={saved} />)
  fireEvent.click(screen.getByRole("button", { name: "Change price" }))
}
describe("Change pack price", () => {
  it("opens at the current total and submits exact cents", async () => {
    const fetch = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ url: "https://stripe.test/new" }), { status: 200 }))
    open()
    expect(screen.getByLabelText("New pack total (USD)")).toHaveValue("1500.00")
    fireEvent.change(screen.getByLabelText("New pack total (USD)"), { target: { value: "750.25" } })
    fireEvent.click(screen.getByRole("button", { name: "Save price and replace link" }))
    await waitFor(() => expect(saved).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/session-packs/pack-1/price",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ priceCents: 75025 }) }),
    )
    expect(screen.getByLabelText("Replacement payment link")).toHaveValue("https://stripe.test/new")
  })
  it("keeps a server refusal visible without claiming success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "This pack was already paid" }), { status: 409 }),
    )
    open()
    fireEvent.change(screen.getByLabelText("New pack total (USD)"), { target: { value: "750" } })
    fireEvent.click(screen.getByRole("button", { name: "Save price and replace link" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("already paid")
    expect(saved).not.toHaveBeenCalled()
  })
  it.each(["0", "-1", "12.345", "hello"])("rejects invalid dollar input %s", async (value) => {
    const fetch = vi.spyOn(global, "fetch")
    open()
    fireEvent.change(screen.getByLabelText("New pack total (USD)"), { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "Save price and replace link" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter")
    expect(fetch).not.toHaveBeenCalled()
  })
})

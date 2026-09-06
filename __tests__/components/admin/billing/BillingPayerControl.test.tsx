// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { BillingPayerControl } from "@/components/admin/billing/BillingPayerControl"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as never
})

describe("BillingPayerControl", () => {
  it("offers Themselves + candidates and preselects the current payer", () => {
    render(
      <BillingPayerControl
        clientUserId="wife"
        currentPayerId="dad"
        candidates={[
          { id: "dad", name: "Dad Smith" },
          { id: "coach", name: "Coach" },
        ]}
      />,
    )
    expect(screen.getByText("Themselves")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Dad Smith" })).toBeInTheDocument()
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("dad")
  })

  it("defaults to Themselves when no payer is set", () => {
    render(<BillingPayerControl clientUserId="wife" currentPayerId={null} candidates={[]} />)
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("")
  })
})

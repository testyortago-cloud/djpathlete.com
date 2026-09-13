// @vitest-environment jsdom
// The theme panel — the hand-editable twin of `set_theme`. It emits a PATCH
// and nothing else (see the file's own header comment); these tests pin that
// contract, not any particular pixel layout.

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemePanel } from "@/components/admin/funnels/builder/ThemePanel"
import { PALETTE_PRESETS } from "@/lib/funnels/sections/palettes"
import type { SectionDocTheme } from "@/lib/funnels/sections/registry"

const theme: SectionDocTheme = { tone: "light", accent: "accent", radius: "soft" }
const noop = () => {}

describe("ThemePanel", () => {
  it("shows a swatch for every preset", () => {
    render(<ThemePanel theme={theme} onChange={noop} brandKit={null} />)
    for (const name of PALETTE_PRESETS) {
      expect(screen.getByRole("button", { name: new RegExp(name, "i") })).toBeTruthy()
    }
  })

  it("emits a set_theme-shaped patch rather than writing the document directly", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={theme} onChange={onChange} brandKit={null} />)
    await userEvent.click(screen.getByRole("button", { name: /ember/i }))
    expect(onChange).toHaveBeenCalledWith({ palette: { preset: "ember" } })
  })

  it("offers the tenant brand colours when the tenant has them", () => {
    render(<ThemePanel theme={theme} onChange={noop} brandKit={{ brand: "#6d28d9" }} />)
    expect(screen.getByText(/my brand/i)).toBeTruthy()
  })

  it("does not offer a brand-colour shortcut when the tenant has none", () => {
    render(<ThemePanel theme={theme} onChange={noop} brandKit={null} />)
    expect(screen.queryByText(/my brand colours/i)).toBeNull()
  })

  it("applying the tenant brand colours patches the document palette, not business_settings", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={theme} onChange={onChange} brandKit={{ brand: "#6d28d9", accent: "#0e7490" }} />)
    await userEvent.click(screen.getByRole("button", { name: /my brand colours/i }))
    expect(onChange).toHaveBeenCalledWith({ palette: { brand: "#6d28d9", accent: "#0e7490" } })
  })

  it("a font pairing choice emits an onChange patch for `font` only", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={theme} onChange={onChange} brandKit={null} />)
    await userEvent.selectOptions(screen.getByLabelText(/font pairing/i), "editorial")
    expect(onChange).toHaveBeenCalledWith({ font: "editorial" })
  })

  it("a density choice emits an onChange patch for `density` only", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={theme} onChange={onChange} brandKit={null} />)
    await userEvent.selectOptions(screen.getByLabelText(/density/i), "airy")
    expect(onChange).toHaveBeenCalledWith({ density: "airy" })
  })

  it("the required tone/accent/radius keys are editable and never offer a blank option", () => {
    render(<ThemePanel theme={theme} onChange={noop} brandKit={null} />)
    const tone = screen.getByLabelText(/^tone$/i) as HTMLSelectElement
    expect(Array.from(tone.options).map((o) => o.value)).toEqual(["light", "dark"])
    expect(tone.value).toBe("light")
  })

  it("saving a brand kit calls onSaveBrandKit with the hex patch and never onChange", async () => {
    const onChange = vi.fn()
    const onSaveBrandKit = vi.fn().mockResolvedValue(undefined)
    render(<ThemePanel theme={theme} onChange={onChange} brandKit={null} onSaveBrandKit={onSaveBrandKit} />)
    await userEvent.click(screen.getByRole("button", { name: /save brand colours/i }))
    expect(onSaveBrandKit).toHaveBeenCalledTimes(1)
    const patch = onSaveBrandKit.mock.calls[0][0]
    expect(patch.brand_color).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("without onSaveBrandKit the save button is disabled rather than throwing", () => {
    render(<ThemePanel theme={theme} onChange={noop} brandKit={null} />)
    expect(screen.getByRole("button", { name: /save brand colours/i })).toBeDisabled()
  })

  it("disables every control while busy", () => {
    render(<ThemePanel theme={theme} onChange={noop} brandKit={{ brand: "#6d28d9" }} busy />)
    expect(screen.getByRole("button", { name: /^ember$/i })).toBeDisabled()
    expect(screen.getByLabelText(/font pairing/i)).toBeDisabled()
  })
})

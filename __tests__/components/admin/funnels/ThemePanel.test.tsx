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

  // Final whole-branch review, finding 3 (2026-09-13): before this fix there
  // was no way to send a page's palette back to "use the tenant's brand kit"
  // — `set_theme` had no delete sentinel. These pin the control that closes
  // that gap, and that it is a genuinely different write from "My brand
  // colours" (a snapshot), not a relabelled shortcut to the same patch.
  describe("clearing an optional theme key", () => {
    it("offers no Clear button when no palette is set — there is nothing to clear", () => {
      render(<ThemePanel theme={theme} onChange={noop} brandKit={null} />)
      expect(screen.queryByRole("button", { name: /^clear$/i })).toBeNull()
    })

    it("offers a Clear button once a palette is set, and it deletes the palette rather than snapshotting one", async () => {
      const onChange = vi.fn()
      const themed: SectionDocTheme = { ...theme, palette: { preset: "ember" } }
      render(<ThemePanel theme={themed} onChange={onChange} brandKit={null} />)
      await userEvent.click(screen.getByRole("button", { name: /^clear$/i }))
      expect(onChange).toHaveBeenCalledWith({ palette: null })
    })

    it("choosing 'Page default' for an optional key like font pairing deletes it, not sets it to a string", async () => {
      const onChange = vi.fn()
      const themed: SectionDocTheme = { ...theme, font: "editorial" }
      render(<ThemePanel theme={themed} onChange={onChange} brandKit={null} />)
      await userEvent.selectOptions(screen.getByLabelText(/font pairing/i), "")
      expect(onChange).toHaveBeenCalledWith({ font: null })
    })

    it("the four optional theme selects always offer 'Page default', even once a real value is already chosen", () => {
      const themed: SectionDocTheme = { ...theme, font: "editorial", density: "airy", width: "wide", rhythm: "banded" }
      render(<ThemePanel theme={themed} onChange={noop} brandKit={null} />)
      for (const label of [/font pairing/i, /^density$/i, /page width/i, /section rhythm/i]) {
        const select = screen.getByLabelText(label) as HTMLSelectElement
        expect(Array.from(select.options).map((o) => o.value), label.source).toContain("")
      }
    })

    it("the required tone/accent/radius selects never gain a 'Page default' option, even indirectly", () => {
      const themed: SectionDocTheme = { tone: "dark", accent: "primary", radius: "round" }
      render(<ThemePanel theme={themed} onChange={noop} brandKit={null} />)
      for (const label of [/^tone$/i, /accent colour/i, /corner radius/i]) {
        const select = screen.getByLabelText(label) as HTMLSelectElement
        expect(Array.from(select.options).map((o) => o.value), label.source).not.toContain("")
      }
    })
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

describe("the design-direction note", () => {
  it("shows the note the document is carrying", () => {
    render(
      <ThemePanel
        theme={{ ...theme, designNote: "Warm sand palette, editorial serif." }}
        onChange={noop}
        brandKit={null}
      />,
    )
    expect((screen.getByLabelText(/design direction/i) as HTMLTextAreaElement).value).toBe(
      "Warm sand palette, editorial serif.",
    )
  })

  it("commits ONE patch on blur, not one per keystroke", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={theme} onChange={onChange} brandKit={null} />)
    const field = screen.getByLabelText(/design direction/i)
    await userEvent.type(field, "Serif")
    // The mutant: a controlled textarea firing `onChange` per character. Every
    // one is a `set_theme` op — one turn, one revision, one row in
    // `funnel_step_turns` — PER LETTER.
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ designNote: "Serif" })
  })

  it("an emptied box clears the note with null, not an empty string", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={{ ...theme, designNote: "Serif" }} onChange={onChange} brandKit={null} />)
    await userEvent.clear(screen.getByLabelText(/design direction/i))
    await userEvent.tab()
    // `""` is a field the model reads as "the direction is: nothing", which is
    // not what an owner who cleared the box meant. `null` is the delete
    // sentinel `sectionDocThemePatchSchema` derives for every optional key.
    expect(onChange).toHaveBeenCalledWith({ designNote: null })
  })

  it("sends nothing when the note was not actually changed", async () => {
    const onChange = vi.fn()
    render(<ThemePanel theme={{ ...theme, designNote: "Serif" }} onChange={onChange} brandKit={null} />)
    await userEvent.click(screen.getByLabelText(/design direction/i))
    await userEvent.tab()
    // A blur that always patches would burn a revision for a stray click.
    expect(onChange).not.toHaveBeenCalled()
  })

  it("stops the owner at the schema's own bound rather than after the fact", () => {
    render(<ThemePanel theme={theme} onChange={noop} brandKit={null} />)
    expect(screen.getByLabelText(/design direction/i).getAttribute("maxlength")).toBe("400")
  })
})

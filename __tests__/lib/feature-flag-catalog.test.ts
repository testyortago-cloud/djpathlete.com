import { describe, it, expect } from "vitest"
import { FEATURE_FLAG_CATALOG, isFeatureFlagKey } from "@/lib/feature-flag-catalog"
import { FUNNEL_CHECKOUT_DEFAULT, FUNNEL_CHECKOUT_FLAG } from "@/lib/funnels/checkout/flag"

describe("feature flag catalog", () => {
  it("declares the captioned-cut flag, default off", () => {
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === "feature_captioned_cut_enabled")
    expect(flag).toBeDefined()
    expect(flag?.defaultEnabled).toBe(false)
  })
  it("recognizes a known key and rejects an unknown one", () => {
    expect(isFeatureFlagKey("feature_captioned_cut_enabled")).toBe(true)
    expect(isFeatureFlagKey("feature_bogus")).toBe(false)
  })
  it("declares the program-excel-import flag, default on", () => {
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === "feature_program_excel_import_enabled")
    expect(flag?.defaultEnabled).toBe(true)
    expect(isFeatureFlagKey("feature_program_excel_import_enabled")).toBe(true)
  })

  // -------------------------------------------------------------------------
  // The funnel checkout flag. Registered here so it has a UI at all: without a
  // catalogue entry the only way to switch on a funnel taking payments was hand-
  // written SQL against system_settings.
  // -------------------------------------------------------------------------

  it("declares the funnel checkout flag under its REAL key", () => {
    // Asserted against the imported constant, never a copied string. The route
    // and the webhook both read FUNNEL_CHECKOUT_FLAG, so a catalogue entry with a
    // typo would render a toggle that flips a row nothing reads — a switch that
    // appears to work and changes nothing.
    expect(isFeatureFlagKey(FUNNEL_CHECKOUT_FLAG)).toBe(true)
    expect(FEATURE_FLAG_CATALOG.find((f) => f.key === FUNNEL_CHECKOUT_FLAG)).toBeDefined()
  })

  it("agrees with the code's own default, so the toggle cannot lie", () => {
    // MUTANT: defaultEnabled: true here. The catalogue's default is what the UI
    // shows when no row exists; the code's default is what the route actually
    // does. Disagreement means the switch reads "on" while every checkout 404s,
    // which is the worst version of this bug because it looks fine.
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === FUNNEL_CHECKOUT_FLAG)
    expect(flag?.defaultEnabled).toBe(FUNNEL_CHECKOUT_DEFAULT)
  })

  it("says in its description that this one takes money", () => {
    // Every other flag in here turns a FEATURE on. This one lets a page charge a
    // card, and the person reading a list of switches deserves to know which is
    // which before they flip it.
    const flag = FEATURE_FLAG_CATALOG.find((f) => f.key === FUNNEL_CHECKOUT_FLAG)
    expect(flag?.description).toMatch(/pay|payment|card|money|charge/i)
  })
})

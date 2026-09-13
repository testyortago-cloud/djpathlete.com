"use client"

// components/admin/funnels/builder/ThemePanel.tsx — the page-level design
// panel: the eight `SectionDoc.theme` keys, reachable by hand.
//
// SAME RULE AS `SectionInspector.tsx`: this component emits a THEME PATCH and
// nothing else. It does not hold the document, does not call `applyOps`, and
// does not fetch. `onChange(patch)` is the whole contract — the caller
// (`FunnelBuilder.tsx`) is the one that turns it into
// `onOps([{ op: "set_theme", theme: patch }])`, the exact op path
// `SectionInspector` already uses for `update_section`. A hand edit here and
// an AI turn therefore land through the SAME transaction, the same turn log,
// and the same undo history — see the design spec, §7a. This file must never
// grow a second way to change the document.
//
// The "use my brand colours" control is a DIFFERENT write, on purpose: it
// changes `business_settings.brand_color` / `.accent_color`, a tenant-level
// row that has nothing to do with any one page's document. That one CANNOT go
// through `set_theme` — there is no document to patch, and every other page
// this tenant owns should see the new brand kit too. It goes through
// `onSaveBrandKit`, which the caller wires to the dedicated write route
// (`app/api/admin/businesses/brand/route.ts`), never to `onOps`.

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { PALETTE_PRESETS, PALETTE_TABLE, type PaletteName } from "@/lib/funnels/sections/palettes"
import type { SectionDocTheme } from "@/lib/funnels/sections/registry"

/** The two tenant colours this panel can offer and can write. Optional accent, same as `BrandKit`. */
export interface ThemePanelBrandKit {
  brand: string
  accent?: string
}

/** What the write route accepts — `accent_color: null` clears it, `brand_color` cannot be cleared without another colour to replace it. */
export interface BrandKitPatch {
  brand_color: string
  accent_color: string | null
}

export interface ThemePanelProps {
  theme: SectionDocTheme
  /** A partial `SectionDocTheme` patch. The caller turns this into a `set_theme` op. */
  onChange: (patch: Partial<SectionDocTheme>) => void
  /** `null` when this tenant has not chosen a brand yet — see `resolveBrandKit`. */
  brandKit: ThemePanelBrandKit | null
  /**
   * Saves a NEW tenant brand kit. Absent in a harness that has nowhere to
   * send it (e.g. these tests) — the save row still renders so the shape of
   * the control is visible, but the button does nothing without it rather
   * than throwing on a fetch this component does not own.
   */
  onSaveBrandKit?: (patch: BrandKitPatch) => Promise<void> | void
  busy?: boolean
  className?: string
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function optionLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** A `<select>` for one required or optional enum theme key. */
function ThemeSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string | undefined
  options: readonly string[]
  disabled: boolean
  onChange: (next: string) => void
}) {
  const id = `theme-${label.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {/* Shown only while nothing has been chosen yet — there is no way to
            unset an optional theme key once one is picked (`set_theme` merges
            these shallowly and has no delete sentinel for them, unlike a
            section prop's `null`), so this option disappears the moment a
            real one is selected and never reappears. */}
        {value === undefined ? (
          <option value="" disabled>
            Not set
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The twelve preset swatches plus a custom two-colour option.
 *
 * Presets write `{ preset }`; custom writes `{ brand, accent }` — the exact
 * two shapes `paletteSchema` accepts (design spec §3.1). Every swatch's own
 * accent and surface tokens are DERIVED (`PALETTE_TABLE`), never chosen here,
 * so this panel cannot drift from what `themeCss` actually paints.
 */
function PaletteField({
  value,
  brandKit,
  disabled,
  onChange,
}: {
  value: SectionDocTheme["palette"]
  brandKit: ThemePanelBrandKit | null
  disabled: boolean
  onChange: (patch: Partial<SectionDocTheme>) => void
}) {
  const activePreset = value && "preset" in value ? value.preset : null
  const activeCustom = value && "brand" in value ? value : null
  const usingBrandKit =
    activeCustom !== null && brandKit !== null && activeCustom.brand === brandKit.brand.toLowerCase()

  const [customBrand, setCustomBrand] = useState(activeCustom?.brand ?? "#1e3a8a")
  const [customAccent, setCustomAccent] = useState(activeCustom?.accent ?? "")

  return (
    <div className="col-span-2 space-y-3">
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Palette</p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {PALETTE_PRESETS.map((name) => {
            const tokens = PALETTE_TABLE[name]
            const active = activePreset === name
            return (
              <button
                key={name}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                title={`Use the ${optionLabel(name)} palette`}
                onClick={() => onChange({ palette: { preset: name as PaletteName } })}
                className={`flex flex-col items-center gap-1 rounded-md border p-1.5 text-[11px] transition-colors disabled:opacity-50 ${
                  active ? "border-primary ring-1 ring-primary" : "border-border hover:bg-surface/50"
                }`}
              >
                <span
                  aria-hidden
                  className="flex h-6 w-full overflow-hidden rounded"
                  style={{ background: tokens.paper }}
                >
                  <span className="h-full w-1/2" style={{ background: tokens.brand }} />
                  <span className="h-full w-1/2" style={{ background: tokens.accent }} />
                </span>
                <span>{optionLabel(name)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {brandKit ? (
        <button
          type="button"
          disabled={disabled}
          aria-pressed={usingBrandKit}
          onClick={() => onChange({ palette: { brand: brandKit.brand, accent: brandKit.accent } })}
          className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-50 ${
            usingBrandKit ? "border-primary ring-1 ring-primary" : "border-border hover:bg-surface/50"
          }`}
        >
          <span className="flex h-5 w-5 shrink-0 overflow-hidden rounded border border-border" aria-hidden>
            <span className="h-full w-1/2" style={{ background: brandKit.brand }} />
            <span className="h-full w-1/2" style={{ background: brandKit.accent ?? brandKit.brand }} />
          </span>
          My brand colours
        </button>
      ) : null}

      <div className="space-y-2 rounded-md border border-border bg-surface/40 p-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Custom colours</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Brand
            <input
              type="color"
              disabled={disabled}
              value={customBrand}
              onChange={(event) => setCustomBrand(event.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-border disabled:cursor-not-allowed"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Accent (optional)
            <input
              type="color"
              disabled={disabled}
              value={customAccent === "" ? customBrand : customAccent}
              onChange={(event) => setCustomAccent(event.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-border disabled:cursor-not-allowed"
            />
          </label>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange({
              palette: customAccent === "" ? { brand: customBrand } : { brand: customBrand, accent: customAccent },
            })
          }
        >
          Use these colours
        </Button>
      </div>
    </div>
  )
}

/**
 * "Set your brand colours" — the WRITER for `business_settings.brand_color` /
 * `.accent_color` (design spec §7). Separate state from `PaletteField` above:
 * this changes what the TENANT owns, not what THIS page's document is
 * currently painted with, and the two can legitimately disagree (an owner
 * previewing a preset while still deciding on their real brand).
 */
function BrandKitEditor({
  brandKit,
  onSave,
  disabled,
}: {
  brandKit: ThemePanelBrandKit | null
  onSave?: (patch: BrandKitPatch) => Promise<void> | void
  disabled: boolean
}) {
  const [brand, setBrand] = useState(brandKit?.brand ?? "#1e3a8a")
  const [accent, setAccent] = useState(brandKit?.accent ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The tenant's own colours can change underneath this panel (another tab,
  // another admin) — re-sync the inputs when the prop moves, but only while
  // nothing is being typed right now, so a save-in-flight is never clobbered.
  useEffect(() => {
    if (saving) return
    setBrand(brandKit?.brand ?? "#1e3a8a")
    setAccent(brandKit?.accent ?? "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandKit?.brand, brandKit?.accent])

  const save = async () => {
    setError(null)
    if (!HEX_RE.test(brand)) {
      setError("Enter a six-digit hex colour for your brand colour.")
      return
    }
    if (accent !== "" && !HEX_RE.test(accent)) {
      setError("Enter a six-digit hex colour for your accent colour, or leave it blank.")
      return
    }
    if (!onSave) return
    setSaving(true)
    try {
      await onSave({ brand_color: brand, accent_color: accent === "" ? null : accent })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your brand colours.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="col-span-2 space-y-2 rounded-md border border-border bg-surface/40 p-2">
      {/* Deliberately NOT "My brand colours" — the quick-apply swatch above
          (rendered only when `brandKit` is set) owns that exact phrase, and
          this editor renders unconditionally (there has to be a way to set a
          brand kit for the FIRST time). Two controls both named "My brand
          colours" would be ambiguous to a screen reader and to
          `getByText(/my brand/i)` alike. */}
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Set your brand colours</p>
      <p className="text-xs text-muted-foreground">
        Saved once, offered on every page you build from now on — for this business only.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Brand
          <input
            type="color"
            disabled={disabled || saving}
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-border disabled:cursor-not-allowed"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Accent
          <input
            type="color"
            disabled={disabled || saving}
            value={accent === "" ? brand : accent}
            onChange={(event) => setAccent(event.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-border disabled:cursor-not-allowed"
          />
        </label>
        <Button type="button" variant="outline" size="sm" disabled={disabled || saving || !onSave} onClick={save}>
          {saving ? "Saving…" : "Save brand colours"}
        </Button>
      </div>
      {error ? <p className="text-xs text-[var(--error)]">{error}</p> : null}
    </div>
  )
}

export function ThemePanel({ theme, onChange, brandKit, onSaveBrandKit, busy = false, className }: ThemePanelProps) {
  return (
    <aside className={className}>
      <div className="border-b border-border px-4 py-3">
        <p className="font-heading text-sm text-primary">Page design</p>
        <p className="text-xs text-muted-foreground">
          Applies to every section on this page that has not set its own style.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-4">
        <PaletteField value={theme.palette} brandKit={brandKit} disabled={busy} onChange={onChange} />

        <ThemeSelect
          label="Font pairing"
          value={theme.font}
          options={["athletic", "editorial", "clean", "bold", "technical"]}
          disabled={busy}
          onChange={(next) => onChange({ font: next as SectionDocTheme["font"] })}
        />
        <ThemeSelect
          label="Density"
          value={theme.density}
          options={["tight", "normal", "airy"]}
          disabled={busy}
          onChange={(next) => onChange({ density: next as SectionDocTheme["density"] })}
        />
        <ThemeSelect
          label="Page width"
          value={theme.width}
          options={["narrow", "normal", "wide", "full"]}
          disabled={busy}
          onChange={(next) => onChange({ width: next as SectionDocTheme["width"] })}
        />
        <ThemeSelect
          label="Section rhythm"
          value={theme.rhythm}
          options={["flat", "alternating", "banded"]}
          disabled={busy}
          onChange={(next) => onChange({ rhythm: next as SectionDocTheme["rhythm"] })}
        />

        <div className="col-span-2 border-t border-border pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Base theme</p>
          <div className="grid grid-cols-2 gap-3">
            <ThemeSelect
              label="Tone"
              value={theme.tone}
              options={["light", "dark"]}
              disabled={busy}
              onChange={(next) => onChange({ tone: next as SectionDocTheme["tone"] })}
            />
            <ThemeSelect
              label="Accent colour"
              value={theme.accent}
              options={["accent", "primary"]}
              disabled={busy}
              onChange={(next) => onChange({ accent: next as SectionDocTheme["accent"] })}
            />
            <ThemeSelect
              label="Corner radius"
              value={theme.radius}
              options={["sharp", "soft", "round"]}
              disabled={busy}
              onChange={(next) => onChange({ radius: next as SectionDocTheme["radius"] })}
            />
          </div>
        </div>

        <BrandKitEditor brandKit={brandKit} onSave={onSaveBrandKit} disabled={busy} />
      </div>
    </aside>
  )
}

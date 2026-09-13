// lib/funnels/sections/palettes.ts — colour derivation for the page builder.
//
// ZERO ENGINE COUPLING, ON PURPOSE. This file is imported by the document
// schema (`registry.ts`), so an import cycle here is expensive — it must
// import nothing from the rest of `lib/funnels`. Every exported function is
// pure and synchronous: same input, same output, no I/O, no clock, no
// randomness.
//
// COLOUR IS A SECURITY BOUNDARY. Every token this file produces ends up
// interpolated into a CSS custom property (`--brand: <value>`), and
// `safeStyle` in `lib/funnels/compile/sanitize.ts` does NOT reject
// `url(...)`. Hex validation — the `/^#[0-9a-f]{6}$/` shape everywhere below
// — is what stands between a model's colour choice and a CSS injection. Never
// interpolate a caller-supplied string into a token without passing it
// through `#rrggbb` validation first.
//
// THE INK-PICKING GUARANTEE. `pickInk` below chooses `#ffffff` or `#000000`
// against a background by MEASURING both, never by thresholding luminance.
// That is not just the safer style — it is provably sufficient on its own:
//
//   contrastRatio(white, bg) * contrastRatio(black, bg)
//     = [1.05 / (Lbg + 0.05)] * [(Lbg + 0.05) / 0.05]
//     = 1.05 / 0.05
//     = 21                                          (constant, for every bg)
//
// so by AM-GM, max(contrastRatio(white, bg), contrastRatio(black, bg)) is
// ALWAYS >= sqrt(21) ~= 4.583, comfortably clearing the 4.5 AA floor for
// every possible background — including the cases that break a fixed
// luminance threshold (`#ffff00` has luminance ~0.93, deep in "light"
// territory, and still needs black; `#808080` has luminance ~0.216, on the
// "dark" side of a naive 0.5 split, and ALSO needs black). `pickInk` still
// carries a background-nudging fallback per the brief's algorithm, but the
// proof above is why that branch is provably unreachable rather than a
// silent gap.

const MIN_AA = 4.5

// ---------------------------------------------------------------------------
// Hex <-> sRGB
// ---------------------------------------------------------------------------

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function assertHex(hex: string): void {
  if (!HEX_RE.test(hex)) throw new Error(`palettes: not a #rrggbb colour: ${JSON.stringify(hex)}`)
}

function hexToRgb(hex: string): [number, number, number] {
  assertHex(hex)
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (n: number) => clampByte(n).toString(16).padStart(2, "0")
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`
}

// ---------------------------------------------------------------------------
// WCAG relative luminance and contrast ratio
// ---------------------------------------------------------------------------

function linearise(channelByte: number): number {
  const c = channelByte / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a `#rrggbb` colour, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 (identical) .. 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

// ---------------------------------------------------------------------------
// Hex <-> HSL, for hue rotation only. Keeping this local rather than pulling
// in a colour library is what keeps this file import-free.
// ---------------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return [0, 0, l]
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  switch (max) {
    case rn:
      h = ((gn - bn) / delta) % 6
      break
    case gn:
      h = (bn - rn) / delta + 2
      break
    default:
      h = (rn - gn) / delta + 4
  }
  h *= 60
  if (h < 0) h += 360
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

function hueRotate(hex: string, degrees: number): string {
  const [r, g, b] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  const [nr, ng, nb] = hslToRgb((h + degrees + 360) % 360, s, l)
  return rgbToHex(nr, ng, nb)
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

// ---------------------------------------------------------------------------
// Ink picking — see the file banner for the proof of why this always clears
// AA. The nudging loop below is the brief's specified fallback; it is kept
// so the algorithm matches the spec exactly, even though the proof makes it
// dead code for any finite `#rrggbb` input.
// ---------------------------------------------------------------------------

const WHITE = "#ffffff"
const BLACK = "#000000"

function bestInk(bg: string): { ink: string; ratio: number } {
  const white = contrastRatio(WHITE, bg)
  const black = contrastRatio(BLACK, bg)
  return white >= black ? { ink: WHITE, ratio: white } : { ink: BLACK, ratio: black }
}

/**
 * Pick `#ffffff` or `#000000` for text on `bg`, by measured contrast — never
 * by a luminance threshold. Returns the possibly-nudged background alongside
 * the ink, per the brief's algorithm ("adjust the background in small steps
 * until it clears"); nudging never actually triggers (see file banner), so
 * callers that must preserve an owner-supplied colour exactly (e.g. `brand`)
 * should use `.ink` only and keep their own original background value.
 */
function pickInk(bg: string): { ink: string; bg: string } {
  let candidate = bg
  for (let step = 0; step < 40; step++) {
    const { ink, ratio } = bestInk(candidate)
    if (ratio >= MIN_AA) return { ink, bg: candidate }
    // Nudge the background a further 2% toward whichever extreme it is
    // already closer to reading against, then re-measure.
    const towards = relativeLuminance(candidate) > 0.5 ? WHITE : BLACK
    candidate = mix(candidate, towards, 0.02)
  }
  // Unreachable: contrastRatio(white, bg) * contrastRatio(black, bg) === 21
  // for every bg, so max(white, black) >= sqrt(21) ~= 4.583 always. Fail
  // loudly rather than silently ship a losing pair.
  throw new Error(`palettes: could not clear AA for background ${bg}`)
}

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export const PALETTE_PRESETS = [
  "slate",
  "midnight",
  "forest",
  "sand",
  "clay",
  "ember",
  "ocean",
  "steel",
  "bone",
  "moss",
  "plum",
  "ink",
] as const

export type PaletteName = (typeof PALETTE_PRESETS)[number]

export interface PaletteTokens {
  brand: string
  brandInk: string
  accent: string
  accentInk: string
  surface: string
  ink: string
  paper: string
}

// A fixed hue rotation used to derive an accent from a brand colour when the
// caller does not supply one. 150deg lands roughly a third of the way around
// the wheel — far enough from `brand` to read as a second colour, never its
// near-complement (180deg), which tends to look like a colour-picker mistake
// rather than a deliberate accent.
const ACCENT_HUE_ROTATION = 150

// How far `surface` starts trying to mix `paper` toward `brand`, in percent.
// `deriveSurface` backs this off toward 0 (bare `paper`) until the mix clears
// AA against `ink` — 0% always clears, because `ink` was chosen against
// `paper` itself.
const SURFACE_MAX_MIX_PERCENT = 8

function deriveSurface(paper: string, brand: string, ink: string): string {
  for (let pct = SURFACE_MAX_MIX_PERCENT; pct >= 0; pct -= 1) {
    const candidate = pct === 0 ? paper : mix(paper, brand, pct / 100)
    if (contrastRatio(ink, candidate) >= MIN_AA) return candidate
  }
  return paper
}

/**
 * Derive a full `PaletteTokens` set from a brand colour (and optionally an
 * accent and a light/dark mode). Every token is `#rrggbb`. Deterministic:
 * same input always produces the same output.
 */
export function resolvePalette(input: { brand: string; accent?: string; mode?: "light" | "dark" }): PaletteTokens {
  assertHex(input.brand)
  if (input.accent !== undefined) assertHex(input.accent)
  const mode = input.mode ?? "light"

  // Normalised to lowercase on the way in: every token this module emits is
  // documented as lowercase `#rrggbb` (see the `PALETTE_TABLE` hex-shape
  // test), and `brand`/`accent` are the only two tokens that come from the
  // caller rather than being derived — an uppercase input would otherwise be
  // the one way to violate that invariant.
  const brand = input.brand.toLowerCase()
  const brandInk = pickInk(brand).ink

  const accent = (input.accent ?? hueRotate(brand, ACCENT_HUE_ROTATION)).toLowerCase()
  const accentInk = pickInk(accent).ink

  // Light mode: paper is plain white. Dark mode: a near-black, slightly
  // cool-tinted paper (not pure #000000 — an OLED-black page reads as
  // "broken", not "dark themed"). Both are fixed constants, not derived from
  // `brand`, so `resolvePalette` never has to search for a readable page
  // background: `pickInk` against either is guaranteed to clear AA (see file
  // banner), independent of what `brand` is.
  const paper = mode === "light" ? "#ffffff" : "#0b0d10"
  const ink = pickInk(paper).ink

  const surface = deriveSurface(paper, brand, ink)

  return { brand, brandInk, accent, accentInk, surface, ink, paper }
}

// ---------------------------------------------------------------------------
// PALETTE_TABLE — twelve named presets.
//
// Each row is produced by running a hand-picked seed brand colour (and, for
// half the presets, a hand-picked dark mode) through the exact same
// `resolvePalette` derivation an owner's arbitrary brand colour goes through.
// That is deliberate, not a shortcut: `resolvePalette`'s AA guarantee is
// proven once (see the file banner) and every preset inherits it, rather
// than each of 12 rows being hand-tuned against the same four assertions
// independently. If a preset's swatch ever looks wrong, fix its SEED (the
// brand/accent/mode below), never the derivation — that would silently
// reopen the guarantee for every OTHER preset and every owner brand colour
// too.
// ---------------------------------------------------------------------------

const PALETTE_SEEDS: Record<PaletteName, { brand: string; accent?: string; mode?: "light" | "dark" }> = {
  slate: { brand: "#475569", mode: "light" },
  midnight: { brand: "#1e3a8a", mode: "dark" },
  forest: { brand: "#166534", mode: "light" },
  sand: { brand: "#b45309", mode: "light" },
  clay: { brand: "#9a3412", mode: "light" },
  ember: { brand: "#b91c1c", mode: "dark" },
  ocean: { brand: "#0e7490", mode: "light" },
  // Was "#334155" (Tailwind slate-800) — same hue family as `slate`
  // ("#475569", slate-600), just a different shade of the SAME colour. That
  // measured a CIE76 ΔE of only ~8.6 against `slate`, well inside "secretly
  // the same colour" territory — exactly the bug this palette module exists
  // to prevent. Moved to a genuinely different hue (a dark teal) rather than
  // lowering the distinctness threshold to fit the old value.
  steel: { brand: "#0f5257", mode: "dark" },
  bone: { brand: "#78716c", mode: "light" },
  moss: { brand: "#4d7c0f", mode: "light" },
  plum: { brand: "#6d28d9", mode: "dark" },
  ink: { brand: "#111827", mode: "dark" },
}

export const PALETTE_TABLE: Record<PaletteName, PaletteTokens> = Object.fromEntries(
  PALETTE_PRESETS.map((name) => [name, resolvePalette(PALETTE_SEEDS[name])]),
) as Record<PaletteName, PaletteTokens>

// render-worker/src/lib/color.ts
// Convert an oklch(L C H) string to an sRGB hex. Captions are encoded to
// H.264/yuv420p, so we bake a plain hex rather than relying on the renderer's
// Chromium build supporting oklch. Falls back to the brand accent on parse fail.

const BRAND_ACCENT_HEX = "#C49B7A"

export function oklchToHex(oklch: string): string {
  const m = oklch.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/i)
  if (!m) return BRAND_ACCENT_HEX

  const L = parseFloat(m[1])
  const C = parseFloat(m[2])
  const hDeg = parseFloat(m[3])
  if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(hDeg)) return BRAND_ACCENT_HEX

  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  // OKLab -> linear sRGB (Björn Ottosson's matrices)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const mm = m_ ** 3
  const s = s_ ** 3

  const lr = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s

  const toSrgb = (c: number) => {
    const x = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(x * 255)))
  }
  const hex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${hex(toSrgb(lr))}${hex(toSrgb(lg))}${hex(toSrgb(lb))}`
}

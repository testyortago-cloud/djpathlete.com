// Burn numbered markers and captions INTO a screenshot.
//
// WHY THIS EXISTS. The house rule is that a `.png` must explain itself on its
// own: if you open the file, the callouts are there. Wrapping a clean capture
// in an HTML page that draws the arrows around it does not satisfy that — the
// annotations live in the wrapper, and the image is still bare.
//
// WHY IT COMPOSITES RATHER THAN RE-RENDERS. Everything here is drawn at the
// capture's own pixel dimensions, read back off the file with sharp's metadata
// rather than assumed from the viewport. A capture taken at deviceScaleFactor 2
// is 2x the CSS viewport, and laying out an overlay against the CSS number
// would put every marker in the wrong place at half scale. Nothing is ever
// resized, so the screenshot cannot be upscaled by this step.

import sharp from "sharp"

/** XML-escape text bound for an SVG text node. */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/**
 * Greedy wrap by character budget. Deliberately not a text-metrics measurement:
 * the caption band is a fixed width and the font is fixed, so a character
 * budget is accurate enough and keeps this dependency-free.
 */
function wrap(text, perLine) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ""
  for (const w of words) {
    if (line && (line + " " + w).length > perLine) {
      lines.push(line)
      line = w
    } else {
      line = line ? line + " " + w : w
    }
  }
  if (line) lines.push(line)
  return lines
}

const INK = "#0E3F50" // primary
const ACCENT = "#C8763C" // accent, for the marker discs
const PAPER = "#FFFFFF"

/**
 * @param {string} src         path to the raw capture
 * @param {string} out         path to write the annotated png
 * @param {object} opts
 * @param {string} opts.title  headline burned into the caption band
 * @param {string} [opts.subtitle]
 * @param {Array<{x:number,y:number,caption:string}>} [opts.markers]
 *        Coordinates are in the SOURCE IMAGE's pixel space. Pass
 *        boundingBox() values multiplied by the deviceScaleFactor used for
 *        the capture — see captureAnnotated() in the capture script, which
 *        does that for you.
 * @param {number} [opts.scale]
 *        Overrides the type/marker scale, which otherwise assumes the capture
 *        was authored at 1440 CSS px wide. A PHONE capture breaks that
 *        assumption: 414 CSS px at deviceScaleFactor 3 is a 1242px-wide image
 *        of a small screen, and deriving the scale from the width alone would
 *        draw 15px captions and 16px marker discs over UI rendered at 3x —
 *        legible only if you zoom in, which is exactly what a burned-in
 *        annotation exists to avoid. Pass the scale that matches the CAPTURE's
 *        own device pixel ratio instead. Nothing is ever resized either way,
 *        so this cannot upscale the screenshot.
 */
export async function annotate(src, out, opts) {
  const { title, subtitle = "", markers = [], scale: scaleOverride } = opts
  const meta = await sharp(src).metadata()
  const W = meta.width
  const H = meta.height
  if (!W || !H) throw new Error(`could not read dimensions of ${src}`)

  // The band is sized from the real wrapped caption text, so a long caption
  // grows the band instead of overflowing it.
  const scale = scaleOverride ?? W / 1440 // captures are authored at 1440 CSS px wide
  const pad = Math.round(28 * scale)
  const titleSize = Math.round(30 * scale)
  const subSize = Math.round(19 * scale)
  const capSize = Math.round(18 * scale)
  const lineH = Math.round(capSize * 1.5)
  const perLine = Math.floor(W / (capSize * 0.56))

  const capLines = []
  markers.forEach((m, i) => {
    const wrapped = wrap(m.caption, perLine - 5)
    wrapped.forEach((l, j) => capLines.push({ n: j === 0 ? i + 1 : null, text: l }))
  })

  const bandH =
    pad +
    titleSize +
    (subtitle ? Math.round(subSize * 1.6) : 0) +
    Math.round(12 * scale) +
    capLines.length * lineH +
    pad

  const discR = Math.round(19 * scale)

  const svg = `<svg width="${W}" height="${H + bandH}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .t { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .title { font-size: ${titleSize}px; font-weight: 700; fill: ${INK}; }
    .sub { font-size: ${subSize}px; fill: #5b6b73; }
    .cap { font-size: ${capSize}px; fill: #223b44; }
    .num { font-size: ${capSize}px; font-weight: 700; fill: ${ACCENT}; }
    .disc { fill: ${ACCENT}; }
    .discTxt { font-size: ${Math.round(discR * 1.05)}px; font-weight: 700; fill: ${PAPER};
               text-anchor: middle; dominant-baseline: central; }
  </style>
  <rect x="0" y="${H}" width="${W}" height="${bandH}" fill="${PAPER}"/>
  <rect x="0" y="${H}" width="${W}" height="${Math.max(2, Math.round(3 * scale))}" fill="${ACCENT}"/>
  <text class="t title" x="${pad}" y="${H + pad + titleSize * 0.82}">${esc(title)}</text>
  ${subtitle ? `<text class="t sub" x="${pad}" y="${H + pad + titleSize + subSize * 0.9}">${esc(subtitle)}</text>` : ""}
  ${capLines
    .map((l, i) => {
      const y =
        H +
        pad +
        titleSize +
        (subtitle ? Math.round(subSize * 1.6) : 0) +
        Math.round(12 * scale) +
        (i + 1) * lineH -
        Math.round(lineH * 0.28)
      return `${l.n ? `<text class="t num" x="${pad}" y="${y}">${l.n}.</text>` : ""}
      <text class="t cap" x="${pad + Math.round(30 * scale)}" y="${y}">${esc(l.text)}</text>`
    })
    .join("\n  ")}
  ${markers
    .map((m, i) => {
      const cx = Math.round(Math.min(Math.max(m.x, discR + 2), W - discR - 2))
      const cy = Math.round(Math.min(Math.max(m.y, discR + 2), H - discR - 2))
      return `<circle class="disc" cx="${cx}" cy="${cy}" r="${discR}"/>
      <circle cx="${cx}" cy="${cy}" r="${discR}" fill="none" stroke="${PAPER}" stroke-width="${Math.max(2, Math.round(3 * scale))}"/>
      <text class="t discTxt" x="${cx}" y="${cy}">${i + 1}</text>`
    })
    .join("\n  ")}
</svg>`

  await sharp({
    create: { width: W, height: H + bandH, channels: 4, background: PAPER },
  })
    .composite([
      { input: await sharp(src).toBuffer(), top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .png()
    .toFile(out)

  return { width: W, height: H + bandH }
}

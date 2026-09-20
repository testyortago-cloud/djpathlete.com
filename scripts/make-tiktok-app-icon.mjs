// scripts/make-tiktok-app-icon.mjs
//
//   node scripts/make-tiktok-app-icon.mjs
//
// Builds the 1024x1024 app icon TikTok's App details form requires, from the
// brand mark in public/brand/dj-logo.png.
//
// Two traps in that source, both already paid for:
//  - it carries a 1px FRAME at inset 20, at full alpha. sharp's .trim() and any
//    naive alpha bounding box therefore return the whole 2040 canvas, and the
//    mark ends up tiny and off-centre. Crop inside the frame first.
//  - the mark is WHITE on transparency, so it is invisible on a white page.
//    It has to be composed on the brand colour, not just resized.
//
// The mark is 727x547 in the source and lands ~660px wide here, so it is
// DOWNscaled -- never enlarged.
import sharp from "sharp"
import fs from "node:fs"
import path from "node:path"

const SRC = "public/brand/dj-logo.png"
const OUT = "deliverables/tiktok-app-review/tiktok-app-icon-1024.png"
const BG = "#13323c" // brand primary, oklch(0.30 0.04 220)
const TILE = 1024
const MARK_WIDTH = 660 // ~64% of the tile, leaving TikTok's rounding room

const FRAME_INSET = 30 // clears the 1px frame at inset 20

async function markBounds() {
  const size = (await sharp(SRC).metadata()).width
  const inner = sharp(SRC).extract({
    left: FRAME_INSET,
    top: FRAME_INSET,
    width: size - 2 * FRAME_INSET,
    height: size - 2 * FRAME_INSET,
  })
  const { data, info } = await inner.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width,
    minY = info.height,
    maxX = -1,
    maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 128) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return {
    left: minX + FRAME_INSET,
    top: minY + FRAME_INSET,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

const box = await markBounds()
console.log("mark bounds in source:", `${box.width}x${box.height} at ${box.left},${box.top}`)
if (box.width < MARK_WIDTH) throw new Error("source mark is smaller than the target -- refusing to upscale")

fs.mkdirSync(path.dirname(OUT), { recursive: true })
const mark = await sharp(SRC).extract(box).resize({ width: MARK_WIDTH }).toBuffer()
const m = await sharp(mark).metadata()

await sharp({ create: { width: TILE, height: TILE, channels: 4, background: BG } })
  .composite([{ input: mark, left: Math.round((TILE - m.width) / 2), top: Math.round((TILE - m.height) / 2) }])
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(OUT)

const out = await sharp(OUT).metadata()
console.log(
  "written:",
  OUT,
  `${out.width}x${out.height}`,
  out.format,
  out.hasAlpha ? "alpha" : "opaque",
  `${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`,
)
if (out.width !== TILE || out.height !== TILE) throw new Error("not 1024x1024")

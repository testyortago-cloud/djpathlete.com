// lib/content-studio/quote-card-renderer.tsx
// Renders a single quote string into a 1080×1080 PNG buffer using Satori
// (via @vercel/og). Server-side only — pulled in by the admin quote-cards
// route. PNG output works for Facebook + LinkedIn carousels; Instagram
// requires JPEG via renderQuoteCardJpeg (which pipes through sharp).
//
// Uses JSX rather than plain-object Satori children so strict TypeScript
// (Vercel build) is happy with the `ReactElement` shape ImageResponse
// expects — plain objects don't carry the implicit `key` field.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ImageResponse } from "@vercel/og"
import sharp from "sharp"

const CANVAS_SIZE = 1080
const PRIMARY = "#0e3f50" // Green Azure approximation of oklch(0.30 0.04 220)
const ACCENT = "#c49b7a" // Gray Orange approximation of oklch(0.70 0.08 60)
const TEXT_ON_PRIMARY = "#f5f2ef"

// Load the brand heading font once at module load. TTF bundled in the repo so
// there's no network dependency at render time. Satori is strict: it needs
// TTF/OTF/WOFF buffers, not WOFF2. If the file is missing for any reason the
// renderer falls back to Satori's default sans-serif — cards still render.
let brandFont: Buffer | null = null
try {
  brandFont = readFileSync(
    join(process.cwd(), "lib/content-studio/fonts/LexendExa-SemiBold.ttf"),
  )
} catch {
  brandFont = null
}

function fontSizeForLength(length: number): number {
  if (length <= 80) return 84
  if (length <= 120) return 64
  return 48
}

export async function renderQuoteCard(text: string): Promise<Buffer> {
  const safe = (text ?? "").trim() || "—"
  const fontSize = fontSizeForLength(safe.length)

  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: PRIMARY,
          padding: 96,
          fontFamily: "Lexend Exa",
        }}
      >
        <div
          style={{
            display: "flex",
            color: TEXT_ON_PRIMARY,
            fontSize,
            fontWeight: 600,
            lineHeight: 1.2,
            textAlign: "center",
            maxWidth: "100%",
          }}
        >
          {safe}
        </div>
        <div
          style={{
            marginTop: 64,
            color: ACCENT,
            fontSize: 28,
            letterSpacing: 2,
            textTransform: "uppercase",
            display: "flex",
          }}
        >
          — Darren J Paul
        </div>
      </div>
    ),
    {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      fonts: brandFont
        ? [
            {
              name: "Lexend Exa",
              data: brandFont,
              weight: 600,
              style: "normal",
            },
          ]
        : undefined,
    },
  )

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Same layout as renderQuoteCard but emits JPEG. Required for Instagram
 * carousels, which reject PNG children via error 2207026. Runs the PNG
 * through sharp for conversion — sharp is transitively available via
 * @huggingface/transformers and is the standard server-side image encoder.
 */
export async function renderQuoteCardJpeg(text: string): Promise<Buffer> {
  const png = await renderQuoteCard(text)
  return await sharp(png)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

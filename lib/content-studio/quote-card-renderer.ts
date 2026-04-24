// lib/content-studio/quote-card-renderer.ts
// Renders a single quote string into a 1080×1080 PNG buffer using Satori
// (via @vercel/og). Server-side only — pulled in by the admin quote-cards
// route. PNG output works for Facebook carousels; Instagram requires JPEG
// which would need a separate conversion step (deferred to Phase 2f.b).

import { ImageResponse } from "@vercel/og"
import sharp from "sharp"

const CANVAS_SIZE = 1080
const PRIMARY = "#0e3f50" // Green Azure approximation of oklch(0.30 0.04 220)
const ACCENT = "#c49b7a" // Gray Orange approximation of oklch(0.70 0.08 60)
const TEXT_ON_PRIMARY = "#f5f2ef"

function fontSizeForLength(length: number): number {
  if (length <= 80) return 84
  if (length <= 120) return 64
  return 48
}

export async function renderQuoteCard(text: string): Promise<Buffer> {
  const safe = (text ?? "").trim() || "—"
  const fontSize = fontSizeForLength(safe.length)

  const response = new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: PRIMARY,
          padding: 96,
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                color: TEXT_ON_PRIMARY,
                fontSize,
                fontWeight: 600,
                lineHeight: 1.2,
                textAlign: "center",
                maxWidth: "100%",
              },
              children: safe,
            },
          },
          {
            type: "div",
            props: {
              style: {
                marginTop: 64,
                color: ACCENT,
                fontSize: 28,
                letterSpacing: 2,
                textTransform: "uppercase",
                display: "flex",
              },
              children: "— Darren J Paul",
            },
          },
        ],
      },
    },
    { width: CANVAS_SIZE, height: CANVAS_SIZE },
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

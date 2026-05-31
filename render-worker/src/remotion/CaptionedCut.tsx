// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill, OffthreadVideo } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"

// A `type` (not `interface`) so it satisfies Remotion's
// `Props extends Record<string, unknown>` constraint on <Composition>.
export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
}

export function CaptionedCut({ videoSrc, pages, accentHex }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* object-fit: cover — fill 1080x1920, center-crop the overflow */}
      <OffthreadVideo src={videoSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
    </AbsoluteFill>
  )
}

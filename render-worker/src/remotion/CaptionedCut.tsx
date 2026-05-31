// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { SourceLayer } from "./SourceLayer.js"
import { ProgressBar } from "./ProgressBar.js"
import { BrandBug } from "./BrandBug.js"

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
      <SourceLayer videoSrc={videoSrc} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      <ProgressBar accentHex={accentHex} />
      <BrandBug accentHex={accentHex} />
    </AbsoluteFill>
  )
}

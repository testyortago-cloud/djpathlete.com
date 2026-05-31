// render-worker/src/remotion/CaptionedCut.tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { SourceLayer } from "./SourceLayer.js"
import { ProgressBar } from "./ProgressBar.js"
import { BrandBug } from "./BrandBug.js"
import { HookCard } from "./HookCard.js"
import { AudioLayer } from "./AudioLayer.js"
import { AccentGraphics } from "./AccentGraphics.js"

// A `type` (not `interface`) so it satisfies Remotion's
// `Props extends Record<string, unknown>` constraint on <Composition>.
export type CaptionedCutProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
  hook?: { text: string }
  music?: { track: string }
}

export function CaptionedCut({ videoSrc, pages, accentHex, hook, music }: CaptionedCutProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AudioLayer pages={pages} music={music} hasHook={Boolean(hook?.text)} />
      <SourceLayer videoSrc={videoSrc} />
      <AccentGraphics accentHex={accentHex} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      {hook?.text ? <HookCard text={hook.text} accentHex={accentHex} /> : null}
      <ProgressBar accentHex={accentHex} />
      <BrandBug />
    </AbsoluteFill>
  )
}

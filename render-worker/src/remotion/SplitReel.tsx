// render-worker/src/remotion/SplitReel.tsx
import { AbsoluteFill } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"
import type { FacePoint } from "../lib/face-track.js"
import { TrackedVideo } from "./TrackedVideo.js"
import { BrollRow, type BrollClip } from "./BrollRow.js"
import { CaptionLayer } from "./CaptionLayer.js"
import { ProgressBar } from "./ProgressBar.js"
import { BrandBug } from "./BrandBug.js"
import { HookCard } from "./HookCard.js"
import { AudioLayer } from "./AudioLayer.js"
import { AccentGraphics } from "./AccentGraphics.js"

// A `type` (not `interface`) to satisfy Remotion's Props constraint on <Composition>.
export type SplitReelProps = {
  videoSrc: string
  pages: CaptionPage[]
  accentHex: string
  trajectory: FacePoint[]
  broll: BrollClip[]
  hook?: { text: string }
  music?: { track: string }
}

export function SplitReel({
  videoSrc,
  pages,
  accentHex,
  trajectory,
  broll,
  hook,
  music,
}: SplitReelProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AudioLayer pages={pages} music={music} hasHook={Boolean(hook?.text)} />
      <TrackedVideo videoSrc={videoSrc} trajectory={trajectory} />
      <BrollRow clips={broll} />
      <AccentGraphics accentHex={accentHex} />
      <CaptionLayer pages={pages} accentHex={accentHex} />
      {hook?.text ? <HookCard text={hook.text} accentHex={accentHex} /> : null}
      <ProgressBar accentHex={accentHex} />
      <BrandBug />
    </AbsoluteFill>
  )
}

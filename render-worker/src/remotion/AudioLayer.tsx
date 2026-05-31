// render-worker/src/remotion/AudioLayer.tsx
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion"
import type { CaptionPage } from "../lib/caption-paging.js"

export type AudioLayerProps = {
  pages: CaptionPage[]
  music?: { track: string }
  hasHook: boolean
}

// Low bed so the coaching voice stays primary; SFX accent, not dominate.
const MUSIC_VOLUME = 0.14
const POP_VOLUME = 0.45
const WHOOSH_VOLUME = 0.6

export function AudioLayer({ pages, music, hasHook }: AudioLayerProps) {
  const { fps } = useVideoConfig()
  const popFrames = Math.max(1, Math.round(0.27 * fps)) // window long enough to hold the ~90ms pop
  return (
    <>
      {music?.track ? <Audio src={staticFile(`music/${music.track}`)} volume={MUSIC_VOLUME} loop /> : null}
      {hasHook ? (
        <Sequence from={0} durationInFrames={Math.round(0.5 * fps)} name="whoosh">
          <Audio src={staticFile("sfx/whoosh.mp3")} volume={WHOOSH_VOLUME} />
        </Sequence>
      ) : null}
      {pages.map((p, i) => (
        <Sequence key={i} from={Math.round((p.startMs / 1000) * fps)} durationInFrames={popFrames} name={`pop-${i}`}>
          <Audio src={staticFile("sfx/pop.mp3")} volume={POP_VOLUME} />
        </Sequence>
      ))}
    </>
  )
}

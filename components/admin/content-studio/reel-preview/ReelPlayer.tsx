"use client"

// Reusable @remotion/player wrapper that previews the SAME composition the
// render worker renders (twin-copied under ./remotion). Load this via
// `dynamic(() => import(...), { ssr: false })` — the compositions call
// loadFont()/delayRender at module scope and use browser video APIs, so the
// subtree must be client-only. durationInFrames should mirror the worker:
// Math.ceil(durationMs / 1000 * 30).
import { Player } from "@remotion/player"
import { SplitReel, type SplitReelProps } from "./remotion/SplitReel"
import { CaptionedCut, type CaptionedCutProps } from "./remotion/CaptionedCut"

export const REEL_FPS = 30
export const REEL_WIDTH = 1080
export const REEL_HEIGHT = 1920

type ReelPlayerProps =
  | { mode: "split_reel"; inputProps: SplitReelProps; durationInFrames: number; initialFrame?: number; className?: string }
  | { mode: "captioned_cut"; inputProps: CaptionedCutProps; durationInFrames: number; initialFrame?: number; className?: string }

export function ReelPlayer(props: ReelPlayerProps) {
  const common = {
    durationInFrames: Math.max(1, Math.round(props.durationInFrames)),
    fps: REEL_FPS,
    compositionWidth: REEL_WIDTH,
    compositionHeight: REEL_HEIGHT,
    controls: true,
    loop: true,
    ...(props.initialFrame !== undefined ? { initialFrame: props.initialFrame } : {}),
    style: { width: "100%", height: "100%" },
  } as const

  if (props.mode === "split_reel") {
    return <Player component={SplitReel} inputProps={props.inputProps} {...common} />
  }
  return <Player component={CaptionedCut} inputProps={props.inputProps} {...common} />
}

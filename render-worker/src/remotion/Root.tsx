// render-worker/src/remotion/Root.tsx
import { Composition } from "remotion"
import { CaptionedCut, type CaptionedCutProps } from "./CaptionedCut.js"
import { SplitReel, type SplitReelProps } from "./SplitReel.js"
import {
  AiBookkeeperPromo,
  type AiBookkeeperPromoProps,
} from "./promo/AiBookkeeperPromo.js"
import {
  FPS as PROMO_FPS,
  HEIGHT as PROMO_HEIGHT,
  TOTAL_FRAMES as PROMO_FRAMES,
  WIDTH as PROMO_WIDTH,
} from "./promo/theme.js"

const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920

// Marketing promo for the AI Bookkeeper proposal — rendered locally, never
// invoked by the Cloud Run job (which renders by composition id).
// Silent by request: set musicTrack to a filename under public/music to score it.
const PROMO_SAMPLE: AiBookkeeperPromoProps = {
  musicTrack: "",
}

const SAMPLE: CaptionedCutProps = {
  videoSrc:
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  pages: [
    {
      text: "let's get",
      words: [
        { text: "let's", startMs: 0, endMs: 400, emphasis: false },
        { text: "get", startMs: 400, endMs: 800, emphasis: false },
      ],
      startMs: 0,
      endMs: 800,
    },
  ],
  accentHex: "#C49B7A",
}

// 10s sample: full-frame face-tracked head 0-3s, FULL-SCREEN b-roll cutaway
// (head hidden, voice continues) 3-6s, full-frame head 6-10s; lower-third
// captions throughout. The broll window (3000-6000) marks the cutaway. A moving
// face trajectory keeps the tracking crop visibly doing something in Studio.
const SPLIT_SAMPLE: SplitReelProps = {
  videoSrc:
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  pages: [
    {
      text: "watch this",
      words: [
        { text: "watch", startMs: 0, endMs: 500, emphasis: false },
        { text: "this", startMs: 500, endMs: 1000, emphasis: true },
      ],
      startMs: 0,
      endMs: 1000,
    },
    {
      text: "right here",
      words: [
        { text: "right", startMs: 3200, endMs: 3700, emphasis: false },
        { text: "here", startMs: 3700, endMs: 4200, emphasis: false },
      ],
      startMs: 3200,
      endMs: 4200,
    },
  ],
  accentHex: "#C49B7A",
  trajectory: [
    { ms: 0, cx: 0.35, cy: 0.4, size: 0.32 },
    { ms: 2500, cx: 0.55, cy: 0.45, size: 0.34 },
    { ms: 5000, cx: 0.65, cy: 0.4, size: 0.3 },
    { ms: 10000, cx: 0.45, cy: 0.42, size: 0.33 },
  ],
  broll: [
    {
      startMs: 3000,
      endMs: 6000,
      src: "https://mdn.github.io/learning-area/html/multimedia-and-embedding/video-and-audio-content/rabbit320.mp4",
    },
  ],
}

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="CaptionedCut"
        component={CaptionedCut}
        durationInFrames={FPS * 10}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={SAMPLE}
      />
      <Composition
        id="SplitReel"
        component={SplitReel}
        durationInFrames={FPS * 10}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={SPLIT_SAMPLE}
      />
      <Composition
        id="AiBookkeeperPromo"
        component={AiBookkeeperPromo}
        durationInFrames={PROMO_FRAMES}
        fps={PROMO_FPS}
        width={PROMO_WIDTH}
        height={PROMO_HEIGHT}
        defaultProps={PROMO_SAMPLE}
      />
    </>
  )
}

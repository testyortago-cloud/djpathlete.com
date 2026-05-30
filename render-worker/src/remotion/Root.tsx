// render-worker/src/remotion/Root.tsx
import { Composition } from "remotion"
import { CaptionedCut, type CaptionedCutProps } from "./CaptionedCut.js"

const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920

const SAMPLE: CaptionedCutProps = {
  videoSrc:
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  pages: [
    {
      text: "let's get",
      words: [
        { text: "let's", startMs: 0, endMs: 400 },
        { text: "get", startMs: 400, endMs: 800 },
      ],
      startMs: 0,
      endMs: 800,
    },
  ],
  accentHex: "#C49B7A",
}

// Remotion 4.x Composition<Schema, Props> requires both type params to infer
// correctly; casting component to any is the minimal workaround.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnyComp = CaptionedCut as any

export function RemotionRoot() {
  return (
    <Composition
      id="CaptionedCut"
      component={AnyComp}
      durationInFrames={FPS * 10}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={SAMPLE}
    />
  )
}

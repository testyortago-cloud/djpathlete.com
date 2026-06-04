// render-worker/src/lib/detect-face.ts
// Given a local MP4, sample frames with a static ffmpeg binary, run BlazeFace
// (via @vladmandic/human on the tfjs WASM backend), and return a normalized
// FacePoint[] trajectory (one point per sampled frame that has a face). Models
// and wasm are baked into the image (see Dockerfile); nothing is downloaded.
import type { Config, Human } from "@vladmandic/human"
// The default @vladmandic/human Node build (dist/human.node.js) hard-requires the
// native @tensorflow/tfjs-node at load — which this image does NOT install (it
// ships the WASM tfjs backend instead; see the Dockerfile's baked wasm + models).
// The node-wasm build runs on the external @tensorflow/tfjs + tfjs-backend-wasm
// that ARE installed/baked. No types ship for this subpath — see the .d.ts shim.
import HumanWasmModule from "@vladmandic/human/dist/human.node-wasm.js"
import * as tf from "@tensorflow/tfjs"
import "@tensorflow/tfjs-backend-wasm"
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm"

// node-wasm default-exports the Human class (CJS/ESM interop may wrap it in .default).
const HumanCtor = ((HumanWasmModule as { default?: unknown }).default ?? HumanWasmModule) as new (
  config: Partial<Config>,
) => Human
import jpeg from "jpeg-js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import ffmpegPath from "ffmpeg-static"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { normalizeFaceBox } from "./face-box.js"
import type { FacePoint } from "./face-track.js"

const execFileP = promisify(execFile)

let human: Human | null = null

async function getHuman(): Promise<Human> {
  if (human) return human
  setWasmPaths(path.join(process.cwd(), "wasm") + "/")
  const config: Partial<Config> = {
    backend: "wasm",
    modelBasePath: "file://" + path.join(process.cwd(), "models") + "/",
    face: {
      enabled: true,
      detector: { enabled: true, rotation: false },
      mesh: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    gesture: { enabled: false },
    filter: { enabled: false },
  }
  const h = new HumanCtor(config)
  await tf.setBackend("wasm")
  await tf.ready()
  await h.load()
  human = h
  return h
}

export async function detectFaceTrajectory(
  localPath: string,
  opts: { sampleEveryMs?: number } = {},
): Promise<FacePoint[]> {
  const sampleEveryMs = opts.sampleEveryMs ?? 200
  const h = await getHuman()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "facedet-"))
  try {
    const fps = (1000 / sampleEveryMs).toString()
    if (!ffmpegPath) throw new Error("ffmpeg-static binary not found")
    await execFileP(ffmpegPath, [
      "-i", localPath, "-vf", `fps=${fps}`, "-q:v", "3",
      path.join(dir, "f-%05d.jpg"),
    ])
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort()
    const points: FacePoint[] = []
    for (let i = 0; i < files.length; i += 1) {
      const raw = fs.readFileSync(path.join(dir, files[i]))
      const img = jpeg.decode(raw, { useTArray: true })
      const rgb = tf.tidy(() =>
        tf.tensor3d(img.data, [img.height, img.width, 4], "int32").slice([0, 0, 0], [img.height, img.width, 3]),
      )
      const res = await h.detect(rgb)
      rgb.dispose()
      const face = res.face?.[0]
      if (face?.box) {
        const [x, y, w, hgt] = face.box as [number, number, number, number]
        points.push(normalizeFaceBox([x, y, w, hgt], img.width, img.height, i * sampleEveryMs))
      }
      // no face → skip; smoothTrajectory/faceAtMs interpolate over the gap
    }
    return points
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

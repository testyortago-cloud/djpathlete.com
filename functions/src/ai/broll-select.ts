// functions/src/ai/broll-select.ts
import { z } from "zod"
import { callAgent, MODEL_SONNET } from "./anthropic.js"

const segmentSchema = z.object({
  segments: z.array(
    z.object({
      start_ms: z.number(),
      end_ms: z.number(),
      concept: z.string(),
      visual_prompt: z.string(),
    }),
  ),
})
export type SelectedSegments = z.infer<typeof segmentSchema>

export type TranscriptWord = { text: string; start: number; end: number }

// Build a compact "[ms] word" stream so the model can anchor windows to real times.
function transcriptWithTimings(words: TranscriptWord[]): string {
  return words.map((w) => `[${w.start}] ${w.text}`).join(" ")
}

export async function selectBrollMoments(opts: {
  words: TranscriptWord[]
  windowSeconds: number
  maxWindows: number
}): Promise<SelectedSegments> {
  const system = [
    "You pick moments in a talking-head video that would genuinely benefit from a short b-roll cutaway,",
    "and you write a vivid text-to-video prompt for each. Choose ONLY concrete, visualizable moments",
    "(named objects, places, actions, vivid metaphors). SKIP abstract filler, greetings, and transitions.",
    `Return at most ${opts.maxWindows} windows. Each window must be about ${opts.windowSeconds} seconds long`,
    "(end_ms ≈ start_ms + window length), non-overlapping, spaced apart. start_ms/end_ms are milliseconds",
    "and must fall within the transcript's timestamps. visual_prompt: one concrete sentence describing the",
    "b-roll footage (no text overlays, no talking people, vertical 9:16, brand-neutral, cinematic).",
    "concept: 2-4 words naming what it depicts.",
  ].join(" ")

  const user = `Transcript (each token prefixed with its start time in ms):\n\n${transcriptWithTimings(opts.words)}`

  const res = await callAgent(system, user, segmentSchema, { model: MODEL_SONNET, cacheSystemPrompt: true })
  return res.content
}

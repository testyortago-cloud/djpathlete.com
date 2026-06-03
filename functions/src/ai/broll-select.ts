// functions/src/ai/broll-select.ts
import { z } from "zod"
import { callAgent, MODEL_OPUS_4_8 } from "./anthropic.js"

const segmentSchema = z.object({
  segments: z
    .array(
      z.object({
        start_ms: z
          .number()
          .describe("Cutaway start, in milliseconds. Must land on a real transcript timestamp, on the word the visual illustrates."),
        end_ms: z
          .number()
          .describe("Cutaway end, in milliseconds. Must be greater than start_ms, ≈ start_ms + the window length, and within the transcript."),
        concept: z
          .string()
          .describe("2-4 word label for what the clip shows (e.g. 'Pre-dawn sprint'). Used only as a UI tag, not as the generation prompt."),
        visual_prompt: z
          .string()
          .describe(
            "A production-ready text-to-video prompt: one moving subject + setting + one deliberate camera move + lighting/mood, framed vertical 9:16, cinematic and brand-neutral. No on-screen text, logos, or person talking to camera.",
          ),
      }),
    )
    .describe("Chosen b-roll windows, ordered by start_ms, non-overlapping, spread across the video. Return fewer than the cap if only fewer moments truly earn a cutaway."),
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
  const windowMs = Math.round(opts.windowSeconds * 1000)
  const totalMs = opts.words.length > 0 ? opts.words[opts.words.length - 1].end : 0

  // The "professional b-roll editor" behaviour lives entirely in this prompt:
  // a clear role, a selection rubric (when a cutaway earns its place), and a
  // text-to-video writing formula tuned for motion models. Schema field
  // descriptions (above) reinforce the per-field contract at fill time.
  const system = `You are a senior b-roll editor and text-to-video prompt writer for short-form vertical (9:16) social video. You receive the transcript of a talking-head clip, each word tagged with its start time in milliseconds. Your job has two parts: choose the handful of moments where a brief b-roll cutaway would strengthen the message, and for each write a prompt an AI video model can render into great footage.

SELECT a moment only when:
- The speaker says something concrete and visualizable — a named object, place, action, a number you can make tangible, or a vivid metaphor — AND
- A cutaway there would reinforce the words, not distract from them.
Skip greetings, sign-offs, abstract claims, opinions, and connective filler. When unsure, stay on the talking head. A few strong cutaways beat many weak ones — it is correct to return well under the cap. Place each cut on the exact word it illustrates.

WRITE each visual_prompt as 1-2 vivid sentences a motion model can render. Build it in this order:
1. Subject + action — one clear subject, described MOVING. These are video models; a static description yields a lifeless clip, so always give it motion.
2. Setting — where it happens.
3. Camera — one deliberate move (slow push-in, handheld follow, low-angle dolly, top-down, orbit) or a locked static shot. Pick one; don't stack moves.
4. Look — lighting and mood (golden-hour backlight, soft overcast, moody low-key) and optionally a lens feel (shallow depth of field, macro).
Keep it cinematic, brand-neutral, and framed for vertical 9:16.

NEVER put in a prompt: on-screen text or captions, watermarks, logos, recognizable brands, or a person talking to camera (it clashes with the host). Describe live motion, never a still photo.

Example — transcript reads "...the work starts before sunrise, before anyone's watching...":
- concept: "Pre-dawn sprint"
- visual_prompt: "A lone athlete sprints up an empty stadium staircase in cold blue pre-dawn light, breath fogging with each stride; low-angle shot with a slow handheld push-in, moody and cinematic with shallow depth of field, vertical 9:16."

TIMING (hard rules):
- Return at most ${opts.maxWindows} windows; return fewer if only fewer earn it.
- Each window is about ${opts.windowSeconds}s long: end_ms ≈ start_ms + ${windowMs}.
- Windows must not overlap and should be spread across the clip with clear gaps between them.
- start_ms and end_ms are integers in milliseconds and must fall within the transcript range (0 to ~${totalMs}ms).
- concept is a 2-4 word label; visual_prompt is the footage description.`

  const user = `Transcript spans 0 to ~${totalMs}ms. Each token below is prefixed with its start time in ms:\n\n${transcriptWithTimings(opts.words)}`

  const res = await callAgent(system, user, segmentSchema, { model: MODEL_OPUS_4_8, cacheSystemPrompt: true })
  return res.content
}

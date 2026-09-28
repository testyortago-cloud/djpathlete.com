import { getOpenRouterClient, isOpenRouterConfigured, toOpenRouterModel } from "@/lib/ai/openrouter"

/**
 * Reading a PDF that has no text layer — a scan, or pages saved from
 * screenshots — with GPT-6 Astra.
 *
 * `pdf-parse` only reads the text layer. On an image-only PDF it returns a
 * couple of newlines, which the blog generator's upload list showed as
 * "0.0KB" and then quietly sent to the model as an empty example.
 *
 * MEASURED 2026-09-29 against the live key, one image-only A4 page: Astra
 * transcribed it word for word in 5.5s, 4,241 prompt tokens, $0.057. It goes
 * through OpenRouter's `file` content part, which OpenAI reads natively — no
 * OCR plugin. The cost is why this runs ONLY when the text layer is empty.
 */

export const DOCUMENT_READER_MODEL = "gpt-6-astra"

// Enough for MAX_REFERENCE_FILE_CHARS (50k characters is ~12.5k tokens) with
// headroom; the caller cuts the text to its own limit anyway.
const MAX_OUTPUT_TOKENS = 16_000

const SYSTEM_PROMPT = `You transcribe documents. Output the document's text exactly as written, in reading order.
- Keep headings, paragraphs and list items on their own lines.
- Do not summarise, translate, correct or comment. Do not add anything that is not on the page.
- Skip page numbers, running headers and footers.
- If a page has no readable text, output nothing for it.
Output only the transcribed text.`

// Below this many non-space characters per page, the text layer is taken to be
// missing (a scan, or screenshots saved as PDF) rather than the document being
// short. A real page of prose carries well over a thousand; a scan that picked
// up only a header or a page number carries a few dozen.
const MIN_TEXT_CHARS_PER_PAGE = 200

/** True when a PDF's text layer is too thin to be the document's real text. */
export function looksImageOnly(text: string, pages: number): boolean {
  const chars = text.replace(/\s+/g, "").length
  return chars < MIN_TEXT_CHARS_PER_PAGE * Math.max(1, pages)
}

export interface ReadDocumentResult {
  text: string
  /** True when the model stopped at the output limit, so the text is cut short. */
  truncated: boolean
}

/**
 * Transcribe a PDF with Astra. Throws when OpenRouter is not configured or the
 * call fails — the caller decides what the coach sees.
 */
export async function readPdfWithAstra(
  buffer: Buffer,
  filename: string,
  options: { signal?: AbortSignal } = {},
): Promise<ReadDocumentResult> {
  if (!isOpenRouterConfigured()) throw new Error("OPENROUTER_API_KEY is not set")

  const client = getOpenRouterClient()
  const body = {
    model: toOpenRouterModel(DOCUMENT_READER_MODEL),
    max_tokens: MAX_OUTPUT_TOKENS,
    // Transcription needs no thinking; "low" keeps a page at a few seconds.
    reasoning: { effort: "low" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this document." },
          {
            type: "file",
            file: { filename, file_data: `data:application/pdf;base64,${buffer.toString("base64")}` },
          },
        ],
      },
    ],
  }

  // Streamed: a long document is minutes of output, and a non-streaming
  // connection that long can be cut by an intermediary before it finishes.
  const stream = client.chat.completions.stream(body as Parameters<typeof client.chat.completions.stream>[0], {
    signal: options.signal,
  })
  const completion = await stream.finalChatCompletion()
  const choice = completion.choices?.[0]
  if (!choice) throw new Error(`No choices in OpenRouter response (model: ${DOCUMENT_READER_MODEL})`)

  const refusal = (choice.message as { refusal?: string | null })?.refusal
  if (refusal) throw new Error(`The model declined to read the document: ${refusal}`)

  return {
    text: (choice.message.content ?? "").trim(),
    truncated: choice.finish_reason === "length",
  }
}

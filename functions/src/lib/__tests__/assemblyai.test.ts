// functions/src/lib/__tests__/assemblyai.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { submitTranscription, getTranscript } from "../assemblyai.js"

describe("assemblyai client", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.ASSEMBLYAI_API_KEY = "test-key"
  })

  it("submitTranscription POSTs to /transcript with the audio_url + webhook_url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "transcript_abc", status: "queued" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await submitTranscription({
      audio_url: "https://example.com/audio.mp3",
      webhook_url: "https://example.com/webhook",
    })

    expect(result.id).toBe("transcript_abc")
    expect(result.status).toBe("queued")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.assemblyai.com/v2/transcript")
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "test-key",
      "content-type": "application/json",
    })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      audio_url: "https://example.com/audio.mp3",
      webhook_url: "https://example.com/webhook",
    })
  })

  it("getTranscript GETs /transcript/{id} and returns the status + text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "transcript_xyz",
        status: "completed",
        text: "Hello athletes, today we're working on the landmine rotational press.",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await getTranscript("transcript_xyz")
    expect(result.status).toBe("completed")
    expect(result.text).toContain("landmine rotational press")

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.assemblyai.com/v2/transcript/transcript_xyz")
  })

  it("throws when ASSEMBLYAI_API_KEY is not set", async () => {
    delete process.env.ASSEMBLYAI_API_KEY
    await expect(
      submitTranscription({ audio_url: "x", webhook_url: "y" }),
    ).rejects.toThrow(/ASSEMBLYAI_API_KEY/)
  })
})

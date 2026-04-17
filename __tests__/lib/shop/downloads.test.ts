import { afterEach, describe, expect, it, vi } from "vitest"
import { generateSignedDownloadUrl } from "@/lib/shop/downloads"

vi.mock("@/lib/firebase-admin", () => ({
  getPrivateBucket: () => ({
    file: (p: string) => ({
      getSignedUrl: vi.fn().mockResolvedValue([`https://signed.example/${p}?exp=1`]),
    }),
  }),
}))

describe("generateSignedDownloadUrl", () => {
  afterEach(() => vi.clearAllMocks())

  it("returns the signed URL from Firebase Admin", async () => {
    const url = await generateSignedDownloadUrl("downloads/x.pdf", 900)
    expect(url).toContain("signed.example")
    expect(url).toContain("x.pdf")
  })
})

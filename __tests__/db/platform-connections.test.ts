// __tests__/db/platform-connections.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  listPlatformConnections,
  getPlatformConnection,
  connectPlatform,
  pausePlatform,
  disconnectPlatform,
} from "@/lib/db/platform-connections"

describe("platform-connections DAL", () => {
  async function resetFacebookToDefault() {
    await disconnectPlatform("facebook")
  }

  beforeAll(resetFacebookToDefault)
  afterAll(resetFacebookToDefault)

  it("lists all seeded plugins (6 social + google_ads)", async () => {
    const all = await listPlatformConnections()
    const names = all.map((c) => c.plugin_name).sort()
    expect(names).toEqual([
      "facebook",
      "google_ads",
      "instagram",
      "linkedin",
      "tiktok",
      "youtube",
      "youtube_shorts",
    ])
  })

  it("getPlatformConnection returns one connection by name", async () => {
    const fb = await getPlatformConnection("facebook")
    expect(fb?.plugin_name).toBe("facebook")
  })

  it("connectPlatform transitions to connected state", async () => {
    const c = await connectPlatform("facebook", {
      credentials: { access_token: "tok" },
      account_handle: "@djpathlete",
    })
    expect(c.status).toBe("connected")
    expect(c.account_handle).toBe("@djpathlete")
    expect((c.credentials as { access_token: string }).access_token).toBe("tok")
    expect(c.connected_at).not.toBeNull()
  })

  it("pausePlatform keeps credentials but sets paused", async () => {
    const c = await pausePlatform("facebook")
    expect(c.status).toBe("paused")
    expect((c.credentials as { access_token?: string }).access_token).toBe("tok")
  })

  it("disconnectPlatform clears credentials and sets not_connected", async () => {
    const c = await disconnectPlatform("facebook")
    expect(c.status).toBe("not_connected")
    expect(c.credentials).toEqual({})
    expect(c.account_handle).toBeNull()
  })
})

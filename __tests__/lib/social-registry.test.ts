// __tests__/lib/social-registry.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { createPluginRegistry } from "@/lib/social/registry"
import type { PublishPlugin, PublishResult } from "@/lib/social/plugins/types"

function makeStubPlugin(name: "facebook" | "instagram" | "tiktok" | "youtube" | "youtube_shorts" | "linkedin"): PublishPlugin {
  return {
    name,
    displayName: name,
    async connect(_creds) {
      return { status: "connected", account_handle: `@${name}` }
    },
    async publish(_input): Promise<PublishResult> {
      return { success: true, platform_post_id: `${name}_post_1` }
    },
    async fetchAnalytics(_postId) {
      return { impressions: 100, engagement: 10 }
    },
    async disconnect() {
      // no-op
    },
    async getSetupInstructions() {
      return `Set up ${name}`
    },
  }
}

describe("plugin registry", () => {
  let registry: ReturnType<typeof createPluginRegistry>

  beforeEach(() => {
    registry = createPluginRegistry()
  })

  it("registers and retrieves a plugin", () => {
    const fb = makeStubPlugin("facebook")
    registry.register(fb)
    expect(registry.get("facebook")).toBe(fb)
  })

  it("lists all registered plugin names", () => {
    registry.register(makeStubPlugin("facebook"))
    registry.register(makeStubPlugin("tiktok"))
    expect(registry.list().sort()).toEqual(["facebook", "tiktok"])
  })

  it("throws when registering the same plugin twice", () => {
    registry.register(makeStubPlugin("facebook"))
    expect(() => registry.register(makeStubPlugin("facebook"))).toThrow(/already registered/i)
  })

  it("returns undefined for unregistered plugin", () => {
    expect(registry.get("linkedin")).toBeUndefined()
  })

  it("invokes plugin.publish and returns its result", async () => {
    registry.register(makeStubPlugin("instagram"))
    const result = await registry.get("instagram")!.publish({
      content: "hi",
      mediaUrl: null,
      scheduledAt: null,
    })
    expect(result.success).toBe(true)
    expect(result.platform_post_id).toBe("instagram_post_1")
  })
})

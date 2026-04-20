import { describe, it, expect, vi, beforeEach } from "vitest"
import { bootstrapPlugins } from "@/lib/social/bootstrap"
import { pluginRegistry } from "@/lib/social/registry"
import type { PlatformConnection } from "@/types/database"

describe("bootstrapPlugins", () => {
  beforeEach(() => {
    pluginRegistry.reset()
  })

  it("registers facebook plugin when connection has access_token and page_id", () => {
    const connections: PlatformConnection[] = [
      {
        id: "1",
        plugin_name: "facebook",
        status: "connected",
        credentials: { access_token: "tok", page_id: "123" },
        account_handle: null,
        last_sync_at: null,
        last_error: null,
        connected_at: null,
        connected_by: null,
        created_at: "",
        updated_at: "",
      },
    ]

    bootstrapPlugins(connections, {
      tiktokEmail: "coach@example.com",
      tiktokFcmToken: null,
      sendPush: vi.fn(),
      sendEmail: vi.fn(),
    })

    const fb = pluginRegistry.get("facebook")
    expect(fb).toBeDefined()
    expect(fb?.name).toBe("facebook")
  })

  it("skips connections that are not connected", () => {
    bootstrapPlugins(
      [
        {
          id: "1",
          plugin_name: "facebook",
          status: "not_connected",
          credentials: {},
          account_handle: null,
          last_sync_at: null,
          last_error: null,
          connected_at: null,
          connected_by: null,
          created_at: "",
          updated_at: "",
        },
      ],
      { tiktokEmail: "a@b.c", tiktokFcmToken: null, sendPush: vi.fn(), sendEmail: vi.fn() },
    )
    expect(pluginRegistry.get("facebook")).toBeUndefined()
  })

  it("registers tiktok plugin using the provided push + email senders", () => {
    bootstrapPlugins(
      [
        {
          id: "1",
          plugin_name: "tiktok",
          status: "connected",
          credentials: {},
          account_handle: "coach@example.com",
          last_sync_at: null,
          last_error: null,
          connected_at: null,
          connected_by: null,
          created_at: "",
          updated_at: "",
        },
      ],
      { tiktokEmail: "coach@example.com", tiktokFcmToken: "fcm_abc", sendPush: vi.fn(), sendEmail: vi.fn() },
    )
    const tk = pluginRegistry.get("tiktok")
    expect(tk).toBeDefined()
    expect(tk?.name).toBe("tiktok")
  })
})

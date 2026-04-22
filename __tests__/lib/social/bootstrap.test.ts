import { describe, it, expect, beforeEach } from "vitest"
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

    bootstrapPlugins(connections)

    const fb = pluginRegistry.get("facebook")
    expect(fb).toBeDefined()
    expect(fb?.name).toBe("facebook")
  })

  it("skips connections that are not connected", () => {
    bootstrapPlugins([
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
    ])
    expect(pluginRegistry.get("facebook")).toBeUndefined()
  })

  it("registers tiktok plugin when credentials include OAuth tokens", () => {
    bootstrapPlugins([
      {
        id: "1",
        plugin_name: "tiktok",
        status: "connected",
        credentials: {
          access_token: "at",
          refresh_token: "rt",
          client_key: "ck",
          client_secret: "cs",
        },
        account_handle: "@djpathlete",
        last_sync_at: null,
        last_error: null,
        connected_at: null,
        connected_by: null,
        created_at: "",
        updated_at: "",
      },
    ])
    const tk = pluginRegistry.get("tiktok")
    expect(tk).toBeDefined()
    expect(tk?.name).toBe("tiktok")
  })

  it("skips tiktok plugin when OAuth credentials are missing", () => {
    bootstrapPlugins([
      {
        id: "1",
        plugin_name: "tiktok",
        status: "connected",
        credentials: {},
        account_handle: null,
        last_sync_at: null,
        last_error: null,
        connected_at: null,
        connected_by: null,
        created_at: "",
        updated_at: "",
      },
    ])
    expect(pluginRegistry.get("tiktok")).toBeUndefined()
  })
})

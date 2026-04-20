// lib/social/registry.ts
import type { SocialPlatform } from "@/types/database"
import type { PublishPlugin } from "./plugins/types"

export interface PluginRegistry {
  register(plugin: PublishPlugin): void
  get(name: SocialPlatform): PublishPlugin | undefined
  list(): SocialPlatform[]
  all(): PublishPlugin[]
  reset(): void
}

export function createPluginRegistry(): PluginRegistry {
  const plugins = new Map<SocialPlatform, PublishPlugin>()

  return {
    register(plugin: PublishPlugin) {
      if (plugins.has(plugin.name)) {
        throw new Error(`Plugin "${plugin.name}" is already registered`)
      }
      plugins.set(plugin.name, plugin)
    },

    get(name: SocialPlatform): PublishPlugin | undefined {
      return plugins.get(name)
    },

    list(): SocialPlatform[] {
      return Array.from(plugins.keys())
    },

    all(): PublishPlugin[] {
      return Array.from(plugins.values())
    },

    reset(): void {
      plugins.clear()
    },
  }
}

// Singleton registry for the Next.js app. Plugin implementations (Phase 2)
// will self-register by importing this module.
export const pluginRegistry = createPluginRegistry()

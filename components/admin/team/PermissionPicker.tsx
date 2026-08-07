"use client"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  PERMISSIONS,
  PERMISSION_GROUP_LABELS,
  type PermissionGroup,
  type PermissionKey,
  type PermissionMap,
} from "@/lib/permissions/registry"

const GROUP_ORDER: PermissionGroup[] = ["coaching", "marketing", "money", "tools"]

interface Props {
  value: PermissionMap
  onChange: (next: PermissionMap) => void
  disabled?: boolean
}

/**
 * The permission checkboxes, shared by the invite dialog and the edit dialog so
 * both always show the same catalogue.
 *
 * Boolean permissions are a single checkbox. Tiered ones are a three-way
 * none/view/manage control, because "can open the books" and "can post to the
 * books" are different grants.
 */
export function PermissionPicker({ value, onChange, disabled }: Props) {
  function setBoolean(key: PermissionKey, checked: boolean) {
    const next = { ...value }
    if (checked) next[key] = true
    else delete next[key]
    onChange(next)
  }

  function setTier(key: PermissionKey, tier: "none" | "view" | "manage") {
    const next = { ...value }
    if (tier === "none") delete next[key]
    else next[key] = tier
    onChange(next)
  }

  return (
    <div className="space-y-5">
      {GROUP_ORDER.map((group) => {
        const items = PERMISSIONS.filter((p) => p.group === group)
        if (items.length === 0) return null

        return (
          <fieldset key={group} className="space-y-2.5">
            <legend className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {PERMISSION_GROUP_LABELS[group]}
            </legend>

            {items.map((def) => {
              const current = value[def.key]

              if (def.kind === "boolean") {
                const checked = current === true
                return (
                  <label
                    key={def.key}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      checked ? "border-accent bg-accent/5" : "hover:bg-muted/40",
                      disabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                      checked={checked}
                      disabled={disabled}
                      onChange={(e) => setBoolean(def.key, e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{def.label}</span>
                      <span className="block text-xs text-muted-foreground">{def.description}</span>
                    </span>
                  </label>
                )
              }

              const tiers: ("none" | "view" | "manage")[] =
                def.kind === "view_only" ? ["none", "view"] : ["none", "view", "manage"]
              const active = current === "manage" ? "manage" : current === "view" ? "view" : "none"

              return (
                <div
                  key={def.key}
                  className={cn(
                    "rounded-lg border p-3",
                    active !== "none" ? "border-accent bg-accent/5" : "",
                    disabled && "opacity-60",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Label className="text-sm font-medium">{def.label}</Label>
                      <p className="text-xs text-muted-foreground">{def.description}</p>
                    </div>
                    <div className="flex shrink-0 rounded-md border bg-background p-0.5">
                      {tiers.map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          disabled={disabled}
                          aria-pressed={active === tier}
                          onClick={() => setTier(def.key, tier)}
                          className={cn(
                            "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                            active === tier
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {tier}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </fieldset>
        )
      })}

      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        Settings, this Team page, audit logs, automations, platform connections and the main dashboard stay
        owner-only — they can&apos;t be granted to anyone.
      </p>
    </div>
  )
}

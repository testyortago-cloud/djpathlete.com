"use client"

import { cn } from "@/lib/utils"
import { grantsAnyPermission, type PermissionMap } from "@/lib/permissions/registry"

/**
 * Says, in plain language, what the current ticks add up to.
 *
 * Which portal someone gets is derived from their permissions rather than
 * chosen separately, so without this the move between the admin panel and the
 * editor portal would happen silently on save. Shared by the invite dialog and
 * the edit dialog so both describe the rule identically.
 */
export function AccessOutcomeNote({ permissions }: { permissions: PermissionMap }) {
  const reachesAdminPanel = grantsAnyPermission(permissions)

  return (
    <p
      className={cn(
        "rounded-lg border p-3 text-xs",
        reachesAdminPanel
          ? "border-accent/30 bg-accent/5 text-foreground"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {reachesAdminPanel ? (
        <>
          Gets the <span className="font-medium">admin panel</span>, limited to the areas ticked below.
        </>
      ) : (
        <>
          Nothing ticked — gets the <span className="font-medium">editor portal</span> only, where they
          upload videos and read your feedback. Tick any area below to let them into the admin panel.
        </>
      )}
    </p>
  )
}

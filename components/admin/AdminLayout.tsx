"use client"

import { useState } from "react"
import { AdminSidebar } from "./AdminSidebar"
import { AdminTopBar } from "./AdminTopBar"
import { AdminMobileSidebar } from "./AdminMobileSidebar"
import { JobsNotificationDock } from "./JobsNotificationDock"
import { AdminWeightUnitProvider } from "@/hooks/use-admin-weight-unit"
import { AiJobsDockProvider } from "@/hooks/use-ai-jobs-dock"
import type { PermissionActor } from "@/lib/permissions/registry"

interface AdminLayoutProps {
  children: React.ReactNode
  avatarUrl?: string | null
  initials?: string
  contentStudioEnabled?: boolean
  /** Drives which nav items render. Omitted = owner (everything). */
  actor?: PermissionActor | null
}

export function AdminLayout({ children, avatarUrl, initials, contentStudioEnabled, actor }: AdminLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <AdminWeightUnitProvider>
      <AiJobsDockProvider>
        <div className="flex min-h-screen bg-surface">
          <AdminSidebar contentStudioEnabled={contentStudioEnabled} actor={actor} />
          <AdminMobileSidebar
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            contentStudioEnabled={contentStudioEnabled}
            actor={actor}
          />
          <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
            <AdminTopBar onMenuClick={() => setMobileOpen(true)} avatarUrl={avatarUrl} initials={initials} />
            <main className="flex-1 p-6">
              <div className="w-full">{children}</div>
            </main>
          </div>
        </div>
        <JobsNotificationDock />
      </AiJobsDockProvider>
    </AdminWeightUnitProvider>
  )
}

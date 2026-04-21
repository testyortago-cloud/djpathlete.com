"use client"

import { useState } from "react"
import { AdminSidebar } from "./AdminSidebar"
import { AdminTopBar } from "./AdminTopBar"
import { AdminMobileSidebar } from "./AdminMobileSidebar"
import { AdminWeightUnitProvider } from "@/hooks/use-admin-weight-unit"

interface AdminLayoutProps {
  children: React.ReactNode
  avatarUrl?: string | null
  initials?: string
  contentStudioEnabled?: boolean
}

export function AdminLayout({ children, avatarUrl, initials, contentStudioEnabled }: AdminLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <AdminWeightUnitProvider>
      <div className="flex min-h-screen bg-surface">
        <AdminSidebar contentStudioEnabled={contentStudioEnabled} />
        <AdminMobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
          <AdminTopBar onMenuClick={() => setMobileOpen(true)} avatarUrl={avatarUrl} initials={initials} />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </AdminWeightUnitProvider>
  )
}

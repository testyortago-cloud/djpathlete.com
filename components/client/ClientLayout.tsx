"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Dumbbell, ShoppingBag, TrendingUp, Trophy, User, CreditCard, Settings, ClipboardList, LogOut, MoreHorizontal } from "lucide-react"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { InstallPrompt } from "@/components/client/InstallPrompt"
import { PullToRefresh } from "@/components/client/PullToRefresh"

const navItems = [
  { label: "Dashboard", href: "/client/dashboard", icon: LayoutDashboard },
  { label: "Programs", href: "/client/programs", icon: ShoppingBag },
  { label: "Workouts", href: "/client/workouts", icon: Dumbbell },
  { label: "Progress", href: "/client/progress", icon: TrendingUp },
  { label: "Achievements", href: "/client/achievements", icon: Trophy },
  { label: "Assessment", href: "/client/questionnaire", icon: ClipboardList },
  { label: "Profile", href: "/client/profile", icon: User },
  { label: "Payments", href: "/client/payments", icon: CreditCard },
  { label: "Settings", href: "/client/settings", icon: Settings },
]

// Bottom tab bar: 4 primary items + More
const bottomTabs = navItems.slice(0, 4)
const moreItems = navItems.slice(4)

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  // Close "More" sheet on navigation
  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("SW registration failed:", err)
      })
    }
  }, [])

  const isMoreActive = moreItems.some((item) => pathname.startsWith(item.href))

  return (
    <div className="min-h-screen bg-surface">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 fixed inset-y-0 left-0 bg-white border-r border-border">
        <div className="px-6 pt-8 pb-5">
          <Link href="/client/dashboard" className="flex items-center gap-2">
            <Image
              src="/logos/logo-icon-dark.png"
              alt="DJP Athlete"
              width={120}
              height={80}
              className="object-contain"
              style={{ height: 32, width: "auto" }}
              priority
            />
            <span className="font-heading font-semibold tracking-[0.2em] text-[11px] uppercase text-foreground">
              Athlete
            </span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface"
                )}
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-border">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          >
            <LogOut className="size-5" strokeWidth={1.5} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        <main className="p-6 pb-28 lg:pb-6">
          <PullToRefresh>{children}</PullToRefresh>
        </main>
      </div>

      {/* Install prompt */}
      <InstallPrompt />

      {/* Mobile bottom tabs */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-border z-30 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-16">
          {bottomTabs.map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 min-w-[64px] py-1 text-[10px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {item.label}
              </Link>
            )
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 min-w-[64px] py-1 text-[10px] font-medium transition-colors",
              isMoreActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <MoreHorizontal className="size-5" strokeWidth={1.5} />
            More
          </button>
        </div>
      </nav>

      {/* More menu sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="px-2 pb-8 pt-4 max-h-[70dvh]">
          <SheetHeader className="px-2 pb-2">
            <SheetTitle className="text-sm">More</SheetTitle>
            <SheetDescription className="sr-only">Additional navigation options</SheetDescription>
          </SheetHeader>
          <div className="space-y-1">
            {moreItems.map((item) => {
              const isActive = pathname.startsWith(item.href)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-surface"
                  )}
                >
                  <Icon className="size-5" strokeWidth={1.5} />
                  {item.label}
                </Link>
              )
            })}
            <div className="border-t border-border mt-2 pt-2">
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              >
                <LogOut className="size-5" strokeWidth={1.5} />
                Logout
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

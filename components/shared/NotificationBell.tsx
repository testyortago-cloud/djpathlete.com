"use client"

import { useRouter } from "next/navigation"
import { Bell, CheckCheck, Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time-utils"
import { useNotifications } from "@/hooks/use-notifications"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { NotificationType } from "@/types/database"

const typeConfig: Record<NotificationType, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "text-blue-500" },
  success: { icon: CheckCircle2, className: "text-green-500" },
  warning: { icon: AlertTriangle, className: "text-amber-500" },
  error: { icon: XCircle, className: "text-red-500" },
}

export function NotificationBell() {
  const router = useRouter()
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications()

  function handleClick(id: string, link: string | null, isRead: boolean) {
    if (!isRead) markAsRead(id)
    if (link) router.push(link)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-surface rounded-lg transition-colors">
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 sm:w-96 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllAsRead()}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <CheckCheck className="size-3" />
              Mark all read
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">No notifications yet.</div>
          ) : (
            notifications.map((n) => {
              const config = typeConfig[n.type as NotificationType] ?? typeConfig.info
              const TypeIcon = config.icon
              return (
                <button
                  key={n.id}
                  onClick={() => handleClick(n.id, n.link, n.is_read)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface",
                    !n.is_read && "bg-primary/[0.03]",
                  )}
                >
                  <TypeIcon className={cn("size-4 mt-0.5 shrink-0", config.className)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          "text-sm truncate",
                          n.is_read ? "text-muted-foreground" : "font-semibold text-foreground",
                        )}
                      >
                        {n.title}
                      </p>
                      {!n.is_read && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

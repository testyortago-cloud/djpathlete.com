"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Video } from "lucide-react"

export function EditorShell({
  user,
  children,
}: {
  user: { name: string; email: string }
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Video className="size-5 text-accent" />
            <h1 className="font-heading text-sm uppercase tracking-widest">DJP Editor</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-right leading-tight">
              <div className="font-medium">{user.name}</div>
              <div className="font-mono text-xs opacity-70">{user.email}</div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-primary-foreground hover:bg-primary-foreground/10"
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}

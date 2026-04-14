"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

export function ResetDataButton() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmText, setConfirmText] = useState("")
  const [pending, setPending] = useState(false)

  const canSubmit = password.length > 0 && confirmText === "RESET"

  async function handleReset() {
    if (!canSubmit) return
    setPending(true)

    try {
      const res = await fetch("/api/admin/reset-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || "Failed to reset data")
        return
      }

      if (data.warnings?.length) {
        toast.warning(`Data reset completed with ${data.warnings.length} warning(s). Check console for details.`)
        console.warn("Reset warnings:", data.warnings)
      } else {
        toast.success("Platform data has been reset successfully.")
      }

      setOpen(false)
      window.location.reload()
    } catch {
      toast.error("Failed to reset data. Please try again.")
    } finally {
      setPending(false)
      setPassword("")
      setConfirmText("")
    }
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Reset Data
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setPassword("")
            setConfirmText("")
          }
          setOpen(v)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Reset Platform Data</DialogTitle>
            <DialogDescription>
              This will permanently delete all client accounts, workout progress, assignments, payments, reviews,
              notifications, and AI history. Your admin account, exercises, and programs will be preserved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="reset-password">Enter your admin password to confirm</Label>
              <Input
                id="reset-password"
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reset-confirm">
                Type <span className="font-semibold text-destructive">RESET</span> to confirm
              </Label>
              <Input
                id="reset-confirm"
                placeholder='Type "RESET"'
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReset} disabled={!canSubmit || pending}>
              {pending ? "Resetting..." : "Reset All Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function EmailPackDialog({
  open,
  onOpenChange,
  from,
  to,
  defaultRecipient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  from: string
  to: string
  defaultRecipient: string
}) {
  const [email, setEmail] = useState(defaultRecipient)
  const [remember, setRemember] = useState(false)
  const [sending, setSending] = useState(false)

  // Reset/prefill on OPEN (not close) so the dialog doesn't visibly reset
  // to blank mid fade-out while Radix keeps the content mounted.
  useEffect(() => {
    if (!open) return
    setEmail(defaultRecipient)
    setRemember(false)
  }, [open, defaultRecipient])

  async function submit() {
    setSending(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/reports/email-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, recipient_email: email, remember }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to send")
        return
      }
      toast.success(`Pack emailed to ${email}`)
      onOpenChange(false)
    } catch {
      toast.error("Failed to send")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email to accountant</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Sends the accountant pack for {from} – {to}. Gross figures, estimates — the CPA files.
          </p>

          <div className="space-y-2">
            <Label htmlFor="epd-email">Recipient email</Label>
            <Input
              id="epd-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="accountant@example.com"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="epd-remember"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 rounded border-border"
            />
            <label htmlFor="epd-remember" className="text-sm text-foreground">
              Remember for quarterly sends
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={sending || !email.trim()}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

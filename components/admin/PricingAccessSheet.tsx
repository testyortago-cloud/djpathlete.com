"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Gift, CreditCard, RefreshCw, Lock, Unlock, Lightbulb, Globe, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PaymentType, Program } from "@/types/database"

interface PricingAccessSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  program: Program
  /** When set, "Publish" also assigns the program to this client. */
  assignTo?: { clientId: string; clientName?: string }
  /** Week numbers the AI suggested as premium (pre-checked, price empty). */
  suggestedPremiumWeeks?: number[]
  onPublished?: () => void
}

export function PricingAccessSheet({
  open,
  onOpenChange,
  program,
  assignTo,
  suggestedPremiumWeeks = [],
  onPublished,
}: PricingAccessSheetProps) {
  const [paymentType, setPaymentType] = useState<PaymentType>(program.payment_type ?? "one_time")
  const [priceDollars, setPriceDollars] = useState(program.price_cents != null ? (program.price_cents / 100).toFixed(2) : "")
  const [billingInterval, setBillingInterval] = useState(program.billing_interval ?? "month")
  const [isPublic, setIsPublic] = useState(program.is_public ?? false)
  // week_number -> price string ("" = premium but unpriced). Absent = included.
  const [premium, setPremium] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const totalWeeks = program.duration_weeks ?? 1

  // Reset all fields + (re)load premium weeks whenever the sheet opens for a program.
  useEffect(() => {
    if (!open) return
    setPaymentType(program.payment_type ?? "one_time")
    setPriceDollars(program.price_cents != null ? (program.price_cents / 100).toFixed(2) : "")
    setBillingInterval(program.billing_interval ?? "month")
    setIsPublic(program.is_public ?? false)
    setPremium({})
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/programs/${program.id}/premium-weeks`)
        if (res.ok) {
          const data = await res.json()
          const map: Record<number, string> = {}
          for (const w of data.weeks ?? []) map[w.week_number] = (w.price_cents / 100).toFixed(2)
          if (Object.keys(map).length === 0) for (const w of suggestedPremiumWeeks) map[w] = ""
          if (!cancelled) setPremium(map)
        }
      } catch {
        /* ignore — start empty */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, program.id])

  const toggleWeek = useCallback((week: number) => {
    setPremium((prev) => {
      const next = { ...prev }
      if (week in next) delete next[week]
      else next[week] = ""
      return next
    })
  }, [])

  const paymentOptions: { value: PaymentType; label: string; icon: React.ReactNode }[] = [
    { value: "free", label: "Free", icon: <Gift className="size-4" /> },
    { value: "one_time", label: "One-time", icon: <CreditCard className="size-4" /> },
    { value: "subscription", label: "Subscription", icon: <RefreshCw className="size-4" /> },
  ]

  async function handlePublish() {
    // Validate entry price
    const entryCents = Math.round(parseFloat(priceDollars) * 100)
    if (paymentType !== "free" && (!Number.isFinite(entryCents) || entryCents <= 0)) {
      toast.error("Set an entry price (or choose Free).")
      return
    }
    // Validate premium prices
    const premiumWeeks: { week_number: number; price_cents: number }[] = []
    for (const [week, price] of Object.entries(premium)) {
      const cents = Math.round(parseFloat(price) * 100)
      if (!Number.isFinite(cents) || cents <= 0) {
        toast.error(`Set a price for premium week ${week}.`)
        return
      }
      premiumWeeks.push({ week_number: Number(week), price_cents: cents })
    }

    setSaving(true)
    try {
      // 1) Program pricing + visibility (reuses existing PATCH + Stripe sync)
      const patchPayload = {
        name: program.name,
        description: program.description,
        category: program.category,
        difficulty: program.difficulty,
        tier: program.tier,
        duration_weeks: program.duration_weeks,
        sessions_per_week: program.sessions_per_week,
        split_type: program.split_type,
        periodization: program.periodization,
        payment_type: paymentType,
        billing_interval: paymentType === "subscription" ? billingInterval : null,
        price_cents: paymentType === "free" ? null : entryCents,
        is_public: isPublic,
      }
      const patchRes = await fetch(`/api/admin/programs/${program.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchPayload),
      })
      if (!patchRes.ok) throw new Error("Failed to save pricing")

      // 2) Premium weeks (replace-all)
      const weeksRes = await fetch(`/api/admin/programs/${program.id}/premium-weeks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeks: premiumWeeks }),
      })
      if (!weeksRes.ok) throw new Error("Failed to save premium weeks")

      // 3) Assign (only when launched with a target client)
      if (assignTo) {
        const today = new Date().toISOString().split("T")[0]
        const assignRes = await fetch(`/api/admin/programs/${program.id}/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_ids: [assignTo.clientId], start_date: today, notes: null, complimentary: false }),
        })
        if (!assignRes.ok) throw new Error("Saved pricing, but assigning failed")
      }

      toast.success(assignTo ? "Published & assigned" : "Pricing & access saved")
      onPublished?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish")
    } finally {
      setSaving(false)
    }
  }

  const previewLine = (() => {
    const entry =
      paymentType === "free"
        ? "Free to start"
        : `Pay $${priceDollars || "0"}${paymentType === "subscription" ? `/${billingInterval === "month" ? "mo" : "wk"}` : ""}`
    const premiumNums = Object.keys(premium).map(Number).sort((a, b) => a - b)
    const premiumPart = premiumNums.length ? ` Weeks ${premiumNums.join(", ")} are paid add-ons.` : ""
    return `${entry} → included weeks unlock.${premiumPart}`
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Pricing &amp; Access</DialogTitle>
        </DialogHeader>

        {/* Coach guide */}
        <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Lightbulb className="size-4 text-primary shrink-0" />
          <div>
            <p className="font-medium text-foreground">How this works</p>
            <ol className="list-decimal pl-4 mt-1 space-y-0.5">
              <li>Choose how clients get in — Free, one-time, or subscription.</li>
              <li>Tap any week to make it a paid add-on.</li>
              <li>Publish — clients are gated automatically.</li>
            </ol>
          </div>
        </div>

        {/* Entry */}
        <div className="space-y-2">
          <Label>How clients get in</Label>
          <div className="grid grid-cols-3 gap-2">
            {paymentOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaymentType(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2.5 text-xs font-medium transition-colors",
                  paymentType === opt.value ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
                )}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
          {paymentType !== "free" && (
            <div className="flex items-center gap-2 pt-1">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number"
                  min="0.50"
                  step="0.01"
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  placeholder="285.00"
                  className="pl-7 w-32"
                />
              </div>
              {paymentType === "subscription" && (
                <select
                  value={billingInterval}
                  onChange={(e) => setBillingInterval(e.target.value as "week" | "month")}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="month">/ month</option>
                  <option value="week">/ week</option>
                </select>
              )}
            </div>
          )}
        </div>

        {/* Weeks */}
        <div className="space-y-2">
          <Label>Weeks — tap to make premium</Label>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((week) => {
              const isPremium = week in premium
              return (
                <button
                  key={week}
                  type="button"
                  onClick={() => toggleWeek(week)}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    isPremium ? "border-warning text-warning bg-warning/5" : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {isPremium ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                  W{week}
                </button>
              )
            })}
          </div>
          {Object.keys(premium).length > 0 && (
            <div className="space-y-1.5 pt-1">
              {Object.keys(premium).map(Number).sort((a, b) => a - b).map((week) => (
                <div key={week} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-12">Week {week}</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      min="0.50"
                      step="0.01"
                      value={premium[week]}
                      onChange={(e) => setPremium((p) => ({ ...p, [week]: e.target.value }))}
                      placeholder="40.00"
                      className="pl-7 h-8 w-28"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Visibility */}
        <div className="space-y-2">
          <Label>Visibility</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIsPublic(false)}
              className={cn(
                "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                !isPublic ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
              )}
            >
              <EyeOff className="size-4" /> Private
            </button>
            <button
              type="button"
              onClick={() => setIsPublic(true)}
              className={cn(
                "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm transition-colors",
                isPublic ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground",
              )}
            >
              <Globe className="size-4" /> Public store
            </button>
          </div>
        </div>

        {/* Preview */}
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Client sees: </span>
          {previewLine}
        </p>

        <DialogFooter>
          <Button onClick={handlePublish} disabled={saving}>
            {saving ? "Publishing..." : assignTo ? `Publish & assign${assignTo.clientName ? ` to ${assignTo.clientName}` : ""}` : "Save pricing & access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

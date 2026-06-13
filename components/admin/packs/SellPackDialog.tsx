"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SessionPackProduct } from "@/types/database"

export function SellPackDialog({
  clientUserId,
  onSold,
  trigger,
}: {
  clientUserId: string
  onSold: () => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [products, setProducts] = useState<SessionPackProduct[]>([])
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([])
  const [programId, setProgramId] = useState<string>("none")
  const [mode, setMode] = useState<"catalogue" | "adhoc">("adhoc")
  const [productId, setProductId] = useState<string>("")
  const [sessionType, setSessionType] = useState("1-on-1")
  const [credits, setCredits] = useState("10")
  const [price, setPrice] = useState("") // dollars
  const [validityDays, setValidityDays] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "cash" | "comp">("stripe")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch("/api/admin/session-packs/products")
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => {
        const active = (d.products ?? []).filter((p: SessionPackProduct) => p.is_active)
        setProducts(active)
        if (active.length > 0) {
          setMode("catalogue")
          setProductId(active[0].id)
        }
      })
      .catch(() => setProducts([]))
    fetch("/api/admin/session-packs/programs")
      .then((r) => (r.ok ? r.json() : { programs: [] }))
      .then((d) => setPrograms(d.programs ?? []))
      .catch(() => setPrograms([]))
  }, [open])

  async function submit() {
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { clientUserId, paymentMethod }
      if (programId !== "none") body.programId = programId
      if (mode === "catalogue") {
        if (!productId) {
          toast.error("Pick a pack")
          return
        }
        body.productId = productId
      } else {
        const c = parseInt(credits, 10)
        const cents = Math.round(parseFloat(price || "0") * 100)
        if (!sessionType || !c || c < 1) {
          toast.error("Enter a session type and credit count")
          return
        }
        body.adhoc = {
          sessionType,
          credits: c,
          priceCents: cents,
          validityDays: validityDays ? parseInt(validityDays, 10) : null,
        }
      }

      const res = await fetch("/api/admin/session-packs/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Failed to sell pack")
        return
      }
      if (data.url) {
        // Stripe — hand the payment link to the client.
        window.location.href = data.url as string
        return
      }
      toast.success("Pack added")
      setOpen(false)
      onSold()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sell a session pack</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {products.length > 0 && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "catalogue" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("catalogue")}
              >
                From catalogue
              </Button>
              <Button
                type="button"
                variant={mode === "adhoc" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("adhoc")}
              >
                Custom
              </Button>
            </div>
          )}

          {mode === "catalogue" ? (
            <div className="space-y-2">
              <Label>Pack</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a pack" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {p.credits}× {p.session_type} (${(p.price_cents / 100).toFixed(0)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="st">Session type</Label>
                <Input id="st" value={sessionType} onChange={(e) => setSessionType(e.target.value)} placeholder="1-on-1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr">Sessions</Label>
                <Input id="cr" type="number" min={1} value={credits} onChange={(e) => setCredits(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pr">Price ($)</Label>
                <Input id="pr" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="vd">Expires after (days, optional)</Label>
                <Input id="vd" type="number" min={1} value={validityDays} onChange={(e) => setValidityDays(e.target.value)} placeholder="never" />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Payment</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stripe">Card (Stripe link)</SelectItem>
                <SelectItem value="cash">Cash / paid offline</SelectItem>
                <SelectItem value="comp">Complimentary</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Link a program (optional)</Label>
            <Select value={programId} onValueChange={setProgramId}>
              <SelectTrigger>
                <SelectValue placeholder="No program" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No program</SelectItem>
                {programs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              If linked, each check-in marks the next workout in this program complete.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {paymentMethod === "stripe" ? "Create payment link" : "Add pack"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

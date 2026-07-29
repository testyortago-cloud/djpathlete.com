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
import { Combobox } from "@/components/ui/combobox"
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
  // "cash_owed" is UI-only: it submits as paymentMethod "cash" + owed true
  // (credits usable now, pack flagged until the Venmo/cash actually arrives).
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "cash" | "cash_owed" | "comp">("stripe")
  const [submitting, setSubmitting] = useState(false)
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Someone other than the client is paying (a parent with no account here).
  const [billToOther, setBillToOther] = useState(false)
  const [billToEmail, setBillToEmail] = useState("")

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
      const body: Record<string, unknown> =
        paymentMethod === "cash_owed"
          ? { clientUserId, paymentMethod: "cash", owed: true }
          : { clientUserId, paymentMethod }
      if (programId !== "none") body.programId = programId

      // Omitted rather than sent empty: "" would fail the .email() validator
      // and break every ordinary sale.
      const trimmedBillTo = billToEmail.trim()
      if (paymentMethod === "stripe" && billToOther) {
        if (!trimmedBillTo) {
          toast.error("Enter the billing email, or untick “Someone else is paying”")
          return
        }
        body.billToEmail = trimmedBillTo
      }

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
        // Stripe — show the payment link for the coach to SEND to the client.
        // Never navigate there ourselves: opening checkout in the coach's own
        // browser makes Stripe Link autofill the coach's email and card.
        setCreatedLink(data.url as string)
        try {
          await navigator.clipboard.writeText(data.url as string)
          setCopied(true)
        } catch {
          setCopied(false)
        }
        onSold()
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

  async function copyLink() {
    if (!createdLink) return
    try {
      await navigator.clipboard.writeText(createdLink)
      setCopied(true)
      toast.success("Link copied")
    } catch {
      window.prompt("Copy the payment link:", createdLink)
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    // Reset on OPEN, not close — clearing during close would swap the link
    // screen back to the sell form mid fade-out (Radix keeps content mounted
    // through the exit animation).
    if (next) {
      setCreatedLink(null)
      setCopied(false)
      setBillToOther(false)
      setBillToEmail("")
    }
  }

  if (createdLink) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment link ready</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Send this link to whoever is paying (WhatsApp, text, email). It&apos;s addressed to their email, so their
              own card details come up — not yours. Don&apos;t pay through it yourself.
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Billed to </span>
              <span className="font-medium text-foreground">{billToEmail.trim() || "the client"}</span>
            </p>
            <div className="flex gap-2">
              <Input readOnly value={createdLink} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" onClick={copyLink}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The pack shows as &quot;awaiting payment&quot; until they pay, then flips to paid automatically. You can
              re-copy this link any time from the pack&apos;s &quot;Copy payment link&quot; button.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
                <SelectItem value="cash_owed">Offline — payment owed</SelectItem>
                <SelectItem value="comp">Complimentary</SelectItem>
              </SelectContent>
            </Select>
            {paymentMethod === "cash_owed" && (
              <p className="text-xs text-muted-foreground">
                Sessions can be used right away. The pack shows an &quot;owes payment&quot; badge until you mark it
                paid (e.g. when the Venmo arrives).
              </p>
            )}
            {paymentMethod === "stripe" && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <label htmlFor="billToOther" className="flex items-center gap-2 text-sm">
                  <input
                    id="billToOther"
                    type="checkbox"
                    checked={billToOther}
                    onChange={(e) => setBillToOther(e.target.checked)}
                    className="size-4 rounded border-border"
                  />
                  Someone else is paying
                </label>
                {billToOther && (
                  <div className="space-y-1.5">
                    <Label htmlFor="billTo">Billing email</Label>
                    <Input
                      id="billTo"
                      type="email"
                      value={billToEmail}
                      onChange={(e) => setBillToEmail(e.target.value)}
                      placeholder="parent@example.com"
                    />
                    <p className="text-xs text-muted-foreground">
                      The payment page and the receipt go to this address. The pack still belongs to the client, and
                      they&apos;re CC&apos;d if you email the link.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Link a program (optional)</Label>
            <Combobox
              value={programId}
              onChange={setProgramId}
              options={[
                { value: "none", label: "No program" },
                ...programs.map((p) => ({ value: p.id, label: p.name })),
              ]}
              placeholder="No program"
              searchPlaceholder="Search programs…"
              emptyText="No programs found"
            />
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

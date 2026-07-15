"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles, RefreshCw, Mail, Phone as PhoneIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { buildLeadMailtoLink, buildTelLink } from "@/lib/leads/build-mailto-link"
import { SERVICE_LABELS, type ServiceType } from "@/lib/validators/inquiry"
import type { LeadInquiry } from "@/types/database"

const PRIORITY_STYLES: Record<NonNullable<LeadInquiry["ai_priority"]>, string> = {
  high: "bg-success/10 text-success",
  medium: "bg-warning/10 text-warning",
  low: "bg-muted text-muted-foreground",
}

export function LeadInquiryPanel({
  leadInquiry,
  phone,
}: {
  leadInquiry: LeadInquiry
  phone: string | null
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(leadInquiry.ai_draft_reply ?? "")
  const [busy, setBusy] = useState(false)

  const serviceLabel = SERVICE_LABELS[leadInquiry.service as ServiceType] ?? leadInquiry.service
  const firstName = leadInquiry.name.split(" ")[0]

  async function regenerate() {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/leads/${leadInquiry.id}/regenerate-analysis`, { method: "POST" })
      if (!res.ok) throw new Error()
      router.refresh()
    } catch {
      toast.error("Could not generate analysis")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-primary flex items-center gap-2">
          <Sparkles className="size-5" strokeWidth={1.5} />
          Lead Inquiry
        </h2>
        {leadInquiry.ai_priority && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PRIORITY_STYLES[leadInquiry.ai_priority]}`}
          >
            {leadInquiry.ai_priority} priority
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 mb-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Service</p>
          <p className="text-foreground">{serviceLabel}</p>
        </div>
        {leadInquiry.sport && (
          <div>
            <p className="text-xs text-muted-foreground">Sport</p>
            <p className="text-foreground">{leadInquiry.sport}</p>
          </div>
        )}
        {leadInquiry.experience && (
          <div>
            <p className="text-xs text-muted-foreground">Experience</p>
            <p className="text-foreground">{leadInquiry.experience}</p>
          </div>
        )}
        {leadInquiry.how_heard && (
          <div>
            <p className="text-xs text-muted-foreground">How they heard about us</p>
            <p className="text-foreground">{leadInquiry.how_heard}</p>
          </div>
        )}
      </div>

      <div className="mb-4">
        <p className="text-xs text-muted-foreground mb-1">Goals</p>
        <p className="text-sm text-foreground whitespace-pre-wrap">{leadInquiry.goals}</p>
      </div>

      {leadInquiry.injuries && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-1">Injuries / Limitations</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{leadInquiry.injuries}</p>
        </div>
      )}

      {leadInquiry.ai_priority_reason && (
        <p className="text-sm text-muted-foreground mb-4">{leadInquiry.ai_priority_reason}</p>
      )}

      <div className="mb-4">
        <p className="text-xs text-muted-foreground mb-1.5">
          {leadInquiry.ai_draft_reply ? "Draft Reply (editable)" : "No draft yet"}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-border p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Generate an analysis to get a draft reply…"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {draft && (
          <Button asChild>
            <a
              href={buildLeadMailtoLink({
                email: leadInquiry.email,
                subject: `Re: Your ${serviceLabel} Application`,
                body: draft,
              })}
            >
              <Mail className="size-4" /> Email {firstName}
            </a>
          </Button>
        )}
        {phone && (
          <Button asChild variant="outline">
            <a href={buildTelLink(phone)}>
              <PhoneIcon className="size-4" /> Call {firstName}
            </a>
          </Button>
        )}
        <Button type="button" variant="ghost" disabled={busy} onClick={regenerate}>
          <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          {leadInquiry.ai_draft_reply ? "Regenerate" : "Generate Analysis"}
        </Button>
      </div>
    </div>
  )
}

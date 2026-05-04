"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { GoogleAdsAudienceType, GoogleAdsUserList } from "@/types/database"

const TYPES: GoogleAdsAudienceType[] = ["bookers", "subscribers", "icp"]

interface Props {
  customerIds: string[]
  existingByType: Record<GoogleAdsAudienceType, GoogleAdsUserList | undefined>
  descriptions: Record<GoogleAdsAudienceType, string>
}

export function UserListForm({ customerIds, existingByType, descriptions }: Props) {
  if (customerIds.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-xl p-6 bg-card text-sm text-muted-foreground">
        Connect a Google Ads account first (
        <a href="/admin/ads/settings" className="underline hover:text-accent">/admin/ads/settings</a>).
        User lists are scoped to a Customer ID.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {TYPES.map((t) => (
        <Row
          key={t}
          customerIds={customerIds}
          audienceType={t}
          description={descriptions[t]}
          existing={existingByType[t]}
        />
      ))}
    </div>
  )
}

function Row({
  customerIds,
  audienceType,
  description,
  existing,
}: {
  customerIds: string[]
  audienceType: GoogleAdsAudienceType
  description: string
  existing?: GoogleAdsUserList
}) {
  const [customerId, setCustomerId] = useState(existing?.customer_id ?? customerIds[0])
  const [userListId, setUserListId] = useState(existing?.user_list_id ?? "")
  const [name, setName] = useState(existing?.name ?? "")
  const [pending, setPending] = useState(false)
  const isIcp = audienceType === "icp"

  async function save() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch("/api/admin/ads/user-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          user_list_id: userListId.trim(),
          name: name.trim() || `${audienceType[0].toUpperCase()}${audienceType.slice(1)}`,
          audience_type: audienceType,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      toast.success("Saved.")
      window.location.reload()
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!existing || pending) return
    if (!confirm(`Delete the ${audienceType} list config? Local member mirror will be deleted; Google Ads list itself is untouched.`))
      return
    setPending(true)
    try {
      const res = await fetch(`/api/admin/ads/user-lists?id=${existing.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      toast.success("Removed.")
      window.location.reload()
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={`border ${isIcp ? "border-dashed border-border/60" : "border-border"} rounded-xl ${isIcp ? "bg-surface/30" : "bg-card"} p-5 space-y-3`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-primary capitalize">{audienceType}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{description}</p>
        </div>
        <span
          className={`text-[11px] font-mono uppercase tracking-wider ${
            existing ? "text-success" : "text-muted-foreground"
          }`}
        >
          {existing ? "Configured" : isIcp ? "Deferred" : "Not set"}
        </span>
      </div>
      {isIcp && !existing ? null : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Customer ID">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {customerIds.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="UserList ID (Google Ads numeric)">
              <input
                value={userListId}
                onChange={(e) => setUserListId(e.target.value)}
                placeholder="e.g. 5544332211"
                className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-card font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </Field>
            <Field label="Display name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={audienceType.charAt(0).toUpperCase() + audienceType.slice(1)}
                className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            {existing ? (
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-error hover:border-error/50 disabled:opacity-50 transition-colors"
              >
                Remove
              </button>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={pending || !userListId.trim()}
              className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {pending ? "Saving..." : existing ? "Update" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react"

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  // Live strength signal — keep it simple so the bar feels honest, not theatrical
  const strength = scorePassword(newPassword)

  function fieldError(name: string): string | undefined {
    return fieldErrors[name]?.[0]
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFieldErrors({})

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Fill in every field")
      return
    }
    if (newPassword.length < 8) {
      setFieldErrors({ newPassword: ["Minimum 8 characters"] })
      return
    }
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: ["Passwords do not match"] })
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/editor/me/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.details && typeof json.details === "object") {
          setFieldErrors(json.details as Record<string, string[]>)
        }
        throw new Error(json.error ?? "Failed to update password")
      }
      toast.success("Password updated")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="currentPassword" className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
          Current password
        </Label>
        <div className="relative">
          <Input
            id="currentPassword"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(fieldError("currentPassword"))}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide passwords" : "Show passwords"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-primary"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {fieldError("currentPassword") && (
          <p className="font-mono text-[11px] text-error">{fieldError("currentPassword")}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword" className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
          New password
        </Label>
        <Input
          id="newPassword"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={submitting}
          aria-invalid={Boolean(fieldError("newPassword"))}
        />
        <StrengthMeter score={strength} />
        {fieldError("newPassword") && (
          <p className="font-mono text-[11px] text-error">{fieldError("newPassword")}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword" className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
          Confirm new password
        </Label>
        <Input
          id="confirmPassword"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={submitting}
          aria-invalid={Boolean(fieldError("confirmPassword"))}
        />
        {fieldError("confirmPassword") && (
          <p className="font-mono text-[11px] text-error">{fieldError("confirmPassword")}</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
          <ShieldCheck className="size-3" />
          Stored hashed (bcrypt cost 12)
        </p>
        <Button type="submit" disabled={submitting} className="gap-1.5">
          <KeyRound className="size-4" />
          {submitting ? "Updating…" : "Update password"}
        </Button>
      </div>
    </form>
  )
}

function StrengthMeter({ score }: { score: number }) {
  // 0-4 scale
  const labels = ["", "Weak", "Fair", "Strong", "Excellent"]
  const tones = [
    "bg-muted",
    "bg-error",
    "bg-warning",
    "bg-success",
    "bg-success",
  ]
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= score ? tones[score] : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
        {score === 0 ? "—" : labels[score]}
      </p>
    </div>
  )
}

function scorePassword(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

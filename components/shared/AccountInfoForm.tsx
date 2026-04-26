"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"

interface AccountInfoFormProps {
  initialFirstName: string
  initialLastName: string
  initialEmail: string
}

export function AccountInfoForm({ initialFirstName, initialLastName, initialEmail }: AccountInfoFormProps) {
  const { update } = useSession()
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [email, setEmail] = useState(initialEmail)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const hasChanges = firstName !== initialFirstName || lastName !== initialLastName || email !== initialEmail

  async function handleSave() {
    if (!hasChanges) return
    setPending(true)
    setError(null)
    setFieldErrors({})
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const { message, fieldErrors: fe } = summarizeApiError(res, data, "Failed to update account.")
        setError(message)
        setFieldErrors(fe)
        toast.error(message)
        return
      }

      // Refresh the session so the navbar/header picks up the new name/email
      await update()

      toast.success("Account information updated.")
    } catch {
      const message = "We couldn't reach the server. Please try again."
      setError(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <FormErrorBanner
        message={error}
        fieldErrors={fieldErrors}
        labels={{ first_name: "First name", last_name: "Last name", email: "Email" }}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="account-first-name">First Name</Label>
          <Input id="account-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="account-last-name">Last Name</Label>
          <Input id="account-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="account-email">Email</Label>
          <Input id="account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>

      {hasChanges && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={pending || !firstName.trim() || !lastName.trim() || !email.trim()}
          >
            {pending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  )
}

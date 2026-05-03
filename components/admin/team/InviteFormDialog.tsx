"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { sendInviteSchema, type SendInviteInput } from "@/lib/validators/team-invite"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function InviteFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<SendInviteInput>({
    resolver: zodResolver(sendInviteSchema),
    defaultValues: { email: "", role: "editor" },
  })

  async function onSubmit(data: SendInviteInput) {
    const res = await fetch("/api/admin/team/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      toast.error(json.error ?? "Failed to send invite")
      return
    }
    toast.success(`Invite sent to ${data.email}`)
    reset()
    onCreated()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They'll get an email with a link to set their password and access the editor portal.
            The link expires in 7 days.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />
            {errors.email && <p id="email-error" className="text-xs text-error">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <select id="role" {...register("role")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="editor">Video Editor</option>
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

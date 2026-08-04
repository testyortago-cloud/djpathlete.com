"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useMessaging } from "./MessagingProvider"

interface ClientOption {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
}

export function NewConversationDialog() {
  const { openConversation, refreshConversations } = useMessaging()
  const [open, setOpen] = useState(false)
  const [clients, setClients] = useState<ClientOption[]>([])
  const [filter, setFilter] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void fetch("/api/messaging/clients")
      .then((res) => (res.ok ? res.json() : { clients: [] }))
      .then((data) => setClients(data.clients ?? []))
      .catch(() => setClients([]))
  }, [open])

  const visible = clients.filter((client) => {
    const haystack = `${client.first_name ?? ""} ${client.last_name ?? ""} ${client.email}`.toLowerCase()
    return haystack.includes(filter.trim().toLowerCase())
  })

  async function start(clientUserId: string) {
    setBusy(true)
    try {
      const res = await fetch("/api/messaging/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_user_id: clientUserId }),
      })
      if (!res.ok) {
        toast.error("Could not open that conversation.")
        return
      }
      const { conversation } = await res.json()
      await refreshConversations()
      openConversation(conversation.id)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Plus className="size-3.5" strokeWidth={1.5} />
          New
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Message a client</DialogTitle>
        </DialogHeader>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search clients"
          aria-label="Search clients"
          className="h-8 text-sm"
        />
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {visible.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void start(client.id)}
                className="w-full px-2 py-2 text-left text-sm transition-colors hover:bg-surface disabled:opacity-50"
              >
                <span className="block font-medium">
                  {[client.first_name, client.last_name].filter(Boolean).join(" ") || client.email}
                </span>
                <span className="block text-xs text-muted-foreground">{client.email}</span>
              </button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">No clients match that.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

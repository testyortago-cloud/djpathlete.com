"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EditClientDialog } from "@/components/admin/EditClientDialog"
import type { User } from "@/types/database"

interface ClientDetailHeaderProps {
  client: User
}

export function ClientDetailHeader({ client }: ClientDetailHeaderProps) {
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setEditOpen(true)}
      >
        <Pencil className="size-3.5" />
        Edit
      </Button>
      <EditClientDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
      />
    </>
  )
}

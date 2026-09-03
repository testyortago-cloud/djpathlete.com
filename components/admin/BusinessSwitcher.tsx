"use client"

// components/admin/BusinessSwitcher.tsx — lets a coach who belongs to more
// than one business pick which one the admin panel is currently reading and
// writing. Rendered by app/(admin)/admin/layout.tsx ONLY when there is more
// than one choice — a coach with a single business never sees this at all.

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { selectBusiness } from "@/app/(admin)/admin/actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { BusinessChoice } from "@/lib/tenancy/resolve"

interface BusinessSwitcherProps {
  choices: BusinessChoice[]
  currentId: string
}

export function BusinessSwitcher({ choices, currentId }: BusinessSwitcherProps) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleChange(nextId: string) {
    if (nextId === currentId) return
    startTransition(async () => {
      await selectBusiness(nextId)
      router.refresh()
    })
  }

  return (
    <Select value={currentId} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger aria-label="Switch business" className="h-9 w-[180px] text-sm font-body">
        <SelectValue placeholder="Choose a business" />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

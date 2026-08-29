"use client"

import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Month selector for the attendance roll-up. A native month input, so there is
 *  no calendar library and no timezone maths — its value IS `YYYY-MM`. */
export function MonthPicker({ month }: { month: string }) {
  const router = useRouter()
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="attendance-month" className="text-sm text-muted-foreground">
        Month
      </Label>
      <Input
        id="attendance-month"
        type="month"
        value={month}
        className="w-[11rem]"
        onChange={(e) => {
          const v = e.target.value
          if (v) router.push(`/admin/attendance?month=${v}`)
        }}
      />
    </div>
  )
}

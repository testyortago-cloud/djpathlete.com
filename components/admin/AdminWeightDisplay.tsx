"use client"

import { useAdminWeightUnit } from "@/hooks/use-admin-weight-unit"

export function AdminWeightDisplay({ weightKg }: { weightKg: number | null }) {
  const { formatWeight } = useAdminWeightUnit()
  if (!weightKg) return null
  return <>{formatWeight(weightKg)}</>
}

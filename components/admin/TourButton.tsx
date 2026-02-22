"use client"

import { HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TourButtonProps {
  onClick: () => void
}

export function TourButton({ onClick }: TourButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 text-muted-foreground hover:text-primary"
      onClick={onClick}
      title="Field guide"
    >
      <HelpCircle className="size-4" />
    </Button>
  )
}

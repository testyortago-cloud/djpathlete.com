"use client"

import { Button } from "@/components/ui/button"
import { Pencil, ArrowUpRight, Square, X } from "lucide-react"
import type { DrawingTool } from "@/types/database"

const COLORS = [
  { name: "red",    hex: "#FF3B30" },
  { name: "yellow", hex: "#FFCC00" },
  { name: "green",  hex: "#34C759" },
  { name: "black",  hex: "#000000" },
] as const

const TOOL_BUTTONS: Array<{ tool: DrawingTool; label: string; Icon: typeof Pencil }> = [
  { tool: "pen",       label: "Pen",       Icon: Pencil },
  { tool: "arrow",     label: "Arrow",     Icon: ArrowUpRight },
  { tool: "rectangle", label: "Rectangle", Icon: Square },
]

interface Props {
  active: boolean
  tool: DrawingTool
  color: string
  strokeWidth: number
  onToolChange: (tool: DrawingTool) => void
  onColorChange: (hex: string) => void
  onStrokeWidthChange: (px: number) => void
  onCancel: () => void
}

export function DrawingToolbar({
  active, tool, color, strokeWidth,
  onToolChange, onColorChange, onStrokeWidthChange, onCancel,
}: Props) {
  if (!active) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 shadow-sm">
      <div className="flex items-center gap-1">
        {TOOL_BUTTONS.map(({ tool: t, label, Icon }) => (
          <Button
            key={t}
            type="button"
            size="sm"
            variant={tool === t ? "default" : "outline"}
            onClick={() => onToolChange(t)}
            aria-label={label}
            aria-pressed={tool === t}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </div>

      <div className="mx-2 h-6 w-px bg-border" aria-hidden />

      <div className="flex items-center gap-1">
        {COLORS.map(({ name, hex }) => (
          <button
            key={hex}
            type="button"
            onClick={() => onColorChange(hex)}
            aria-label={`${name} color`}
            aria-pressed={color === hex}
            className={`size-6 rounded-full border-2 ${
              color === hex ? "border-primary" : "border-border"
            }`}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>

      <div className="mx-2 h-6 w-px bg-border" aria-hidden />

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Width
        <input
          type="range"
          min={2}
          max={8}
          value={strokeWidth}
          onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
          className="w-20"
        />
        <span className="w-4 text-right tabular-nums">{strokeWidth}</span>
      </label>

      <div className="ml-auto">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} aria-label="Cancel drawing">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}

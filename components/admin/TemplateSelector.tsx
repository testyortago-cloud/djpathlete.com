"use client"

import { useState, useRef, useEffect } from "react"
import { FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PROMPT_TEMPLATES, PROMPT_TEMPLATE_CATEGORIES, type PromptTemplate } from "@/lib/prompt-templates"

interface TemplateSelectorProps {
  onSelect: (prompt: string) => void
}

export function TemplateSelector({ onSelect }: TemplateSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref_ = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref_.current && !ref_.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  function handleSelect(template: PromptTemplate) {
    onSelect(template.prompt)
    setOpen(false)
  }

  const grouped = Object.entries(PROMPT_TEMPLATE_CATEGORIES)
    .map(([key, label]) => ({
      key,
      label,
      templates: PROMPT_TEMPLATES.filter((t) => t.category === key),
    }))
    .filter((g) => g.templates.length > 0)

  return (
    <div className="relative" ref={ref_}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <FileText className="size-3 mr-1" />
        Templates
      </Button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-80 max-h-72 overflow-y-auto bg-white rounded-lg border border-border shadow-lg z-50 py-1">
          {grouped.map((group) => (
            <div key={group.key}>
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-surface/50 transition-colors"
                  onClick={() => handleSelect(template)}
                >
                  <p className="text-sm font-medium">{template.name}</p>
                  <p className="text-[11px] text-muted-foreground">{template.description}</p>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

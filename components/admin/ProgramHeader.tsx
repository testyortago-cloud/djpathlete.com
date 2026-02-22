"use client"

import { useState } from "react"
import { Pencil, UserPlus, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProgramFormDialog } from "@/components/admin/ProgramFormDialog"
import { AssignProgramDialog } from "@/components/admin/AssignProgramDialog"
import type { Program, User } from "@/types/database"

interface ProgramHeaderProps {
  program: Program
  clients: User[]
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  conditioning: "Conditioning",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
  nutrition: "Nutrition",
  hybrid: "Hybrid",
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-success/10 text-success border-success/20",
  intermediate: "bg-warning/10 text-warning border-warning/20",
  advanced: "bg-destructive/10 text-destructive border-destructive/20",
  elite: "bg-primary/10 text-primary border-primary/20",
}

const SPLIT_TYPE_LABELS: Record<string, string> = {
  full_body: "Full Body",
  upper_lower: "Upper/Lower",
  push_pull_legs: "Push/Pull/Legs",
  push_pull: "Push/Pull",
  body_part: "Body Part",
  movement_pattern: "Movement Pattern",
  custom: "Custom",
}

const PERIODIZATION_LABELS: Record<string, string> = {
  linear: "Linear",
  undulating: "Undulating",
  block: "Block",
  reverse_linear: "Reverse Linear",
  none: "None",
}

function formatPrice(cents: number | null): string {
  if (cents == null) return "Free"
  return `$${(cents / 100).toFixed(2)}`
}

export function ProgramHeader({ program, clients }: ProgramHeaderProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)

  return (
    <>
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-heading font-semibold text-foreground">
                {program.name}
              </h1>
              {(Array.isArray(program.category) ? program.category : [program.category]).map((cat) => (
                <Badge key={cat} variant="outline" className="capitalize">
                  {CATEGORY_LABELS[cat] ?? cat}
                </Badge>
              ))}
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize border ${DIFFICULTY_COLORS[program.difficulty] ?? "bg-muted text-muted-foreground"}`}
              >
                {DIFFICULTY_LABELS[program.difficulty] ?? program.difficulty}
              </span>
              {program.split_type && (
                <Badge variant="outline" className="capitalize">
                  {SPLIT_TYPE_LABELS[program.split_type] ?? program.split_type}
                </Badge>
              )}
              {program.periodization && program.periodization !== "none" && (
                <Badge variant="outline" className="capitalize">
                  {PERIODIZATION_LABELS[program.periodization] ?? program.periodization}
                </Badge>
              )}
              {program.is_ai_generated && (
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="size-3" />
                  AI Generated
                </Badge>
              )}
            </div>
            {program.description && (
              <p className="text-sm text-muted-foreground">
                {program.description}
              </p>
            )}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{program.duration_weeks} week{program.duration_weeks !== 1 ? "s" : ""}</span>
              <span>{program.sessions_per_week} sessions/week</span>
              <span>{formatPrice(program.price_cents)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              <UserPlus className="size-3.5" />
              Assign
            </Button>
          </div>
        </div>
      </div>

      <ProgramFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        program={program}
      />

      <AssignProgramDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        programId={program.id}
        clients={clients}
      />
    </>
  )
}

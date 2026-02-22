"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Upload, CheckCircle2, XCircle, FileText } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { parseCsv } from "@/lib/csv-parser"
import { exerciseFormSchema } from "@/lib/validators/exercise"

interface ExerciseImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface PreviewRow {
  data: Record<string, string>
  valid: boolean
  errors: string[]
}

/** Convert pipe-delimited strings to arrays and string booleans to actual booleans. */
function transformCsvRow(row: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row }

  // Pipe-delimited array fields
  const arrayFields = ["category", "primary_muscles", "secondary_muscles", "equipment_required"]
  for (const field of arrayFields) {
    const val = row[field]
    if (val && val.trim()) {
      result[field] = val.split("|").map((s) => s.trim()).filter(Boolean)
    } else {
      result[field] = field === "category" ? [] : []
    }
  }

  // Boolean fields
  if ("is_bodyweight" in row) {
    result.is_bodyweight = row.is_bodyweight?.toLowerCase() === "true"
  }
  if ("is_compound" in row) {
    result.is_compound = row.is_compound?.toLowerCase() !== "false"
  }

  return result
}

export function ExerciseImportDialog({
  open,
  onOpenChange,
}: ExerciseImportDialogProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  const validCount = previewRows.filter((r) => r.valid).length

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const { rows } = parseCsv(text)

      const preview: PreviewRow[] = rows.map((row) => {
        const transformed = transformCsvRow(row)
        const result = exerciseFormSchema.safeParse(transformed)
        if (result.success) {
          return { data: row, valid: true, errors: [] }
        }
        const fieldErrors = result.error.flatten().fieldErrors
        const errorMessages = Object.entries(fieldErrors)
          .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
        return { data: row, valid: false, errors: errorMessages }
      })

      setPreviewRows(preview)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    const validRows = previewRows.filter((r) => r.valid).map((r) => transformCsvRow(r.data))
    if (validRows.length === 0) return

    setIsImporting(true)
    try {
      const response = await fetch("/api/admin/exercises/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: validRows }),
      })

      if (!response.ok) throw new Error("Import failed")

      const result = await response.json()
      toast.success(`Imported ${result.imported} exercises`)
      onOpenChange(false)
      setPreviewRows([])
      setFileName(null)
      router.refresh()
    } catch {
      toast.error("Failed to import exercises")
    } finally {
      setIsImporting(false)
    }
  }

  function handleClose(value: boolean) {
    if (!value) {
      setPreviewRows([])
      setFileName(null)
    }
    onOpenChange(value)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Exercises from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file with required columns: name, category, difficulty. Optional: muscle_group, equipment, description, instructions, video_url, movement_pattern, primary_muscles, secondary_muscles, force_type, laterality, equipment_required, is_bodyweight, is_compound. Use pipe (|) to separate multiple values in muscle and equipment columns.
          </DialogDescription>
        </DialogHeader>

        {previewRows.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="flex items-center justify-center size-16 rounded-full bg-primary/10">
              <Upload className="size-8 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Select a CSV file to preview and import exercises.
              </p>
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                <FileText className="size-4" />
                Choose CSV File
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">
                File: {fileName}
              </span>
              <span>
                <span className="text-success font-medium">{validCount} valid</span>
                {" / "}
                <span className="text-muted-foreground">{previewRows.length} total</span>
              </span>
            </div>

            <div className="overflow-x-auto border border-border rounded-lg max-h-72">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface/50 border-b border-border">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8" />
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Category</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Difficulty</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-3 py-2 text-center text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {row.data.name || "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground capitalize">
                        {row.data.category || "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground capitalize">
                        {row.data.difficulty || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.valid ? (
                          <CheckCircle2 className="size-4 text-success" />
                        ) : (
                          <span className="flex items-center gap-1 text-destructive">
                            <XCircle className="size-4 shrink-0" />
                            <span className="truncate max-w-[200px]" title={row.errors.join("; ")}>
                              {row.errors[0]}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isImporting}
          >
            Cancel
          </Button>
          {previewRows.length > 0 && (
            <Button
              onClick={handleImport}
              disabled={isImporting || validCount === 0}
            >
              {isImporting
                ? "Importing..."
                : `Import ${validCount} Valid Row${validCount !== 1 ? "s" : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

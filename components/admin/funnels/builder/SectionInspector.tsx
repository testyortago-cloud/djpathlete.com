"use client"

// components/admin/funnels/builder/SectionInspector.tsx - the panel that edits
// the selected section.
//
// EVERY CONTROL HERE IS GENERATED FROM `fieldsForSection`, which is generated
// from the section's own Zod schema. Nothing in this file knows that a hero has
// a headline. That is the point: a hand-written panel per kind drifts from the
// schema the moment either changes, and drifts silently - the new prop is
// simply absent, with no error and no failing test.
//
// It emits `SectionOp`s and nothing else. It does not hold the document, does
// not merge, and does not decide whether an edit is legal; `applyOps` on the
// server does all three, transactionally. The panel's job is to describe the
// change the owner asked for.

import { useMemo } from "react"
import { Trash2, ChevronUp, ChevronDown, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { fieldsForSection, styleFields, variantOptions, type SectionField } from "@/lib/funnels/sections/fields"
import { SECTION_REGISTRY, type Section, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { SectionOp } from "@/lib/funnels/sections/apply"
import { patchForPath, valueAtPath as valueAt } from "./section-patch"

interface SectionInspectorProps {
  doc: SectionDoc
  selectedId: string | null
  /** The `data-edit` path last clicked, so the matching control can be focused. */
  selectedPath: string | null
  onOps: (ops: SectionOp[]) => void
  busy: boolean
  className?: string
}

/**
 * A fresh id for a duplicated or added section.
 *
 * `sectionIdSchema` is `^[a-z][a-z0-9-]{0,39}$`, so the kind's first letter
 * plus a number satisfies it. Uniqueness is checked against the document rather
 * than assumed, because `applyOps` refuses a colliding `add_section` outright
 * and the owner would just see "already exists".
 */
export function nextSectionId(doc: SectionDoc, kind: string): string {
  const taken = new Set(doc.sections.map((section) => section.id))
  const prefix = kind.slice(0, 2).replace(/[^a-z]/g, "") || "s"
  for (let n = 1; n < 500; n++) {
    const candidate = `${prefix}${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${prefix}${Date.now().toString(36)}`
}

function FieldControl({
  field,
  props,
  onChange,
  disabled,
  autoFocus,
}: {
  field: SectionField
  props: Record<string, unknown>
  onChange: (path: string, value: unknown) => void
  disabled: boolean
  autoFocus: boolean
}) {
  const value = valueAt(props, field.path)
  const id = `field-${field.path.replace(/\./g, "-")}`

  if (field.type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(next) => onChange(field.path, next === true)}
        />
        <Label htmlFor={id} className="text-sm font-normal">
          {field.label}
        </Label>
      </div>
    )
  }

  const control = (() => {
    if (field.type === "select") {
      return (
        <select
          id={id}
          className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(field.path, event.target.value)}
        >
          {field.optional ? <option value="">Default</option> : null}
          {field.options?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }

    if (field.type === "textarea") {
      return (
        <Textarea
          id={id}
          rows={3}
          maxLength={field.maxLength}
          disabled={disabled}
          autoFocus={autoFocus}
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(event) => onChange(field.path, event.target.value)}
        />
      )
    }

    if (field.type === "number") {
      return (
        <Input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          disabled={disabled}
          defaultValue={typeof value === "number" ? value : ""}
          onBlur={(event) =>
            onChange(field.path, event.target.value === "" ? null : Number(event.target.value))
          }
        />
      )
    }

    return (
      <Input
        id={id}
        type={field.type === "url" ? "text" : "text"}
        maxLength={field.maxLength}
        pattern={field.pattern}
        disabled={disabled}
        autoFocus={autoFocus}
        defaultValue={typeof value === "string" ? value : ""}
        onBlur={(event) => onChange(field.path, event.target.value)}
      />
    )
  })()

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
        {field.label}
        {field.optional ? null : <span className="ml-1 text-[var(--error)]">*</span>}
      </Label>
      {control}
      {/* A format the schema enforces is shown BEFORE the save fails on it.
          `formKey` and `redirectUrl` are both pattern-bound; presenting them as
          free text invites a save that can only be refused. */}
      {field.type === "url" ? (
        <p className="text-xs text-muted-foreground">A site path like /thanks, or an https:// link.</p>
      ) : field.pattern ? (
        <p className="text-xs text-muted-foreground">Lowercase letters, numbers and hyphens.</p>
      ) : null}
    </div>
  )
}

export function SectionInspector({
  doc,
  selectedId,
  selectedPath,
  onOps,
  busy,
  className,
}: SectionInspectorProps) {
  const index = doc.sections.findIndex((section) => section.id === selectedId)
  const section: Section | null = index === -1 ? null : doc.sections[index]

  const fields = useMemo(() => (section ? fieldsForSection(section) : []), [section])
  const style = useMemo(() => styleFields(), [])

  if (!section) {
    return (
      <aside className={className}>
        <p className="p-4 text-sm text-muted-foreground">
          Click anything on the page to edit it. Double-click text to type straight into it.
        </p>
      </aside>
    )
  }

  const props = section.props as Record<string, unknown>
  const kindLabel = SECTION_REGISTRY[section.kind].label

  const setProp = (path: string, raw: unknown) => {
    const current = valueAt(props, path)
    // `null` is `applyOps`'s explicit delete sentinel and the only way to
    // remove an optional field over JSON. An emptied optional box therefore
    // UNSETS the prop rather than storing "", which would render an empty
    // element where the placeholder should be.
    const field = [...fields, ...style].find((candidate) => candidate.path === path)
    const value = raw === "" && field?.optional ? null : raw
    if (value === current) return
    onOps([{ op: "update_section", id: section.id, props: patchForPath(props, path, value) } as SectionOp])
  }

  const setStyle = (path: string, raw: unknown) => {
    const value = raw === "" ? null : raw
    onOps([{ op: "update_section", id: section.id, style: { [path]: value } } as unknown as SectionOp])
  }

  const move = (direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= doc.sections.length) return
    // `after: null` is "the very top" - the only way to express it, since there
    // is no section to sit after.
    const after = direction === -1 ? (index - 2 >= 0 ? doc.sections[index - 2].id : null) : doc.sections[index + 1].id
    onOps([{ op: "move_section", id: section.id, after }])
  }

  const duplicate = () => {
    onOps([
      {
        op: "add_section",
        after: section.id,
        section: { ...structuredClone(section), id: nextSectionId(doc, section.kind) },
      } as SectionOp,
    ])
  }

  const remove = () => {
    onOps([{ op: "remove_section", id: section.id }])
  }

  // `sectionDocSchema` bounds sections at 1..24, so the LAST section cannot be
  // removed. Disabling the button is how the owner finds that out; letting them
  // click it and refusing afterwards means the page visibly loses a section and
  // then puts it back.
  const canDelete = doc.sections.length > 1

  return (
    <aside className={className}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-heading text-sm text-primary">{kindLabel}</p>
          <p className="text-xs text-muted-foreground">
            Section {index + 1} of {doc.sections.length}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Move section up"
            disabled={busy || index === 0}
            onClick={() => move(-1)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Move section down"
            disabled={busy || index === doc.sections.length - 1}
            onClick={() => move(1)}
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Duplicate section"
            disabled={busy || doc.sections.length >= 24}
            onClick={duplicate}
          >
            <Copy className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Delete section"
            disabled={busy || !canDelete}
            title={canDelete ? "Delete this section" : "A page needs at least one section"}
            onClick={remove}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="field-variant" className="text-xs uppercase tracking-wide text-muted-foreground">
            Layout
          </Label>
          <select
            id="field-variant"
            className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
            value={section.variant}
            disabled={busy}
            onChange={(event) =>
              onOps([{ op: "update_section", id: section.id, variant: event.target.value }])
            }
          >
            {variantOptions(section).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {fields.map((field) => (
          <div key={field.path}>
            {field.type === "repeater" || field.type === "list" ? (
              <RepeaterSummary field={field} props={props} />
            ) : (
              <FieldControl
                field={field}
                props={props}
                onChange={setProp}
                disabled={busy}
                autoFocus={field.path === selectedPath}
              />
            )}
          </div>
        ))}

        <div className="border-t border-border pt-4">
          <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Style</p>
          <div className="grid grid-cols-2 gap-3">
            {style.map((field) => (
              <FieldControl
                key={field.path}
                field={field}
                props={section.style as Record<string, unknown>}
                onChange={setStyle}
                disabled={busy}
                autoFocus={false}
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}

/**
 * Repeating content is edited ON THE PAGE, not in a nested form in this panel.
 *
 * The items are all visible in the canvas with their own anchors, so a second
 * copy of them here would be two controls for one value - and the one in the
 * panel would be the worse of the two, because it has no layout context. This
 * says how many there are and points at the page.
 */
function RepeaterSummary({ field, props }: { field: SectionField; props: Record<string, unknown> }) {
  const value = valueAt(props, field.path)
  const count = Array.isArray(value) ? value.length : 0
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{field.label}</p>
      <p className="mt-1 text-sm text-foreground">
        {count} {count === 1 ? "item" : "items"}
        {field.min !== undefined && field.max !== undefined ? (
          <span className="text-muted-foreground">
            {" "}
            (allowed: {field.min}&ndash;{field.max})
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Double-click an item on the page to edit it.</p>
    </div>
  )
}

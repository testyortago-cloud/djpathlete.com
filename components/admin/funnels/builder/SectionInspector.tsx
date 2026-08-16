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
import { Trash2, ChevronUp, ChevronDown, Copy, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  fieldsForSection,
  styleFields,
  variantOptions,
  blankItemFor,
  blankValueFor,
  type SectionField,
} from "@/lib/funnels/sections/fields"
import { SECTION_REGISTRY, type Section, type SectionDoc } from "@/lib/funnels/sections/registry"
import type { SectionOp } from "@/lib/funnels/sections/apply"
import { patchForPath, valueAtPath as valueAt } from "@/lib/funnels/sections/patch"

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

/**
 * Where a CTA currently points, in one line of plain English.
 *
 * Reads the stored union defensively rather than casting to `CtaTarget`: the
 * panel opens on whatever is in the document, including a target written by an
 * older build or one whose ref has not been resolved yet, and a control that
 * throws on an unrecognised shape would take the whole inspector down with it.
 */
export function describeCtaTarget(target: Record<string, unknown> | undefined): string {
  const read = (key: string): string => (typeof target?.[key] === "string" ? (target[key] as string) : "")
  switch (typeof target?.kind === "string" ? target.kind : "") {
    case "url":
      return `Goes to ${read("href") || "a link"}`
    case "anchor":
      return `Scrolls down to the "${read("sectionId")}" section`
    case "step":
      return `Goes to the "${read("stepSlug")}" step of this funnel`
    case "program":
      return `Buys the program "${read("ref")}"`
    case "session_pack":
      return `Buys the session pack "${read("ref")}"`
    case "event":
      return `Registers for "${read("ref")}"`
    case "booking":
      return "Goes to the booking enquiry"
    default:
      return "This button has no destination yet."
  }
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

  // A CTA is `{label, target}` — an OBJECT — and without this branch it fell
  // through to the text input at the bottom of this function. That input read
  // `typeof value === "string"`, found an object, and rendered EMPTY; blurring
  // it then wrote a bare string over the whole CTA, which `applyOps` refuses.
  // An editor control whose only possible effect was to corrupt the thing it
  // was editing, on the panel that pairs with the canvas.
  //
  // THE LABEL IS EDITABLE, THE TARGET IS DESCRIBED. That split is a real limit
  // and not an oversight: a target is a typed union whose `program` / `event`
  // refs are only meaningful once `resolve.ts` matches them against live rows,
  // and inventing a picker here would be a second, weaker resolver. So the
  // panel says where the button currently goes and points at the one place
  // that can change it — the same move `RepeaterEditor` makes for adding a
  // form field.
  if (field.type === "cta") {
    const cta = (value ?? {}) as { label?: unknown; target?: Record<string, unknown> }
    const currentLabel = typeof cta.label === "string" ? cta.label : ""

    // AN OPTIONAL CTA THAT DOES NOT EXIST GETS NO INPUT. `fieldsForSection`
    // lists `secondaryCta` whether or not the hero has one, and a label box on
    // a missing CTA is another control that can only fail: typing in it sends
    // `{secondaryCta: {label: "x"}}`, which `applyOps` refuses for want of a
    // `target`, and the owner is told their change "could not be applied" for a
    // reason they were never shown. The chat can add the whole button at once.
    if (cta.target === undefined) {
      return (
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">{field.label}</Label>
          <p className="text-xs text-muted-foreground">
            This section has no {field.label.toLowerCase()}. Ask in the chat to add one.
          </p>
        </div>
      )
    }

    return (
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
          {field.label}
          {field.optional ? null : <span className="ml-1 text-[var(--error)]">*</span>}
        </Label>
        <Input
          id={id}
          // NO `maxLength` HERE. `ctaWithLabelSchema` owns the bound; copying
          // the number into this file is the restated-validator mistake this
          // repo has paid for repeatedly, and the server refuses an over-long
          // label anyway.
          disabled={disabled}
          autoFocus={autoFocus}
          defaultValue={currentLabel}
          onBlur={(event) => {
            const next = event.target.value.trim()
            // The schema's `min(1)`. Sending "" would come back as "that change
            // could not be applied", which names no rule and looks like a bug.
            if (next === "") {
              event.target.value = currentLabel
              return
            }
            onChange(`${field.path}.label`, next)
          }}
        />
        <p className="text-xs text-muted-foreground">{describeCtaTarget(cta.target)}</p>
        <p className="text-xs text-muted-foreground">Ask in the chat to send this button somewhere else.</p>
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
              <RepeaterEditor field={field} section={section} onOps={onOps} busy={busy} />
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
 * Repeating content: HOW MANY and IN WHAT ORDER live here; WHAT EACH ONE SAYS
 * is edited on the page.
 *
 * The split is deliberate. Every item is already on the canvas carrying its own
 * `data-edit` anchors, so duplicating its text fields into this panel would be
 * two controls for one value — and the panel's copy would be the worse of the
 * two, because it has no layout context. What the canvas CANNOT express is
 * structure: there is no gesture for "add a fourth bullet" or "move this one
 * up". That is what these rows are.
 */
function RepeaterEditor({
  field,
  section,
  onOps,
  busy,
}: {
  field: SectionField
  section: Section
  onOps: (ops: SectionOp[]) => void
  busy: boolean
}) {
  const props = section.props as Record<string, unknown>
  const value = valueAt(props, field.path)
  const items: unknown[] = Array.isArray(value) ? value : []

  const min = field.min ?? 0
  const max = field.max ?? 24

  /**
   * A format-bound required field means a generated blank could COLLIDE with an
   * existing one. `funnelFormFieldSchema.name` is the live case: two form
   * fields both named `name` submit one value, so the second silently eats the
   * first's lead data. Reordering and removing are still safe; only ADD is
   * withheld, and the note below says so rather than leaving a dead button.
   */
  const unsafeToAdd = (field.item ?? []).some(
    (child) => !child.optional && child.pattern !== undefined,
  )

  const replace = (next: unknown[]) => {
    onOps([
      { op: "update_section", id: section.id, props: patchForPath(props, field.path, next) } as SectionOp,
    ])
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    replace(next)
  }

  const remove = (index: number) => replace(items.filter((_, i) => i !== index))

  const add = () =>
    replace([...items, field.type === "repeater" ? blankItemFor(field) : blankValueFor(field)])

  /** The first text a row holds, so a row is recognisable without opening it. */
  const rowLabel = (item: unknown, index: number): string => {
    if (typeof item === "string") return item
    if (item && typeof item === "object") {
      for (const child of field.item ?? []) {
        const candidate = (item as Record<string, unknown>)[child.path]
        if (typeof candidate === "string" && candidate.trim() !== "") return candidate
      }
      // A CTA item (footer links) keeps its label one level in.
      const label = (item as { label?: unknown }).label
      if (typeof label === "string" && label.trim() !== "") return label
    }
    return `Item ${index + 1}`
  }

  return (
    // A named group, because a section can hold more than one list (a form has
    // both `fields` and `proofPoints`) and "Add" on its own says nothing about
    // what it adds — to a screen reader or to a test.
    <div role="group" aria-label={field.label} className="rounded-md border border-border bg-surface/40 p-2">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{field.label}</p>
        <p className="text-xs text-muted-foreground">
          {items.length} of {min}&ndash;{max}
        </p>
      </div>

      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={index} className="flex items-center gap-1 rounded bg-white px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{rowLabel(item, index)}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Move ${field.label} ${index + 1} up`}
              disabled={busy || index === 0}
              onClick={() => move(index, -1)}
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Move ${field.label} ${index + 1} down`}
              disabled={busy || index === items.length - 1}
              onClick={() => move(index, 1)}
            >
              <ChevronDown className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Remove ${field.label} ${index + 1}`}
              // The schema's own lower bound. Removing past it produces a
              // document `applyOps` refuses, so the row would vanish from the
              // page and come straight back — worse than a disabled button.
              disabled={busy || items.length <= min}
              title={items.length <= min ? `At least ${min} required` : undefined}
              onClick={() => remove(index)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      {unsafeToAdd ? (
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          Add a field by describing it in the chat — new ones need a unique name.
        </p>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          disabled={busy || items.length >= max}
          title={items.length >= max ? `At most ${max}` : undefined}
          onClick={add}
        >
          <Plus className="size-4" />
          Add
        </Button>
      )}

      <p className="px-1 pt-2 text-xs text-muted-foreground">
        Double-click an item on the page to change its wording.
      </p>
    </div>
  )
}

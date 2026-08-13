"use client"

// The inspector. Its fields come from the selected element's own ElementDef —
// and for islands, from ISLAND_TRAITS via `fieldsForIsland` — so a control can
// never exist for a setting the compiler would reject, nor a setting exist with
// no control (a `form` once shipped a successMode default with no way to change
// it, which made the Redirect URL field below it purely decorative).
//
// The Style groups follow the same rule from the other direction. `styleToCss`
// compiles roughly seventeen properties and this panel offered three of them,
// so the rest were reachable only by hand-editing the stored document. Every
// group below writes a property the compiler already honours.
//
// WHICH GROUPS APPEAR IS DERIVED, NOT DECLARED. Typography is offered only when
// the element's own `compile` passes TypeStyle through — see
// `lib/funnels/tree/capability.ts`. A divider therefore cannot be given a
// font-size box that silently does nothing, and no flag has to be kept in step
// with the compiler to keep it that way.

import { useEditor } from "@craftjs/core"
import type { ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ELEMENT_REGISTRY, fieldsForIsland } from "@/lib/funnels/tree/elements"
import { honoursType, richtextField } from "@/lib/funnels/tree/capability"
import type { FieldSpec } from "@/lib/funnels/tree/element-def"
import type { BoxStyle, ElementKind, Sides, TypeStyle } from "@/lib/funnels/tree/types"
import type { IslandName } from "@/lib/funnels/islands"

const SIDES = ["top", "right", "bottom", "left"] as const

/** The border styles `styleToCss` will emit. Narrowed from BoxStyle so the
 * select cannot offer a value the type refuses. */
type BorderStyle = NonNullable<BoxStyle["border"]>["style"]

export function Inspector() {
  const { selectedId, kind, elementProps, style, typeStyle, editing, actions } = useEditor(
    (state, query) => {
      const id = Array.from(state.events.selected)[0]
      if (!id || !state.nodes[id]) return { selectedId: null }
      const props = state.nodes[id].data.props
      return {
        selectedId: id,
        kind: props.kind as ElementKind | undefined,
        elementProps: (props.elementProps ?? {}) as Record<string, unknown>,
        style: (props.style ?? {}) as BoxStyle,
        typeStyle: (props.type ?? {}) as TypeStyle,
        editing: Boolean(props.editing),
        query,
      }
    },
  )

  if (!selectedId) {
    return (
      <aside aria-label="Inspector" className="w-72 shrink-0 border-l border-border bg-surface/30 p-4">
        <p className="text-sm text-muted-foreground">Select something on the page to edit it.</p>
      </aside>
    )
  }

  const def = kind ? ELEMENT_REGISTRY[kind] : undefined

  // An island's real fields depend on WHICH island, so they are looked up per
  // selection rather than being static on the def.
  const fields: FieldSpec[] =
    def && kind === "island"
      ? [
          ...def.fields,
          ...fieldsForIsland((elementProps.name as IslandName) ?? "form"),
        ]
      : (def?.fields ?? [])

  const inlineField = def ? richtextField(def) : null
  const showTypography = def ? honoursType(def) : false

  function setElementProp(name: string, value: unknown) {
    actions.setProp(selectedId as string, (props: Record<string, unknown>) => {
      const next = { ...((props.elementProps ?? {}) as Record<string, unknown>) }
      next[name] = value
      props.elementProps = next
    })
  }

  function setIslandProp(name: string, value: unknown) {
    actions.setProp(selectedId as string, (props: Record<string, unknown>) => {
      const outer = { ...((props.elementProps ?? {}) as Record<string, unknown>) }
      const inner = { ...((outer.islandProps ?? {}) as Record<string, unknown>) }
      inner[name] = value
      outer.islandProps = inner
      props.elementProps = outer
    })
  }

  function setStyle(patch: Partial<BoxStyle>) {
    actions.setProp(selectedId as string, (props: Record<string, unknown>) => {
      props.style = { ...((props.style ?? {}) as BoxStyle), ...patch }
    })
  }

  /**
   * Typography lands on `props.type`, NOT inside `props.style`. `styleToCss`
   * takes TypeStyle as a separate second argument, so a font size written into
   * BoxStyle compiles to nothing at all.
   */
  function setType(patch: Partial<TypeStyle>) {
    actions.setProp(selectedId as string, (props: Record<string, unknown>) => {
      props.type = { ...((props.type ?? {}) as TypeStyle), ...patch }
    })
  }

  function setSide(which: "padding" | "margin", side: (typeof SIDES)[number], value: string) {
    setStyle({ [which]: { ...((style[which] ?? {}) as Sides), [side]: value } })
  }

  const islandProps = (elementProps.islandProps ?? {}) as Record<string, unknown>

  return (
    <aside
      aria-label="Inspector"
      className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-border bg-surface/30 p-4"
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Content</p>
        <p className="mt-0.5 text-sm font-medium text-primary">{def?.label ?? "Block"}</p>
      </div>

      <div className="space-y-3">
        {fields.map((field) => {
          // The island picker writes to the element's own props; every other
          // island field writes inside `islandProps`.
          const isOuter = kind !== "island" || field.name === "name"
          const value = isOuter ? elementProps[field.name] : islandProps[field.name]
          const onChange = (next: unknown) =>
            isOuter ? setElementProp(field.name, next) : setIslandProp(field.name, next)

          // While the owner is typing on the page, the canvas owns this value.
          // A second editor bound to the same prop would fight it for the caret.
          if (inlineField && field.name === inlineField.name && editing) {
            return (
              <p key={field.name} className="text-xs text-muted-foreground">
                Editing <span className="font-medium text-primary">{field.label}</span> on the page.
                Click away to finish.
              </p>
            )
          }

          return <Field key={field.name} field={field} value={value} onChange={onChange} />
        })}
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">This block has no content settings.</p>
        ) : null}
        {inlineField ? (
          <p className="text-xs text-muted-foreground">Tip: double-click the text on the page to edit it there.</p>
        ) : null}
      </div>

      <Group title="Spacing" defaultOpen>
        {(["padding", "margin"] as const).map((which) => (
          <div key={which} className="space-y-1.5">
            <p className="text-xs font-medium capitalize text-muted-foreground">{which}</p>
            <div className="grid grid-cols-2 gap-2">
              {SIDES.map((side) => (
                <StyleField
                  key={side}
                  id={`insp-${which}-${side}`}
                  label={`${which === "padding" ? "Padding" : "Margin"} ${side}`}
                  value={(style[which] ?? {})[side] ?? ""}
                  placeholder="0px"
                  onChange={(next) => setSide(which, side, next)}
                />
              ))}
            </div>
          </div>
        ))}
      </Group>

      {showTypography ? (
        <Group title="Typography" defaultOpen>
          <StyleField
            id="insp-font-size"
            label="Font size"
            value={typeStyle.fontSize ?? ""}
            placeholder="48px"
            onChange={(next) => setType({ fontSize: next })}
          />
          <StyleField
            id="insp-font-weight"
            label="Font weight"
            value={typeStyle.fontWeight ?? ""}
            placeholder="600"
            onChange={(next) => setType({ fontWeight: next })}
          />
          <StyleField
            id="insp-line-height"
            label="Line height"
            value={typeStyle.lineHeight ?? ""}
            placeholder="1.2"
            onChange={(next) => setType({ lineHeight: next })}
          />
          <StyleField
            id="insp-text-colour"
            label="Text colour"
            value={typeStyle.color ?? ""}
            placeholder="#0b1f2a"
            onChange={(next) => setType({ color: next })}
          />
          <StyleField
            id="insp-letter-spacing"
            label="Letter spacing"
            value={typeStyle.letterSpacing ?? ""}
            placeholder="-0.02em"
            onChange={(next) => setType({ letterSpacing: next })}
          />
        </Group>
      ) : null}

      <Group title="Background">
        <StyleField
          id="insp-bg-colour"
          label="Background colour"
          value={style.background?.color ?? ""}
          placeholder="#ffffff"
          onChange={(next) => setStyle({ background: { ...(style.background ?? {}), color: next } })}
        />
        <StyleField
          id="insp-bg-image"
          label="Background image"
          value={style.background?.image ?? ""}
          placeholder="https://…"
          onChange={(next) => setStyle({ background: { ...(style.background ?? {}), image: next } })}
        />
      </Group>

      <Group title="Border">
        <StyleField
          id="insp-border-width"
          label="Border width"
          value={style.border?.width ?? ""}
          placeholder="1px"
          onChange={(next) => setStyle({ border: { ...(style.border ?? {}), width: next } })}
        />
        <div className="space-y-1.5">
          <Label htmlFor="insp-border-style">Border style</Label>
          <select
            id="insp-border-style"
            value={style.border?.style ?? ""}
            onChange={(event) =>
              setStyle({
                border: {
                  ...(style.border ?? {}),
                  style: (event.target.value || undefined) as BorderStyle,
                },
              })
            }
            className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="">None</option>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>
        <StyleField
          id="insp-border-colour"
          label="Border colour"
          value={style.border?.color ?? ""}
          placeholder="#e5e7eb"
          onChange={(next) => setStyle({ border: { ...(style.border ?? {}), color: next } })}
        />
        <StyleField
          id="insp-radius"
          label="Corner radius"
          value={style.radius ?? ""}
          placeholder="12px"
          onChange={(next) => setStyle({ radius: next })}
        />
      </Group>

      <Group title="Layout">
        <div className="space-y-1.5">
          <Label htmlFor="insp-align">Align</Label>
          <select
            id="insp-align"
            value={style.align ?? "left"}
            onChange={(event) => setStyle({ align: event.target.value as BoxStyle["align"] })}
            className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <StyleField
          id="insp-max-width"
          label="Max width"
          value={style.maxWidth ?? ""}
          placeholder="720px"
          onChange={(next) => setStyle({ maxWidth: next })}
        />
      </Group>
    </aside>
  )
}

/**
 * A collapsible style group. `<details>` keeps its contents in the DOM when
 * closed, so a collapsed group is hidden from the eye without being hidden from
 * assistive technology or from a test that asks for a control by its label.
 */
function Group({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="border-t border-border pt-3">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </summary>
      <div role="group" aria-label={title} className="space-y-3 pt-3">
        {children}
      </div>
    </details>
  )
}

function StyleField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  onChange: (next: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldSpec
  value: unknown
  onChange: (next: unknown) => void
}) {
  const id = `insp-${field.name}`

  if (field.type === "select") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
        >
          {(field.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    )
  }

  if (field.type === "number") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <Input
          id={id}
          type="number"
          value={String(value ?? "")}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    )
  }

  if (field.type === "richtext" || field.type === "json") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <Textarea
          id={id}
          rows={field.type === "richtext" ? 4 : 3}
          value={
            field.type === "json"
              ? JSON.stringify(value ?? null, null, 2)
              : String(value ?? "")
          }
          onChange={(event) => {
            if (field.type !== "json") return onChange(event.target.value)
            try {
              onChange(JSON.parse(event.target.value))
            } catch {
              // Keep the keystroke; half-typed JSON is not an error yet.
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <Input id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

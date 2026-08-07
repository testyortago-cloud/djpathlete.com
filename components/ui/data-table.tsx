import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The house table style — the standard for every list in the app.
 *
 * Taken from the Clients list, which is the reference. Use these instead of a
 * bare `<table>`: the chrome (card, toolbar, header tint, row hover, cell
 * padding, empty state, footer) is fixed here so a new page cannot quietly
 * invent its own variant. /admin/team did exactly that — a grey header bar,
 * tighter rows, square corners — and it read as a different app.
 *
 * Not for HTML emails (`components/emails/*`, which need inline styles) or
 * print views, which carry their own stylesheets.
 *
 * Shape:
 *
 *   <DataTableCard>
 *     <DataTableToolbar>search / filters</DataTableToolbar>
 *     <DataTable>
 *       <DataTableHeader>
 *         <DataTableHead>Name</DataTableHead>
 *         <DataTableHead align="right">Actions</DataTableHead>
 *       </DataTableHeader>
 *       <tbody>
 *         <DataTableRow>
 *           <DataTableCell>…</DataTableCell>
 *           <DataTableCell align="right">…</DataTableCell>
 *         </DataTableRow>
 *         <DataTableEmpty colSpan={2}>Nothing here yet.</DataTableEmpty>
 *       </tbody>
 *     </DataTable>
 *     <DataTableFooter>pagination</DataTableFooter>
 *   </DataTableCard>
 *
 * `DataTableToolbar` and `DataTableFooter` are optional — a list with no
 * search and no pagination just omits them.
 */

function DataTableCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="data-table-card"
      className={cn("rounded-xl border border-border bg-white shadow-sm", className)}
      {...props}
    />
  )
}

/** Search inputs, filters and bulk actions. Sits above the table, inside the card. */
function DataTableToolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="data-table-toolbar"
      className={cn("flex flex-col gap-3 border-b border-border p-4 sm:flex-row", className)}
      {...props}
    />
  )
}

function DataTable({ className, children, ...props }: React.ComponentProps<"table">) {
  return (
    // Wide tables scroll inside the card rather than pushing the page sideways.
    <div data-slot="data-table-scroll" className="overflow-x-auto">
      <table data-slot="data-table" className={cn("w-full text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  )
}

/** Renders the `<thead>` *and* its single row — pass `<DataTableHead>` cells straight in. */
function DataTableHeader({ className, children, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead data-slot="data-table-header" {...props}>
      <tr className={cn("border-b border-border bg-surface/50", className)}>{children}</tr>
    </thead>
  )
}

function DataTableHead({
  align = "left",
  className,
  ...props
}: React.ComponentProps<"th"> & { align?: "left" | "right" }) {
  return (
    <th
      data-slot="data-table-head"
      className={cn(
        "px-4 py-3 font-medium text-muted-foreground",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  )
}

function DataTableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="data-table-row"
      className={cn(
        "border-b border-border transition-colors last:border-b-0 hover:bg-surface/30",
        className,
      )}
      {...props}
    />
  )
}

function DataTableCell({
  align = "left",
  muted,
  className,
  ...props
}: React.ComponentProps<"td"> & { align?: "left" | "right"; muted?: boolean }) {
  return (
    <td
      data-slot="data-table-cell"
      className={cn(
        "px-4 py-3",
        muted && "text-muted-foreground",
        align === "right" && "text-right",
        className,
      )}
      {...props}
    />
  )
}

/** The "nothing here" row. Spans the table so the message sits under the header, centred. */
function DataTableEmpty({
  colSpan,
  className,
  ...props
}: React.ComponentProps<"td"> & { colSpan: number }) {
  return (
    <tr data-slot="data-table-empty">
      <td
        colSpan={colSpan}
        className={cn("px-4 py-12 text-center text-muted-foreground", className)}
        {...props}
      />
    </tr>
  )
}

/** Pagination and row counts. Sits below the table, inside the card. */
function DataTableFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="data-table-footer"
      className={cn("flex items-center justify-between border-t border-border p-4 text-sm", className)}
      {...props}
    />
  )
}

/**
 * The pill used for statuses and roles in a cell. Tones match the Clients list
 * so "Active" is the same green everywhere it appears.
 */
type DataTableBadgeTone = "neutral" | "success" | "warning" | "info" | "danger"

const BADGE_TONES: Record<DataTableBadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-accent/15 text-accent",
  info: "bg-primary/10 text-primary",
  danger: "bg-destructive/10 text-destructive",
}

function DataTableBadge({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: DataTableBadgeTone }) {
  return (
    <span
      data-slot="data-table-badge"
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  )
}

export {
  DataTableCard,
  DataTableToolbar,
  DataTable,
  DataTableHeader,
  DataTableHead,
  DataTableRow,
  DataTableCell,
  DataTableEmpty,
  DataTableFooter,
  DataTableBadge,
  type DataTableBadgeTone,
}

// __tests__/components/messaging/shell-clears-dock.test.ts
//
// The last thing on a page (a table's pagination, a form's Save) sits at the
// bottom of the shell's <main> once the page is scrolled all the way down. If
// <main>'s bottom padding is smaller than the Messages dock, the dock covers it
// and nothing can scroll it out from under. That hid the Programs list's page
// arrows. The page shells reserve the corner, never the dock (dock-geometry.ts).
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { clearsMessagingDock, tailwindBottomPaddingPx, SM_BUTTON_HEIGHT_PX } from "@/components/messaging/dock-geometry"

function mainClasses(file: string): string {
  const match = /<main className="([^"]+)"/.exec(readFileSync(file, "utf8"))
  if (!match) throw Error(`no <main className="..."> in ${file}`)
  return match[1]
}

describe.each([["components/admin/AdminLayout.tsx"], ["components/client/ClientLayout.tsx"]])(
  "%s <main> bottom padding",
  (file) => {
    it("keeps a button at the very bottom of the page clear of the Messages dock on large screens", () => {
      const pad = tailwindBottomPaddingPx(mainClasses(file), "lg")
      expect(clearsMessagingDock(pad, SM_BUTTON_HEIGHT_PX, "lg")).toBe(true)
    })
  },
)

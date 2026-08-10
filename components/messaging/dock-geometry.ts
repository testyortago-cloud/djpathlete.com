// components/messaging/dock-geometry.ts — the collapsed Messages dock's
// footprint, and the one predicate that answers "is this bottom-anchored
// control reachable?".
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS: A BUTTON THAT RENDERS, ENABLES, AND CANNOT BE CLICKED.
// ---------------------------------------------------------------------------
// `MessagingDock` renders a `fixed bottom-20 right-4 z-40 … lg:bottom-4`
// floating button on EVERY admin and client page (mounted globally by
// `components/messaging/MessagingMount.tsx`). Every ordinary page scrolls, so
// the dock covers content the reader can move out from under it.
//
// The AI page builder is not an ordinary page: it is a
// `h-[calc(100dvh-4rem)]` app shell whose review footer is pinned to the
// bottom of the viewport. Measured in Chromium at 1600x1000, "Publish now"
// sat at x1460 y956 124x32 and the dock at x1457 y940 127x44 —
// `document.elementFromPoint` at the button's own centre returned the DOCK.
// The button rendered, reported enabled, passed every jsdom test in
// `__tests__/components/admin/funnel-builder.test.tsx`, and could not be
// clicked by a human. NO TEST IN THIS REPO COULD HAVE SEEN IT: jsdom has no
// layout engine, so `getBoundingClientRect` is all zeros and
// `elementFromPoint` is meaningless.
//
// So the fix is not "detect the overlap at runtime" — nothing can, in the
// tooling this repo has. It is to make the geometry a VALUE both sides read:
// the dock's inset and height live here, the clearance a bottom-anchored
// action row must reserve is derived from them by `clearsMessagingDock`, and
// a test asserts the derivation rather than restating a pixel count.
//
// THE FIX GOES IN THE PAGE, NEVER IN THE DOCK. Moving or hiding the dock
// changes a component every other admin and client page depends on, to fix one
// page's layout. The page reserves the corner instead.
//
// ---------------------------------------------------------------------------
// WHAT IS MEASURED AND WHAT IS DERIVED — read before changing a number.
// ---------------------------------------------------------------------------
// `MESSAGING_DOCK_INSET_PX` is DERIVED from the dock's own Tailwind classes
// (`bottom-20` = 20 * 4px, `lg:bottom-4` = 4 * 4px) and is pinned against
// `MessagingDock.tsx`'s source by the test, so a future reposition of the dock
// fails here rather than silently swallowing a button somewhere.
//
// `MESSAGING_DOCK_HEIGHT_PX` is MEASURED — it comes from `px-4 py-3` plus a
// 20px icon plus a `text-sm` label, none of which this file can compute. It
// does not vary with the label (the unread badge grows the dock's WIDTH, not
// its height), which is exactly why the clearance below is reserved on the
// VERTICAL axis: width depends on a translated string and an unread count,
// height does not.

/**
 * The dock's distance from the bottom of the viewport, per breakpoint.
 *
 * `bottom-20` below `lg` is deliberate in `MessagingDock` — it clears the
 * client shell's mobile tab bar. That is why a bottom-anchored footer needs
 * NO clearance on small screens and a real one on large ones: below `lg` the
 * dock floats 80px up and a 32px control sitting 12px off the bottom passes
 * cleanly underneath it.
 */
export const MESSAGING_DOCK_INSET_PX = { base: 80, lg: 16 } as const

export type DockScope = keyof typeof MESSAGING_DOCK_INSET_PX

/** Rendered height of the collapsed dock button. Measured, not derived. */
export const MESSAGING_DOCK_HEIGHT_PX = 44

/**
 * The bottom padding a bottom-anchored action row must carry so its buttons
 * clear the dock at every breakpoint.
 *
 * Kept as a literal class string because Tailwind cannot see a constructed
 * one — the JIT scans source for whole class names. `clearsMessagingDock`
 * plus `tailwindBottomPaddingPx` are what stop it drifting from the numbers
 * above: the test parses THIS string and asks the predicate, so shrinking it
 * to `pb-3` goes red instead of quietly putting a button back under the dock.
 */
export const MESSAGING_DOCK_CLEARANCE_CLASS = "pb-3 lg:pb-20"

/**
 * A `size="sm"` shadcn button is `h-8`. Both the builder's "Publish now" and
 * its "Cancel" are that size, and the browser measurement above agrees (32px).
 */
export const SM_BUTTON_HEIGHT_PX = 32

/**
 * Reads the effective `pb-*` for one breakpoint out of a Tailwind class
 * string. `base` ignores `lg:`-prefixed tokens; `lg` prefers an `lg:pb-*` and
 * falls back to the unprefixed one, which is what the cascade does.
 *
 * Tailwind's spacing scale is `n * 0.25rem`, and this app never overrides the
 * root font size, so one step is 4px.
 */
export function tailwindBottomPaddingPx(classes: string, scope: DockScope): number {
  const tokens = classes.split(/\s+/).filter(Boolean)
  const read = (prefix: string): number | null => {
    let value: number | null = null
    for (const token of tokens) {
      const match = new RegExp(`^${prefix}p([by])-(\\d+)$`).exec(token)
      if (match) value = Number(match[2]) * 4
    }
    return value
  }
  if (scope === "lg") return read("lg:") ?? read("") ?? 0
  return read("") ?? 0
}

/**
 * True when a control anchored `bottomPx` off the bottom of the viewport does
 * not intersect the dock at this breakpoint.
 *
 * The control occupies `[bottomPx, bottomPx + heightPx]` measured up from the
 * viewport floor; the dock occupies `[inset, inset + height]`. Clear means
 * entirely below the dock (small screens, where the dock floats above the tab
 * bar) or entirely above it (large screens, where the dock sits in the
 * corner). Anything else is a control a human cannot click, however green the
 * suite is.
 */
export function clearsMessagingDock(bottomPx: number, heightPx: number, scope: DockScope): boolean {
  const dockBottom = MESSAGING_DOCK_INSET_PX[scope]
  const dockTop = dockBottom + MESSAGING_DOCK_HEIGHT_PX
  return bottomPx + heightPx <= dockBottom || bottomPx >= dockTop
}

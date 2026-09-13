// components/admin/pipeline/BoardSwitcher.tsx — the row of pills above the
// Lead Engine board, one per board this tenant has (Task 8, audit §4 #7).
//
// Deliberately NOT a tabs component and NOT a client component. Every pill is
// an ordinary link back to /admin/pipeline with a different `?board`, so the
// server component re-reads the board it names and re-renders — there is no
// state here to hold, nothing to hydrate, and no second rendering path for the
// board that could disagree with the first.
//
// It also does not decide anything. WHICH board is active is the page's call
// (it validates `?board` against the tenant's own boards before trusting it);
// this component is handed the answer and only has to show it.

import Link from "next/link"
import { cn } from "@/lib/utils"

export type BoardSwitcherBoard = { key: string; name: string }

export function BoardSwitcher({ boards, activeKey }: { boards: BoardSwitcherBoard[]; activeKey: string }) {
  return (
    <nav
      aria-label="Pipeline boards"
      className="inline-flex gap-1 rounded-lg border border-border bg-white p-1 font-body"
    >
      {boards.map((board) => {
        const isActive = board.key === activeKey
        return (
          <Link
            key={board.key}
            // `pipelines.key` is a slug today, so this encodes to itself — but
            // the column has no format constraint, and a key with a `&` in it
            // would otherwise truncate the query string.
            href={`/admin/pipeline?board=${encodeURIComponent(board.key)}`}
            // The name the coach configured (`pipelines.name`), never the key.
            // A board renamed to "Assessments & Screens" must say so.
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-surface/50 hover:text-foreground",
            )}
          >
            {board.name}
          </Link>
        )
      })}
    </nav>
  )
}

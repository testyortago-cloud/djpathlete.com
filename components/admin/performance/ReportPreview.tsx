"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ExternalLink, Copy, RefreshCw } from "lucide-react"

/**
 * Live preview of the client's public test report, inside the admin Tests tab.
 *
 * Deliberately an iframe of the REAL `/athlete/<token>` page rather than a
 * re-implementation: a second summary UI would drift out of sync with the
 * document the client actually receives, and the whole point of this panel is
 * "what will they see after I log this test".
 *
 * Same-origin, so `frame-src 'self'` in next.config.mjs already covers it — no
 * CSP change needed (and a CSP miss here would fail silently, see the project's
 * frame-src lesson).
 */
export function ReportPreview({ reportUrl, clientName }: { reportUrl: string; clientName: string }) {
  // Bumping this remounts the iframe, so the coach can pull fresh numbers after
  // logging a test without reloading the whole admin page.
  const [nonce, setNonce] = useState(0)
  const first = clientName.split(" ")[0] || "this client"

  // Rendered at desktop width then scaled down, so the preview shows the real
  // multi-column layout rather than the mobile stack an iframe-width render
  // would produce.
  // One report "page" is a viewport tall (the pages are min-h-screen). Rendering
  // at this size and scaling the WINDOW by the same factor means the preview
  // always shows exactly one full page, at any container width.
  const RENDER_WIDTH = 1280
  const RENDER_HEIGHT = 900

  // Scale is MEASURED, not fixed: a hardcoded scale leaves dead space beside the
  // frame on wide screens and overflows on narrow ones.
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(0.42)

  const measure = useCallback(() => {
    const w = hostRef.current?.clientWidth
    if (w && w > 0) setScale(w / RENDER_WIDTH)
  }, [])

  useEffect(() => {
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    if (hostRef.current) ro.observe(hostRef.current)
    return () => ro.disconnect()
  }, [measure])

  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-sm font-bold text-foreground">Test report preview</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Exactly what {first} and their parents see. Updates as you log tests.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface/50"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.5} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(reportUrl)
              toast.success("Report link copied")
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface/50"
          >
            <Copy className="size-3.5" strokeWidth={1.5} />
            Copy link
          </button>
          <a
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <ExternalLink className="size-3.5" strokeWidth={1.5} />
            Open
          </a>
        </div>
      </div>

      <div ref={hostRef} className="mt-3 overflow-hidden rounded-lg border border-border bg-surface/40">
        {/* Fixed-height window; the iframe is scaled inside it and clipped. */}
        <div className="relative w-full overflow-hidden" style={{ height: `${RENDER_HEIGHT * scale}px` }}>
          <iframe
            key={nonce}
            src={reportUrl}
            title={`${first}'s test report preview`}
            loading="lazy"
            // Non-interactive on purpose: this is a preview, and swallowing
            // clicks stops a stray click scrolling or printing inside the frame.
            className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
            style={{
              width: `${RENDER_WIDTH}px`,
              height: `${RENDER_HEIGHT}px`,
              transform: `scale(${scale})`,
            }}
          />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Scroll the full report with <span className="font-medium text-foreground">Open</span>. The link is permanent
        and always shows the latest results.
      </p>
    </section>
  )
}

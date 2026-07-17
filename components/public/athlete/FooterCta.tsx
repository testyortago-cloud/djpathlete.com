import Image from "next/image"
import { ArrowRight } from "lucide-react"

/**
 * Closing brand band — the card is a marketing surface every time it's shared.
 * Sticky: pinned to the viewport bottom so the CTA stays in view while the
 * card scrolls (and sits flush on sparse cards via the flex-column layout).
 * Print keeps it as a normal closing band.
 */
export function FooterCta() {
  return (
    <footer className="sticky bottom-0 z-20 mt-16 overflow-hidden bg-primary text-primary-foreground shadow-[0_-12px_32px_-12px_oklch(0_0_0/0.45)] print:static print:shadow-none [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
      {/* Accent hairline top edge — reads as the band's cut line. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/80 to-transparent" />
      {/* Glow field bookending the hero's (mirrored corners). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at bottom left, oklch(0.70 0.08 60 / 0.22), transparent 45%), radial-gradient(circle at top right, oklch(1 0 0 / 0.06), transparent 35%)",
        }}
      />
      <div className="relative mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/logos/logo-icon-light.png" alt="DJP Athlete" width={32} height={32} className="h-8 w-auto" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">DJP Athlete</p>
            {/* The full line doesn't fit beside the CTA on phones — eyebrow carries the brand there. */}
            <p className="hidden truncate font-heading text-sm font-bold uppercase leading-tight tracking-tight sm:block md:text-base">
              Train with Darren <span className="text-accent">J Paul</span>
            </p>
          </div>
        </div>
        <a
          href="https://www.darrenjpaul.com/"
          className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-accent px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary transition-all hover:shadow-[0_0_24px_-4px_oklch(0.70_0.08_60/0.8)] hover:brightness-110 md:px-5"
        >
          Start Training
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
        </a>
      </div>
    </footer>
  )
}

"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import type { SocialPlatform } from "@/types/database"
import { PLATFORM_SETUP_GUIDES } from "@/lib/platform-setup-guides"
import { cn } from "@/lib/utils"

interface SetupGuideProps {
  platform: SocialPlatform
  platformLabel: string
  alreadyConnected: boolean
}

export function SetupGuide({ platform, platformLabel, alreadyConnected }: SetupGuideProps) {
  const [open, setOpen] = useState(false)
  const guide = PLATFORM_SETUP_GUIDES[platform]

  return (
    <div className="w-full mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
      >
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        {open ? "Hide" : "Show"} setup guide for {platformLabel}
      </button>

      {open && (
        <div className="mt-3 space-y-4 text-sm">
          <section>
            <h4 className="font-medium text-primary text-xs uppercase tracking-wide">I already have {platformLabel}</h4>
            <ol className="mt-2 space-y-1.5 text-muted-foreground list-decimal list-inside">
              {guide.connectSteps.map((step, i) => (
                <li key={i} className="text-sm">
                  {step}
                </li>
              ))}
            </ol>
            {alreadyConnected && <p className="mt-2 text-xs text-success">You&apos;re already connected.</p>}
          </section>

          {guide.accountSetupSteps.length > 0 && guide.accountSetupMinutes > 0 && (
            <section>
              <h4 className="font-medium text-primary text-xs uppercase tracking-wide">
                I don&apos;t have {platformLabel} yet ({guide.accountSetupMinutes} min)
              </h4>
              <ol className="mt-2 space-y-1.5 text-muted-foreground list-decimal list-inside">
                {guide.accountSetupSteps.map((step, i) => (
                  <li key={i} className="text-sm">
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div
            className={cn(
              "flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
              "pt-2 border-t border-border",
            )}
          >
            <span className="font-medium text-primary">Permissions granted:</span>
            {guide.scopesGranted.map((scope) => (
              <code key={scope} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted/40 text-foreground">
                {scope}
              </code>
            ))}
            {guide.helpUrl && (
              <a
                href={guide.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
              >
                {platformLabel} docs <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

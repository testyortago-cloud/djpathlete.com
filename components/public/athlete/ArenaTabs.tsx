"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

export interface ArenaTab {
  value: string
  label: string
  content: React.ReactNode
}

/**
 * Arena tab shell. Panels are force-mounted and hidden with CSS so (a) the
 * print stylesheet can reveal every tab in the PDF (each panel keeps its own
 * section headings) and (b) all content stays in the DOM for tests/SEO-free
 * crawling. The trigger row hides in print.
 */
export function ArenaTabs({ tabs }: { tabs: ArenaTab[] }) {
  if (tabs.length === 0) return null
  // A tab bar with one tab is noise — render the panel straight.
  if (tabs.length === 1) return <div>{tabs[0].content}</div>

  return (
    <Tabs defaultValue={tabs[0].value}>
      <TabsList
        variant="line"
        className="sticky top-0 z-30 -mx-4 mt-2 w-[calc(100%+2rem)] justify-start gap-1 overflow-x-auto border-b border-border bg-background/85 px-4 py-2 backdrop-blur-md md:-mx-6 md:w-[calc(100%+3rem)] md:px-6 print:hidden"
      >
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="shrink-0 grow-0 rounded-full border border-transparent px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors after:hidden hover:text-foreground data-[state=active]:border-accent/40 data-[state=active]:bg-accent/15 data-[state=active]:text-accent"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} forceMount className="arena-tab-panel data-[state=inactive]:hidden">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

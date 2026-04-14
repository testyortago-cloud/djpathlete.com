"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

export function ShopEmbed() {
  const [isLoaded, setIsLoaded] = useState(false)

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-border bg-white">
      {/* Loading state */}
      {!isLoaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading store...</p>
          </div>
        </div>
      )}

      {/* Iframe */}
      <iframe
        src="https://shop.yortago.com/"
        title="DJP Athlete Shop"
        onLoad={() => setIsLoaded(true)}
        className={`w-full transition-opacity duration-500 ${isLoaded ? "opacity-100" : "opacity-0"}`}
        style={{
          border: 0,
          height: "calc(100vh - 200px)",
          minHeight: 600,
        }}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation-by-user-activation"
      />
    </div>
  )
}

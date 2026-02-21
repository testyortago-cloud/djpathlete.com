"use client"

import { useState, useRef, useCallback, type ReactNode } from "react"
import { useRouter } from "next/navigation"

const PULL_THRESHOLD = 80
const MAX_PULL = 120

interface PullToRefreshProps {
  children: ReactNode
}

export function PullToRefresh({ children }: PullToRefreshProps) {
  const router = useRouter()
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isRefreshing) return

      // Only activate when scrolled to top
      if (window.scrollY !== 0) return

      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    },
    [isRefreshing]
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isPulling.current || isRefreshing) return

      const currentY = e.touches[0].clientY
      const diff = currentY - touchStartY.current

      // Only pull down, not up
      if (diff < 0) {
        setPullDistance(0)
        return
      }

      // Resist pull with diminishing returns
      const distance = Math.min(MAX_PULL, diff * 0.5)
      setPullDistance(distance)
    },
    [isRefreshing]
  )

  const handleTouchEnd = useCallback(() => {
    if (!isPulling.current || isRefreshing) return
    isPulling.current = false

    if (pullDistance >= PULL_THRESHOLD) {
      setIsRefreshing(true)
      setPullDistance(PULL_THRESHOLD * 0.5) // Hold at a smaller position while refreshing

      router.refresh()

      // Give the refresh a moment to process, then reset
      setTimeout(() => {
        setIsRefreshing(false)
        setPullDistance(0)
      }, 1000)
    } else {
      setPullDistance(0)
    }
  }, [pullDistance, isRefreshing, router])

  const pullProgress = Math.min(1, pullDistance / PULL_THRESHOLD)
  const showIndicator = pullDistance > 10 || isRefreshing

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      {showIndicator && (
        <div
          className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
          style={{ height: `${pullDistance}px` }}
        >
          <div
            className={`size-8 flex items-center justify-center ${
              isRefreshing ? "animate-spin" : ""
            }`}
            style={{
              transform: isRefreshing
                ? undefined
                : `rotate(${pullProgress * 360}deg)`,
              opacity: Math.min(1, pullProgress * 1.5),
            }}
          >
            <svg
              className="size-6 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              <polyline points="21 3 21 12 12 12" />
            </svg>
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

"use client"

import { useState, useEffect, useRef } from "react"

interface LocalVideoBackgroundProps {
  src: string
  /** Still frame shown instantly (and while the video buffers). Strongly recommended. */
  poster?: string
  className?: string
}

export function LocalVideoBackground({ src, poster, className = "" }: LocalVideoBackgroundProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [shouldLoad, setShouldLoad] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Defer video load until after initial paint for faster page load
  useEffect(() => {
    const hasIdleCallback = typeof requestIdleCallback === "function"
    const timer = hasIdleCallback
      ? requestIdleCallback(() => setShouldLoad(true))
      : window.setTimeout(() => setShouldLoad(true), 100)

    return () => {
      if (hasIdleCallback) {
        cancelIdleCallback(timer as number)
      } else {
        window.clearTimeout(timer as number)
      }
    }
  }, [])

  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {/* Poster paints immediately so the hero is never blank during the
          deferred load + buffering window. The video fades in on top of it. */}
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {shouldLoad && (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          poster={poster}
          onCanPlay={() => setIsLoaded(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
            isLoaded ? "opacity-100" : "opacity-0"
          }`}
        >
          <source src={src} type="video/mp4" />
        </video>
      )}
    </div>
  )
}

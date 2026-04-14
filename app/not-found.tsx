"use client"

export default function NotFound() {
  function hardRefreshHome() {
    window.location.replace("/?_r=" + Date.now())
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="text-center max-w-md">
        <p className="text-7xl font-heading font-bold text-primary mb-4">404</p>
        <h1 className="text-2xl font-heading font-semibold text-foreground mb-2">Page Not Found</h1>
        <p className="text-muted-foreground font-body mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <button
          onClick={hardRefreshHome}
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
        >
          Go Home
        </button>
      </div>
    </div>
  )
}

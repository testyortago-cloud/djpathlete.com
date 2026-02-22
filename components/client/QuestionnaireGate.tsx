"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export function QuestionnaireGate({
  hasCompleted,
  children,
}: {
  hasCompleted: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!hasCompleted && !pathname.startsWith("/client/questionnaire")) {
      router.replace("/client/questionnaire")
    } else {
      setReady(true)
    }
  }, [hasCompleted, pathname, router])

  if (!ready) {
    return null
  }

  return <>{children}</>
}

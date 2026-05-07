// components/emails/_shared/Section.tsx
// Single visual primitive used by every section in the Daily Brief and
// Weekly Review emails. Heading is uppercase + spaced out (matches the
// existing emails); children render in the body slot.

import type { ReactNode } from "react"

const BRAND = {
  primary: "#0E3F50",
  border: "#e8e5e0",
} as const

interface Props {
  title: string
  children: ReactNode
  /** Outer padding override. Defaults to "20px 48px 8px" matching existing emails. */
  padding?: string
}

export function Section({ title, children, padding = "20px 48px 8px" }: Props) {
  return (
    <tr>
      <td style={{ padding }}>
        <h2
          style={{
            margin: "0 0 14px",
            fontFamily: "'Lexend Exa', Georgia, serif",
            fontSize: "13px",
            color: BRAND.primary,
            textTransform: "uppercase",
            letterSpacing: "2px",
            fontWeight: 600,
          }}
        >
          {title}
        </h2>
        {children}
      </td>
    </tr>
  )
}

export const SECTION_BRAND = BRAND

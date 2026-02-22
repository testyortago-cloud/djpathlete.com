export interface TourStep {
  /** DOM id of the field (or its parent) to highlight */
  target: string
  /** Tooltip header */
  title: string
  /** Plain-English explanation of the field */
  description: string
  /** Called before showing this step — e.g. expand a collapsible section */
  beforeShow?: () => void
}

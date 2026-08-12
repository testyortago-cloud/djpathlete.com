// Shared by the two rich-text elements.
//
// Rich text is stored as TipTap HTML and is THE ONLY PATH by which free-form
// HTML reaches a published page. It compiles through `htmlToNodes` — the
// allowlisting sanitiser the publish path already uses — rather than through
// any new rule written here.

import { htmlToNodes } from "@/lib/funnels/compile/sanitize"
import type { FunnelNode } from "@/lib/funnels/compile/types"

export function richTextNodes(html: string): FunnelNode[] {
  return htmlToNodes(html).nodes
}

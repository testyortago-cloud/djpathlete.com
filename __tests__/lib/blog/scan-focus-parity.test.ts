import { describe, expect, it } from "vitest"
import { searchesFor } from "@/lib/blog/scan-topics"
// Direct relative import of the functions/ twin: scan-focus.ts imports nothing, so it loads under the root
// vitest config (the chat-tools-parity precedent).
import { searchesFor as twinSearchesFor } from "../../../functions/src/lib/scan-focus"

// The weekly scan recognises a focus topic's results by matching its search strings. If the twin builds a
// different string than the topics page saved, the focus is silently never applied.
describe("scan focus twin", () => {
  const topics = [
    { name: "Agility", keywords: ["deceleration", " cutting mechanics "] },
    { name: "Sleep research", keywords: ["adolescents"] },
    { name: "  hamstring injury  ", keywords: [] },
    { name: "Strength RESEARCH methods", keywords: ["youth"] },
  ]

  it.each(topics)("builds the same searches as lib for $name", (topic) => {
    expect(twinSearchesFor(topic)).toEqual(searchesFor(topic))
  })
})

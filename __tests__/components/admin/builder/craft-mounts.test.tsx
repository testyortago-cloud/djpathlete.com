// @vitest-environment jsdom
// Craft.js declares React ^19 in its peer range, but a peer range is a claim,
// not a proof. GrapesJS also "supported" this app right up until its icons
// rendered as blank squares under our CSP and it silently discarded every
// island setting typed into it. This test is the proof, and it runs before a
// single element is built on top of the assumption.

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Editor, Frame, Element, useNode } from "@craftjs/core"
import type { ReactNode } from "react"

function Box({ children }: { children?: ReactNode }) {
  const {
    connectors: { connect },
  } = useNode()
  return (
    <div
      ref={(ref) => {
        if (ref) connect(ref)
      }}
      data-testid="box"
    >
      {children}
    </div>
  )
}
Box.craft = { displayName: "Box" }

describe("@craftjs/core under React 19", () => {
  it("mounts an editor and renders a connected node", () => {
    // MUTANT KILLED: taking the peer range at its word. If Craft cannot mount
    // here, the editor engine decision in the spec is invalid and everything
    // built on it is wasted — better to find out in one test than in task 9.
    render(
      <Editor resolver={{ Box }}>
        <Frame>
          <Element is={Box} canvas>
            <Box />
          </Element>
        </Frame>
      </Editor>,
    )
    expect(screen.getAllByTestId("box").length).toBeGreaterThan(0)
  })

  it("exposes a serializable node tree", () => {
    // MUTANT KILLED: assuming query.serialize() exists in this version — the
    // save path in task 11 depends on it, and finding out then would mean
    // rewriting persistence around whatever Craft actually offers.
    let serialized: string | null = null

    function Probe() {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { useEditor } = require("@craftjs/core") as typeof import("@craftjs/core")
      const { query } = useEditor()
      serialized = query.serialize()
      return null
    }

    render(
      <Editor resolver={{ Box }}>
        <Frame>
          <Element is={Box} canvas>
            <Box />
          </Element>
        </Frame>
        <Probe />
      </Editor>,
    )

    expect(serialized).toBeTypeOf("string")
    expect(JSON.parse(serialized as unknown as string)).toBeTypeOf("object")
  })
})

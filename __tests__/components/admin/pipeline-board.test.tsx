// __tests__/components/admin/pipeline-board.test.tsx
//
// Fix round 1, Finding 1: the board must render the CONFIGURED stage name
// (pipeline_stages.name), never a label reconstructed from `key`. The two
// happen to produce the same string for every stage seeded today
// ("consult_booked" -> "Consult Booked"), which is exactly why a prior
// version of this component deriving the label from `key` alone passed every
// existing test while silently ignoring a real rename. This fixture
// deliberately makes `key` and `name` diverge so a regression back to
// key-derivation fails loudly instead of coincidentally matching.

import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PipelineBoard } from "@/components/admin/pipeline-board"
import type { BoardColumn } from "@/lib/db/pipeline"

const COLUMNS: BoardColumn[] = [
  {
    stage: {
      id: "stage-1",
      key: "consult_booked",
      // Deliberately NOT "Consult Booked" — a business renamed this stage.
      // stageLabel("consult_booked") would produce "Consult Booked", so if
      // the component ever reverts to deriving from `key`, this exact
      // fixture is what catches it.
      name: "Discovery Call",
      position: 1,
      kind: "open",
      amber_after_days: 3,
      red_after_days: 7,
    },
    cards: [],
  },
  {
    stage: {
      id: "stage-2",
      key: "won",
      name: "Won",
      position: 2,
      kind: "won",
      amber_after_days: null,
      red_after_days: null,
    },
    cards: [],
  },
]

describe("<PipelineBoard>", () => {
  it("renders the configured stage name, not a key-derived label", () => {
    render(<PipelineBoard columns={COLUMNS} />)
    expect(screen.getByText("Discovery Call")).toBeInTheDocument()
    expect(screen.queryByText("Consult Booked")).not.toBeInTheDocument()
  })

  it("still renders a plain key-derived label when name and key would coincide", () => {
    render(<PipelineBoard columns={COLUMNS} />)
    expect(screen.getByText("Won")).toBeInTheDocument()
  })
})

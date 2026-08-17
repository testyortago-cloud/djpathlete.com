// __tests__/app/funnel-edit-layout-draft-jobs.test.tsx
//
// WHICH STEPS THE BACKGROUND QUEUE IS ALLOWED TO WRITE.
//
// The layout composes `draftJobs` and hands them to `ConnectionsProvider`, which
// then POSTs a first draft for each one. "Unbuilt" is therefore defined TWICE —
// here, and in `lib/funnels/publish-plan.ts` — and the two definitions have to
// agree or a legacy page gets rewritten by a model nobody asked.
//
// NO RENDER. `FunnelBuilderShell` is an async server component, so it is called
// and its returned element inspected: the assertion is about the props it
// composes, and rendering the rail would only add a client tree to keep alive.
//
// EVERY TEST NAMES THE MUTANT IT KILLS.

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ReactElement } from "react"
import type { ConnectionsProviderProps } from "@/components/admin/funnels/connections-context"
import type { Funnel, FunnelStep } from "@/types/database"

const db = vi.hoisted(() => ({
  getFunnelById: vi.fn(),
  listSteps: vi.fn(),
}))
vi.mock("@/lib/db/funnels", () => db)

import { FunnelBuilderShell } from "@/app/(admin)/admin/funnels/[id]/edit/layout"

const FUNNEL: Funnel = {
  id: "f1",
  slug: "summer-camp",
  name: "Summer Camp",
  description: null,
  status: "published",
  kind: "funnel",
  goal: null,
  template: "event",
  audience: null,
  offer_kind: null,
  offer_ref: null,
  starts_at: null,
  ends_at: null,
  auto_offline_at_end: false,
  notify_emails: null,
  created_by: null,
  created_at: "",
  updated_at: "",
}

function step(overrides: Partial<FunnelStep> = {}): FunnelStep {
  return {
    id: "s1",
    funnel_id: "f1",
    slug: "index",
    name: "Details",
    position: 0,
    is_entry: true,
    goal: "event",
    seo_title: null,
    seo_description: null,
    og_image_url: null,
    project_data: null,
    published_version_id: null,
    doc_revision: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as FunnelStep
}

/** The props the shell handed the provider. */
async function draftJobsFor(steps: FunnelStep[]): Promise<{ stepId: string }[]> {
  db.getFunnelById.mockResolvedValue(FUNNEL)
  db.listSteps.mockResolvedValue(steps)
  const element = (await FunnelBuilderShell({ id: "f1", children: null })) as ReactElement<ConnectionsProviderProps>
  return element.props.draftJobs ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the edit layout's draft queue", () => {
  it("queues a step that has never been built", async () => {
    // The control. Without it the test below cannot tell "the filter works"
    // from "no step is ever queued".
    const jobs = await draftJobsFor([step({ id: "s1" }), step({ id: "s2", slug: "thanks", name: "Thank you", position: 1 })])
    expect(jobs.map((job) => job.stepId)).toEqual(["s1", "s2"])
  })

  it("does NOT queue a legacy page that is already serving a published version", async () => {
    // MUTANT: `.filter((_step, index) => docs[index].doc === null)` — the whole
    // of the condition before this fix.
    //
    // A legacy GrapesJS step fails `sectionDocSchema`, so its `doc` is null and
    // it looks exactly like a blank page from here. It is not: it has a
    // `published_version_id` and is serving real content. Queue it and the
    // background model writes an AI first draft over its `project_data` — the
    // live page survives that instant, but the step now HAS a `SectionDoc`, so
    // the next funnel publish renders the draft over the live legacy page with
    // nothing said. `lib/funnels/publish-plan.ts:86` takes the opposite view
    // deliberately ("left alone — neither published nor a problem"), and two
    // definitions of "unbuilt" is the drift this assertion pins shut.
    const jobs = await draftJobsFor([
      step({ id: "s1" }),
      step({
        id: "legacy",
        slug: "old",
        name: "Old page",
        position: 1,
        // Not a SectionDoc: this is what the drag-and-drop editor stored.
        project_data: { pages: [{ frames: [] }], styles: [] } as unknown as FunnelStep["project_data"],
        published_version_id: "v-legacy",
      }),
    ])
    expect(jobs.map((job) => job.stepId)).toEqual(["s1"])
  })

  it("still queues a doc-less step that has never been published", async () => {
    // MUTANT: filtering on `published_version_id` alone, or dropping the doc
    // check. A blank step with no version row is exactly the page the queue
    // exists to write — "i dont want to click the other one for it to be
    // generate" — and the planner agrees: no doc and no version is a problem.
    const jobs = await draftJobsFor([
      step({ id: "s1", published_version_id: "v1" }),
      step({ id: "s2", slug: "thanks", name: "Thank you", position: 1 }),
    ])
    expect(jobs.map((job) => job.stepId)).toEqual(["s2"])
  })

  it("does not queue a step whose stored draft really is a SectionDoc", async () => {
    // MUTANT: dropping the doc check entirely once the version check is there.
    const jobs = await draftJobsFor([
      step({
        id: "s1",
        // A document that REALLY PARSES — `sectionDocSchema.sections` is
        // `.min(1)`, so an empty array is a legacy blob as far as the layout is
        // concerned and this test would be measuring the wrong branch.
        project_data: {
          v: 1,
          engine: "sections",
          theme: { tone: "light", accent: "accent", radius: "soft" },
          sections: [
            {
              id: "hero1",
              kind: "hero",
              variant: "centered",
              style: {},
              props: {
                headline: "Train like an athlete",
                primaryCta: { label: "Get started", target: { kind: "step", stepSlug: "thanks" } },
              },
            },
          ],
        } as unknown as FunnelStep["project_data"],
      }),
      step({ id: "s2", slug: "thanks", name: "Thank you", position: 1 }),
    ])
    expect(jobs.map((job) => job.stepId)).toEqual(["s2"])
  })
})

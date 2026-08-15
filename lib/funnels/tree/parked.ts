// lib/funnels/tree/parked.ts — the drag designer is parked.
//
// ---------------------------------------------------------------------------
// WHY, AND WHAT WOULD JUSTIFY UNPARKING IT
// ---------------------------------------------------------------------------
// The Craft.js designer (`/admin/funnels/[id]/edit/[stepId]/design`, the
// `page_tree` column, everything under `lib/funnels/tree/`) was built over
// 2026-08-12 and parked on 2026-08-15, with ZERO pages ever using it: a
// `count(*) filter (where page_tree is not null)` against production returned
// 0 of 2 funnel steps. It also could not publish at all — `compilePageTree` had
// no caller outside its own test file, so Task 12 of its plan shipped the
// entry point and not the publish half.
//
// The deciding argument was not the missing publish path, which is a stage's
// work. It is what a SECOND PUBLISHABLE ENGINE costs afterwards, permanently:
// every new island, every change to CTA resolution, the publish gate, lead
// capture, analytics and the AI's write path would each have to be built twice
// or reasoned about twice. `docs/superpowers/plans/2026-08-15-sites-funnels-
// builder-design.md` §3 argues against Craft.js on exactly these grounds, and
// its appendix names "three editors over two content models" as the source
// repo's largest avoidable mistake.
//
// What the section engine gained instead (stages 0-3, 2026-08-15) covers most
// of what a drag builder is wanted for: click any text on the real rendered
// page and type, swap the hero photo, change layout variants and style knobs,
// reorder / duplicate / delete sections — with the AI still able to read and
// edit the same document.
//
// UNPARK IT IF, AND ONLY IF, FREEFORM PLACEMENT IS ACTUALLY WANTED — dragging
// an element into the left half of a specific row, which the section engine
// genuinely cannot express. Then the work is: flip this to `false`, and finish
// the publish half (`compilePageTree` -> `funnel_step_versions`), which is the
// thing that was never built.
//
// NOTHING WAS DELETED. The route, `DesignEditor`, the element registry, the
// compiler, the schema and migration 00206 are all still here and still
// tested. Unparking is un-hiding a button, not rebuilding a feature — which is
// precisely why this is a constant and not a code deletion.

export const DESIGNER_PARKED = true

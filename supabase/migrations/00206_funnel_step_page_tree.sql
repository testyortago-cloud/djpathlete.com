-- The visual builder's draft document.
--
-- Nullable, and BESIDE project_data rather than replacing it: a step has a
-- SectionDoc (the AI builder), a PageTree (the visual builder), or neither.
-- WHICH COLUMN IS POPULATED is what decides which editor opens the step. A
-- separate `editor` flag would be a third thing that can disagree with the two
-- columns, and there would be no correct way to resolve the disagreement.
--
-- Nothing is migrated. Existing SectionDoc pages keep working untouched, and no
-- page is ever half-converted. The cost is a second publish path until stage 5
-- moves the AI onto PageTree, and that cost is recorded in the design doc.
--
-- Design doc: docs/superpowers/specs/2026-08-13-visual-page-builder-design.md

ALTER TABLE public.funnel_steps
  ADD COLUMN IF NOT EXISTS page_tree jsonb;

COMMENT ON COLUMN public.funnel_steps.page_tree IS
  'Draft PageTree for the visual builder. Null means this step is not a visual '
  'page - it is either an AI SectionDoc page (project_data) or empty.';

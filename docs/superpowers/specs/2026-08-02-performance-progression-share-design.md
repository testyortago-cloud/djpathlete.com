# Performance Progression on the Athlete Share Card + Client Self-Share

**Date:** 2026-08-02 (follow-on to the Full Arena redesign, same day)
**Approved by Darren via in-session Q&A:** enrich the sharable card with performance-dashboard content; add a self-serve card button for clients.

## What ships

1. **"Performance Progression" section** on `/athlete/<token>`, between Personal Records and Athlete Radar. One row per test type with **≥2 logged results**: test label, an accent SVG sparkline of the chronological series (server-rendered — prints in the PDF), latest value + unit, and an improvement chip.
   - **Direction-aware:** a faster 10m sprint is ↑ improvement even though the number went down. New `testDirection()` export in `lib/coach-intel/test-normalization.ts` (from the existing reference ranges). Custom/unknown tests get a **neutral** chip (`first → latest`) — never a wrong-colored judgment.
   - Declines render muted, not red — this is a marketing surface; improvement gets the accent, decline gets quiet honesty.
   - Section self-hides when no test type qualifies (same honest-card rule). Capped at 6 rows, most-improved first, neutrals last.
2. **Data:** the existing scrubbed `RadarTestPoint` projection gains `resultUnit` + `customName`. No new queries (`listTests` already fetches everything) and no new sensitivity class — values, units and custom names are already public via the radar and field-records sections. Notes, video, ids stay excluded.
3. **Client self-share:** `/client/performance` gets a "My athlete card" button — the server signs the client's own permanent token (`signAthleteProfileToken`) and links to the public card. Coach control is unchanged: deactivating the client kills the link, same as coach-issued ones.

## Not doing

Readiness on the public card (private wellness data), decline-red styling, per-test detail pages on the card, OG-image changes.

## Verification

New pure-logic suite for the progression builder (direction-aware math with mutation-discriminating fixtures: lower-better sprint improving 2.0→1.8 must read +10%, not −10%), card-component test additions (section renders with 2+ results, hides otherwise), targeted suites + build, visual pass via temporary preview route.

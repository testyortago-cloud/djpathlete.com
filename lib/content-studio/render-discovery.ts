// True when the live set of in-flight captioned-cut renders (discovered client-side
// from Firestore) contains a video whose render the server snapshot hasn't surfaced
// yet — i.e. a render that STARTED after the Pipeline board was server-rendered. The
// board then refreshes once so getPipelineData re-derives the columns and the card
// slides into the Rendering column. The reverse (a known render finishing) is handled
// by RenderWatcher. Pure set-difference so it can be unit-tested without React.
export function hasUntrackedRender(liveVideoIds: Set<string>, knownVideoIds: Set<string>): boolean {
  for (const id of liveVideoIds) {
    if (!knownVideoIds.has(id)) return true
  }
  return false
}

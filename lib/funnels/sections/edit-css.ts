// lib/funnels/sections/edit-css.ts — the stylesheet the EDITABLE preview adds.
//
// Deliberately not in `styles.ts`. That stylesheet is compiled into every
// published page, and none of these classes can ever appear in one: `render.ts`
// only emits `djp-empty` when `editable` is set, and `djp-selected` /
// `djp-editing` are added by the canvas at runtime. Shipping them to visitors
// would be editor chrome in a page nobody can edit.
//
// It lives in `lib/` rather than beside the canvas so the preview route (a
// server component) can import it without pulling DOM-manipulating code into a
// server bundle.
//
// SELECTION CHROME IS `outline`, NEVER `border`. A border participates in
// layout, so selecting an element would move the page by a pixel — with the
// pointer moving across the canvas, that reads as the page twitching under the
// cursor. `outline` costs no layout at all.

export const CANVAS_EDIT_CSS = `
[data-sec] { position: relative; }
[data-edit] { cursor: text; }
[data-edit-image] { cursor: pointer; }
[data-edit]:hover { outline: 1px dashed rgba(120,120,120,0.7); outline-offset: 2px; }
[data-sec]:hover { outline: 1px solid rgba(120,120,120,0.35); outline-offset: -1px; }
.djp-selected { outline: 2px solid rgba(70,130,180,0.9) !important; outline-offset: -2px; }
.djp-editing { outline: 2px solid rgba(70,130,180,0.9) !important; outline-offset: 2px; background: rgba(70,130,180,0.06); }
.djp-empty { opacity: 0.45; font-style: italic; }
`.trim()

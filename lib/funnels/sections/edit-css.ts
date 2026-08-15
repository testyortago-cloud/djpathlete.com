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

/* The wrapper an island CTA's label gets while editing (anchoredIsland in
   render.ts). inline-block so the hover outline hugs the button instead of
   spanning the line box, and so a wrapper inside a flex row lays out the way
   the bare island did. NO BACKTICKS ANYWHERE IN THIS FILE: one inside a CSS
   comment closes the template literal that holds the whole stylesheet. */
.djp-edit-slot { display: inline-block; }

/* Chrome that exists ONLY on the canvas: the note on a live feed, and the
   chips that give a <select>'s options a click target. Neutral grey rather
   than the page's palette, because it must read as the editor talking and not
   as copy someone forgot to remove.

   A PILL, NOT BARE TEXT, AND THAT IS CONTRAST NOT DECORATION. A section carries
   one of four tones and dark is one of them, so a note that only sets a colour
   is invisible on exactly the sections that need it — caught in a screenshot,
   where the testimonials band's note was grey on near-black. It paints its own
   background, so it is legible on all four. */
.djp-edit-note {
  display: inline-block;
  margin: 0 0 0.5rem;
  padding: 0.15rem 0.45rem;
  border-radius: 0.25rem;
  background: rgba(255,255,255,0.92);
  font-size: 0.75rem;
  line-height: 1.4;
  font-style: italic;
  color: rgba(60,60,60,0.95);
}
.djp-edit-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.35rem;
}
.djp-edit-options .djp-edit-note { margin: 0; font-style: normal; text-transform: uppercase; letter-spacing: 0.04em; }
.djp-edit-chip {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border: 1px dashed rgba(120,120,120,0.7);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  line-height: 1.4;
  color: rgba(60,60,60,0.95);
  background: rgba(255,255,255,0.92);
}
`.trim()

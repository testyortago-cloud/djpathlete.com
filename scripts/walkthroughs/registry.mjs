/**
 * The walkthrough shows.
 *
 * Every per-show fact lives here and nothing else in the pipeline hard-codes a
 * show: the recorder, the narration synth, the media staging step and the
 * Remotion compositions all read from this table.
 *
 * `bookkeeper` keeps the directory name `walkthrough` deliberately — its takes,
 * staged media and narration are already on disk under that name, and renaming
 * it would orphan a finished 10-minute video to save one inconsistent string.
 */
export const SHOWS = {
  bookkeeper: {
    chapters: "./bookkeeper.mjs",
    dir: "walkthrough",
    composition: "BookkeeperWalkthrough",
    // The take that already exists. recordVideo.size cannot upscale, so this
    // width IS the captured layout width.
    viewport: { width: 1600, height: 1000 },
    zoom: 1,
  },
  "team-permissions": {
    chapters: "./team-permissions.mjs",
    dir: "walkthrough-team",
    composition: "TeamPermissionsWalkthrough",
    // Native 1080p: a 1920x1080 viewport is already 16:9, so the edit maps the
    // take 1:1 with no scale and no crop.
    viewport: { width: 1920, height: 1080 },
    // ...but a 1920-wide layout renders the admin UI physically small. Zooming
    // the root element makes the LAYOUT ~1670 CSS px wide while the frames stay
    // a true 1920x1080. deviceScaleFactor cannot do this — recordVideo ignores it.
    //
    // 1.15 is a ceiling, not a preference. `vh` resolves against the UNZOOMED
    // viewport and is then scaled, so the invite dialog's max-h-[85vh] occupies
    // 85 * zoom vh of the frame. At 1.2 that is 102vh: the dialog overflows and
    // the footer holding "Send invite" sits just off the bottom of the picture.
    // Any zoom above 1/0.85 = 1.176 clips it.
    zoom: 1.15,
  },
}

export const DEFAULT_SHOW = "bookkeeper"

/** `--show <id>`, defaulting to the bookkeeper so existing invocations are unchanged. */
export function showArg(argv) {
  const i = argv.indexOf("--show")
  return i >= 0 && argv[i + 1] ? argv[i + 1] : DEFAULT_SHOW
}

export async function resolveShow(id) {
  const show = SHOWS[id]
  if (!show) {
    throw new Error(`unknown show "${id}". known: ${Object.keys(SHOWS).join(", ")}`)
  }
  const { CHAPTERS } = await import(show.chapters)
  if (!CHAPTERS?.length) throw new Error(`show "${id}" exports no chapters`)
  return { id, ...show, CHAPTERS }
}

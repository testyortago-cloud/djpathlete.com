/**
 * Team permissions — a ~3 minute owner-side how-to.
 *
 * Films only the owner's screen. The teammate's-eye view (their shrunken
 * sidebar, a blocked page, the editor portal) is deliberately not here: it
 * needs a second signed-in account and /api/dev/login mints admin sessions from
 * one fixed address.
 *
 * Every address on camera is on djpathlete.demo, which cannot receive mail —
 * chapter 3 clicks a real "Send invite" button, and the invite route logs the
 * delivery failure and still returns 201, so the row appears and nobody is
 * emailed. Run scripts/seed-team-demo.mjs before recording.
 *
 * Beat actions the recorder understands are documented in
 * scripts/record-walkthrough.mjs.
 */

const INVITE_EMAIL = "sam.whitfield@djpathlete.demo"

/**
 * A real client, used to demonstrate the assignment search.
 *
 * MUST be someone the seed has NOT already assigned to Marcus, or the one row
 * the search leaves visible is already ticked and there is nothing to
 * demonstrate — seed-team-demo.mjs gives him the first four clients, and the
 * first pick here was one of them.
 */
const CLIENT_QUERY = "Arhan"

export const CHAPTERS = [
  {
    id: "01-where",
    title: "Where it lives",
    url: "/admin/team",
    beats: [
      { text: "This is the Team page. Everyone who works with you is in one list — the people who've accepted, the people who haven't yet, and your video editors." },
      { text: "It lives under Team in the admin sidebar, and only you can open it. No teammate can reach this page, whatever access you give them. That's the one door that never opens." },
      { text: "Each row tells you three things: who they are, what they can reach, and whether they're active." },
    ],
  },
  {
    id: "02-inviting",
    title: "Inviting someone",
    url: "/admin/team",
    beats: [
      { text: "To add someone, click Invite member.", click: /invite member/i },
      { text: "Type their email. They'll get a link to set their own password — you never create one for them — and the link expires after seven days.", type: { selector: "#invite-email", value: INVITE_EMAIL } },
      { text: "Then pick a role. These are starting templates, not fixed job titles: Coach, Marketing Manager, Bookkeeper, Front Desk, or Video Editor.", select: { selector: "#invite-preset", value: "bookkeeper" } },
    ],
  },
  {
    id: "03-permissions",
    title: "The permission picker",
    url: "/admin/team",
    // Chapter 3 opens on a fresh page, so it re-opens the dialog and re-fills
    // it. Every chapter records in its own browser context precisely so it can
    // be re-recorded alone; picking up where chapter 2 left off would break that.
    setup: [
      { click: /invite member/i },
      { type: { selector: "#invite-email", value: INVITE_EMAIL } },
      { select: { selector: "#invite-preset", value: "bookkeeper" } },
    ],
    beats: [
      { text: "Whichever role you pick just fills in the tick-boxes below. Everything from here is editable." },
      { text: "Permissions come in four groups — Coaching, Marketing, Money and Tools. Most are a simple yes or no.", dialogScroll: 0.25 },
      { text: "The money ones are different. Payments, Accounting, Shop and Ads each have three settings: none, view, or manage.", dialogScroll: 0.6 },
      { text: "The Bookkeeper role already uses that. Accounting is set to manage, Payments only to view — they keep the books without being able to issue refunds." },
      { text: "Add view on Ads and they can see what campaigns cost without being able to change a budget.", tier: { label: "Ads", tier: "view" } },
      { text: "Watch this note as you tick. With nothing ticked they only get the editor portal — video uploads and your feedback, no admin panel. Tick anything at all and they get the panel, limited to what's ticked.", dialogScroll: 0 },
      { text: "And some things can never be granted. Settings, this Team page, audit logs, automations, platform connections and your dashboard stay yours alone.", dialogScroll: 1 },
      { text: "Send the invite, and they appear in the list as pending until they accept.", click: /send invite/i },
    ],
  },
  {
    id: "04-clients",
    title: "Scoping to specific clients",
    url: "/admin/team",
    beats: [
      { text: "Ticking Clients doesn't hand someone your whole roster. It's assignment-based." },
      { text: "Click the Clients button on their row, and choose exactly who they work with.", row: "Marcus Bell", click: /^Clients \(/ },
      { text: "Search, tick, and save. They'll see those clients and no others — the rest of your roster doesn't exist for them.", type: { label: "Search clients", value: CLIENT_QUERY }, checkFirst: 1, then: /^Save$/ },
    ],
  },
  {
    id: "05-changing",
    title: "Changing and removing access",
    url: "/admin/team",
    beats: [
      { text: "Access isn't fixed at invite time. Edit access reopens the same tick-boxes for anyone already on the team.", row: "Priya Raman", click: /edit access/i },
      { text: "Clear every tick and they drop to the editor portal. Tick one and they're back in the panel. There's no second switch to forget." },
      { text: "Suspend locks someone out immediately without deleting anything — the right move when someone's away, or on their way out.", esc: true },
      { text: "An invite nobody's accepted yet can be re-sent, or revoked." },
      { text: "And whatever you change, it takes effect the next time they load a page." },
    ],
  },
]

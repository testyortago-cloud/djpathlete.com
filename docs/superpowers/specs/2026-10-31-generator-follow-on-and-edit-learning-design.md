# Program generator follows on, learns from edits; focus topics go deeper

Date: 2026-10-31. The owner chose to skip design questions; every decision below is the builder's call.

## Why

From the 2026-10-30 call with Darren:

- 37:31: "making a point of kind of saying, can we have it they acknowledge… the exercises that are done before,
  obviously not to replicate it, but to sort of show, like, Hey listen. In their previous program, there was a big
  focus on shoulder rehab". He has been typing this into Additional instructions by hand.
- 41:36–45:03: a focus topic in the weekly scan should "go into the depths of that topic". Shipped 10-31 with one
  known limit: the scan still keeps at most 3 candidates per theme, and the ranking prompt allows 2 topics per theme.
- The owner (2026-10-31): log how often Darren changes an exercise, and have the generator learn from it.

## What gets built

1. **Previous program.** When the AI generates for a client (and "ignore profile" is off), it reads the client's
   most recent assigned program: name, dates, the instructions it was generated with, and every exercise with
   the weeks it ran and its last prescription. All three agents see it, with the instruction to build on its
   focus and progress from where it ended, and not to copy its exercise list. It is kept OUT of the coach
   instructions on purpose: those are parsed for named exercises, which would force the old list back in.
   The AI Generate dialog says which program the new one follows on from.
2. **Focus topics.** A weekly scan topic with keywords is a focus topic. Its results skip the 3-per-theme
   candidate cap, are tagged FOCUS in the ranking prompt, and are exempt from the 2-per-theme rule. Every other
   topic keeps both guards (see memory: blog diversity is four guards, not one).
3. **Exercise change log.** Every exercise removed from or added to an AI-generated program in the program
   builder is written to `program_exercise_edits` (with `business_id`). Moves and set/rep edits are not
   exercise changes and are not logged; nor are bulk week/day clears or copies.
4. **Learning.** The generator reads the requesting coach's last 180 days of changes. Each time the coach took
   out an exercise the AI had picked, that exercise scores 15 lower (at most 45); each time the coach put one in,
   it scores 10 higher (at most 30). Soft, like favourites: hard filters (injury, equipment, Blocked) still win.
   Switch: `system_settings.ai_learn_from_edits_enabled`, default true.
5. **Where Darren sees it.** A "Learned from your edits" card on Settings > AI Program Policy: how many changes,
   the exercises he takes out and puts in most, and the recent changes.

## Not built

- No pairing of a removal with an addition into a "swap"; counts per exercise are enough to learn from.
- Edits made in the program chat assistant: it does not edit programs.
- The log is per coach; nothing is shared across coaches or tenants.

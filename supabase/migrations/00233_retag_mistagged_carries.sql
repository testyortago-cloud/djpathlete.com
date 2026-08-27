-- Migration 00233: correct two exercises mis-tagged as `carry`
--
-- WHY THIS EXISTS. `carry` held four of the library's 917 exercises, and the AI
-- assigns by movement_pattern — so a day plan asking for a carry had almost no
-- choice and returned the same exercise every time. That was the coach's
-- report: "Suitcase carry ... always appear in all of them".
--
-- Two of the four are not carries under any reading:
--
--   Barbell shoulder take outs_Shoulder — "lifting bar from rack to front
--     hold", landmine + plate, shoulders/core. A press-out into a static hold:
--     nothing is carried and nothing travels. -> isometric, because the hold is
--     the stimulus (`push` was the other candidate; it is a judgement call).
--
--   Cable rear hip abduction_Hip — "standing cable hip abduction ... moving the
--     leg diagonally backward to isolate the lateral and posterior hip".
--     Single-joint hip work. -> hinge, as the hip-extension-biased pattern; the
--     enum has no abduction option, so this is the least-wrong of ten.
--
-- The other two KEEP `carry` deliberately:
--
--   Suitcase carry-Core — a genuine loaded carry.
--   Offset cable steps_Core — "step while resisting lateral cable pull", the
--     same anti-lateral-flexion stimulus a suitcase carry trains. Kept rather
--     than stripped, so the pattern retains two members.
--
-- WHAT THIS DOES NOT FIX, and it matters: re-tagging creates NO new competition
-- for Suitcase carry, because the library has no hidden carries to promote. A
-- search for farmer / waiter / rack walk / loaded walk / yoke / sled / march
-- across every name and description returned three exercises, all already
-- tagged correctly (a forearm rotation, a kneeling hold, a walking lunge). The
-- library genuinely contains about two carries. Getting variety into carry
-- slots needs new EXERCISES, not new tags.
--
-- KEYED BY NAME, NOT ID. The ids were read off the dev clone
-- (`5c6d72f8-…a67c2` and `a202d27e-…90a027` there) and prod is a separate
-- project, so an id that does not match would make this a silent no-op. All
-- four names are unique in the library. The `movement_pattern = 'carry'` guard
-- makes it idempotent and stops it clobbering a later hand-edit by the coach.

UPDATE exercises
   SET movement_pattern = 'isometric'
 WHERE name = 'Barbell shoulder take outs_Shoulder'
   AND movement_pattern = 'carry';

UPDATE exercises
   SET movement_pattern = 'hinge'
 WHERE name = 'Cable rear hip abduction_Hip'
   AND movement_pattern = 'carry';

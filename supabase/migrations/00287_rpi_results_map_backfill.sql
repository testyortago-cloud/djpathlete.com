-- 00287_rpi_results_map_backfill.sql
-- Puts the live Rotational Performance Index on the results map and gives
-- each movement test its common-mistakes clip.
--
-- SCOPED to quizzes.key = 'rotational-performance-index'. A database without
-- that quiz is untouched. Every update fills only what is still NULL, or copy
-- that is still exactly the seed's original text: copy a human has edited in
-- the quiz editor is left alone. Re-running is a no-op.
--
-- The seed (lib/quizzes/seed/rotational-performance-index.ts) is the source
-- of truth for a fresh seed; this migration brings an already-seeded quiz up
-- to it.

-- 1. Paired tests: "<Test> — left side: ..." / "<Test> — right side: ..."
update public.quiz_questions qq
   set report_label = (regexp_match(qq.prompt, '^(.+?) — (left|right) side:'))[1],
       side         = (regexp_match(qq.prompt, '^(.+?) — (left|right) side:'))[2]
 where qq.quiz_id in (select id from public.quizzes where key = 'rotational-performance-index')
   and qq.report_label is null
   and qq.prompt ~ '^(.+?) — (left|right) side:';

-- 2. The one unpaired test.
update public.quiz_questions qq
   set report_label = 'Rocking hollow'
 where qq.quiz_id in (select id from public.quizzes where key = 'rotational-performance-index')
   and qq.report_label is null
   and qq.prompt like 'Rocking hollow:%';

-- 3. Mistakes clips, by the label just written.
update public.quiz_questions qq
   set mistakes_media_url = 'https://firebasestorage.googleapis.com/v0/b/darrenjpaulcom.firebasestorage.app/o/quiz-media%2Frotational-reboot%2F' || f.file || '-mistakes.mp4?alt=media',
       mistakes_media_poster_url = 'https://firebasestorage.googleapis.com/v0/b/darrenjpaulcom.firebasestorage.app/o/quiz-media%2Frotational-reboot%2F' || f.file || '-mistakes-poster.jpg?alt=media'
  from (values
    ('Prone hip abduction with external rotation', '1-prone-hip-abduction'),
    ('Rocking hollow',                              '2-rocking-hollow'),
    ('Short lever Copenhagen',                      '3-short-lever-copenhagen'),
    ('Windshield wipers',                           '4-windshield-wipers'),
    ('Retro backwards hop',                         '5-retro-backwards-hop')
  ) as f(label, file)
 where qq.report_label = f.label
   and qq.mistakes_media_url is null
   and qq.quiz_id in (select id from public.quizzes where key = 'rotational-performance-index');

-- 4. Tier copy, only where it is still the seed's original.
update public.quiz_tiers t
   set body = n.body
  from (values
    ('red',
     E'Your body is finding ways around the work rather than doing it. That is the pattern that leaks speed and power, and it is the most fixable one on this list.',
     E'Your results suggest you have a rotational performance leak — and a big one. This isn''t an effort problem. It''s a structure problem: your body is finding ways around the work instead of doing it, and that is where speed and power leak out.\n\nTraditional training misses it because it trains the sport and the gym, not the connection between them.\n\nRotational Reboot is six weeks built to close exactly these gaps, side by side.'),
    ('orange',
     E'You held some of it together and lost the rest. The gaps that showed up here are the ones costing you output when you are tired.',
     E'Your results suggest you have a rotational performance leak. This isn''t an effort problem. It''s a structure problem: you held some of it together and lost the rest, and those gaps cost you output when you are tired.\n\nMost programs never test for it, so they never train it.\n\nRotational Reboot targets the gaps on the map below.'),
    ('yellow',
     E'A solid base with specific leaks in it. Worth closing before they decide a result for you.',
     E'Your results suggest you may have a rotational performance leak. A solid base, with specific leaks in it. This isn''t an effort problem. It''s a structure problem — and a small one.\n\nThese are the leaks that decide close results. Rotational Reboot closes them before they do.'),
    ('green',
     E'You control rotation well. The value now is precision — the small side-to-side differences that still cost output.',
     E'You control rotation well. The value now is precision — the small side-to-side differences on the map below still cost output, and an assessment measures them properly.')
  ) as n(key, old_body, body)
 where t.key = n.key
   and t.body = n.old_body
   and t.quiz_id in (select id from public.quizzes where key = 'rotational-performance-index');

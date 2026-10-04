-- 00286_quiz_question_report_and_mistakes.sql
-- A second clip per movement test, and the two fields that put a question on
-- the results map.
--
-- mistakes_media_url / mistakes_media_poster_url: the "common mistakes" clip.
-- Every RPI source video ends with Darren demonstrating each wrong version;
-- self-grading inflates toward green without it. Same hosting and same
-- durability rule as media_url (00262): a public Firebase download URL,
-- never a signed one.
--
-- report_label / side: questions sharing a report_label are one row on the
-- results map; side pairs a left and a right attempt so asymmetry can be
-- shown. Read server-side only (lib/quizzes/report.ts) and never shipped in
-- the public definition.
--
-- ALL NULLABLE, NO URL CHECK — the reasons 00262 gives still hold: most
-- questions have none, and Zod .url() in the admin route is the right layer.

alter table public.quiz_questions
  add column if not exists mistakes_media_url text,
  add column if not exists mistakes_media_poster_url text,
  add column if not exists report_label text,
  add column if not exists side text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quiz_questions_side_check') then
    alter table public.quiz_questions
      add constraint quiz_questions_side_check check (side in ('left', 'right'));
  end if;
end $$;

comment on column public.quiz_questions.mistakes_media_url is
  'Durable public URL of a "common mistakes" clip. Null unless a movement test. Shipped to anonymous visitors by publicQuizDefinition.';
comment on column public.quiz_questions.mistakes_media_poster_url is
  'Poster frame for mistakes_media_url. Null whenever it is null.';
comment on column public.quiz_questions.report_label is
  'Row name on the results map. Questions sharing it form one row. Null = not on the map. Server-only.';
comment on column public.quiz_questions.side is
  'left | right for a paired movement test; null when unpaired. Server-only.';

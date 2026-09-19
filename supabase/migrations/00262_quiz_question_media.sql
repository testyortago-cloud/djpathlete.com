-- 00262_quiz_question_media.sql
-- A demo clip per quiz question.
--
-- WHY. The Rotational Performance Index asks a visitor to perform a movement
-- and grade themselves on it. "Short lever Copenhagen" and "rocking hollow"
-- are not names a non-coach knows, so a question without a demonstration is a
-- question nobody outside strength & conditioning can answer honestly. Every
-- other quiz shipped so far asked only about training history, which is why
-- this column did not exist before.
--
-- BOTH NULLABLE, AND THAT IS THE POINT. The athlete quiz's 28 questions have
-- no media and never will; a NOT NULL here would need a lie for every one of
-- them. Nullable also keeps every existing `Omit<Row, …>` insert builder
-- compiling — a DB-defaulted-but-required column breaks those, which this repo
-- has already paid for once.
--
-- NO CHECK CONSTRAINT ON THE URL. The value is written by an admin through
-- `/api/admin/quizzes/[id]`, which validates it with Zod (`.url()`), and by
-- the seed. A regex here would reject a perfectly good Firebase download URL
-- the first time the bucket name changes, and fail as a 500 with no operator
-- explanation. The validator is the right layer; this column stores text.
--
-- Hosting lives at `quiz-media/{quizKey}/{fileName}` in Firebase Storage, made
-- publicly readable by storage.rules. See lib/quiz-media-storage.ts for why
-- the href must be durable rather than signed.

alter table public.quiz_questions
  add column if not exists media_url text,
  add column if not exists media_poster_url text;

comment on column public.quiz_questions.media_url is
  'Durable public URL of a silent demo clip for this question. Null for every question that is not a movement test. Shipped to anonymous visitors by publicQuizDefinition.';

comment on column public.quiz_questions.media_poster_url is
  'Poster frame for media_url, so the player is not a black rectangle before play. Null whenever media_url is null.';

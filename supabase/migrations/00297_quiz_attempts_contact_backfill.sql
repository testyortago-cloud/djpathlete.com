-- 00297_quiz_attempts_contact_backfill.sql
--
-- quiz_attempts.contact_id has existed since 00228, but nothing wrote it: /api/quiz/submit completes the
-- attempt BEFORE the contact exists, with contact_id null, and never came back to it. The route now stamps
-- it after recordContactEvent. This fills it in for attempts taken before that, from the timeline row the
-- same submit wrote (metadata.attempt_id).
--
-- Reader: lib/quizzes/client-result.ts (a client's own quiz result on Performance and in AI Generate).
-- A timeline row the retention cron already scrubbed (metadata = '{}') cannot be recovered; its attempt
-- stays null. Idempotent: only null links are touched.
--
-- One timeline row per attempt, the NEWEST: a resubmitted attempt can carry rows for two contacts (two
-- emails), and the live route keeps the last one. A bare UPDATE ... FROM would pick one at random.

UPDATE public.quiz_attempts a
   SET contact_id = e.contact_id
  FROM (
    SELECT DISTINCT ON (business_id, metadata->>'attempt_id')
           business_id, metadata->>'attempt_id' AS attempt_id, contact_id
      FROM public.contact_timeline_events
     WHERE metadata ? 'attempt_id'
     ORDER BY business_id, metadata->>'attempt_id', occurred_at DESC
  ) e
 WHERE a.contact_id IS NULL
   AND a.status = 'completed'
   AND e.business_id = a.business_id
   AND e.attempt_id = a.id::text;

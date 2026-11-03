-- Output Sports records a single-leg CMJ (UNILATERAL_CMJ) once per leg. Each leg gets its own
-- test type, so a PR and a history never mix the left leg with the right or with a two-leg jump
-- (the PR view and recomputeDownstream both group by test_type alone).
alter table public.performance_tests drop constraint if exists performance_tests_test_type_check;
alter table public.performance_tests add constraint performance_tests_test_type_check check (test_type in (
  'drop_jump','cmj','cmj_left','cmj_right','squat_jump','broad_jump','sprint_10m','sprint_20m','sprint_40m',
  'sprint_5_10_5','t_test','beep_test','sit_reach','bench_press_1rm','back_squat_1rm',
  'deadlift_1rm','pull_up_max','push_up_max','plank_hold','custom'
));

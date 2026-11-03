-- The Output Sports tests Darren chose on 2026-11-03, each as its own test type (one per side
-- where Output records each side separately), so a PR and a history only ever hold one exercise:
-- Repeated Jumps (two-leg and single-leg), Sprinting ground contact, the Med Ball Vertical Press
-- Squat Throw, the Trap Bar Deadlift's estimated 1RM, and Torso Rotation.
alter table public.performance_tests drop constraint if exists performance_tests_test_type_check;
alter table public.performance_tests add constraint performance_tests_test_type_check check (test_type in (
  'drop_jump','cmj','cmj_left','cmj_right','repeated_jumps','repeated_jumps_left','repeated_jumps_right',
  'squat_jump','broad_jump','sprint_10m','sprint_20m','sprint_40m','sprint_5_10_5',
  'sprint_contact_left','sprint_contact_right','t_test','beep_test','sit_reach',
  'torso_rotation_left','torso_rotation_right','bench_press_1rm','back_squat_1rm','deadlift_1rm',
  'trap_bar_deadlift_1rm','med_ball_squat_throw','pull_up_max','push_up_max','plank_hold','custom'
));

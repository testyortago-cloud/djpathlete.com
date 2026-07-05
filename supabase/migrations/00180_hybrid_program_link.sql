-- Hybrid link: a standing slot can advance an online program on attendance.
alter table recurring_sessions
  add column if not exists assignment_id uuid references program_assignments(id) on delete set null;
create index if not exists idx_recurring_sessions_assignment
  on recurring_sessions(assignment_id) where assignment_id is not null;

-- Which program day an attendance completed (traceability / future revert hook).
alter table scheduled_sessions
  add column if not exists workout_session_id uuid references workout_sessions(id) on delete set null;

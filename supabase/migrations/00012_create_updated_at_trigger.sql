-- Auto-update updated_at timestamp
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply trigger to all tables with updated_at
create trigger set_updated_at before update on public.users for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.client_profiles for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.exercises for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.programs for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.program_assignments for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.payments for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.reviews for each row execute function public.update_updated_at();
create trigger set_updated_at before update on public.testimonials for each row execute function public.update_updated_at();

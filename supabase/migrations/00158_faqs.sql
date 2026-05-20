-- 00158_faqs.sql — FAQ CMS: page-keyed FAQ entries managed from the admin.
create table if not exists faqs (
  id uuid primary key default gen_random_uuid(),
  page_key text not null,
  category text,
  question text not null,
  answer text not null,
  link_text text,
  link_href text,
  sort_order integer not null default 0,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faqs_status_chk check (status in ('published','draft')),
  constraint faqs_link_chk check ((link_text is null) = (link_href is null)),
  constraint faqs_question_chk check (length(trim(question)) > 0),
  constraint faqs_answer_chk check (length(trim(answer)) > 0)
);

create index if not exists faqs_page_key_idx on faqs (page_key, status, sort_order);

create or replace function faqs_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger faqs_updated_at before update on faqs
  for each row execute function faqs_set_updated_at();

alter table faqs enable row level security;
-- Service-role only: all access is via the DAL with the service-role client.

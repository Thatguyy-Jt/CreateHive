-- AI diagnosis per post (Phase 5 — Analytics and Learning, part 2).
--
-- One row per successful diagnosis of a published post. Append-only for
-- creators (select, insert, delete; no update), like `content_versions`. Rows
-- go away with their post through the composite FK cascade. Part 3's insight
-- extraction reads them.
--
-- `diagnosis` is JSON validated by the app (`lib/schemas/diagnosis.ts`,
-- `schema_version: 1`). `snapshot_id` is the check-in the diagnosis read last;
-- it has no FK so deleting a check-in keeps the diagnosis. `ai_generation_id`
-- has no FK, as for `content_versions`: `ai_generations` is server-owned.
--
-- No value-list checks, so schema parity is unchanged.

create table public.content_diagnoses (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  content_item_id uuid not null,
  snapshot_id uuid,
  ai_generation_id uuid,
  prompt_version text not null check (prompt_version <> ''),
  diagnosis jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (content_item_id, user_id)
    references public.content_items (id, user_id) on delete cascade
);

-- The post page reads the newest diagnosis; the per-post cap counts recent ones.
create index content_diagnoses_item_created_idx
  on public.content_diagnoses (content_item_id, created_at desc);
create index content_diagnoses_user_id_idx on public.content_diagnoses (user_id);

alter table public.content_diagnoses enable row level security;
alter table public.content_diagnoses force row level security;

revoke all on public.content_diagnoses from anon, authenticated;
grant all on public.content_diagnoses to service_role;
-- Append-only: no update.
grant select, insert, delete on public.content_diagnoses to authenticated;

create policy content_diagnoses_select_own on public.content_diagnoses
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy content_diagnoses_insert_own on public.content_diagnoses
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy content_diagnoses_delete_own on public.content_diagnoses
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

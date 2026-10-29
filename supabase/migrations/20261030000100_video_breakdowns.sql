-- Video Breakdown (Pro, pre-beta; prompts/video-breakdown.md).
--
-- One row per successful breakdown of a reference video the creator pasted.
-- Append-only for creators (select, insert, delete; no update), like
-- `content_diagnoses`. Rows go away with the user through the FK cascade.
--
-- `platform` is unconstrained text validated by the app's `platform` enum,
-- like `content_ideas.platform`. `source_data` holds YouTube API data only and
-- is nulled by the daily maintenance job once `source_expires_at` passes (the
-- YouTube API Services storage limit). `creator_input`, `facts` and
-- `breakdown` are JSON validated by the app (`lib/schemas/breakdown.ts`).
-- `ai_generation_id` has no FK: `ai_generations` is server-owned.
--
-- No value-list checks, so schema parity is unchanged.

create table public.video_breakdowns (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  platform text not null check (platform <> ''),
  source_url text not null check (source_url <> '' and char_length(source_url) <= 500),
  external_id text,
  source_data jsonb,
  source_fetched_at timestamptz,
  source_expires_at timestamptz,
  creator_input jsonb not null default '{}',
  facts jsonb not null,
  ai_generation_id uuid,
  prompt_version text not null check (prompt_version <> ''),
  breakdown jsonb not null,
  created_at timestamptz not null default now()
);

-- History, newest first.
create index video_breakdowns_user_created_idx
  on public.video_breakdowns (user_id, created_at desc);
-- The "same video in the last 24 hours" check.
create index video_breakdowns_user_video_idx
  on public.video_breakdowns (user_id, platform, external_id, created_at desc);
-- The daily sweep that drops expired YouTube data.
create index video_breakdowns_source_expires_idx
  on public.video_breakdowns (source_expires_at) where source_data is not null;

alter table public.video_breakdowns enable row level security;
alter table public.video_breakdowns force row level security;

revoke all on public.video_breakdowns from anon, authenticated;
grant all on public.video_breakdowns to service_role;
-- Append-only: no update.
grant select, insert, delete on public.video_breakdowns to authenticated;

create policy video_breakdowns_select_own on public.video_breakdowns
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy video_breakdowns_insert_own on public.video_breakdowns
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy video_breakdowns_delete_own on public.video_breakdowns
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

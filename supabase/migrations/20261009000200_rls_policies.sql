-- Row Level Security, grants and policies for the core schema.
--
-- Prerequisite (Supabase dashboard, not SQL): enable the Clerk third-party
-- auth integration so Supabase verifies Clerk session tokens. The Clerk user
-- id then arrives as the JWT `sub` claim, read here with
-- `(select auth.jwt() ->> 'sub')`. Never authorize on `user_metadata`.
--
-- Access model:
--   anon           no access to any table.
--   authenticated  own rows only (`user_id = sub`), per-operation policies,
--                  with column/operation grants narrowed per table.
--   service_role   server-side only (webhooks, AI service, metering). It has
--                  BYPASSRLS, so its key must never reach the browser.
--
-- Server-owned tables (subscriptions, usage_events, ai_generations) are
-- read-only to `authenticated`, so creators cannot forge plan or usage state.

-- ---------------------------------------------------------------------------
-- Enable and force RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.users               enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.creator_profiles    enable row level security;
alter table public.brand_profiles      enable row level security;
alter table public.content_pillars     enable row level security;
alter table public.content_ideas       enable row level security;
alter table public.content_items       enable row level security;
alter table public.content_versions    enable row level security;
alter table public.analytics_snapshots enable row level security;
alter table public.competitors         enable row level security;
alter table public.research_signals    enable row level security;
alter table public.creator_insights    enable row level security;
alter table public.ai_generations      enable row level security;
alter table public.assets              enable row level security;
alter table public.usage_events        enable row level security;
alter table public.notifications       enable row level security;

alter table public.users               force row level security;
alter table public.subscriptions       force row level security;
alter table public.creator_profiles    force row level security;
alter table public.brand_profiles      force row level security;
alter table public.content_pillars     force row level security;
alter table public.content_ideas       force row level security;
alter table public.content_items       force row level security;
alter table public.content_versions    force row level security;
alter table public.analytics_snapshots force row level security;
alter table public.competitors         force row level security;
alter table public.research_signals    force row level security;
alter table public.creator_insights    force row level security;
alter table public.ai_generations      force row level security;
alter table public.assets              force row level security;
alter table public.usage_events        force row level security;
alter table public.notifications       force row level security;

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants everything on new public tables to anon and
-- authenticated by default; reset that, then grant only what policies allow.
-- ---------------------------------------------------------------------------

revoke all on
  public.users, public.subscriptions, public.creator_profiles, public.brand_profiles,
  public.content_pillars, public.content_ideas, public.content_items, public.content_versions,
  public.analytics_snapshots, public.competitors, public.research_signals,
  public.creator_insights, public.ai_generations, public.assets, public.usage_events,
  public.notifications
from anon, authenticated;

grant all on
  public.users, public.subscriptions, public.creator_profiles, public.brand_profiles,
  public.content_pillars, public.content_ideas, public.content_items, public.content_versions,
  public.analytics_snapshots, public.competitors, public.research_signals,
  public.creator_insights, public.ai_generations, public.assets, public.usage_events,
  public.notifications
to service_role;

-- Full CRUD on own rows.
grant select, insert, update, delete on
  public.creator_profiles, public.brand_profiles, public.content_pillars,
  public.content_ideas, public.content_items, public.analytics_snapshots,
  public.competitors, public.research_signals, public.creator_insights, public.assets
to authenticated;

-- users: a creator may create and rename their own row; email is synced
-- server-side from Clerk and deletion goes through the server.
grant select, insert on public.users to authenticated;
grant update (display_name) on public.users to authenticated;

-- content_versions: append-only.
grant select, insert on public.content_versions to authenticated;

-- notifications: created server-side; the creator can mark read or dismiss.
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Server-owned: read-only.
grant select on public.subscriptions, public.usage_events, public.ai_generations to authenticated;

-- ---------------------------------------------------------------------------
-- Policies: users
-- ---------------------------------------------------------------------------

create policy users_select_own on public.users
  for select to authenticated
  using (id = (select auth.jwt() ->> 'sub'));

create policy users_insert_own on public.users
  for insert to authenticated
  with check (id = (select auth.jwt() ->> 'sub'));

create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.jwt() ->> 'sub'))
  with check (id = (select auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------
-- Policies: read-only, server-owned tables
-- ---------------------------------------------------------------------------

create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

create policy usage_events_select_own on public.usage_events
  for select to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

create policy ai_generations_select_own on public.ai_generations
  for select to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------
-- Policies: content_versions (append-only)
-- ---------------------------------------------------------------------------

create policy content_versions_select_own on public.content_versions
  for select to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

create policy content_versions_insert_own on public.content_versions
  for insert to authenticated
  with check (user_id = (select auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------
-- Policies: notifications
-- ---------------------------------------------------------------------------

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));

create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

-- ---------------------------------------------------------------------------
-- Policies: full CRUD on own rows
-- ---------------------------------------------------------------------------

create policy creator_profiles_select_own on public.creator_profiles
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_profiles_insert_own on public.creator_profiles
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_profiles_update_own on public.creator_profiles
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_profiles_delete_own on public.creator_profiles
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy brand_profiles_select_own on public.brand_profiles
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy brand_profiles_insert_own on public.brand_profiles
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy brand_profiles_update_own on public.brand_profiles
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy brand_profiles_delete_own on public.brand_profiles
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy content_pillars_select_own on public.content_pillars
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy content_pillars_insert_own on public.content_pillars
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy content_pillars_update_own on public.content_pillars
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy content_pillars_delete_own on public.content_pillars
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy content_ideas_select_own on public.content_ideas
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy content_ideas_insert_own on public.content_ideas
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy content_ideas_update_own on public.content_ideas
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy content_ideas_delete_own on public.content_ideas
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy content_items_select_own on public.content_items
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy content_items_insert_own on public.content_items
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy content_items_update_own on public.content_items
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy content_items_delete_own on public.content_items
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy analytics_snapshots_select_own on public.analytics_snapshots
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy analytics_snapshots_insert_own on public.analytics_snapshots
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy analytics_snapshots_update_own on public.analytics_snapshots
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy analytics_snapshots_delete_own on public.analytics_snapshots
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy competitors_select_own on public.competitors
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy competitors_insert_own on public.competitors
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy competitors_update_own on public.competitors
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy competitors_delete_own on public.competitors
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy research_signals_select_own on public.research_signals
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy research_signals_insert_own on public.research_signals
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy research_signals_update_own on public.research_signals
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy research_signals_delete_own on public.research_signals
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy creator_insights_select_own on public.creator_insights
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_insights_insert_own on public.creator_insights
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_insights_update_own on public.creator_insights
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_insights_delete_own on public.creator_insights
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

create policy assets_select_own on public.assets
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy assets_insert_own on public.assets
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy assets_update_own on public.assets
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy assets_delete_own on public.assets
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

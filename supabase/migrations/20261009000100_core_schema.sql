-- Core schema for AI Creator Strategist (Phase 1 — Foundation).
--
-- Identity: every creator-owned row carries `user_id text`, the Clerk user id
-- (`user_...`). Supabase receives Clerk session tokens through the Clerk
-- third-party auth integration, and RLS (next migration) compares `user_id`
-- with the JWT `sub` claim. There is no foreign key to `auth.users`.
--
-- Isolation by construction: parents expose `unique (id, user_id)` and
-- children reference them with composite foreign keys `(parent_id, user_id)`,
-- so a row can never point at another creator's parent row.
--
-- Deletion: every table cascades from `users`, so deleting a user row removes
-- all of that creator's data.
--
-- This file uses plain Postgres only. Roles, grants and policies live in
-- 20261009000200_rls_policies.sql.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users / subscriptions
-- ---------------------------------------------------------------------------

create table public.users (
  id text primary key check (id <> ''),
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique references public.users (id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  provider_customer_id text,
  provider_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- creator identity
-- ---------------------------------------------------------------------------

create table public.creator_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique references public.users (id) on delete cascade,
  niche text,
  audience_description text,
  goals text[] not null default '{}',
  platforms text[] not null default '{}',
  posting_capacity_per_week smallint
    check (posting_capacity_per_week between 0 and 100),
  experience_level text
    check (experience_level in ('beginner', 'growing', 'established')),
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started', 'in_progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique references public.users (id) on delete cascade,
  tone text,
  voice_traits text[] not null default '{}',
  do_list text[] not null default '{}',
  dont_list text[] not null default '{}',
  sample_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_pillars (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  name text not null check (name <> ''),
  description text,
  position smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index content_pillars_user_id_idx on public.content_pillars (user_id);

-- ---------------------------------------------------------------------------
-- opportunities and content
-- ---------------------------------------------------------------------------

create table public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  pillar_id uuid,
  topic text not null check (topic <> ''),
  audience_need text,
  angle text,
  hook text,
  format text,
  evidence jsonb not null default '[]',
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  audience_fit text check (audience_fit in ('low', 'medium', 'high')),
  evidence_strength text check (evidence_strength in ('low', 'medium', 'high')),
  trend_signal text check (trend_signal in ('low', 'medium', 'high')),
  content_gap text check (content_gap in ('low', 'medium', 'high')),
  cta text,
  status text not null default 'new'
    check (status in ('new', 'saved', 'planned', 'in_production', 'used', 'dismissed')),
  source text not null default 'ai' check (source in ('ai', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (pillar_id, user_id)
    references public.content_pillars (id, user_id) on delete set null (pillar_id)
);

create index content_ideas_user_id_status_idx on public.content_ideas (user_id, status);
create index content_ideas_pillar_id_idx on public.content_ideas (pillar_id);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  idea_id uuid,
  pillar_id uuid,
  title text not null check (title <> ''),
  platform text,
  format text,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'scheduled', 'published', 'archived')),
  scheduled_for timestamptz,
  published_at timestamptz,
  published_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (idea_id, user_id)
    references public.content_ideas (id, user_id) on delete set null (idea_id),
  foreign key (pillar_id, user_id)
    references public.content_pillars (id, user_id) on delete set null (pillar_id)
);

create index content_items_user_id_status_idx on public.content_items (user_id, status);
create index content_items_user_id_scheduled_for_idx on public.content_items (user_id, scheduled_for);
create index content_items_idea_id_idx on public.content_items (idea_id);
create index content_items_pillar_id_idx on public.content_items (pillar_id);

-- Append-only history of a content item's package.
create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  content_item_id uuid not null,
  version_no integer not null check (version_no > 0),
  content jsonb not null default '{}',
  source text not null check (source in ('user', 'ai')),
  note text,
  created_at timestamptz not null default now(),
  unique (content_item_id, version_no),
  foreign key (content_item_id, user_id)
    references public.content_items (id, user_id) on delete cascade
);

create index content_versions_user_id_idx on public.content_versions (user_id);

-- ---------------------------------------------------------------------------
-- analytics and research
-- ---------------------------------------------------------------------------

create table public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  content_item_id uuid,
  platform text,
  captured_at timestamptz not null default now(),
  views bigint check (views >= 0),
  watch_time_seconds bigint check (watch_time_seconds >= 0),
  avg_view_duration_seconds numeric(10, 2) check (avg_view_duration_seconds >= 0),
  retention_rate numeric(5, 4) check (retention_rate between 0 and 1),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  shares bigint check (shares >= 0),
  saves bigint check (saves >= 0),
  follower_delta bigint,
  source text not null default 'manual' check (source in ('manual', 'import', 'api')),
  raw jsonb,
  created_at timestamptz not null default now(),
  foreign key (content_item_id, user_id)
    references public.content_items (id, user_id) on delete cascade
);

create index analytics_snapshots_user_id_captured_at_idx
  on public.analytics_snapshots (user_id, captured_at);
create index analytics_snapshots_content_item_id_idx
  on public.analytics_snapshots (content_item_id);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  platform text not null,
  handle text,
  url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (handle is not null or url is not null)
);

create index competitors_user_id_idx on public.competitors (user_id);

create table public.research_signals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  source text not null,
  external_id text,
  source_url text,
  signal_type text not null,
  title text,
  payload jsonb not null default '{}',
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create index research_signals_user_id_fetched_at_idx
  on public.research_signals (user_id, fetched_at);

create table public.creator_insights (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  insight_type text not null
    check (insight_type in (
      'topic', 'hook', 'format', 'duration', 'cta', 'audience', 'underperformance', 'other'
    )),
  summary text not null check (summary <> ''),
  evidence jsonb not null default '[]',
  confidence text check (confidence in ('low', 'medium', 'high')),
  sample_size integer check (sample_size >= 0),
  status text not null default 'active'
    check (status in ('active', 'dismissed', 'superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creator_insights_user_id_status_idx on public.creator_insights (user_id, status);

-- ---------------------------------------------------------------------------
-- AI, assets, usage, notifications
-- ---------------------------------------------------------------------------

create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  kind text not null,
  model text,
  prompt_version text,
  content_item_id uuid,
  content_idea_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  latency_ms integer check (latency_ms >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id),
  foreign key (content_item_id, user_id)
    references public.content_items (id, user_id) on delete set null (content_item_id),
  foreign key (content_idea_id, user_id)
    references public.content_ideas (id, user_id) on delete set null (content_idea_id)
);

create index ai_generations_user_id_created_at_idx on public.ai_generations (user_id, created_at);
create index ai_generations_content_item_id_idx on public.ai_generations (content_item_id);
create index ai_generations_content_idea_id_idx on public.ai_generations (content_idea_id);

-- Metadata only; the file itself lives in Supabase Storage at storage_path.
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  content_item_id uuid,
  name text not null check (name <> ''),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (content_item_id, user_id)
    references public.content_items (id, user_id) on delete set null (content_item_id)
);

create index assets_user_id_idx on public.assets (user_id);
create index assets_content_item_id_idx on public.assets (content_item_id);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  event_type text not null,
  quantity integer not null default 1 check (quantity > 0),
  cost_micros bigint check (cost_micros >= 0),
  ai_generation_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (ai_generation_id, user_id)
    references public.ai_generations (id, user_id) on delete set null (ai_generation_id)
);

create index usage_events_user_id_created_at_idx on public.usage_events (user_id, created_at);
create index usage_events_ai_generation_id_idx on public.usage_events (ai_generation_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx on public.notifications (user_id, created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
create trigger creator_profiles_set_updated_at before update on public.creator_profiles
  for each row execute function public.set_updated_at();
create trigger brand_profiles_set_updated_at before update on public.brand_profiles
  for each row execute function public.set_updated_at();
create trigger content_pillars_set_updated_at before update on public.content_pillars
  for each row execute function public.set_updated_at();
create trigger content_ideas_set_updated_at before update on public.content_ideas
  for each row execute function public.set_updated_at();
create trigger content_items_set_updated_at before update on public.content_items
  for each row execute function public.set_updated_at();
create trigger competitors_set_updated_at before update on public.competitors
  for each row execute function public.set_updated_at();
create trigger creator_insights_set_updated_at before update on public.creator_insights
  for each row execute function public.set_updated_at();
create trigger assets_set_updated_at before update on public.assets
  for each row execute function public.set_updated_at();

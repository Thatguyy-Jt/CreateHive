-- Persistent creator strategy (Phase 2 — Creator Intelligence).
--
-- One row per creator: the strategy is strategic memory that later agents
-- read, not a one-off AI reply. Pillars stay in `content_pillars`; this table
-- holds everything else the Strategy Agent produces. JSON columns are
-- validated by Zod (lib/schemas/creator.ts) on write and on read; the checks
-- here only pin their top-level shape.
--
-- `ai_generation_id` records provenance without a foreign key: `ai_generations`
-- is server-owned and its rows may be pruned independently.

create table public.creator_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique references public.users (id) on delete cascade,
  positioning text not null check (positioning <> ''),
  audience_profile jsonb not null check (jsonb_typeof(audience_profile) = 'object'),
  format_strategy jsonb not null check (jsonb_typeof(format_strategy) = 'array'),
  voice_profile jsonb not null check (jsonb_typeof(voice_profile) = 'object'),
  growth_objective text not null check (growth_objective <> ''),
  monetization_objective text not null check (monetization_objective <> ''),
  thirty_day_plan jsonb not null check (jsonb_typeof(thirty_day_plan) = 'array'),
  notes text,
  version integer not null default 1 check (version > 0),
  prompt_version text,
  ai_generation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger creator_strategies_set_updated_at before update on public.creator_strategies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- save_creator_strategy: one transaction for the strategy and its pillars
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER: runs with the caller's privileges, so RLS still limits it
-- to the caller's own rows. The owner comes from the JWT, never an argument.
--
-- Pillars are retired (`is_active = false`), not deleted: ideas and content
-- items reference them and should keep their history.

create function public.save_creator_strategy(p_strategy jsonb, p_pillars jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id text := (select auth.jwt() ->> 'sub');
  v_version integer;
  v_pillar_count integer;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'save_creator_strategy requires an authenticated creator'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_strategy) is distinct from 'object' then
    raise exception 'p_strategy must be a JSON object' using errcode = '22023';
  end if;
  if jsonb_typeof(p_pillars) is distinct from 'array' then
    raise exception 'p_pillars must be a JSON array' using errcode = '22023';
  end if;
  v_pillar_count := jsonb_array_length(p_pillars);
  if v_pillar_count < 3 or v_pillar_count > 5 then
    raise exception 'a strategy needs 3 to 5 pillars' using errcode = '22023';
  end if;

  insert into public.creator_strategies as s (
    user_id, positioning, audience_profile, format_strategy, voice_profile,
    growth_objective, monetization_objective, thirty_day_plan, notes,
    prompt_version, ai_generation_id
  )
  values (
    v_user_id,
    p_strategy ->> 'positioning',
    p_strategy -> 'audience_profile',
    p_strategy -> 'format_strategy',
    p_strategy -> 'voice_profile',
    p_strategy ->> 'growth_objective',
    p_strategy ->> 'monetization_objective',
    p_strategy -> 'thirty_day_plan',
    nullif(p_strategy ->> 'notes', ''),
    p_strategy ->> 'prompt_version',
    (p_strategy ->> 'ai_generation_id')::uuid
  )
  on conflict (user_id) do update set
    positioning = excluded.positioning,
    audience_profile = excluded.audience_profile,
    format_strategy = excluded.format_strategy,
    voice_profile = excluded.voice_profile,
    growth_objective = excluded.growth_objective,
    monetization_objective = excluded.monetization_objective,
    thirty_day_plan = excluded.thirty_day_plan,
    notes = excluded.notes,
    prompt_version = excluded.prompt_version,
    ai_generation_id = excluded.ai_generation_id,
    version = s.version + 1
  returning s.version into v_version;

  update public.content_pillars
    set is_active = false
    where user_id = v_user_id and is_active;

  insert into public.content_pillars (user_id, name, description, position, is_active)
  select
    v_user_id,
    p.value ->> 'name',
    nullif(p.value ->> 'description', ''),
    (p.ordinality - 1)::smallint,
    true
  from jsonb_array_elements(p_pillars) with ordinality as p(value, ordinality);

  return v_version;
end;
$$;

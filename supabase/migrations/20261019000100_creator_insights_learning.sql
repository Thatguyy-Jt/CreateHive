-- Phase 5, part 3: creator insights (Learning Agent).
--
-- Each successful insights update supersedes the creator's active insights and
-- inserts the new set, atomically, through `replace_creator_insights`. Rows
-- keep the generation they came from (for Undo on dismiss) and one next step.

alter table public.creator_insights
  -- No FK, as for content_versions and content_diagnoses.
  add column ai_generation_id uuid,
  add column next_step text
    check (next_step is null or char_length(next_step) between 1 and 300);

create index creator_insights_user_generation_idx
  on public.creator_insights (user_id, ai_generation_id);

-- SECURITY INVOKER: RLS still limits it to the caller's own rows. The owner
-- comes from the JWT, never an argument. Errors are stable tokens the app maps
-- to creator-facing text. A bad element aborts the whole call: nothing is
-- superseded unless the new set is stored.
create function public.replace_creator_insights(
  p_generation_id uuid,
  p_insights jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id text := (select auth.jwt() ->> 'sub');
  v_insight jsonb;
  v_count integer := 0;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'replace_creator_insights requires an authenticated creator'
      using errcode = '42501';
  end if;

  if p_insights is null
    or jsonb_typeof(p_insights) <> 'array'
    or jsonb_array_length(p_insights) > 6 then
    raise exception 'invalid_insights' using errcode = '22023';
  end if;

  update public.creator_insights
    set status = 'superseded'
    where user_id = v_user_id and status = 'active';

  for v_insight in select value from jsonb_array_elements(p_insights)
  loop
    if jsonb_typeof(v_insight) <> 'object'
      or jsonb_typeof(v_insight -> 'evidence') is distinct from 'array' then
      raise exception 'invalid_insights' using errcode = '22023';
    end if;

    insert into public.creator_insights
      (user_id, insight_type, summary, next_step, evidence, confidence, sample_size, status, ai_generation_id)
    values (
      v_user_id,
      v_insight ->> 'insight_type',
      v_insight ->> 'summary',
      v_insight ->> 'next_step',
      v_insight -> 'evidence',
      v_insight ->> 'confidence',
      (v_insight ->> 'sample_size')::integer,
      'active',
      p_generation_id
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants new
-- functions to anon. Only signed-in creators may call this.
revoke execute on function public.replace_creator_insights(uuid, jsonb) from public, anon;
grant execute on function public.replace_creator_insights(uuid, jsonb) to authenticated, service_role;

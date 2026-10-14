-- Calendar and weekly planning (Phase 3 — Opportunity Engine, part 3).
--
-- Additive only. Scheduling reuses `content_items`: a scheduled idea becomes a
-- `content_items` row (`status = 'scheduled'`, `scheduled_for`), the same row
-- Studio will later fill with a content package. No new table.
--
-- `creator_profiles.timezone` is an IANA name (for example `Africa/Lagos`),
-- unconstrained text validated by the app against the runtime's IANA list
-- (lib/calendar/dates.ts), like `platforms`. RLS and grants are unchanged:
-- the existing own-row policies cover the new column.
--
-- Indexes: the week query uses `content_items_user_id_scheduled_for_idx`, and
-- the saved-ideas list uses `content_ideas_user_id_status_idx`; per-creator
-- row counts are small, so no new index is needed.

alter table public.creator_profiles add column timezone text;

-- ---------------------------------------------------------------------------
-- schedule_content_ideas: schedule a batch of saved ideas in one transaction
-- ---------------------------------------------------------------------------
--
-- p_slots: [{ "idea_id": uuid, "scheduled_for": timestamptz }, ...]
--
-- SECURITY INVOKER: runs with the caller's privileges, so RLS still limits it
-- to the caller's own rows. The owner comes from the JWT, never an argument.
-- Any raise aborts the whole batch. Error messages are stable tokens the app
-- maps to creator-facing text.

create function public.schedule_content_ideas(p_slots jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id text := (select auth.jwt() ->> 'sub');
  v_count integer;
  v_slot jsonb;
  v_idea_id uuid;
  v_at timestamptz;
  v_idea record;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'schedule_content_ideas requires an authenticated creator'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'invalid_slots' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_slots);
  if v_count < 1 or v_count > 20 then
    raise exception 'invalid_slots' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_slots) as s(value) where jsonb_typeof(s.value) <> 'object') then
    raise exception 'invalid_slots' using errcode = '22023';
  end if;
  if (select count(distinct s.value ->> 'idea_id') from jsonb_array_elements(p_slots) as s(value)) <> v_count then
    raise exception 'duplicate_idea' using errcode = '22023';
  end if;

  for v_slot in select s.value from jsonb_array_elements(p_slots) as s(value) loop
    v_idea_id := (v_slot ->> 'idea_id')::uuid;
    v_at := (v_slot ->> 'scheduled_for')::timestamptz;
    if v_idea_id is null or v_at is null then
      raise exception 'invalid_slots' using errcode = '22023';
    end if;
    if v_at < now() - interval '1 hour' or v_at > now() + interval '180 days' then
      raise exception 'scheduled_for_out_of_range' using errcode = '22023';
    end if;

    select i.status, i.topic, i.platform, i.format, i.pillar_id
      into v_idea
      from public.content_ideas as i
      where i.id = v_idea_id and i.user_id = v_user_id
      for update;
    if not found then
      raise exception 'idea_not_found' using errcode = 'P0002';
    end if;
    if v_idea.status <> 'saved' then
      raise exception 'idea_not_saved' using errcode = 'P0001';
    end if;

    insert into public.content_items (user_id, idea_id, pillar_id, title, platform, format, status, scheduled_for)
    values (v_user_id, v_idea_id, v_idea.pillar_id, v_idea.topic, v_idea.platform, v_idea.format, 'scheduled', v_at);

    update public.content_ideas
      set status = 'planned'
      where id = v_idea_id and user_id = v_user_id;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- unschedule_content_item: take one scheduled item off the calendar
-- ---------------------------------------------------------------------------
--
-- Without Studio work (no `content_versions`), the item is deleted and its
-- idea goes back to `saved`. With versions, the item is kept as a `draft`
-- without a date and the idea stays `planned`, so nothing the creator wrote
-- is lost.

create function public.unschedule_content_item(p_item_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id text := (select auth.jwt() ->> 'sub');
  v_idea_id uuid;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'unschedule_content_item requires an authenticated creator'
      using errcode = '42501';
  end if;

  select c.idea_id
    into v_idea_id
    from public.content_items as c
    where c.id = p_item_id and c.user_id = v_user_id and c.status = 'scheduled'
    for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.content_versions as v
    where v.content_item_id = p_item_id and v.user_id = v_user_id
  ) then
    update public.content_items
      set status = 'draft', scheduled_for = null
      where id = p_item_id and user_id = v_user_id;
    return;
  end if;

  delete from public.content_items where id = p_item_id and user_id = v_user_id;

  if v_idea_id is not null then
    update public.content_ideas
      set status = 'saved'
      where id = v_idea_id and user_id = v_user_id and status = 'planned';
  end if;
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants new
-- functions to anon. Only signed-in creators may call these.
revoke execute on function public.schedule_content_ideas(jsonb) from public, anon;
grant execute on function public.schedule_content_ideas(jsonb) to authenticated, service_role;
revoke execute on function public.unschedule_content_item(uuid) from public, anon;
grant execute on function public.unschedule_content_item(uuid) to authenticated, service_role;

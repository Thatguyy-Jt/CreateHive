-- Content Studio: package generation (Phase 4 — Content Studio, part 1).
--
-- Additive only. A Studio item is a `content_items` row; each generated
-- package is an append-only `content_versions` row (`source = 'ai'`). No new
-- table, no new check constraint, and RLS is unchanged: the new column
-- inherits the `content_versions` grants (select and insert only).

-- Provenance for AI versions. No FK, as for `content_ideas.ai_generation_id`
-- and `creator_strategies`: `ai_generations` rows are server-owned metering.
alter table public.content_versions add column ai_generation_id uuid;

-- ---------------------------------------------------------------------------
-- start_studio_item: open Studio for a saved idea
-- ---------------------------------------------------------------------------
--
-- In one transaction, with the idea row locked:
-- - `saved`: inserts a `draft` item from the idea (title = topic, platform,
--   format, pillar) and moves the idea to `in_production`;
-- - `planned` or `in_production`: returns that idea's newest non-archived
--   item, so a double submit never creates two items;
-- - anything else: `idea_not_available`.
--
-- SECURITY INVOKER: RLS still limits it to the caller's own rows. The owner
-- comes from the JWT, never an argument. Errors are stable tokens the app maps
-- to creator-facing text.

create function public.start_studio_item(p_idea_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id text := (select auth.jwt() ->> 'sub');
  v_idea record;
  v_item_id uuid;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'start_studio_item requires an authenticated creator'
      using errcode = '42501';
  end if;

  select i.status, i.topic, i.platform, i.format, i.pillar_id
    into v_idea
    from public.content_ideas as i
    where i.id = p_idea_id and i.user_id = v_user_id
    for update;
  if not found then
    raise exception 'idea_not_found' using errcode = 'P0002';
  end if;

  if v_idea.status = 'saved' then
    insert into public.content_items (user_id, idea_id, pillar_id, title, platform, format, status)
    values (v_user_id, p_idea_id, v_idea.pillar_id, v_idea.topic, v_idea.platform, v_idea.format, 'draft')
    returning id into v_item_id;

    update public.content_ideas
      set status = 'in_production'
      where id = p_idea_id and user_id = v_user_id;
    return v_item_id;
  end if;

  if v_idea.status in ('planned', 'in_production') then
    select c.id
      into v_item_id
      from public.content_items as c
      where c.idea_id = p_idea_id and c.user_id = v_user_id and c.status <> 'archived'
      order by c.created_at desc
      limit 1;
    if found then
      return v_item_id;
    end if;
  end if;

  raise exception 'idea_not_available' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- schedule_content_item: put a Studio draft on the calendar
-- ---------------------------------------------------------------------------
--
-- Only from `draft`, in the same window as `schedule_content_ideas` (1 hour in
-- the past to 180 days ahead). Its idea moves from `in_production` to
-- `planned`, so `unschedule_content_item` later behaves as it does for any
-- scheduled item.

create function public.schedule_content_item(p_item_id uuid, p_scheduled_for timestamptz)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id text := (select auth.jwt() ->> 'sub');
  v_item record;
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'schedule_content_item requires an authenticated creator'
      using errcode = '42501';
  end if;

  if p_scheduled_for is null
    or p_scheduled_for < now() - interval '1 hour'
    or p_scheduled_for > now() + interval '180 days' then
    raise exception 'scheduled_for_out_of_range' using errcode = '22023';
  end if;

  select c.status, c.idea_id
    into v_item
    from public.content_items as c
    where c.id = p_item_id and c.user_id = v_user_id
    for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_item.status <> 'draft' then
    raise exception 'item_not_draft' using errcode = 'P0001';
  end if;

  update public.content_items
    set status = 'scheduled', scheduled_for = p_scheduled_for
    where id = p_item_id and user_id = v_user_id;

  if v_item.idea_id is not null then
    update public.content_ideas
      set status = 'planned'
      where id = v_item.idea_id and user_id = v_user_id and status = 'in_production';
  end if;
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants new
-- functions to anon. Only signed-in creators may call these.
revoke execute on function public.start_studio_item(uuid) from public, anon;
grant execute on function public.start_studio_item(uuid) to authenticated, service_role;
revoke execute on function public.schedule_content_item(uuid, timestamptz) from public, anon;
grant execute on function public.schedule_content_item(uuid, timestamptz) to authenticated, service_role;

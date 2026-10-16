-- Analytics: publishing, results entry and baselines (Phase 5 — Analytics and
-- Learning, part 1).
--
-- Additive only. A post is a `content_items` row with `status = 'published'`;
-- each results check-in is an `analytics_snapshots` row. No new table. RLS and
-- grants are unchanged: both tables already have own-row CRUD, and the new
-- columns inherit it. The new checks are ranges, not value lists, so schema
-- parity (`DB_ENUM_COLUMNS`) is unchanged.

-- What was actually posted, for diagnosis (part 2). Both optional.
alter table public.content_items
  add column hook_used text check (char_length(hook_used) between 1 and 300),
  add column duration_seconds integer check (duration_seconds between 1 and 86400);

-- The post page and the baseline read a post's check-ins in time order.
drop index public.analytics_snapshots_content_item_id_idx;
create index analytics_snapshots_content_item_id_captured_at_idx
  on public.analytics_snapshots (content_item_id, captured_at);

-- ---------------------------------------------------------------------------
-- publish_content_item: mark a Studio item as posted
-- ---------------------------------------------------------------------------
--
-- In one transaction, with the item row locked:
-- - optional details default to null;
-- - only from `draft`, `ready` or `scheduled`;
-- - `published_at` between 2 years ago and 1 hour from now;
-- - sets `published` and the details; `scheduled_for` is kept as history;
-- - its idea, if any, moves from `planned` or `in_production` to `used`.
--
-- SECURITY INVOKER: RLS still limits it to the caller's own rows. The owner
-- comes from the JWT, never an argument. Errors are stable tokens the app maps
-- to creator-facing text.

create function public.publish_content_item(
  p_item_id uuid,
  p_published_at timestamptz,
  p_published_url text default null,
  p_hook_used text default null,
  p_duration_seconds integer default null
)
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
    raise exception 'publish_content_item requires an authenticated creator'
      using errcode = '42501';
  end if;

  if p_published_at is null
    or p_published_at < now() - interval '2 years'
    or p_published_at > now() + interval '1 hour' then
    raise exception 'published_at_out_of_range' using errcode = '22023';
  end if;

  select c.status, c.idea_id
    into v_item
    from public.content_items as c
    where c.id = p_item_id and c.user_id = v_user_id
    for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_item.status not in ('draft', 'ready', 'scheduled') then
    raise exception 'item_not_publishable' using errcode = 'P0001';
  end if;

  update public.content_items
    set status = 'published',
        published_at = p_published_at,
        published_url = p_published_url,
        hook_used = p_hook_used,
        duration_seconds = p_duration_seconds
    where id = p_item_id and user_id = v_user_id;

  if v_item.idea_id is not null then
    update public.content_ideas
      set status = 'used'
      where id = v_item.idea_id and user_id = v_user_id and status in ('planned', 'in_production');
  end if;
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants new
-- functions to anon. Only signed-in creators may call this.
revoke execute on function public.publish_content_item(uuid, timestamptz, text, text, integer) from public, anon;
grant execute on function public.publish_content_item(uuid, timestamptz, text, text, integer) to authenticated, service_role;

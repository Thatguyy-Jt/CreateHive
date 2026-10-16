-- Content Studio: discarding a draft (Phase 4 — Content Studio, part 2).
--
-- Additive only: one function. No table, column, constraint, RLS or grant
-- change. Versions stay append-only for creators (select and insert only);
-- deleting the item is the only way its versions go away (FK cascade).

-- ---------------------------------------------------------------------------
-- discard_studio_item: delete a Studio draft and return its idea to Saved
-- ---------------------------------------------------------------------------
--
-- In one transaction, with the item row locked:
-- - only `draft` items (a scheduled item is first removed from the calendar,
--   which keeps it as a draft);
-- - the item is deleted; `content_versions` cascade, and
--   `ai_generations.content_item_id` is set to null by its existing FK;
-- - its idea, if any, goes from `in_production` or `planned` back to `saved`.
--
-- SECURITY INVOKER: RLS still limits it to the caller's own rows. The owner
-- comes from the JWT, never an argument. Errors are stable tokens the app maps
-- to creator-facing text.

create function public.discard_studio_item(p_item_id uuid)
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
    raise exception 'discard_studio_item requires an authenticated creator'
      using errcode = '42501';
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

  delete from public.content_items where id = p_item_id and user_id = v_user_id;

  if v_item.idea_id is not null then
    update public.content_ideas
      set status = 'saved'
      where id = v_item.idea_id and user_id = v_user_id and status in ('in_production', 'planned');
  end if;
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase also grants new
-- functions to anon. Only signed-in creators may call this.
revoke execute on function public.discard_studio_item(uuid) from public, anon;
grant execute on function public.discard_studio_item(uuid) to authenticated, service_role;

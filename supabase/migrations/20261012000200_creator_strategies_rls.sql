-- Row Level Security, grants and policies for creator_strategies and
-- save_creator_strategy(). Same access model as 20261009000200_rls_policies.sql.

alter table public.creator_strategies enable row level security;
alter table public.creator_strategies force row level security;

revoke all on public.creator_strategies from anon, authenticated;
grant all on public.creator_strategies to service_role;
grant select, insert, update, delete on public.creator_strategies to authenticated;

create policy creator_strategies_select_own on public.creator_strategies
  for select to authenticated using (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_strategies_insert_own on public.creator_strategies
  for insert to authenticated with check (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_strategies_update_own on public.creator_strategies
  for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));
create policy creator_strategies_delete_own on public.creator_strategies
  for delete to authenticated using (user_id = (select auth.jwt() ->> 'sub'));

-- Functions are executable by PUBLIC by default, and Supabase also grants new
-- functions to anon. Only signed-in creators may call this one.
revoke execute on function public.save_creator_strategy(jsonb, jsonb) from public, anon;
grant execute on function public.save_creator_strategy(jsonb, jsonb) to authenticated, service_role;

-- Partial indexes for the daily maintenance sweeps (lib/jobs/daily-maintenance.ts),
-- which otherwise scan whole tables once a day as the data grows.
--
-- Both stay small: pending generations are short-lived, and only signals with
-- an expiry (YouTube) are indexed. Plain `create index`: `concurrently` can't
-- run inside a migration transaction, and the tables are small at beta.
-- No RLS or grant changes.

-- update ai_generations ... where status = 'pending' and created_at < cutoff
create index ai_generations_pending_created_at_idx
  on public.ai_generations (created_at)
  where status = 'pending';

-- delete from research_signals where expires_at < now
create index research_signals_expires_at_idx
  on public.research_signals (expires_at)
  where expires_at is not null;

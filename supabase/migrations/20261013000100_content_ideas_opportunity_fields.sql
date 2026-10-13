-- Opportunity fields on content_ideas (Phase 3 — Opportunities).
--
-- Additive only. `platform` is unconstrained text validated by the app's
-- `platform` enum (lib/schemas/creator.ts), like `creator_profiles.platforms`.
-- `rationale` explains why an idea fits the creator's strategy.
-- `ai_generation_id` records provenance without a foreign key: `ai_generations`
-- is server-owned and its rows may be pruned independently.
--
-- RLS and grants are unchanged: the existing own-row policies and table grants
-- cover the new columns.

alter table public.content_ideas
  add column platform text,
  add column rationale text,
  add column ai_generation_id uuid;

-- The opportunities list: a creator's ideas, newest first.
create index content_ideas_user_id_created_at_idx
  on public.content_ideas (user_id, created_at desc);

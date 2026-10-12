import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

// Mirrors the pieces of a Supabase database that the migrations rely on but
// do not create: the API roles and `auth.jwt()`, which Supabase defines as a
// read of the `request.jwt.claims` setting that PostgREST sets per request.
const SUPABASE_SHIM = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema auth;
  create function auth.jwt() returns jsonb
    language sql stable
    as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
      )::jsonb
    $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.jwt() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

export const CORE_TABLES = [
  "users",
  "subscriptions",
  "creator_profiles",
  "brand_profiles",
  "content_pillars",
  "content_ideas",
  "content_items",
  "content_versions",
  "analytics_snapshots",
  "competitors",
  "research_signals",
  "creator_insights",
  "ai_generations",
  "assets",
  "usage_events",
  "notifications",
  "creator_strategies",
] as const;

/** A valid `creator_strategies` row's JSON columns, as strings for parameterized inserts. */
export const STRATEGY_JSON = {
  audience_profile: JSON.stringify({ summary: "s", pain_points: ["a", "b"], desires: ["c", "d"], where_they_are: ["e"] }),
  format_strategy: JSON.stringify([{ platform: "youtube", formats: ["shorts"], cadence: "2/wk", rationale: "r" }]),
  voice_profile: JSON.stringify({ summary: "s", traits: ["a", "b"], sounds_like: ["x"], avoid: ["y"] }),
  thirty_day_plan: JSON.stringify(
    [1, 2, 3, 4].map((week) => ({ week, theme: "t", focus: "f", actions: ["a", "b"] })),
  ),
};

export type CoreTable = (typeof CORE_TABLES)[number];

/** Fresh in-memory Postgres with the Supabase shim and every migration applied in order. */
export async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

type Session =
  | { role: "authenticated"; sub?: string }
  | { role: "anon" }
  | { role: "service_role" };

/**
 * Runs `fn` as the given API role inside a transaction that is always rolled
 * back, so test cases never leak writes into each other.
 */
async function withSession<T>(
  db: PGlite,
  session: Session,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims: Record<string, string> = { role: session.role };
    if (session.role === "authenticated" && session.sub) claims.sub = session.sub;

    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${session.role}`);
    try {
      return await fn(tx);
    } finally {
      await tx.rollback();
    }
  });
}

export const asUser = <T>(db: PGlite, sub: string, fn: (tx: Transaction) => Promise<T>) =>
  withSession(db, { role: "authenticated", sub }, fn);

/** Authenticated role whose token has no `sub` claim. */
export const asSubjectless = <T>(db: PGlite, fn: (tx: Transaction) => Promise<T>) =>
  withSession(db, { role: "authenticated" }, fn);

export const asAnon = <T>(db: PGlite, fn: (tx: Transaction) => Promise<T>) =>
  withSession(db, { role: "anon" }, fn);

export const asService = <T>(db: PGlite, fn: (tx: Transaction) => Promise<T>) =>
  withSession(db, { role: "service_role" }, fn);

type Row = Record<string, unknown>;
type Queryable = Pick<PGlite, "query"> | Pick<Transaction, "query">;

/** Parameterized single-row insert; returns the inserted row. */
export async function insertRow(q: Queryable, table: string, values: Row): Promise<Row> {
  const cols = Object.keys(values);
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `insert into public.${table} (${cols.join(", ")}) values (${params}) returning *`;
  const result = await q.query<Row>(sql, Object.values(values));
  return result.rows[0];
}

export interface Fixture {
  userId: string;
  pillarId: string;
  ideaId: string;
  itemId: string;
  generationId: string;
  /** id of the seeded row in each table (`users` → the user id). */
  rowIds: Record<CoreTable, string>;
}

/**
 * Seeds one row in every core table for `userId`, as the database owner
 * (bypasses RLS), so isolation tests have a target to attack.
 */
export async function seedCreator(db: PGlite, userId: string): Promise<Fixture> {
  const id = async (table: CoreTable, values: Row) =>
    String((await insertRow(db, table, values)).id);

  await insertRow(db, "users", { id: userId, email: `${userId}@example.com` });
  const pillarId = await id("content_pillars", { user_id: userId, name: "Pillar" });
  const ideaId = await id("content_ideas", { user_id: userId, topic: "Topic", pillar_id: pillarId });
  const itemId = await id("content_items", {
    user_id: userId,
    title: "Item",
    idea_id: ideaId,
    pillar_id: pillarId,
  });
  const generationId = await id("ai_generations", {
    user_id: userId,
    kind: "content_package",
    content_item_id: itemId,
  });

  const rowIds: Record<CoreTable, string> = {
    users: userId,
    content_pillars: pillarId,
    content_ideas: ideaId,
    content_items: itemId,
    ai_generations: generationId,
    subscriptions: await id("subscriptions", { user_id: userId }),
    creator_profiles: await id("creator_profiles", { user_id: userId, niche: "Fitness" }),
    brand_profiles: await id("brand_profiles", { user_id: userId, tone: "warm" }),
    content_versions: await id("content_versions", {
      user_id: userId,
      content_item_id: itemId,
      version_no: 1,
      source: "ai",
    }),
    analytics_snapshots: await id("analytics_snapshots", {
      user_id: userId,
      content_item_id: itemId,
      views: 100,
    }),
    competitors: await id("competitors", { user_id: userId, platform: "youtube", handle: "@rival" }),
    research_signals: await id("research_signals", {
      user_id: userId,
      source: "manual",
      signal_type: "comment",
    }),
    creator_insights: await id("creator_insights", {
      user_id: userId,
      insight_type: "hook",
      summary: "Question hooks retain better",
    }),
    assets: await id("assets", {
      user_id: userId,
      name: "thumb.png",
      mime_type: "image/png",
      size_bytes: 1024,
      storage_path: `${userId}/thumb.png`,
      content_item_id: itemId,
    }),
    usage_events: await id("usage_events", {
      user_id: userId,
      event_type: "ai_generation",
      ai_generation_id: generationId,
    }),
    notifications: await id("notifications", { user_id: userId, type: "digest", title: "Hello" }),
    creator_strategies: await id("creator_strategies", {
      user_id: userId,
      positioning: "Helps busy parents train at home",
      growth_objective: "Grow",
      monetization_objective: "Earn",
      ...STRATEGY_JSON,
    }),
  };

  return { userId, pillarId, ideaId, itemId, generationId, rowIds };
}

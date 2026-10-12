import type { AiDbClient } from "@/lib/ai/limits";

type DbError = { code: string; message: string } | null;

export interface FakeDbOptions {
  /** Rows counted by the limit query (the fake trusts the caller's filter). */
  count?: number;
  countError?: DbError;
  insertGenerationError?: DbError;
  updateGenerationError?: DbError;
  insertUsageError?: DbError;
}

/**
 * Minimal stand-in for the supabase-js builder calls the AI service makes.
 * Records every write and the limit query's filters.
 */
export function fakeDb(options: FakeDbOptions = {}) {
  const writes = {
    generationInserts: [] as Record<string, unknown>[],
    generationUpdates: [] as { row: Record<string, unknown>; filters: [string, unknown][] }[],
    usageInserts: [] as Record<string, unknown>[],
  };
  const limitQueries: { filters: [string, unknown][]; or?: string }[] = [];

  const client = {
    from(table: string) {
      if (table === "usage_events") {
        return {
          insert: async (row: Record<string, unknown>) => {
            writes.usageInserts.push(row);
            return { error: options.insertUsageError ?? null };
          },
        };
      }
      if (table !== "ai_generations") throw new Error(`unexpected table ${table}`);
      return {
        select: () => {
          const query = { filters: [] as [string, unknown][], or: undefined as string | undefined };
          limitQueries.push(query);
          const builder = {
            eq: (column: string, value: unknown) => (query.filters.push([column, value]), builder),
            gte: (column: string, value: unknown) => (query.filters.push([`${column}>=`, value]), builder),
            or: async (expression: string) => {
              query.or = expression;
              return { count: options.countError ? null : (options.count ?? 0), error: options.countError ?? null };
            },
          };
          return builder;
        },
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              writes.generationInserts.push(row);
              return options.insertGenerationError
                ? { data: null, error: options.insertGenerationError }
                : { data: { id: "gen_1" }, error: null };
            },
          }),
        }),
        update: (row: Record<string, unknown>) => {
          const entry = { row, filters: [] as [string, unknown][] };
          writes.generationUpdates.push(entry);
          const builder = {
            eq: (column: string, value: unknown) => {
              entry.filters.push([column, value]);
              return entry.filters.length >= 2 ? Promise.resolve({ error: options.updateGenerationError ?? null }) : builder;
            },
          };
          return builder;
        },
      };
    },
  };

  return { db: client as unknown as AiDbClient, writes, limitQueries };
}

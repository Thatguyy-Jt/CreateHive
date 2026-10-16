type PgError = { code: string; message: string };

export interface FakeResult {
  data?: unknown;
  error?: PgError | null;
  count?: number | null;
}

export interface RecordedQuery {
  table: string;
  op: "select" | "insert" | "upsert" | "update" | "delete";
  columns?: string;
  payload?: unknown;
  options?: unknown;
  filters: [string, ...unknown[]][];
}

type Handler = FakeResult | Error | ((query: RecordedQuery) => FakeResult | Error);

/**
 * Chainable stand-in for the supabase-js builder. Every chain is thenable and
 * resolves through the handler for its table; filters and writes are recorded.
 * A table without a handler fails the test, so unexpected reads surface.
 */
export function fakeSupabase(
  tables: Record<string, Handler>,
  rpc?: (name: string, args: unknown) => FakeResult | Error,
) {
  const queries: RecordedQuery[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];

  const settle = (handler: Handler | undefined, query: RecordedQuery) => {
    if (!handler) return Promise.reject(new Error(`unexpected table ${query.table}`));
    const outcome = typeof handler === "function" ? handler(query) : handler;
    return outcome instanceof Error
      ? Promise.reject(outcome)
      : Promise.resolve({ data: null, error: null, count: null, ...outcome });
  };

  function builder(query: RecordedQuery) {
    const chain: Record<string, unknown> = {};
    for (const method of ["eq", "gte", "lt", "order", "limit", "in", "neq", "or", "like"]) {
      chain[method] = (...args: unknown[]) => {
        query.filters.push([method, ...args]);
        return chain;
      };
    }
    chain.select = (columns?: string) => {
      query.columns ??= columns;
      return chain;
    };
    chain.maybeSingle = () => chain;
    chain.single = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      settle(tables[query.table], query).then(resolve, reject);
    return chain;
  }

  const client = {
    from(table: string) {
      const start = (op: RecordedQuery["op"], payload?: unknown, options?: unknown, columns?: string) => {
        const query: RecordedQuery = { table, op, payload, options, columns, filters: [] };
        queries.push(query);
        return builder(query);
      };
      return {
        select: (columns?: string, options?: unknown) => start("select", undefined, options, columns),
        insert: (payload: unknown) => start("insert", payload),
        upsert: (payload: unknown, options?: unknown) => start("upsert", payload, options),
        update: (payload: unknown) => start("update", payload),
        delete: () => start("delete"),
      };
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      if (!rpc) return Promise.reject(new Error(`unexpected rpc ${name}`));
      const outcome = rpc(name, args);
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({ data: null, error: null, ...outcome });
    },
  };

  return { client: client as never, queries, rpcCalls };
}

export const pgError = (code = "XX000", message = "boom"): PgError => ({ code, message });

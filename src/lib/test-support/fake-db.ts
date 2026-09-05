/**
 * A small in-memory stand-in for the PostgREST client, for tests about money.
 *
 * ---------------------------------------------------------------------------
 * Why this exists, given `analyse.test.ts` says the opposite
 * ---------------------------------------------------------------------------
 *
 * The rule in this repo is that pure decisions are unit-tested and the
 * conversations with Postgres are verified against a real database, because a
 * fake that answers differently from Postgres is worse than no test at all.
 * That rule still stands for anything about data.
 *
 * These tests are not about data. They are about **whether a provider call
 * happens at all** — a claim that loses, a flag that is off, a demand gate that
 * matches nobody. Those decisions live in TypeScript, between two queries, and
 * the only way to assert "and then nothing was bought" is to run the stage and
 * count. So this fake implements exactly the operators the pipeline actually
 * uses, evaluates PostgREST filter strings rather than ignoring them (a fake
 * that ignored `.eq("status", "pending")` would make every claim succeed and
 * every one of these tests vacuous), and is deliberately narrow everywhere
 * else.
 *
 * What it does NOT model, and what therefore still belongs in SQL or in a live
 * check: row-level security, real atomicity, `count: "planned"`, embedded
 * resource selection (seed the nested object instead), and any operator not in
 * `compare()` below — an unsupported one throws rather than silently matching.
 */

export type Row = Record<string, unknown>;

type Filter = (row: Row) => boolean;

type Hooks = {
  /**
   * Runs after a select resolves, before the caller sees it. The hook that
   * makes a race testable: it is where "another worker claimed this row between
   * your select and your update" is expressed.
   */
  afterSelect?: (table: string, rows: Row[]) => void;
};

export type RpcHandler = (args: Record<string, unknown>) => unknown;

export class FakeDb {
  readonly tables: Record<string, Row[]>;
  readonly rpcs: Record<string, RpcHandler>;
  readonly hooks: Hooks;
  /** Every rpc name called, in order. */
  readonly rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  constructor(
    tables: Record<string, Row[]> = {},
    rpcs: Record<string, RpcHandler> = {},
    hooks: Hooks = {},
  ) {
    this.tables = tables;
    this.rpcs = rpcs;
    this.hooks = hooks;
  }

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  async rpc(fn: string, args: Record<string, unknown> = {}) {
    this.rpcCalls.push({ fn, args });
    const handler = this.rpcs[fn];
    if (!handler) return { data: null, error: { message: `no such function: ${fn}` } };
    const out = handler(args);
    if (out instanceof Error) return { data: null, error: { message: out.message } };
    return { data: out, error: null };
  }
}

/* ---------------------------------------------------------------------- */
/* Filter evaluation                                                      */
/* ---------------------------------------------------------------------- */

function coerce(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function compare(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return String(actual) === String(expected);
    case "neq":
      return String(actual) !== String(expected);
    case "is":
      return expected === null ? actual === null || actual === undefined : actual === expected;
    case "lt":
      return actual !== null && actual !== undefined && String(actual) < String(expected);
    case "lte":
      return actual !== null && actual !== undefined && String(actual) <= String(expected);
    case "gt":
      return actual !== null && actual !== undefined && String(actual) > String(expected);
    case "gte":
      return actual !== null && actual !== undefined && String(actual) >= String(expected);
    case "ilike":
    case "like": {
      // PostgREST spells the wildcard `*`; SQL spells it `%`. Both appear in
      // this codebase's filter strings, so both are accepted here.
      const pattern = String(expected).replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(`^${pattern.replace(/[*%]/g, ".*")}$`, op === "ilike" ? "i" : "");
      return rx.test(String(actual ?? ""));
    }
    default:
      throw new Error(`fake-db: unsupported filter operator "${op}"`);
  }
}

/**
 * Splits on top-level commas only, so `and(a.eq.1,b.eq.2)` stays one term.
 */
function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current !== "") out.push(current);
  return out;
}

/** One `col.op.value` term, an `and(...)` group, or an `in.(a,b)` list. */
function term(expr: string): Filter {
  const trimmed = expr.trim();

  if (trimmed.startsWith("and(") && trimmed.endsWith(")")) {
    const inner = splitTop(trimmed.slice(4, -1)).map(term);
    return (row) => inner.every((f) => f(row));
  }
  if (trimmed.startsWith("or(") && trimmed.endsWith(")")) {
    const inner = splitTop(trimmed.slice(3, -1)).map(term);
    return (row) => inner.some((f) => f(row));
  }

  const inMatch = /^([\w.]+)\.in\.\((.*)\)$/.exec(trimmed);
  if (inMatch) {
    const [, col, list] = inMatch;
    const values = (list ?? "").split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    return (row) => values.includes(String(row[col as string]));
  }

  const parts = trimmed.split(".");
  if (parts.length < 3) throw new Error(`fake-db: cannot parse filter "${trimmed}"`);
  const col = parts[0] as string;
  const op = parts[1] as string;
  const value = coerce(parts.slice(2).join("."));
  return (row) => compare(row[col], op, value);
}

/** A PostgREST `.or()` string: top-level commas are OR. */
export function orFilter(expr: string): Filter {
  const terms = splitTop(expr).map(term);
  return (row) => terms.some((f) => f(row));
}

/* ---------------------------------------------------------------------- */
/* Query builder                                                          */
/* ---------------------------------------------------------------------- */

type Mode =
  | { kind: "select"; count: boolean }
  | { kind: "update"; patch: Row; returning: boolean }
  | { kind: "delete" }
  | { kind: "insert"; rows: Row[] }
  | { kind: "upsert"; rows: Row[]; onConflict: string[]; ignoreDuplicates: boolean };

class FakeQuery implements PromiseLike<{
  data: Row[] | null;
  error: null | { message: string };
  count?: number;
}> {
  private readonly filters: Filter[] = [];
  private mode: Mode = { kind: "select", count: false };
  private ordering: { column: string; ascending: boolean } | null = null;
  private limitTo: number | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(_columns?: string, options?: { count?: string }): this {
    if (this.mode.kind === "update") this.mode = { ...this.mode, returning: true };
    else if (this.mode.kind === "select")
      this.mode = { kind: "select", count: options?.count === "exact" };
    return this;
  }

  update(patch: Row): this {
    this.mode = { kind: "update", patch, returning: false };
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.mode = { kind: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.mode = {
      kind: "upsert",
      rows: Array.isArray(rows) ? rows : [rows],
      onConflict: (options?.onConflict ?? "id").split(",").map((c) => c.trim()),
      ignoreDuplicates: options?.ignoreDuplicates === true,
    };
    return this;
  }

  delete(): this {
    this.mode = { kind: "delete" };
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], "eq", value));
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], "neq", value));
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], "is", value));
    return this;
  }

  not(column: string, op: string, value: unknown): this {
    this.filters.push((row) => !compare(row[column], op, value));
    return this;
  }

  in(column: string, values: unknown[]): this {
    const wanted = values.map((v) => String(v));
    this.filters.push((row) => wanted.includes(String(row[column])));
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], "lt", value));
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], "lte", value));
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], "gt", value));
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], "gte", value));
    return this;
  }

  ilike(column: string, value: unknown): this {
    this.filters.push((row) => compare(row[column], "ilike", value));
    return this;
  }

  or(expr: string): this {
    this.filters.push(orFilter(expr));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.ordering = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this.limitTo = n;
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null | { message: string } }> {
    const { data, error } = await this.run();
    return { data: data?.[0] ?? null, error };
  }

  async single(): Promise<{ data: Row | null; error: null | { message: string } }> {
    return this.maybeSingle();
  }

  then<
    TResult1 = { data: Row[] | null; error: null | { message: string }; count?: number },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: Row[] | null;
          error: null | { message: string };
          count?: number;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private matches(): Row[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)));
  }

  private async run(): Promise<{
    data: Row[] | null;
    error: null | { message: string };
    count?: number;
  }> {
    const rows = this.db.rows(this.table);

    if (this.mode.kind === "insert") {
      rows.push(...this.mode.rows.map((r) => ({ ...r })));
      return { data: this.mode.rows, error: null };
    }

    if (this.mode.kind === "upsert") {
      const { onConflict, ignoreDuplicates } = this.mode;
      for (const incoming of this.mode.rows) {
        const existing = rows.find((row) =>
          onConflict.every((key) => String(row[key]) === String(incoming[key])),
        );
        if (!existing) rows.push({ ...incoming });
        else if (!ignoreDuplicates) Object.assign(existing, incoming);
      }
      return { data: this.mode.rows, error: null };
    }

    if (this.mode.kind === "update") {
      const hit = this.matches();
      for (const row of hit) Object.assign(row, this.mode.patch);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }

    if (this.mode.kind === "delete") {
      const hit = new Set(this.matches());
      this.db.tables[this.table] = rows.filter((row) => !hit.has(row));
      return { data: [], error: null };
    }

    let out = this.matches().map((r) => ({ ...r }));
    const total = out.length;

    if (this.ordering) {
      const { column, ascending } = this.ordering;
      out = [...out].sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (left === right) return 0;
        if (left === null || left === undefined) return 1;
        if (right === null || right === undefined) return -1;
        const cmp = String(left) < String(right) ? -1 : 1;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitTo !== null) out = out.slice(0, this.limitTo);

    this.db.hooks.afterSelect?.(this.table, out);

    return this.mode.count ? { data: out, error: null, count: total } : { data: out, error: null };
  }
}

/** Cast helper: the pipeline stages take a typed Supabase client. */
export function asDb(fake: FakeDb): never {
  return fake as never;
}

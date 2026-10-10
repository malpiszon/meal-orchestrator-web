import type { SupabaseClient } from "@supabase/supabase-js";

/** One table row of a fixture. Embeds (e.g. `plan_meal_options`) are part of the row as given. */
export type Row = Record<string, unknown>;

interface FakeError {
  code: string;
  message: string;
}

interface Result<T> {
  data: T;
  error: FakeError | null;
}

type Filter = (row: Row) => boolean;

interface Order {
  column: string;
  ascending: boolean;
}

/**
 * Wraps `target` so that reading any property it doesn't have throws: a query method the fake doesn't
 * implement fails the test instead of being ignored (an ignored filter would let a lying test pass).
 * Symbols pass through, so inspection by the test runner keeps working.
 */
function failLoudly<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol" || prop in obj) return Reflect.get(obj, prop, receiver) as unknown;
      throw new Error(`fake-supabase: ${prop} not implemented`);
    },
  });
}

function rejectOptions(method: string, options: object | undefined, allowed: readonly string[] = []): void {
  const extra = Object.keys(options ?? {}).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new Error(`fake-supabase: ${method} option ${extra.join(", ")} not implemented`);
  }
}

// Comparisons are on ISO date strings (`YYYY-MM-DD`), which sort lexicographically.
function isoValue(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`fake-supabase: ${column} is not a string in a fixture row`);
  }
  return value;
}

function isoArgument(method: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`fake-supabase: ${method} compares ISO date strings only`);
  }
  return value;
}

/**
 * The filter builder `select` returns. Filters, order and limit are collected and applied when the query
 * resolves, as PostgREST applies them regardless of call order.
 */
class FakeFilterBuilder implements PromiseLike<Result<Row[]>> {
  private readonly filters: Filter[] = [];
  private readonly orders: Order[] = [];
  private maxRows: number | null = null;

  constructor(private readonly rows: readonly Row[]) {}

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gt(column: string, value: unknown): this {
    const bound = isoArgument("gt", value);
    this.filters.push((row) => isoValue(row, column) > bound);
    return this;
  }

  lte(column: string, value: unknown): this {
    const bound = isoArgument("lte", value);
    this.filters.push((row) => isoValue(row, column) <= bound);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    rejectOptions("order", options, ["ascending"]);
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number, options?: object): this {
    rejectOptions("limit", options);
    this.maxRows = count;
    return this;
  }

  /** The single matching row, or `null` when none; an error when more than one row matches. */
  maybeSingle(): Promise<Result<Row | null>> {
    const rows = this.run();
    if (rows.length > 1) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      });
    }
    return Promise.resolve({ data: rows.length === 1 ? rows[0] : null, error: null });
  }

  then<TResult1 = Result<Row[]>, TResult2 = never>(
    onfulfilled?: ((value: Result<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve<Result<Row[]>>({ data: this.run(), error: null }).then(onfulfilled, onrejected);
  }

  private run(): Row[] {
    const rows = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    rows.sort((a, b) => {
      for (const { column, ascending } of this.orders) {
        const left = isoValue(a, column);
        const right = isoValue(b, column);
        if (left !== right) return (left < right ? -1 : 1) * (ascending ? 1 : -1);
      }
      return 0;
    });
    return this.maxRows === null ? rows : rows.slice(0, this.maxRows);
  }
}

/** What `from(table)` returns: only `select` starts a query. */
class FakeQueryBuilder {
  constructor(private readonly rows: readonly Row[]) {}

  /** Returns the rows as given (no column projection); embeds come from the fixture. */
  select(_columns?: string, options?: object): FakeFilterBuilder {
    rejectOptions("select", options);
    return failLoudly(new FakeFilterBuilder(this.rows));
  }
}

/**
 * A test-only stand-in for `SupabaseClient.from(table)` that applies the services' filters to the fixture
 * rows of `tables`, so tests assert on behaviour rather than on query arguments. Supports `select`, `eq`,
 * `gt`, `lte`, `order`, `limit`, `maybeSingle` and awaiting the builder; any other method, option or
 * table throws.
 */
export function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  const client = {
    from(table: string): FakeQueryBuilder {
      if (!Object.hasOwn(tables, table)) throw new Error(`fake-supabase: table ${table} has no fixture`);
      return failLoudly(new FakeQueryBuilder(tables[table]));
    },
  };
  return failLoudly(client) as unknown as SupabaseClient;
}

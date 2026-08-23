/**
 * A very small SQL reader: finds the INSERT statements in a migration file and
 * reports everything else as out of reach.
 *
 * This is not a SQL parser and must not grow into one. It understands the exact
 * shape a seed migration takes —
 *
 *   insert into public.table (a, b, c) values
 *     ('x', null, 3),
 *     ('y', 'it''s', true)
 *   on conflict (a) do nothing;
 *
 * — and nothing more. Every other statement is handed back in `rejected` so the
 * caller can refuse the whole file rather than applying half of it.
 *
 * The one genuinely fiddly part is string literals, because `--` inside a quoted
 * value is data and `--` outside one is a comment, and `''` inside a literal is
 * an escaped apostrophe rather than the end of it. `Tom''s Hardware` in the 0006
 * seed exercises both.
 */

export type SqlValue = string | number | boolean | null;

export type InsertStatement = {
  table: string;
  columns: string[];
  rows: SqlValue[][];
  /** The conflict target, or null if the statement had no `do nothing` clause. */
  onConflict: string | null;
};

export type ParsedSql = {
  inserts: InsertStatement[];
  /** First line of each statement this reader will not touch, for reporting. */
  rejected: string[];
};

export function parseInserts(sql: string): ParsedSql {
  const inserts: InsertStatement[] = [];
  const rejected: string[] = [];

  for (const statement of splitStatements(stripComments(sql))) {
    const parsed = parseInsert(statement);
    if (parsed) inserts.push(parsed);
    else rejected.push(summarise(statement));
  }

  return { inserts, rejected };
}

/* ---------------------------------------------------------------------- */
/* Lexing                                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Removes `--` line comments and `/* *\/` blocks, leaving string literals alone.
 *
 * Comments are replaced with a space rather than deleted, so a comment sitting
 * between two tokens cannot glue them together.
 */
export function stripComments(sql: string): string {
  let out = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'") {
      const end = endOfLiteral(sql, i);
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      out += " ";
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
      out += " ";
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Splits on semicolons that are not inside a string literal. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      i = endOfLiteral(sql, i);
      continue;
    }
    if (ch === ";") {
      statements.push(sql.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  statements.push(sql.slice(start));

  return statements.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Index just past the closing quote of the literal starting at `open`.
 *
 * `''` is an escaped apostrophe, so it advances by two and keeps going. An
 * unterminated literal returns the end of the input rather than throwing — the
 * statement will fail to parse as an insert, which is the right outcome and a
 * better message than a lexer error.
 */
function endOfLiteral(sql: string, open: number): number {
  let i = open + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

/* ---------------------------------------------------------------------- */
/* Parsing                                                                */
/* ---------------------------------------------------------------------- */

const HEAD =
  /^insert\s+into\s+(?:(?:public|"public")\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)\s*values\s*/i;

const TAIL = /\s*on\s+conflict\s*\(\s*"?([a-z_][a-z0-9_]*)"?\s*\)\s*do\s+nothing\s*$/i;

function parseInsert(statement: string): InsertStatement | null {
  const head = HEAD.exec(statement);
  if (!head) return null;

  const table = head[1];
  const columnList = head[2];
  if (!table || columnList === undefined) return null;

  let body = statement.slice(head[0].length);
  let onConflict: string | null = null;

  const tail = TAIL.exec(body);
  if (tail?.[1]) {
    onConflict = tail[1];
    body = body.slice(0, tail.index);
  }

  const columns = columnList
    .split(",")
    .map((c) => c.trim().replace(/^"|"$/g, ""))
    .filter((c) => c.length > 0);

  const rows = parseRows(body, columns.length);
  if (!rows) return null;

  return { table, columns, rows, onConflict };
}

/** `('a', 1), ('b', 2)` → `[["a", 1], ["b", 2]]`, or null if it does not fit. */
function parseRows(body: string, arity: number): SqlValue[][] | null {
  const rows: SqlValue[][] = [];
  let i = 0;

  const skipSpace = () => {
    while (i < body.length && /\s/.test(body[i] ?? "")) i += 1;
  };

  skipSpace();
  while (i < body.length) {
    if (body[i] !== "(") return null;
    i += 1;

    const values: SqlValue[] = [];
    for (;;) {
      skipSpace();
      const value = readValue(body, i);
      if (!value) return null;
      values.push(value.value);
      i = value.next;

      skipSpace();
      if (body[i] === ",") {
        i += 1;
        continue;
      }
      if (body[i] === ")") {
        i += 1;
        break;
      }
      return null;
    }

    // An arity mismatch means this reader has misunderstood the statement.
    // Bailing out sends the whole file to `rejected`, which is the safe answer.
    if (values.length !== arity) return null;
    rows.push(values);

    skipSpace();
    if (body[i] === ",") {
      i += 1;
      skipSpace();
      continue;
    }
    break;
  }

  skipSpace();
  if (i !== body.length) return null;
  return rows.length > 0 ? rows : null;
}

function readValue(body: string, at: number): { value: SqlValue; next: number } | null {
  if (body[at] === "'") {
    const end = endOfLiteral(body, at);
    if (end > body.length) return null;
    const raw = body.slice(at + 1, end - 1);
    return { value: raw.replace(/''/g, "'"), next: end };
  }

  const word = /^[A-Za-z0-9_+\-.]+/.exec(body.slice(at));
  if (!word?.[0]) return null;
  const token = word[0];
  const next = at + token.length;

  const lower = token.toLowerCase();
  if (lower === "null") return { value: null, next };
  if (lower === "true") return { value: true, next };
  if (lower === "false") return { value: false, next };

  const number = Number(token);
  if (!Number.isNaN(number)) return { value: number, next };

  // Anything else — a function call, a cast, `default` — is beyond this reader.
  return null;
}

/** A statement reduced to something short enough to print in an error. */
function summarise(statement: string): string {
  const line = statement.replace(/\s+/g, " ").trim();
  return line.length > 96 ? `${line.slice(0, 93)}…` : line;
}

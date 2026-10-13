type Kind = "session" | "member" | "catalog" | "media" | "quota" | "auth" | "other";
export type D1Call = { method: string; statements: Kind[]; start: number; end?: number; failed?: boolean;
  meta?: { duration: number; rows_read: number; rows_written: number }[] };

// Test-only probe: never retain SQL, parameters, credentials or result rows.
export function probeD1(database: D1Database, after?: (call: D1Call) => Promise<void>) {
  const calls: D1Call[] = [], origin = performance.now();
  const statements = new WeakMap<D1PreparedStatement, { original: D1PreparedStatement; kind: Kind }>();
  const kind = (sql: string): Kind => /member_profiles/i.test(sql) ? "member"
    : /^\s*select\b[\s\S]*\bfrom\s+["`]session["`]/i.test(sql) ? "session" : /media_files|subtitle_tracks/i.test(sql) ? "media"
    : /works|playable_units|seasons/i.test(sql) ? "catalog" : /rate_limit_counters/i.test(sql) ? "quota"
    : /\b(user|account|rateLimit|verification|twoFactor|passkey)\b/i.test(sql) ? "auth" : "other";
  async function execute(method: string, kinds: Kind[], run: () => Promise<unknown>) {
    const call: D1Call = { method, statements: kinds, start: performance.now() - origin }; calls.push(call);
    try {
      const result = await run();
      const metas = (Array.isArray(result) ? result : [result]).flatMap(row => row && typeof row === "object" && "meta" in row ? [row.meta] : []);
      if (metas.length) call.meta = metas.map(({ duration, rows_read, rows_written }) => ({ duration, rows_read, rows_written }));
      return result;
    } catch (error) { call.failed = true; throw error; }
    finally { call.end = performance.now() - origin; await after?.(call); }
  }
  function statement(original: D1PreparedStatement, label: Kind): D1PreparedStatement {
    const wrapped = new Proxy(original, { get(target, property) {
      if (property === "bind") return (...values: unknown[]) => statement(target.bind(...values), label);
      const value = Reflect.get(target, property, target);
      if (["all", "first", "run", "raw"].includes(String(property))) return (...args: unknown[]) => execute(String(property), [label], () => value.apply(target, args));
      return typeof value === "function" ? value.bind(target) : value;
    } });
    statements.set(wrapped, { original, kind: label }); return wrapped;
  }
  function binding<T extends D1Database | D1DatabaseSession>(original: T): T {
    return new Proxy(original, { get(target, property) {
      if (property === "prepare") return (sql: string) => statement(target.prepare(sql), kind(sql));
      if (property === "withSession" && "withSession" in target) return (...args: Parameters<D1Database["withSession"]>) => binding(target.withSession(...args));
      if (property === "batch") return (batch: D1PreparedStatement[]) => execute("batch", batch.map(s => statements.get(s)?.kind ?? "other"),
        () => target.batch(batch.map(s => statements.get(s)?.original ?? s)));
      const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  }
  return { db: binding(database), calls };
}

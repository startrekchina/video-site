import { APIError } from "better-auth/api";
import type { Comment, Reply, SortKey, Vote } from "./discussion";
import { createRequestIdentity, type D1Reader } from "./member.server";
import { checkWrite, readJson } from "./security.server";
import { settings } from "./settings.server";

type Row = { id: string; body: string; created_at: number; author: string; admin: number; mine: number; likes: number; vote: Vote };
type CommentRow = Row & { reply_count: number };
type ReplyRow = Row & { comment_id: string; reply_to: string | null };

const fail = (status: "BAD_REQUEST" | "NOT_FOUND" | "UNAUTHORIZED" | "FORBIDDEN", code: string, message: string): never => { throw new APIError(status, { code, message }); };
const invalid = (message = "请求格式无效。") => fail("BAD_REQUEST", "INVALID_INPUT", message);
// Deleted and never-existing targets answer alike (B 6.12.4).
const missing = () => fail("NOT_FOUND", "NOT_FOUND", "内容不存在或已被删除。");
const respond = (request: Request, body: object) => Response.json({ ...body, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() });

// ?1 is the viewer wherever rows are projected; likes are counted, dislikes never leave the server (B 6.12.3).
const fields = (alias: "c" | "r", column: "comment_id" | "reply_id") => `${alias}.id, ${alias}.body_markdown AS body, ${alias}.created_at,
  coalesce(u.displayUsername, u.username) AS author, p.role = 'admin' AS admin, ${alias}.author_user_id = ?1 AS mine,
  (SELECT count(*) FROM discussion_votes v WHERE v.${column} = ${alias}.id AND v.value = 1) AS likes,
  coalesce((SELECT v.value FROM discussion_votes v WHERE v.${column} = ${alias}.id AND v.user_id = ?1), 0) AS vote`;
const author = (alias: "c" | "r") => `JOIN "user" u ON u.id = ${alias}.author_user_id JOIN member_profiles p ON p.user_id = ${alias}.author_user_id`;
const replyFields = `${fields("r", "reply_id")}, r.comment_id, coalesce(t.displayUsername, t.username) AS reply_to`;
const replyFrom = `${author("r")} LEFT JOIN "user" t ON t.id = r.reply_to_user_id`;

// The prototype's smart sort: the 95% Wilson lower bound of likes among votes (0.5 before any vote), times engagement on a log
// scale (replies at half weight), plus a boost fading over about two days.
const orders: Record<SortKey, string> = {
  smart: `CASE WHEN n = 0 THEN 0.5 ELSE (q + 1.9208 / n - 1.96 * sqrt((q * (1 - q) + 0.9604 / n) / n)) / (1 + 3.8416 / n) END
    * log2(1 + up + 0.5 * replies) + 1.5 * exp(-age / 172800000.0) DESC, created_at DESC, id DESC`,
  new: "created_at DESC, id DESC",
  old: "created_at, id",
};
// ?2 unit, ?3 now: every comment of the unit ranked in the chosen order.
const ranked = (sort: SortKey) => `WITH counted AS (SELECT c.id, c.created_at, ?3 - c.created_at AS age,
    (SELECT count(*) FROM discussion_votes v WHERE v.comment_id = c.id AND v.value = 1) AS up,
    (SELECT count(*) FROM discussion_votes v WHERE v.comment_id = c.id AND v.value = -1) AS down,
    (SELECT count(*) FROM comment_replies r WHERE r.comment_id = c.id) AS replies
  FROM comments c WHERE c.playable_unit_id = ?2),
  scored AS (SELECT *, up + down AS n, CAST(up AS REAL) / max(up + down, 1) AS q FROM counted),
  picked AS (SELECT id, row_number() OVER (ORDER BY ${orders[sort]}) AS rank FROM scored)`;
// ?2 unit, ?3 JSON array of IDs: the listed comments still in the unit, in the listed order.
const listed = "WITH picked AS (SELECT c.id, j.key AS rank FROM json_each(?3) j JOIN comments c ON c.id = j.value AND c.playable_unit_id = ?2)";
// The picked comments up to rank ?4, each with its first ?5 replies in posting order.
const pageOf = (db: D1Reader, picked: string, params: unknown[]) => [
  db.prepare(`${picked} SELECT ${fields("c", "comment_id")}, (SELECT count(*) FROM comment_replies x WHERE x.comment_id = c.id) AS reply_count
    FROM picked k JOIN comments c ON c.id = k.id ${author("c")} WHERE k.rank <= ?4 ORDER BY k.rank`).bind(...params.slice(0, 4)),
  db.prepare(`${picked} SELECT * FROM (SELECT ${replyFields}, row_number() OVER (PARTITION BY r.comment_id ORDER BY r.created_at, r.id) AS n
    FROM picked k JOIN comment_replies r ON r.comment_id = k.id ${replyFrom} WHERE k.rank <= ?4) WHERE n <= ?5 ORDER BY n`).bind(...params),
];

const item = (row: Row) => ({ id: row.id, author: row.author, admin: Boolean(row.admin), mine: Boolean(row.mine), body: row.body, createdAt: row.created_at, likes: row.likes, vote: row.vote });
const reply = (row: ReplyRow): Reply => ({ ...item(row), replyTo: row.reply_to });
const threads = (rows: CommentRow[], replies: ReplyRow[]): Comment[] =>
  rows.map(row => ({ ...item(row), replyCount: row.reply_count, replies: replies.filter(value => value.comment_id === row.id).map(reply) }));

// B 6.12.2: the server checks the body itself; rendering keeps Markdown to the allowed subset and never runs HTML.
function text(value: unknown) {
  const body = typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim() : "";
  return body && [...body].length <= settings.commentMaxLength && !/(?![\n\t])\p{Cc}/u.test(body) ? body : invalid(`内容需为 1–${settings.commentMaxLength} 个字符。`);
}
const id = (value: unknown) => typeof value === "string" && value && value.length <= 200 ? value : invalid();

// Discussion under one playable unit: members read and write, votes are their own, and only admins delete (B 6.12, 6.5).
export async function discussionHttp(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const url = new URL(request.url), match = /^\/units\/([^/]+)\/(?:comments(?:\/([^/]+)(?:\/(replies|vote))?)?|replies\/([^/]+)(\/vote)?)$/u.exec(url.pathname);
  const [, unitId, commentId, part, replyId, replyVote] = match ?? [];
  const route = `${request.method} ${replyId ? replyVote ? "reply-vote" : "reply" : !commentId ? "comments" : part === "replies" ? "replies" : part ? "comment-vote" : "comment"}`;
  if (!match || !["GET comments", "POST comments", "GET replies", "POST replies", "PUT comment-vote", "DELETE comment-vote", "PUT reply-vote", "DELETE reply-vote",
    "DELETE comment", "DELETE reply"].includes(route)) return new Response(null, { status: 404 });
  if (request.method !== "GET") checkWrite(request, env);
  const body = request.method === "POST" || request.method === "PUT" ? await readJson(request) : {}, db = env.DB, now = Date.now();
  const read = async <T>(load: (reader: D1Reader, userId: string) => Promise<T>) => await identity.read(load) ?? fail("UNAUTHORIZED", "AUTH_REQUIRED", "请先登录。");
  const unit = (reader: D1Reader) => reader.prepare("SELECT 1 FROM playable_units WHERE id = ?").bind(unitId);
  const comment = (reader: D1Reader) => reader.prepare("SELECT 1 FROM comments WHERE id = ? AND playable_unit_id = ?").bind(commentId, unitId);

  if (route === "GET comments") {
    const sort = url.searchParams.get("sort"), ids = url.searchParams.get("ids")?.split(",").map(id);
    if (sort !== null ? ids || !Object.hasOwn(orders, sort) : !ids || ids.length > settings.commentsPerPage) invalid();
    const current = await read((reader, userId) => {
      const params = [userId, unitId, sort ? now : JSON.stringify(ids), sort ? settings.commentsPerPage : ids!.length, settings.repliesPerBatch];
      return reader.batch<Record<string, unknown>>([unit(reader), ...pageOf(reader, sort ? ranked(sort as SortKey) : listed, params),
        ...sort ? [reader.prepare(`${ranked(sort as SortKey)} SELECT id FROM picked ORDER BY rank`).bind(userId, unitId, now)] : []]);
    });
    const [units, rows, replies, order] = current.value;
    if (!units.results.length) missing();
    const items = threads(rows.results as CommentRow[], replies.results as ReplyRow[]);
    // The full order is fixed when the sort is chosen, so later votes and posts never reshuffle the pages being read (B 6.12.3).
    return respond(request, { data: order ? { order: order.results.map(row => row.id), items, pageSize: settings.commentsPerPage, maxLength: settings.commentMaxLength } : { items } });
  }
  if (route === "GET replies") {
    const at = url.searchParams.get("afterAt"), after = id(url.searchParams.get("afterId"));
    if (!at || !/^\d{1,15}$/u.test(at)) invalid();
    const current = await read((reader, userId) => reader.batch<Record<string, unknown>>([comment(reader),
      reader.prepare(`SELECT ${replyFields} FROM comment_replies r ${replyFrom} WHERE r.comment_id = ?2 AND (r.created_at, r.id) > (?3, ?4)
        ORDER BY r.created_at, r.id LIMIT ?5`).bind(userId, commentId, Number(at), after, settings.repliesPerBatch),
      reader.prepare("SELECT count(*) AS rest FROM comment_replies WHERE comment_id = ?1 AND (created_at, id) > (?2, ?3)").bind(commentId, Number(at), after)]));
    const [found, rows, rest] = current.value;
    if (!found.results.length) missing();
    return respond(request, { data: { items: (rows.results as ReplyRow[]).map(reply), rest: (rest.results[0].rest as number) - rows.results.length } });
  }
  if (route === "POST comments") {
    const content = text(body.bodyMarkdown), current = await read(reader => reader.batch([unit(reader)]));
    if (!current.value[0].results.length) missing();
    const { member } = current, row = { id: crypto.randomUUID(), body: content, created_at: now, author: member.displayUsername ?? member.username,
      admin: Number(member.role === "admin"), mine: 1, likes: 0, vote: 0 as const };
    await db.prepare("INSERT INTO comments (id, playable_unit_id, author_user_id, body_markdown, created_at) VALUES (?, ?, ?, ?, ?)").bind(row.id, unitId, member.user_id, content, now).run();
    return respond(request, { data: { ...item(row), replyCount: 0, replies: [] } satisfies Comment });
  }
  if (route === "POST replies") {
    // A reply answers the comment's author, or names one reply of the same conversation whose author it answers.
    const content = text(body.bodyMarkdown), to = body.replyTo === undefined || body.replyTo === null ? null : id(body.replyTo);
    const current = await read(reader => reader.batch<{ author_user_id?: string; name?: string }>([comment(reader),
      ...to ? [reader.prepare(`SELECT r.author_user_id, coalesce(u.displayUsername, u.username) AS name FROM comment_replies r JOIN "user" u ON u.id = r.author_user_id
        WHERE r.id = ? AND r.comment_id = ?`).bind(to, commentId)] : []]));
    const [found, target] = current.value, answered = target?.results[0];
    if (!found.results.length || (to && !answered)) missing();
    const { member } = current, row = { id: crypto.randomUUID(), body: content, created_at: now, author: member.displayUsername ?? member.username,
      admin: Number(member.role === "admin"), mine: 1, likes: 0, vote: 0 as const };
    // A comment or target reply deleted since the check takes the insert with it: nothing is written and the reply is refused.
    const saved = await db.prepare(`INSERT INTO comment_replies (id, comment_id, author_user_id, reply_to_user_id, body_markdown, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM comments WHERE id = ?2)
        AND (?7 IS NULL OR EXISTS (SELECT 1 FROM comment_replies WHERE id = ?7 AND comment_id = ?2))`)
      .bind(row.id, commentId, member.user_id, answered?.author_user_id ?? null, content, now, to).run();
    if (!saved.meta.changes) missing();
    return respond(request, { data: { ...item(row), replyTo: answered?.name ?? null } satisfies Reply });
  }
  const column = replyId ? "reply_id" : "comment_id", target = replyId ?? commentId;
  // ?1 target, ?2 unit.
  const inUnit = replyId ? "SELECT 1 FROM comment_replies r JOIN comments c ON c.id = r.comment_id WHERE r.id = ?1 AND c.playable_unit_id = ?2"
    : "SELECT 1 FROM comments WHERE id = ?1 AND playable_unit_id = ?2";
  if (route === "DELETE comment" || route === "DELETE reply") {
    const current = await read(reader => reader.batch([reader.prepare(inUnit).bind(target, unitId)]));
    if (current.member.role !== "admin") fail("FORBIDDEN", "FORBIDDEN", "需要管理员权限。");
    if (!current.value[0].results.length) missing();
    // B 6.12.4: one statement removes the record, and the foreign key cascades take a comment's replies and every related vote with it.
    const saved = await (replyId ? db.prepare("DELETE FROM comment_replies WHERE id = ?1 AND comment_id IN (SELECT id FROM comments WHERE playable_unit_id = ?2)")
      : db.prepare("DELETE FROM comments WHERE id = ?1 AND playable_unit_id = ?2")).bind(target, unitId).run();
    if (!saved.meta.changes) missing();
    return respond(request, { data: { deleted: true } });
  }
  const value = request.method === "PUT" ? body.value : null;
  if (request.method === "PUT" && value !== 1 && value !== -1) invalid();
  const current = await read(reader => reader.batch([reader.prepare(inUnit).bind(target, unitId)]));
  if (!current.value[0].results.length) missing();
  const userId = current.member.user_id;
  // One row per member and target (B 6.12.3): a switch updates it, a cancel deletes it, and a deleted target takes no new row.
  const [, saved] = await db.batch([value === null ? db.prepare(`DELETE FROM discussion_votes WHERE ${column} = ?1 AND user_id = ?3`).bind(target, unitId, userId)
    : db.prepare(`INSERT INTO discussion_votes (user_id, ${column}, value) SELECT ?3, ?1, ?4 WHERE EXISTS (${inUnit})
      ON CONFLICT (user_id, ${column}) WHERE ${column} IS NOT NULL DO UPDATE SET value = excluded.value`).bind(target, unitId, userId, value),
    db.prepare(`SELECT EXISTS (${inUnit}) AS found, (SELECT count(*) FROM discussion_votes WHERE ${column} = ?1 AND value = 1) AS likes,
      coalesce((SELECT value FROM discussion_votes WHERE ${column} = ?1 AND user_id = ?3), 0) AS vote`).bind(target, unitId, userId)]);
  const row = saved.results[0] as { found: number; likes: number; vote: Vote };
  if (!row.found) missing();
  return respond(request, { data: { likes: row.likes, vote: row.vote } });
}

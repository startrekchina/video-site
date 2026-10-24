import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import worker from "../workers/app";
import type { Comment, Reply } from "@/lib/discussion";
import { settings } from "@/lib/settings.server";
import { login, member, request } from "./fixtures/auth";
import { seedCatalog } from "./fixtures/catalog";

const runtime = { ...env, APP_ENV: "development" };
const unit = "/units/episode-unit";
let cookie: string, userId: string, other: string, otherId: string, admin: string;
beforeAll(async () => { await send(request("/robots.txt")); }, 60000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true, hostname: "localhost", action: "auth" })));
  try {
    userId = (await member("Kepler")).id; cookie = await login("Kepler");
    otherId = (await member("Tessel")).id; other = await login("Tessel");
    const vega = await member("Vega");
    await env.DB.prepare("UPDATE member_profiles SET role = 'admin' WHERE user_id = ?").bind(vega.id).run();
    admin = await login("Vega");
  } finally { vi.unstubAllGlobals(); }
  await seedCatalog(env.DB);
});

async function send(input: Request) {
  const ctx = createExecutionContext(), response = await worker.fetch(input, runtime, ctx);
  await waitOnExecutionContext(ctx); return response;
}
const call = (method: string, path: string, body?: object, as = cookie, headers: Record<string, string> = {}) =>
  send(new Request(request(path, method === "GET" ? undefined : body ?? {}, as, headers), { method }));
type Body<T> = { data?: T; error?: { code: string } };
const json = async <T = Record<string, unknown>>(response: Response) => await response.json() as Body<T>;
const post = async (path: string, bodyMarkdown: string, as = cookie, extra: object = {}) => (await json<Comment & Reply>(await call("POST", path, { bodyMarkdown, ...extra }, as))).data!;
const page = async (query: string, as = cookie) => (await json<{ order: string[]; items: Comment[]; pageSize: number; maxLength: number }>(await call("GET", `${unit}/comments?${query}`, undefined, as))).data!;
const count = (sql: string, ...values: unknown[]) => env.DB.prepare(`SELECT count(*) AS n FROM ${sql}`).bind(...values).first<number>("n");
// Fixed times keep posting order deterministic; requests made in the same millisecond would tie.
const comment = (id: string, author: string, createdAt: number, unitId = "episode-unit") =>
  env.DB.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?)").bind(id, unitId, author, `虚构评论 ${id}`, createdAt);
const reply = (id: string, commentId: string, author: string, createdAt: number) =>
  env.DB.prepare("INSERT INTO comment_replies VALUES (?, ?, ?, NULL, ?, ?)").bind(id, commentId, author, `虚构回复 ${id}`, createdAt);
const vote = (user: string, target: { comment?: string; reply?: string }, value: 1 | -1) =>
  env.DB.prepare("INSERT INTO discussion_votes VALUES (?, ?, ?, ?)").bind(user, target.comment ?? null, target.reply ?? null, value);

it("posts and reads comments as the session member with a checked body", async () => {
  const mine = await post(`${unit}/comments`, "  **好看**\r\n第二行  ");
  expect(mine).toMatchObject({ author: "Kepler", mine: true, admin: false, body: "**好看**\n第二行", likes: 0, vote: 0, replyCount: 0, replies: [] });
  const byAdmin = await post(`${unit}/comments`, "<script>alert(1)</script>", admin);
  expect(byAdmin).toMatchObject({ author: "Vega", admin: true });
  expect(await post(`${unit}/comments`, "😀".repeat(settings.commentMaxLength))).toMatchObject({ mine: true });
  for (const bodyMarkdown of ["", "   ", "字".repeat(settings.commentMaxLength + 1), "a\u0000b", "a\u007fb", 1, null]) {
    expect((await call("POST", `${unit}/comments`, { bodyMarkdown })).status, JSON.stringify(bodyMarkdown)).toBe(400);
  }
  const seen = await page("sort=new", other);
  expect(seen).toMatchObject({ pageSize: settings.commentsPerPage, maxLength: settings.commentMaxLength });
  expect(seen.items.map(item => [item.author, item.mine])).toEqual([["Kepler", false], ["Vega", false], ["Kepler", false]]);
  expect(seen.items[1].body).toBe("<script>alert(1)</script>");
  expect(seen.order).toEqual(seen.items.map(item => item.id));
  // The unit must exist; guests, banned members, cross-site and non-JSON writes are refused.
  expect((await call("GET", "/units/missing/comments?sort=new")).status).toBe(404);
  expect((await call("POST", "/units/missing/comments", { bodyMarkdown: "虚构" })).status).toBe(404);
  expect((await call("GET", `${unit}/comments?sort=new`, undefined, "")).status).toBe(401);
  expect((await call("POST", `${unit}/comments`, { bodyMarkdown: "虚构" }, "")).status).toBe(401);
  expect((await call("POST", `${unit}/comments`, { bodyMarkdown: "虚构" }, cookie, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  expect((await call("POST", `${unit}/comments`, { bodyMarkdown: "虚构" }, cookie, { "Content-Type": "text/plain" })).status).toBe(400);
  await post(`${unit}/comments`, "封禁前的发言", other);
  await env.DB.prepare("UPDATE member_profiles SET status = 'banned' WHERE user_id = ?").bind(otherId).run();
  expect((await call("GET", `${unit}/comments?sort=new`, undefined, other)).status).toBe(401);
  expect((await call("POST", `${unit}/comments`, { bodyMarkdown: "虚构" }, other)).status).toBe(401);
  // A ban keeps what the member already wrote (B 6.12.4).
  expect((await page("sort=new")).items[0]).toMatchObject({ author: "Tessel", body: "封禁前的发言" });
}, 60000);

it("orders comments by the prototype's smart rule, newest and oldest, and reads listed pages", async () => {
  const now = Date.now(), hour = 3600_000;
  await env.DB.batch([comment("a", "nova", now - 240 * hour), comment("b", "quinn", now - hour), comment("c", "nova", now - 120 * hour), comment("d", "quinn", now - 72 * hour),
    comment("e", "nova", now - 72 * hour), comment("elsewhere", "nova", now, "movie-unit"),
    ...["nova", "quinn", userId, otherId].map(user => vote(user, { comment: "a" }, 1)), vote("nova", { comment: "c" }, 1),
    ...["quinn", userId, otherId].map(user => vote(user, { comment: "c" }, -1)), vote("nova", { comment: "d" }, 1), vote("quinn", { comment: "d" }, 1),
    reply("d1", "d", "nova", now - 70 * hour), reply("d2", "d", "quinn", now - 69 * hour)]);
  // The prototype's score, kept here as the reference the SQL must follow.
  const wilson = (up: number, n: number) => n === 0 ? 0.5 : (up / n + 1.96 ** 2 / (2 * n) - 1.96 * Math.sqrt((up / n * (1 - up / n) + 1.96 ** 2 / (4 * n)) / n)) / (1 + 1.96 ** 2 / n);
  const score = (up: number, down: number, replies: number, ageH: number) => wilson(up, up + down) * Math.log2(1 + up + 0.5 * replies) + 1.5 * Math.exp(-ageH / 48);
  const expected = Object.entries({ a: score(4, 0, 0, 240), b: score(0, 0, 0, 1), c: score(1, 3, 0, 120), d: score(2, 0, 2, 72), e: score(0, 0, 0, 72) })
    .sort(([x, left], [y, right]) => right - left || (x < y ? 1 : -1)).map(([id]) => id);
  expect((await page("sort=smart")).order).toEqual(expected);
  // Equal times fall back to the ID, so every order is total.
  expect((await page("sort=new")).order).toEqual(["b", "e", "d", "c", "a"]);
  expect((await page("sort=old")).order).toEqual(["a", "c", "d", "e", "b"]);
  const smart = await page("sort=smart");
  expect(smart.items.find(item => item.id === "d")).toMatchObject({ likes: 2, vote: 0, replyCount: 2, replies: [{ id: "d1", author: "Nova" }, { id: "d2", author: "Quinn" }] });
  expect(smart.items.find(item => item.id === "a")).toMatchObject({ likes: 4, vote: 1 });
  expect(smart.items.find(item => item.id === "c")).toMatchObject({ likes: 1, vote: -1 });
  expect(JSON.stringify(smart)).not.toMatch(/dislike|down/u);

  const limit = settings.commentsPerPage;
  Object.assign(settings, { commentsPerPage: 2 });
  try {
    const first = await page("sort=old");
    expect(first.order).toHaveLength(5); expect(first.items.map(item => item.id)).toEqual(["a", "c"]);
    // A listed page keeps the requested order and drops what is gone or belongs to another unit.
    expect((await page("ids=c,e")).items.map(item => item.id)).toEqual(["c", "e"]);
    expect((await page("ids=missing,elsewhere")).items).toEqual([]);
    for (const query of ["ids=a,b,c", "sort=new&ids=a", "", "sort=toString", "sort=top", "ids=", "ids=a,"]) expect((await call("GET", `${unit}/comments?${query}`)).status, query).toBe(400);
  } finally { Object.assign(settings, { commentsPerPage: limit }); }
}, 60000);

it("replies in posting order and batches, only within the same conversation", async () => {
  const start = Date.now() - 1000_000, ids = Array.from({ length: 23 }, (_, index) => `r${String(index).padStart(2, "0")}`);
  await env.DB.batch([comment("root", "nova", start - 1000), comment("other", "quinn", start - 1000), reply("foreign", "other", "quinn", start),
    ...ids.map((id, index) => reply(id, "root", index % 2 ? "nova" : "quinn", start + index * 1000))]);
  const root = (await page("sort=old")).items.find(item => item.id === "root")!;
  expect(root.replyCount).toBe(23); expect(root.replies.map(item => item.id)).toEqual(ids.slice(0, settings.repliesPerBatch));
  const more = async (after: Reply, path = `${unit}/comments/root/replies`) => json<{ items: Reply[]; rest: number }>(await call("GET", `${path}?afterAt=${after.createdAt}&afterId=${after.id}`));
  const second = (await more(root.replies.at(-1)!)).data!;
  expect(second.items.map(item => item.id)).toEqual(ids.slice(10, 20)); expect(second.rest).toBe(3);
  const third = (await more(second.items.at(-1)!)).data!;
  expect(third.items.map(item => item.id)).toEqual(ids.slice(20)); expect(third.rest).toBe(0);
  expect((await call("GET", `${unit}/comments/root/replies?afterAt=x&afterId=r00`)).status).toBe(400);
  expect((await call("GET", `${unit}/comments/root/replies`)).status).toBe(400);
  expect((await more(root.replies[0], "/units/movie-unit/comments/root/replies")).error?.code).toBe("NOT_FOUND");

  const toAuthor = await post(`${unit}/comments/root/replies`, "回复评论作者");
  expect(toAuthor).toMatchObject({ author: "Kepler", mine: true, replyTo: null, likes: 0, vote: 0 });
  // Answering a reply names its author; a reply from another conversation or unit is refused.
  expect(await post(`${unit}/comments/root/replies`, "回复楼中成员", other, { replyTo: "r01" })).toMatchObject({ author: "Tessel", replyTo: "Nova" });
  expect((await call("POST", `${unit}/comments/root/replies`, { bodyMarkdown: "虚构", replyTo: "foreign" })).status).toBe(404);
  expect((await call("POST", `${unit}/comments/root/replies`, { bodyMarkdown: "虚构", replyTo: 1 })).status).toBe(400);
  expect((await call("POST", `${unit}/comments/root/replies`, { bodyMarkdown: "" })).status).toBe(400);
  expect((await call("POST", "/units/movie-unit/comments/root/replies", { bodyMarkdown: "虚构" })).status).toBe(404);
  expect((await call("POST", `${unit}/comments/root/replies`, { bodyMarkdown: "虚构" }, "")).status).toBe(401);
  expect(await count("comment_replies WHERE comment_id = 'root'")).toBe(25);
}, 60000);

it("keeps one vote per member and target, counts likes only and refuses other units", async () => {
  await env.DB.batch([comment("root", "nova", Date.now() - 2000), reply("answer", "root", "quinn", Date.now() - 1000)]);
  for (const [base, column, value] of [[`${unit}/comments/root`, "comment_id", "root"], [`${unit}/replies/answer`, "reply_id", "answer"]] as const) {
    const cast = async (method: string, body?: object, as = cookie) => (await json(await call(method, `${base}/vote`, body, as))).data;
    expect(await cast("PUT", { value: 1 })).toEqual({ likes: 1, vote: 1 });
    expect(await cast("PUT", { value: 1 })).toEqual({ likes: 1, vote: 1 });
    expect(await cast("PUT", { value: 1 }, other)).toEqual({ likes: 2, vote: 1 });
    expect(await cast("PUT", { value: -1 })).toEqual({ likes: 1, vote: -1 });
    expect(await cast("DELETE")).toEqual({ likes: 1, vote: 0 });
    expect(await cast("DELETE")).toEqual({ likes: 1, vote: 0 });
    await Promise.all([1, -1, 1, -1, 1, -1].map(choice => call("PUT", `${base}/vote`, { value: choice })));
    expect(await count(`discussion_votes WHERE ${column} = ? AND user_id = ?`, value, userId)).toBe(1);
    expect(await cast("DELETE")).toEqual({ likes: 1, vote: 0 });
    for (const body of [{}, { value: 0 }, { value: 2 }, { value: "1" }]) expect((await call("PUT", `${base}/vote`, body)).status, JSON.stringify(body)).toBe(400);
    expect((await call("PUT", `${base.replace(unit, "/units/movie-unit")}/vote`, { value: 1 }, admin)).status).toBe(404);
    expect((await call("PUT", `${base}/vote`, { value: 1 }, "")).status).toBe(401);
  }
  expect(await count("discussion_votes WHERE user_id = (SELECT id FROM \"user\" WHERE username = 'vega')")).toBe(0);
  const root = (await page("sort=new", other)).items[0];
  expect(root).toMatchObject({ likes: 1, vote: 1, replies: [{ id: "answer", likes: 1, vote: 1 }] });
}, 60000);

it("rejects null replacement votes without changing existing comment or reply feedback", async () => {
  await env.DB.batch([comment("root", "nova", Date.now() - 2000), reply("answer", "root", "quinn", Date.now() - 1000)]);
  for (const target of ["comments/root", "replies/answer"]) {
    const path = `${unit}/${target}/vote`;
    expect((await call("PUT", path, { value: 1 })).status).toBe(200);
    const invalid = await call("PUT", path, { value: null });
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error?.code).toBe("INVALID_INPUT");
    const root = (await page("sort=new")).items[0];
    expect(target.startsWith("comments") ? root : root.replies[0]).toMatchObject({ likes: 1, vote: 1 });
    expect((await json(await call("DELETE", path))).data).toEqual({ likes: 0, vote: 0 });
  }
});

it("lets only admins delete a whole conversation or a single reply, leaving nothing behind", async () => {
  const now = Date.now();
  await env.DB.batch([comment("root", "nova", now - 5000), comment("kept", "quinn", now - 4000), reply("first", "root", "quinn", now - 3000), reply("second", "root", userId, now - 2000),
    ...[userId, otherId].flatMap(user => [vote(user, { comment: "root" }, 1), vote(user, { reply: "first" }, 1), vote(user, { reply: "second" }, -1), vote(user, { comment: "kept" }, 1)])]);
  for (const [as, status] of [[cookie, 403], [other, 403], ["", 401]] as const) {
    expect((await call("DELETE", `${unit}/comments/root`, undefined, as)).status).toBe(status);
    expect((await call("DELETE", `${unit}/replies/first`, undefined, as)).status).toBe(status);
  }
  expect((await call("DELETE", "/units/movie-unit/replies/first", undefined, admin)).status).toBe(404);
  expect((await call("DELETE", `${unit}/replies/first`, undefined, admin, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  expect((await json(await call("DELETE", `${unit}/replies/first`, undefined, admin))).data).toEqual({ deleted: true });
  expect(await count("comment_replies WHERE id = 'first'")).toBe(0); expect(await count("discussion_votes WHERE reply_id = 'first'")).toBe(0);
  expect((await page("sort=old")).items[0]).toMatchObject({ id: "root", likes: 2, replyCount: 1, replies: [{ id: "second" }] });

  // Replies and votes racing the delete either land before it and go with it, or fail after it.
  const racing = await Promise.all([call("DELETE", `${unit}/comments/root`, undefined, admin), call("POST", `${unit}/comments/root/replies`, { bodyMarkdown: "并发回复" }),
    call("PUT", `${unit}/comments/root/vote`, { value: -1 }, other), call("PUT", `${unit}/replies/second/vote`, { value: 1 }, other)]);
  expect(racing[0].status).toBe(200);
  expect(await count("comments WHERE id = 'root'")).toBe(0); expect(await count("comment_replies WHERE comment_id = 'root'")).toBe(0);
  expect(await count("discussion_votes WHERE comment_id IS NOT NULL AND comment_id NOT IN (SELECT id FROM comments)")).toBe(0);
  expect(await count("discussion_votes WHERE reply_id IS NOT NULL AND reply_id NOT IN (SELECT id FROM comment_replies)")).toBe(0);
  expect(await count("discussion_votes")).toBe(2);
  const left = await page("sort=old");
  expect(left.order).toEqual(["kept"]); expect(left.items[0]).toMatchObject({ id: "kept", likes: 2 });
  // The deleted conversation cannot be read, answered, voted on or deleted again.
  for (const [method, path, body] of [["GET", `${unit}/comments/root/replies?afterAt=0&afterId=x`], ["POST", `${unit}/comments/root/replies`, { bodyMarkdown: "虚构" }],
    ["PUT", `${unit}/comments/root/vote`, { value: 1 }], ["PUT", `${unit}/replies/second/vote`, { value: 1 }], ["DELETE", `${unit}/comments/root`], ["DELETE", `${unit}/replies/second`]] as const) {
    expect((await json(await call(method, path, body, admin))).error?.code, `${method} ${path}`).toBe("NOT_FOUND");
  }
  expect((await page("ids=root,kept")).items.map(item => item.id)).toEqual(["kept"]);
  expect(await count("discussion_votes")).toBe(2);
}, 60000);

it("refuses a reply whose target reply is deleted between the checks and the insert", async () => {
  const root = await post(`${unit}/comments`, "虚构对话");
  const target = await post(`${unit}/comments/${root.id}/replies`, "将被删除", other);
  // The database stand-in lets an admin delete the target right before the reply is inserted.
  const db = new Proxy(env.DB, { get: (real, key) => key !== "prepare" ? (value => typeof value === "function" ? value.bind(real) : value)(Reflect.get(real, key))
    : (sql: string) => !sql.startsWith("INSERT INTO comment_replies") ? real.prepare(sql) : { bind: (...values: unknown[]) => ({ run: async () => {
      await real.prepare("DELETE FROM comment_replies WHERE id = ?").bind(target.id).run();
      return await real.prepare(sql).bind(...values).run();
    } }) } });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request(`${unit}/comments/${root.id}/replies`, { bodyMarkdown: "回复已删的", replyTo: target.id }, cookie), { ...runtime, DB: db }, ctx);
  await waitOnExecutionContext(ctx);
  expect((await json(response)).error?.code).toBe("NOT_FOUND");
  expect(await count("comment_replies WHERE comment_id = ?", root.id)).toBe(0);
});

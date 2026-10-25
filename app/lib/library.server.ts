import { APIError } from "better-auth/api";
import { displayTitle, episodeCode } from "./catalog";
import { codes, playableMedia, posterPath } from "./catalog.server";
import { createRequestIdentity, type D1Reader } from "./member.server";
import { checkWrite, readJson } from "./security.server";
import { settings } from "./settings.server";

type Target = { workId: string; unitId: null } | { workId: null; unitId: string };
type HeadRow = { id: string; title: string; visibility: "private" | "members"; revision: number; updated_at: number; own: number; owner: string };
type UnitRow = { item: string; id: string; kind: "movie" | "episode"; playable: number; completed: number; title_zh: string | null; title_en: string | null; year: number | null; poster_asset: string | null;
  tmdb_id: number; season_number: number | null; episode_number: number | null; unit_title_zh: string | null; unit_title_en: string | null };
type ItemRow = { id: string; slug: string; kind: "movie" | "series"; title_zh: string | null; title_en: string | null; year: number | null; poster_asset: string | null; tmdb_id: number;
  season_count: number; unit_id: string | null; season_number: number | null; episode_number: number | null; unit_title_zh: string | null; unit_title_en: string | null };
type ListRow = { id: string; title: string; visibility: "private" | "members"; updated_at: number; owner: string; count: number; posters: string };

const fail = (status: "BAD_REQUEST" | "NOT_FOUND" | "UNAUTHORIZED" | "CONFLICT", code: string, message: string): never => { throw new APIError(status, { code, message }); };
const invalid = (message = "请求格式无效。") => fail("BAD_REQUEST", "INVALID_INPUT", message);
const missing = (message = "片单不存在。") => fail("NOT_FOUND", "NOT_FOUND", message);
const respond = (request: Request, body: object, status = 200) => Response.json({ ...body, requestId: request.headers.get("X-Site-Request-Id") ?? crypto.randomUUID() }, { status });
const code = (row: { tmdb_id: number; season_number: number | null; episode_number: number | null }) =>
  [codes[row.tmdb_id], episodeCode({ seasonNumber: row.season_number ?? 0, number: row.episode_number ?? 0 })].filter(Boolean).join(" · ");
const workTitle = (row: { title_zh: string | null; title_en: string | null }) => row.title_zh || row.title_en || "标题暂缺";

// An item names exactly one target: a work (series or movie) or an episode; movies join as works (B 6.5).
function target(body: Record<string, unknown>): Target {
  const given = [body.workId, body.unitId].filter(value => value !== undefined), [id] = given;
  if (given.length !== 1 || typeof id !== "string" || !id || id.length > 200) return invalid();
  return body.workId !== undefined ? { workId: id, unitId: null } : { workId: null, unitId: id };
}
const found = "SELECT EXISTS(SELECT 1 FROM works WHERE id = ?1) OR EXISTS(SELECT 1 FROM playable_units WHERE id = ?2 AND kind = 'episode') AS found";
function title(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && [...text].length <= settings.playlistTitleMax && !/\p{Cc}/u.test(text) ? text : invalid(`片单名称需为 1–${settings.playlistTitleMax} 个字符。`);
}
const visibility = (value: unknown) => value === "private" || value === "members" ? value : invalid();

// Readable playlists are the member's own and those shared with members; others' private playlists look absent.
const head = (db: D1Reader, userId: string, id: string) => db.prepare(`SELECT l.id, l.title, l.visibility, l.revision, l.updated_at, l.owner_user_id = ?2 AS own,
    coalesce(u.displayUsername, u.username) AS owner FROM playlists l JOIN "user" u ON u.id = l.owner_user_id
    WHERE l.id = ?1 AND (l.owner_user_id = ?2 OR l.visibility = 'members')`).bind(id, userId);
// Every item's units in stored order, a series in season and episode order, with the viewer's own progress (never the owner's).
const expansion = (db: D1Reader, userId: string, id: string) => db.prepare(`SELECT e.item, u.id, u.kind, EXISTS(${playableMedia}) AS playable, coalesce(p.completed, 0) AS completed,
    w.title_zh, w.title_en, w.year, w.poster_asset, w.tmdb_id, s.season_number, u.episode_number, u.title_zh AS unit_title_zh, u.title_en AS unit_title_en
  FROM (SELECT id AS item, position, playable_unit_id AS unit FROM playlist_items WHERE playlist_id = ?1 AND playable_unit_id IS NOT NULL
    UNION ALL SELECT i.id, i.position, pu.id FROM playlist_items i JOIN playable_units pu ON pu.work_id = i.work_id WHERE i.playlist_id = ?1) e
  JOIN playable_units u ON u.id = e.unit JOIN works w ON w.id = u.work_id LEFT JOIN seasons s ON s.id = u.season_id
  LEFT JOIN watch_progress p ON p.playable_unit_id = u.id AND p.user_id = ?2
  ORDER BY e.position, s.season_number, u.episode_number, u.id`).bind(id, userId);
// B 6.7.2: playable units keep their first appearance. Finished units stay so a watch page can find and show its place; playback skips them.
function queue(rows: UnitRow[]) {
  const seen = new Set<string>();
  return rows.filter(row => row.playable && !seen.has(row.id) && seen.add(row.id)).map(row => ({ id: row.id, completed: Boolean(row.completed), poster: posterPath(row.poster_asset),
    label: row.kind === "movie" ? "电影" : code(row), year: row.kind === "movie" ? row.year : null, title: row.kind === "movie" ? workTitle(row) : displayTitle({ titleZh: row.unit_title_zh, titleEn: row.unit_title_en }) }));
}

export async function playlists(db: D1Reader, userId: string, scope: "mine" | "members") {
  const [rows] = await db.batch<ListRow>([db.prepare(`SELECT l.id, l.title, l.visibility, l.updated_at, coalesce(u.displayUsername, u.username) AS owner,
      (SELECT count(*) FROM playlist_items i WHERE i.playlist_id = l.id) AS count,
      (SELECT json_group_array(poster_asset) FROM (SELECT w.poster_asset FROM playlist_items i LEFT JOIN playable_units pu ON pu.id = i.playable_unit_id
        JOIN works w ON w.id = coalesce(i.work_id, pu.work_id) WHERE i.playlist_id = l.id ORDER BY i.position LIMIT 4)) AS posters
    FROM playlists l JOIN "user" u ON u.id = l.owner_user_id WHERE ${scope === "mine" ? "l.owner_user_id = ?" : "l.visibility = 'members'"}
    ORDER BY l.updated_at DESC, l.id`).bind(...scope === "mine" ? [userId] : [])]);
  return rows.results.map(row => ({ id: row.id, title: row.title, visibility: row.visibility, owner: row.owner, count: row.count, updatedAt: row.updated_at,
    posters: (JSON.parse(row.posters) as (string | null)[]).map(posterPath) }));
}
export async function playlistPage(db: D1Reader, userId: string, id: string) {
  const [heads, items, units] = await db.batch([head(db, userId, id),
    db.prepare(`SELECT i.id, w.id AS slug, w.kind, w.title_zh, w.title_en, w.year, w.poster_asset, w.tmdb_id, (SELECT count(*) FROM seasons s WHERE s.work_id = w.id) AS season_count,
      pu.id AS unit_id, s.season_number, pu.episode_number, pu.title_zh AS unit_title_zh, pu.title_en AS unit_title_en
      FROM playlist_items i LEFT JOIN playable_units pu ON pu.id = i.playable_unit_id LEFT JOIN seasons s ON s.id = pu.season_id JOIN works w ON w.id = coalesce(i.work_id, pu.work_id)
      WHERE i.playlist_id = ? ORDER BY i.position`).bind(id),
    expansion(db, userId, id)]);
  const list = heads.results[0] as HeadRow | undefined;
  if (!list) return null;
  const rows = units.results as UnitRow[], order = queue(rows);
  return { playlist: { id: list.id, title: list.title, visibility: list.visibility, revision: list.revision, own: Boolean(list.own), owner: list.owner, updatedAt: list.updated_at },
    items: (items.results as ItemRow[]).map(row => ({ id: row.id, poster: posterPath(row.poster_asset), href: row.unit_id ? `/watch/${row.unit_id}` : `/title/${row.slug}`,
      kicker: row.unit_id ? code(row) : row.kind === "movie" ? `电影 · ${row.year ?? "—"}` : `整部剧集 · ${row.season_count} 季`,
      title: row.unit_id ? displayTitle({ titleZh: row.unit_title_zh, titleEn: row.unit_title_en }) : workTitle(row), sub: row.unit_id ? workTitle(row) : row.title_en ?? "",
      watched: (row.unit_id !== null || row.kind === "movie") && rows.some(unit => unit.item === row.id && unit.completed === 1) })),
    // B 6.7.2: play from the first unfinished unit; when none is left the member stays on the playlist page.
    start: order.find(unit => !unit.completed)?.id ?? null, queued: order.length };
}
// A watch page's place among the playlist's playable units, each unit's watched state, and the next unfinished unit after it (null at the end).
export async function playlistQueue(db: D1Reader, userId: string, id: string, unitId: string) {
  const [heads, units] = await db.batch([head(db, userId, id), expansion(db, userId, id)]);
  const list = heads.results[0] as HeadRow | undefined, order = queue(units.results as UnitRow[]), position = order.findIndex(unit => unit.id === unitId);
  return list && position >= 0 ? { id: list.id, title: list.title, position, watched: order.map(unit => unit.completed),
    next: order.slice(position + 1).find(unit => !unit.completed) ?? null } : null;
}

// Personal library writes: the member comes from the session, and only the owner can change a playlist.
export async function libraryHttp(request: Request, env: Env, identity = createRequestIdentity(request, env)) {
  const url = new URL(request.url), match = /^\/me\/(?:favorites\/([^/]+)|playlists(?:\/([^/]+)(\/items(?:\/([^/]+))?)?)?)$/u.exec(url.pathname);
  const [, workId, id, items, itemId] = match ?? [];
  const route = `${request.method} ${workId ? "favorite" : !id ? "playlists" : !items ? "playlist" : !itemId ? "items" : "item"}`;
  if (!match || !["PUT favorite", "GET playlists", "POST playlists", "PATCH playlist", "DELETE playlist", "POST items", "PUT items", "DELETE item"].includes(route)) return new Response(null, { status: 404 });
  if (request.method !== "GET") checkWrite(request, env);
  const body = request.method === "GET" || request.method === "DELETE" ? {} : await readJson(request), db = env.DB, now = Date.now();
  const read = async <T>(load: (reader: D1Reader, userId: string) => Promise<T>) => await identity.read(load) ?? fail("UNAUTHORIZED", "AUTH_REQUIRED", "请先登录。");
  const owned = async () => {
    const current = await read((reader, userId) => reader.batch([reader.prepare("SELECT 1 FROM playlists WHERE id = ? AND owner_user_id = ?").bind(id, userId)]));
    return current.value[0].results.length ? current.member.user_id : missing();
  };
  const conflict = (revision: number) => respond(request, { error: { code: "REVISION_CONFLICT", message: "片单已在其他设备更新。", revision } }, 409);

  if (route === "PUT favorite") {
    if (typeof body.favorite !== "boolean") invalid();
    const current = await read(reader => reader.batch([reader.prepare("SELECT 1 FROM works WHERE id = ?").bind(workId)]));
    if (!current.value[0].results.length) missing("作品不存在。");
    await (body.favorite ? db.prepare("INSERT INTO favorites (user_id, work_id) VALUES (?, ?) ON CONFLICT DO NOTHING") : db.prepare("DELETE FROM favorites WHERE user_id = ? AND work_id = ?"))
      .bind(current.member.user_id, workId).run();
    return respond(request, { data: { favorite: body.favorite } });
  }
  if (route === "GET playlists") {
    const item = target({ workId: url.searchParams.get("workId") ?? undefined, unitId: url.searchParams.get("unitId") ?? undefined });
    const current = await read((reader, userId) => reader.batch<{ id: string; title: string; count: number; has: number }>([reader.prepare(`SELECT l.id, l.title,
        (SELECT count(*) FROM playlist_items i WHERE i.playlist_id = l.id) AS count,
        EXISTS(SELECT 1 FROM playlist_items i WHERE i.playlist_id = l.id AND (i.work_id = ?1 OR i.playable_unit_id = ?2)) AS has
      FROM playlists l WHERE l.owner_user_id = ?3 ORDER BY l.updated_at DESC, l.id`).bind(item.workId, item.unitId, userId)]));
    return respond(request, { data: current.value[0].results.map(row => ({ id: row.id, title: row.title, count: row.count, has: Boolean(row.has) })) });
  }
  if (route === "POST playlists") {
    const name = title(body.title), scope = visibility(body.visibility);
    const item = body.item === undefined ? null : target(body.item && typeof body.item === "object" && !Array.isArray(body.item) ? body.item as Record<string, unknown> : invalid());
    const current = await read(reader => reader.batch<{ found: number }>([reader.prepare(found).bind(item?.workId ?? null, item?.unitId ?? null)]));
    if (item && !current.value[0].results[0].found) missing("作品或单集不存在。");
    const playlistId = crypto.randomUUID();
    await db.batch([db.prepare("INSERT INTO playlists (id, owner_user_id, title, visibility, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
      .bind(playlistId, current.member.user_id, name, scope, now, now),
      ...item ? [db.prepare("INSERT INTO playlist_items (id, playlist_id, work_id, playable_unit_id, position) VALUES (?, ?, ?, ?, 0)").bind(crypto.randomUUID(), playlistId, item.workId, item.unitId)] : []]);
    return respond(request, { data: { id: playlistId } });
  }
  if (route === "PATCH playlist") {
    const scope = visibility(body.visibility), userId = await owned();
    const saved = await db.prepare("UPDATE playlists SET visibility = ?, updated_at = ? WHERE id = ? AND owner_user_id = ? RETURNING visibility").bind(scope, now, id, userId).first();
    return saved ? respond(request, { data: { visibility: scope } }) : missing();
  }
  if (route === "DELETE playlist") {
    // Items go with the playlist through the foreign key cascade.
    await db.prepare("DELETE FROM playlists WHERE id = ? AND owner_user_id = ?").bind(id, await owned()).run();
    return respond(request, { data: { deleted: true } });
  }
  if (route === "POST items") {
    const item = target(body), current = await read((reader, userId) => reader.batch<{ found?: number }>([
      reader.prepare("SELECT 1 FROM playlists WHERE id = ? AND owner_user_id = ?").bind(id, userId), reader.prepare(found).bind(item.workId, item.unitId)]));
    if (!current.value[0].results.length) missing();
    if (!current.value[1].results[0].found) missing("作品或单集不存在。");
    const userId = current.member.user_id, max = settings.playlistItemsMax;
    // One row per target (B 6.7.1.1): a repeated or concurrent add changes nothing, and every caller gets the existing item.
    const same = "(work_id = ?3 OR playable_unit_id = ?4)", room = `(SELECT count(*) FROM playlist_items WHERE playlist_id = ?1) < ${max}`;
    const [, , saved] = await db.batch([
      db.prepare(`UPDATE playlists SET revision = revision + 1, updated_at = ?5 WHERE id = ?1 AND owner_user_id = ?2 AND ${room}
        AND NOT EXISTS (SELECT 1 FROM playlist_items WHERE playlist_id = ?1 AND ${same})`).bind(id, userId, item.workId, item.unitId, now),
      db.prepare(`INSERT INTO playlist_items (id, playlist_id, work_id, playable_unit_id, position)
        SELECT ?5, ?1, ?3, ?4, coalesce((SELECT max(position) + 1 FROM playlist_items WHERE playlist_id = ?1), 0)
        WHERE EXISTS (SELECT 1 FROM playlists WHERE id = ?1 AND owner_user_id = ?2) AND ${room} ON CONFLICT DO NOTHING`).bind(id, userId, item.workId, item.unitId, crypto.randomUUID()),
      db.prepare(`SELECT l.revision, (SELECT id FROM playlist_items WHERE playlist_id = ?1 AND ${same}) AS item FROM playlists l WHERE l.id = ?1 AND l.owner_user_id = ?2`)
        .bind(id, userId, item.workId, item.unitId),
    ]);
    const row = saved.results[0] as { revision: number; item: string | null } | undefined;
    if (!row) return missing();
    return row.item ? respond(request, { data: { item: row.item, revision: row.revision } }) : fail("CONFLICT", "PLAYLIST_FULL", `片单最多 ${max} 项。`);
  }
  if (route === "PUT items") {
    const expected = body.expectedRevision, ids = body.itemIds;
    if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0 || !Array.isArray(ids) || !ids.every(value => typeof value === "string") || new Set(ids).size !== ids.length) invalid();
    const order = ids as string[], current = await read((reader, userId) => reader.batch<{ id?: string; revision?: number }>([
      reader.prepare("SELECT revision FROM playlists WHERE id = ? AND owner_user_id = ?").bind(id, userId), reader.prepare("SELECT id FROM playlist_items WHERE playlist_id = ?").bind(id)]));
    const list = current.value[0].results[0];
    if (!list) return missing();
    if (list.revision !== expected) return conflict(list.revision!);
    const stored = new Set(current.value[1].results.map(row => row.id));
    if (stored.size !== order.length || !order.every(value => stored.has(value))) invalid();
    // Two passes keep (playlist_id, position) unique at every row: lift all items above any stored position, then lower them into place.
    const lift = 2 ** 30, userId = current.member.user_id;
    const [, , saved] = await db.batch([
      db.prepare(`UPDATE playlist_items SET position = ?3 + (SELECT key FROM json_each(?4) WHERE value = playlist_items.id)
        WHERE playlist_id = ?1 AND EXISTS (SELECT 1 FROM playlists WHERE id = ?1 AND owner_user_id = ?2 AND revision = ?5)`).bind(id, userId, lift, JSON.stringify(order), expected),
      db.prepare("UPDATE playlist_items SET position = position - ?2 WHERE playlist_id = ?1 AND position >= ?2").bind(id, lift),
      db.prepare("UPDATE playlists SET revision = revision + 1, updated_at = ?4 WHERE id = ?1 AND owner_user_id = ?2 AND revision = ?3 RETURNING revision").bind(id, userId, expected, now),
    ]);
    const revision = (saved.results[0] as { revision: number } | undefined)?.revision;
    if (revision !== undefined) return respond(request, { data: { revision } });
    const latest = await db.prepare("SELECT revision FROM playlists WHERE id = ? AND owner_user_id = ?").bind(id, userId).first<number>("revision");
    return latest === null ? missing() : conflict(latest);
  }
  const userId = await owned();
  const [, , saved] = await db.batch([
    db.prepare("UPDATE playlists SET revision = revision + 1, updated_at = ?3 WHERE id = ?1 AND owner_user_id = ?2 AND EXISTS (SELECT 1 FROM playlist_items WHERE id = ?4 AND playlist_id = ?1)")
      .bind(id, userId, now, itemId),
    db.prepare("DELETE FROM playlist_items WHERE id = ?3 AND playlist_id = ?1 AND EXISTS (SELECT 1 FROM playlists WHERE id = ?1 AND owner_user_id = ?2)").bind(id, userId, itemId),
    db.prepare("SELECT revision FROM playlists WHERE id = ? AND owner_user_id = ?").bind(id, userId),
  ]);
  const revision = (saved.results[0] as { revision: number } | undefined)?.revision;
  return revision === undefined ? missing() : respond(request, { data: { revision } });
}

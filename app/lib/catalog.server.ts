import { APIError } from "better-auth/api";
import stillManifest from "../../public/assets/stills/star-trek/manifest.json";
import type { Episode, Work, WorkCard } from "./catalog";

// Deployment configuration, not a browser/admin editing surface.
export const recommendedStarts = [
  { tmdbId: 103516, why: "新拍、单元剧为主，不需要任何前置知识" },
  { tmdbId: 655, why: "老粉最常推荐的入门作，七季一气呵成" },
  { tmdbId: 253, why: "1966 年，一切的起点：柯克与斯波克" },
].map(start => ({ ...start, season: 1, episode: 1 }));
const codes: Record<number, string> = { 103516: "SNW", 655: "TNG", 253: "TOS", 580: "DS9", 1855: "VOY", 314: "ENT" };
const stills = new Map(stillManifest.episodes.map(item => [`${item.tmdbId}:${item.season}:${item.episode}`, `/assets/stills/star-trek/${item.file}`]));

// Called only after membership validation; no storage identifiers enter the global UI.
export async function catalogSummary(db: D1Database) {
  const [works, counts] = await db.withSession("first-primary").batch<Record<string, unknown>>([
    db.prepare("SELECT id, kind, tmdb_id, title_zh, title_en, year FROM works ORDER BY year, tmdb_id, id"),
    db.prepare("SELECT (SELECT count(*) FROM seasons) AS seasons, (SELECT count(*) FROM playable_units WHERE season_id IS NOT NULL) AS episodes"),
  ]);
  return { works: works.results.map(row => ({ slug: String(row.id), kind: row.kind as "series" | "movie", titleZh: String(row.title_zh || row.title_en || "资料暂缺"), titleEn: String(row.title_en || ""), code: codes[Number(row.tmdb_id)] ?? "", year: row.year as number | null })),
    stats: { series: works.results.filter(row => row.kind === "series").length, movies: works.results.filter(row => row.kind === "movie").length, seasons: Number(counts.results[0].seasons), episodes: Number(counts.results[0].episodes) } };
}

export function singleParameter(url: URL, name: string) {
  if (url.searchParams.getAll(name).length > 1) throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "查询参数重复。" });
  return url.searchParams.get(name);
}
type WorkRow = { id: string; kind: "movie" | "series"; tmdb_id: number; title_zh: string | null; title_en: string | null; overview_zh: string | null; overview_en: string | null; year: number | null; poster_asset: string | null; favorite: number; episode_count?: number; watched_count?: number };
type SeasonRow = { id: string; work_id: string; season_number: number };
type UnitRow = { id: string; work_id: string; season_id: string | null; episode_number: number | null; tmdb_id: number; title_zh: string | null; title_en: string | null; overview_zh: string | null; overview_en: string | null; duration_seconds: number | null; playable: number; position_seconds: number | null; completed: number | null; updated_at: number | null; revision: number | null };
function searchQuery(query: string) {
  if (query.length > 100) throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "搜索最多 100 个字符。" });
  return query.trim();
}
function workDto(row: WorkRow) {
  return { slug: row.id, kind: row.kind, tmdbId: row.tmdb_id, titleZh: row.title_zh || row.title_en || "资料暂缺", titleEn: row.title_en || "",
    overviewZh: row.overview_zh, overviewEn: row.overview_en, year: row.year,
    poster: row.poster_asset?.startsWith("/assets/posters/star-trek/") && !row.poster_asset.includes("..") ? row.poster_asset : "",
    code: codes[row.tmdb_id] ?? "", favorite: Boolean(row.favorite) };
}
export async function catalogCards(db: D1Database, userId: string, query = "", kind: "series" | "movie" | null = null) {
  const search = searchQuery(query), database = db.withSession("first-primary");
  const [cards, totals] = await database.batch([
    database.prepare(`SELECT w.id, w.kind, w.tmdb_id, w.title_zh, w.title_en, w.overview_zh, w.overview_en, w.year, w.poster_asset,
      EXISTS(SELECT 1 FROM favorites f WHERE f.work_id = w.id AND f.user_id = ?) AS favorite,
      (SELECT count(*) FROM seasons s WHERE s.work_id = w.id) AS season_count,
      (SELECT count(*) FROM playable_units u WHERE u.work_id = w.id) AS episode_count,
      (SELECT count(*) FROM playable_units u JOIN watch_progress p ON p.playable_unit_id = u.id WHERE u.work_id = w.id AND p.user_id = ? AND p.completed = 1) AS watched_count,
      (SELECT duration_seconds FROM playable_units u WHERE u.work_id = w.id AND u.season_id IS NULL LIMIT 1) AS duration_seconds
      FROM works w WHERE (? IS NULL OR w.kind = ?) AND (? = '' OR instr(lower(coalesce(w.title_zh, '')), lower(?)) > 0 OR instr(lower(coalesce(w.title_en, '')), lower(?)) > 0)
      ORDER BY w.year, w.tmdb_id, w.id`).bind(userId, userId, kind, kind, search, search, search),
    database.prepare("SELECT kind, count(*) AS n FROM works GROUP BY kind"),
  ]);
  return { works: (cards.results as (WorkRow & { season_count: number; episode_count: number; watched_count: number; duration_seconds: number | null })[]).map(row => ({ ...workDto(row),
      seasonCount: row.season_count, episodeCount: row.episode_count, watchedCount: row.watched_count,
      ...(row.kind === "movie" ? { runtimeMin: row.duration_seconds === null ? null : row.duration_seconds / 60 } : {}) } satisfies WorkCard)),
    totals: Object.fromEntries((totals.results as { kind: string; n: number }[]).map(row => [row.kind, row.n])) };
}
export async function catalog(db: D1Database, userId: string, query = "", target?: { workId: string } | { unitId: string } | { home: true }) {
  const search = searchQuery(query), workId = target && "workId" in target ? target.workId : null, unitId = target && "unitId" in target ? target.unitId : null;
  const home = Boolean(target && "home" in target);
  const matching = `SELECT id FROM works WHERE (? = '' OR instr(lower(coalesce(title_zh, '')), lower(?)) > 0 OR instr(lower(coalesce(title_en, '')), lower(?)) > 0)
    AND (? IS NULL OR id = ?) AND (? IS NULL OR id = (SELECT work_id FROM playable_units WHERE id = ?))`;
  const parameters = [search, search, search, workId, workId, unitId, unitId];
  const database = db.withSession("first-primary");
  const [workRows, seasonRows, unitRows] = await database.batch([
    database.prepare(`SELECT w.id, w.kind, w.tmdb_id, w.title_zh, w.title_en, w.overview_zh, w.overview_en, w.year, w.poster_asset,
    EXISTS(SELECT 1 FROM favorites f WHERE f.work_id = w.id AND f.user_id = ?) AS favorite
    ${home ? `, (SELECT count(*) FROM playable_units u WHERE u.work_id = w.id) AS episode_count,
      (SELECT count(*) FROM playable_units u JOIN watch_progress p ON p.playable_unit_id = u.id WHERE u.work_id = w.id AND p.user_id = ? AND p.completed = 1) AS watched_count` : ""}
    FROM works w WHERE w.id IN (${matching}) ORDER BY w.year, w.tmdb_id, w.id`).bind(userId, ...(home ? [userId] : []), ...parameters),
    database.prepare(`SELECT id, work_id, season_number FROM seasons WHERE work_id IN (${matching}) ORDER BY season_number, id`).bind(...parameters),
    database.prepare(`SELECT u.id, u.work_id, u.season_id, u.episode_number, u.tmdb_id, u.title_zh, u.title_en, u.overview_zh, u.overview_en, u.duration_seconds,
    EXISTS(SELECT 1 FROM media_files m WHERE m.playable_unit_id = u.id AND m.format = 'mp4') AS playable,
    p.position_seconds, p.completed, p.updated_at, p.revision FROM playable_units u
    LEFT JOIN watch_progress p ON p.playable_unit_id = u.id AND p.user_id = ?
    JOIN works w ON w.id = u.work_id LEFT JOIN seasons s ON s.id = u.season_id WHERE u.work_id IN (${matching})
    ${home ? `AND (u.kind = 'movie' OR (EXISTS(SELECT 1 FROM media_files m WHERE m.playable_unit_id = u.id AND m.format = 'mp4')
      AND ((p.position_seconds > 0 AND p.completed = 0) OR ${recommendedStarts.map(() => "(w.tmdb_id = ? AND w.kind = 'series' AND s.season_number = ? AND u.episode_number = ?)").join(" OR ")})))` : ""}
    ORDER BY u.episode_number, u.id`).bind(userId, ...parameters, ...(home ? recommendedStarts.flatMap(start => [start.tmdbId, start.season, start.episode]) : [])),
  ]);
  const works = workRows.results as WorkRow[], seasons = seasonRows.results as SeasonRow[], units = unitRows.results as UnitRow[];
  // ponytail: in-memory joins suit the fixed v1 catalog; use indexed/grouped queries if the catalog grows.
  return works.map(row => {
    const unitDto = (unit: UnitRow): Episode => {
      const season = seasons.find(season => season.id === unit.season_id)?.season_number ?? 0;
      return { id: unit.id, number: unit.episode_number ?? 0, seasonNumber: season, tmdbId: unit.tmdb_id,
        titleZh: unit.title_zh, titleEn: unit.title_en, overviewZh: unit.overview_zh, overviewEn: unit.overview_en,
        durationSeconds: unit.duration_seconds, runtimeMin: unit.duration_seconds === null ? null : unit.duration_seconds / 60, playable: Boolean(unit.playable),
        still: stills.get(`${row.tmdb_id}:${season}:${unit.episode_number}`) ?? null,
        positionSeconds: unit.position_seconds ?? 0, completed: Boolean(unit.completed), updatedAt: unit.updated_at ?? 0, revision: unit.revision ?? 0 };
    };
    const all = units.filter(unit => unit.work_id === row.id).map(unitDto);
    const workSeasons = seasons.filter(season => season.work_id === row.id).map(season => ({ id: season.id, number: season.season_number, episodes: all.filter(unit => unit.seasonNumber === season.season_number) }));
    const sorted = row.kind === "movie" ? all : workSeasons.flatMap(season => season.episodes);
    return { ...workDto(row), seasons: workSeasons, units: sorted, seasonCount: workSeasons.length, episodeCount: row.episode_count ?? sorted.length, watchedCount: row.watched_count ?? sorted.filter(unit => unit.completed).length,
      ...(row.kind === "movie" ? { unitId: sorted[0]?.id, runtimeMin: sorted[0]?.runtimeMin } : {}) } satisfies Work;
  });
}
export function homeStages(works: Work[]) {
  const continued = works.flatMap(work => work.units.filter(unit => unit.playable && !unit.completed && unit.positionSeconds > 0).map(unit => ({ work, unit }))).sort((a, b) => b.unit.updatedAt - a.unit.updatedAt);
  if (continued.length) return { label: "继续观看", items: continued };
  return { label: "推荐起点", items: recommendedStarts.flatMap(start => {
    const work = works.find(work => work.kind === "series" && work.tmdbId === start.tmdbId);
    const unit = work?.units.find(unit => unit.playable && unit.seasonNumber === start.season && unit.number === start.episode);
    return work && unit ? [{ work, unit, why: start.why }] : [];
  }) };
}

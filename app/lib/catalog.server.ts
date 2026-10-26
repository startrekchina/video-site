import stillManifest from "../../public/assets/stills/star-trek/manifest.json";
import { continuation, unitHref, type Episode, type Work, type WorkCard } from "./catalog";
import type { D1Reader } from "./member.server";

// Deployment configuration, not a browser/admin editing surface.
export const recommendedStarts = [
  { tmdbId: 103516, why: "新拍、单元剧为主，不需要任何前置知识" },
  { tmdbId: 655, why: "老粉最常推荐的入门作，七季一气呵成" },
  { tmdbId: 253, why: "1966 年，一切的起点：柯克与斯波克" },
].map(start => ({ ...start, season: 1, episode: 1 }));
// Fan short codes, not TMDB data; every series in the poster manifest has one.
export const codes: Record<number, string> = { 253: "TOS", 1992: "TAS", 655: "TNG", 580: "DS9", 1855: "VOY", 314: "ENT", 67198: "DIS", 82491: "ST", 85948: "LD", 85949: "PIC", 106393: "PRO", 103516: "SNW", 223530: "SFA" };
// Page paths (B 6.11) name a series by its code in lower case and a movie by its short English title; every manifest work has one.
export const movieSlugs: Record<number, string> = { 152: "the-motion-picture", 154: "wrath-of-khan", 157: "search-for-spock", 168: "voyage-home", 172: "final-frontier",
  174: "undiscovered-country", 193: "generations", 199: "first-contact", 200: "insurrection", 201: "nemesis", 13475: "star-trek-2009", 54138: "into-darkness", 188927: "beyond", 1114894: "section-31" };
export function workHref(kind: "series" | "movie", tmdbId: number) {
  const name = kind === "series" ? codes[tmdbId]?.toLowerCase() : movieSlugs[tmdbId];
  // Imports only accept manifest works and a test covers every one; a gap is a deployment error, not a page to guess.
  if (!name) throw new Error(`No page path for ${kind} ${tmdbId}`);
  return kind === "series" ? `/series/${name}` : `/movies/${name}`;
}
export type WorkKey = { kind: "series" | "movie"; tmdbId: number };
export type UnitKey = { kind: "series"; tmdbId: number; season: number; episode: number } | { kind: "movie"; tmdbId: number };
export const unitPath = (unit: UnitKey) => unitHref({ kind: unit.kind, href: workHref(unit.kind, unit.tmdbId) }, unit.kind === "series" ? { seasonNumber: unit.season, number: unit.episode } : { seasonNumber: 0, number: 0 });
const pathNames = { series: new Map(Object.entries(codes).map(([tmdbId, code]) => [code.toLowerCase(), Number(tmdbId)])), movie: new Map(Object.entries(movieSlugs).map(([tmdbId, slug]) => [slug, Number(tmdbId)])) };
type PathParams = { code?: string; slug?: string; season?: string; episode?: string };
// Numbers are canonical decimals: s3 and e15, never s03 or S3.
export function pathNumber(segment: string | undefined, prefix: "s" | "e") {
  const match = /^([se])(0|[1-9]\d{0,3})$/u.exec(segment ?? "");
  return match?.[1] === prefix ? Number(match[2]) : null;
}
// A path's work or unit, or null when a segment names nothing.
export function pathWork(params: PathParams): WorkKey | null {
  const kind = params.code === undefined ? "movie" : "series", tmdbId = pathNames[kind].get(params.code ?? params.slug ?? "");
  return tmdbId === undefined ? null : { kind, tmdbId };
}
export function pathUnit(params: PathParams): UnitKey | null {
  const work = pathWork(params);
  if (work?.kind !== "series") return work && { kind: "movie", tmdbId: work.tmdbId };
  const season = pathNumber(params.season, "s"), episode = pathNumber(params.episode, "e");
  return season === null || episode === null ? null : { kind: "series", tmdbId: work.tmdbId, season, episode };
}
// Only bundled poster files reach the browser.
export const posterPath = (asset: string | null) => asset?.startsWith("/assets/posters/star-trek/") && !asset.includes("..") ? asset : "";
export const playableMedia = "SELECT 1 FROM media_files m WHERE m.playable_unit_id = u.id AND m.format = 'mp4' AND m.variant = 'original' AND m.r2_etag IS NOT NULL AND m.r2_etag <> ''";
const stills = new Map(stillManifest.episodes.map(item => [`${item.tmdbId}:${item.season}:${item.episode}`, `/assets/stills/star-trek/${item.file}`]));

// Called only after membership validation; no storage identifiers enter the global UI.
export async function catalogSummary(db: D1Reader) {
  const [works] = await db.batch<Record<string, unknown>>([db.prepare("SELECT id, kind, tmdb_id, title_zh, title_en, year FROM works ORDER BY year, tmdb_id, id")]);
  return { works: works.results.map(row => ({ slug: String(row.id), href: workHref(row.kind as "series" | "movie", Number(row.tmdb_id)), kind: row.kind as "series" | "movie", titleZh: String(row.title_zh || row.title_en || "标题暂缺"), titleEn: String(row.title_en || ""), code: codes[Number(row.tmdb_id)] ?? "", year: row.year as number | null })) };
}

export function singleParameter(url: URL, name: string) {
  if (url.searchParams.getAll(name).length > 1) throw Response.json({ code: "INVALID_INPUT", message: "查询参数重复。" }, { status: 400 });
  return url.searchParams.get(name);
}
type WorkRow = { id: string; kind: "movie" | "series"; tmdb_id: number; title_zh: string | null; title_en: string | null; overview_zh: string | null; overview_en: string | null; year: number | null; poster_asset: string | null; favorite: number; episode_count?: number; watched_count?: number };
type SeasonRow = { id: string; work_id: string; season_number: number };
type UnitRow = { id: string; work_id: string; season_id: string | null; episode_number: number | null; tmdb_id: number; title_zh: string | null; title_en: string | null; overview_zh: string | null; overview_en: string | null; air_date: string | null; duration_seconds: number | null; playable: number; position_seconds: number | null; completed: number | null; updated_at: number | null; revision: number | null };
function searchQuery(query: string) {
  if (query.length > 100) throw Response.json({ code: "INVALID_INPUT", message: "搜索最多 100 个字符。" }, { status: 400 });
  return query.trim();
}
function workDto(row: WorkRow) {
  return { slug: row.id, href: workHref(row.kind, row.tmdb_id), kind: row.kind, tmdbId: row.tmdb_id, titleZh: row.title_zh || row.title_en || "标题暂缺", titleEn: row.title_en || "",
    overviewZh: row.overview_zh, overviewEn: row.overview_en, year: row.year,
    poster: posterPath(row.poster_asset),
    code: codes[row.tmdb_id] ?? "", favorite: Boolean(row.favorite) };
}
export async function catalogCards(db: D1Reader, userId: string, query = "", kind: "series" | "movie" | null = null) {
  const search = searchQuery(query);
  const [cards, totals] = await db.batch([
    db.prepare(`SELECT w.id, w.kind, w.tmdb_id, w.title_zh, w.title_en, w.overview_zh, w.overview_en, w.year, w.poster_asset,
      EXISTS(SELECT 1 FROM favorites f WHERE f.work_id = w.id AND f.user_id = ?) AS favorite,
      (SELECT count(*) FROM seasons s WHERE s.work_id = w.id) AS season_count,
      (SELECT count(*) FROM playable_units u WHERE u.work_id = w.id) AS episode_count,
      (SELECT count(*) FROM playable_units u JOIN watch_progress p ON p.playable_unit_id = u.id WHERE u.work_id = w.id AND p.user_id = ? AND p.completed = 1) AS watched_count,
      (SELECT duration_seconds FROM playable_units u WHERE u.work_id = w.id AND u.season_id IS NULL LIMIT 1) AS duration_seconds
      FROM works w WHERE (? IS NULL OR w.kind = ?) AND (? = '' OR instr(lower(coalesce(w.title_zh, '')), lower(?)) > 0 OR instr(lower(coalesce(w.title_en, '')), lower(?)) > 0)
      ORDER BY w.year, w.tmdb_id, w.id`).bind(userId, userId, kind, kind, search, search, search),
    db.prepare("SELECT kind, count(*) AS n FROM works GROUP BY kind"),
  ]);
  return { works: (cards.results as (WorkRow & { season_count: number; episode_count: number; watched_count: number; duration_seconds: number | null })[]).map(row => ({ ...workDto(row),
      seasonCount: row.season_count, episodeCount: row.episode_count, watchedCount: row.watched_count,
      ...(row.kind === "movie" ? { runtimeMin: row.duration_seconds === null ? null : row.duration_seconds / 60 } : {}) } satisfies WorkCard)),
    totals: Object.fromEntries((totals.results as { kind: string; n: number }[]).map(row => [row.kind, row.n])) };
}
export async function catalog(db: D1Reader, userId: string, query = "", target?: WorkKey | { home: true }) {
  const search = searchQuery(query), work = target && "tmdbId" in target ? target : null;
  const home = Boolean(target && "home" in target);
  const matching = `SELECT id FROM works WHERE (? = '' OR instr(lower(coalesce(title_zh, '')), lower(?)) > 0 OR instr(lower(coalesce(title_en, '')), lower(?)) > 0)
    AND (? IS NULL OR (kind = ? AND tmdb_id = ?))`;
  const parameters = [search, search, search, work?.kind ?? null, work?.kind ?? null, work?.tmdbId ?? null];
  // The home page keeps only the units continuation() can pick: for each series, its latest finished episode and the first unfinished one after it.
  const afterFinished = `WITH ordered AS MATERIALIZED (SELECT u.id, u.work_id, p.completed,
      row_number() OVER (PARTITION BY u.work_id ORDER BY s.season_number, u.episode_number, u.id) AS n,
      row_number() OVER (PARTITION BY u.work_id ORDER BY p.completed = 1 DESC, p.updated_at DESC, s.season_number, u.episode_number, u.id) AS recency
      FROM playable_units u JOIN seasons s ON s.id = u.season_id LEFT JOIN watch_progress p ON p.playable_unit_id = u.id AND p.user_id = ?),
    finished AS (SELECT work_id, n FROM ordered WHERE recency = 1 AND completed = 1),
    targets AS (SELECT f.work_id, f.n, min(o.n) AS next FROM finished f LEFT JOIN ordered o ON o.work_id = f.work_id AND o.n > f.n AND coalesce(o.completed, 0) = 0 GROUP BY f.work_id, f.n)
    SELECT o.id FROM ordered o JOIN targets t ON t.work_id = o.work_id AND o.n IN (t.n, t.next)`;
  const [workRows, seasonRows, unitRows] = await db.batch([
    db.prepare(`SELECT w.id, w.kind, w.tmdb_id, w.title_zh, w.title_en, w.overview_zh, w.overview_en, w.year, w.poster_asset,
    EXISTS(SELECT 1 FROM favorites f WHERE f.work_id = w.id AND f.user_id = ?) AS favorite
    ${home ? `, (SELECT count(*) FROM playable_units u WHERE u.work_id = w.id) AS episode_count,
      (SELECT count(*) FROM playable_units u JOIN watch_progress p ON p.playable_unit_id = u.id WHERE u.work_id = w.id AND p.user_id = ? AND p.completed = 1) AS watched_count` : ""}
    FROM works w WHERE w.id IN (${matching}) ORDER BY w.year, w.tmdb_id, w.id`).bind(userId, ...(home ? [userId] : []), ...parameters),
    db.prepare(`SELECT id, work_id, season_number FROM seasons WHERE work_id IN (${matching}) ORDER BY season_number, id`).bind(...parameters),
    db.prepare(`SELECT u.id, u.work_id, u.season_id, u.episode_number, u.tmdb_id, u.title_zh, u.title_en, u.overview_zh, u.overview_en, u.air_date, u.duration_seconds,
    EXISTS(${playableMedia}) AS playable,
    p.position_seconds, p.completed, p.updated_at, p.revision FROM playable_units u
    LEFT JOIN watch_progress p ON p.playable_unit_id = u.id AND p.user_id = ?
    JOIN works w ON w.id = u.work_id LEFT JOIN seasons s ON s.id = u.season_id WHERE u.work_id IN (${matching})
    ${home ? `AND (u.kind = 'movie' OR (EXISTS(${playableMedia})
      AND ((p.position_seconds > 0 AND p.completed = 0) OR ${recommendedStarts.map(() => "(w.tmdb_id = ? AND w.kind = 'series' AND s.season_number = ? AND u.episode_number = ?)").join(" OR ")}))
      OR u.id IN (${afterFinished}))` : ""}
    ORDER BY u.episode_number, u.id`).bind(userId, ...parameters, ...(home ? [...recommendedStarts.flatMap(start => [start.tmdbId, start.season, start.episode]), userId] : [])),
  ]);
  const works = workRows.results as WorkRow[], seasons = seasonRows.results as SeasonRow[], units = unitRows.results as UnitRow[];
  // ponytail: in-memory joins suit the fixed v1 catalog; use indexed/grouped queries if the catalog grows.
  return works.map(row => {
    const unitDto = (unit: UnitRow): Episode => {
      const season = seasons.find(season => season.id === unit.season_id)?.season_number ?? 0;
      return { id: unit.id, number: unit.episode_number ?? 0, seasonNumber: season, tmdbId: unit.tmdb_id,
        titleZh: unit.title_zh, titleEn: unit.title_en, overviewZh: unit.overview_zh, overviewEn: unit.overview_en, airDate: unit.air_date,
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
  const continued = works.flatMap(work => {
    const item = continuation(work);
    return item?.unit.playable ? [{ work, ...item }] : [];
  }).sort((a, b) => b.at - a.at);
  if (continued.length) return { label: "继续观看", items: continued };
  return { label: "推荐起点", items: recommendedStarts.flatMap(start => {
    const work = works.find(work => work.kind === "series" && work.tmdbId === start.tmdbId);
    const unit = work?.units.find(unit => unit.playable && unit.seasonNumber === start.season && unit.number === start.episode);
    return work && unit ? [{ work, unit, why: start.why }] : [];
  }) };
}

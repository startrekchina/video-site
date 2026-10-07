import { APIError } from "better-auth/api";
import stillManifest from "../../public/assets/stills/star-trek/manifest.json";
import type { Episode, Work } from "./catalog";

// Deployment configuration, not a browser/admin editing surface.
export const recommendedStarts = [103516, 655, 253].map(tmdbId => ({ tmdbId, season: 1, episode: 1 }));
const codes: Record<number, string> = { 103516: "SNW", 655: "TNG", 253: "TOS", 580: "DS9", 1855: "VOY", 314: "ENT" };
const stills = new Map(stillManifest.episodes.map(item => [`${item.tmdbId}:${item.season}:${item.episode}`, `/assets/stills/star-trek/${item.file}`]));

export function singleParameter(url: URL, name: string) {
  if (url.searchParams.getAll(name).length > 1) throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "查询参数重复。" });
  return url.searchParams.get(name);
}
export async function catalog(db: D1Database, userId: string, query = "") {
  if (query.length > 100) throw new APIError("BAD_REQUEST", { code: "INVALID_INPUT", message: "搜索最多 100 个字符。" });
  const database = db.withSession("first-primary");
  const works = await database.prepare(`SELECT w.id, w.kind, w.tmdb_id, w.title_zh, w.title_en, w.overview_zh, w.overview_en, w.year, w.poster_asset,
    EXISTS(SELECT 1 FROM favorites f WHERE f.work_id = w.id AND f.user_id = ?) AS favorite FROM works w
    WHERE ? = '' OR instr(lower(coalesce(w.title_zh, '')), lower(?)) > 0 OR instr(lower(coalesce(w.title_en, '')), lower(?)) > 0
    ORDER BY w.year, w.tmdb_id, w.id`).bind(userId, query.trim(), query.trim(), query.trim()).all<{
      id: string; kind: "movie" | "series"; tmdb_id: number; title_zh: string | null; title_en: string | null; overview_zh: string | null; overview_en: string | null; year: number | null; poster_asset: string | null; favorite: number;
    }>();
  const seasons = await database.prepare("SELECT id, work_id, season_number FROM seasons ORDER BY season_number, id").all<{ id: string; work_id: string; season_number: number }>();
  const units = await database.prepare(`SELECT u.id, u.work_id, u.season_id, u.episode_number, u.tmdb_id, u.title_zh, u.title_en, u.overview_zh, u.overview_en, u.duration_seconds,
    EXISTS(SELECT 1 FROM media_files m WHERE m.playable_unit_id = u.id AND m.format = 'mp4') AS playable,
    p.position_seconds, p.completed, p.updated_at, p.revision FROM playable_units u
    LEFT JOIN watch_progress p ON p.playable_unit_id = u.id AND p.user_id = ? ORDER BY u.episode_number, u.id`).bind(userId).all<{
      id: string; work_id: string; season_id: string | null; episode_number: number | null; tmdb_id: number; title_zh: string | null; title_en: string | null; overview_zh: string | null; overview_en: string | null; duration_seconds: number; playable: number; position_seconds: number | null; completed: number | null; updated_at: number | null; revision: number | null;
    }>();
  // ponytail: in-memory joins suit the fixed v1 catalog; use indexed/grouped queries if the catalog grows.
  return works.results.map(row => {
    const unitDto = (unit: typeof units.results[number]): Episode => {
      const season = seasons.results.find(season => season.id === unit.season_id)?.season_number ?? 0;
      return { id: unit.id, number: unit.episode_number ?? 0, seasonNumber: season, tmdbId: unit.tmdb_id,
        titleZh: unit.title_zh, titleEn: unit.title_en, overviewZh: unit.overview_zh, overviewEn: unit.overview_en,
        durationSeconds: unit.duration_seconds, runtimeMin: unit.duration_seconds / 60, playable: Boolean(unit.playable),
        still: stills.get(`${row.tmdb_id}:${season}:${unit.episode_number}`) ?? null,
        positionSeconds: unit.position_seconds ?? 0, completed: Boolean(unit.completed), updatedAt: unit.updated_at ?? 0, revision: unit.revision ?? 0 };
    };
    const all = units.results.filter(unit => unit.work_id === row.id).map(unitDto);
    const workSeasons = seasons.results.filter(season => season.work_id === row.id).map(season => ({ id: season.id, number: season.season_number, episodes: all.filter(unit => unit.seasonNumber === season.season_number) }));
    const sorted = row.kind === "movie" ? all : workSeasons.flatMap(season => season.episodes);
    return { slug: row.id, kind: row.kind, tmdbId: row.tmdb_id, titleZh: row.title_zh || row.title_en || "资料暂缺", titleEn: row.title_en || "",
      overviewZh: row.overview_zh, overviewEn: row.overview_en, year: row.year,
      poster: row.poster_asset?.startsWith("/assets/posters/star-trek/") && !row.poster_asset.includes("..") ? row.poster_asset : "",
      code: codes[row.tmdb_id] ?? "", favorite: Boolean(row.favorite), seasons: workSeasons, units: sorted,
      ...(row.kind === "movie" ? { unitId: sorted[0]?.id, runtimeMin: sorted[0]?.runtimeMin } : {}) } satisfies Work;
  });
}
export function homeStages(works: Work[]) {
  const continued = works.flatMap(work => work.units.filter(unit => unit.playable && !unit.completed && unit.positionSeconds > 0).map(unit => ({ work, unit }))).sort((a, b) => b.unit.updatedAt - a.unit.updatedAt);
  if (continued.length) return { label: "继续观看", items: continued };
  return { label: "推荐起点", items: recommendedStarts.flatMap(start => {
    const work = works.find(work => work.kind === "series" && work.tmdbId === start.tmdbId);
    const unit = work?.units.find(unit => unit.playable && unit.seasonNumber === start.season && unit.number === start.episode);
    return work && unit ? [{ work, unit }] : [];
  }) };
}

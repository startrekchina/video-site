export type Episode = { id: string; number: number; seasonNumber: number; tmdbId: number; titleZh: string | null; titleEn: string | null; overviewZh: string | null; overviewEn: string | null; airDate: string | null; runtimeMin: number | null; durationSeconds: number | null; still: string | null; playable: boolean; positionSeconds: number; completed: boolean; updatedAt: number; revision: number };
export type WorkCard = { slug: string; href: string; kind: "series" | "movie"; tmdbId: number; titleZh: string; titleEn: string; overviewZh: string | null; overviewEn: string | null; year: number | null; poster: string; code: string; seasonCount: number; episodeCount: number; watchedCount: number; runtimeMin?: number | null; unitId?: string; favorite: boolean };
export type Work = WorkCard & { seasons: { id: string; number: number; episodes: Episode[] }[]; units: Episode[] };
// Page paths (B 6.11): a season adds s<n> to the work's path, an episode e<m>; a movie plays at /watch.
export const seasonHref = (work: Pick<WorkCard, "href">, season: number) => `${work.href}/s${season}`;
export const unitHref = (work: Pick<WorkCard, "kind" | "href">, unit: Pick<Episode, "seasonNumber" | "number">) => work.kind === "movie" ? `${work.href}/watch` : `${seasonHref(work, unit.seasonNumber)}/e${unit.number}`;
export function workCard({ seasons, units, ...card }: Work): WorkCard { return card; }
export const displayTitle = (unit: { titleZh: string | null; titleEn: string | null }) => unit.titleZh || unit.titleEn || "标题暂缺";
export const episodeCode = (unit: Pick<Episode, "seasonNumber" | "number">) => `S${String(unit.seasonNumber).padStart(2, "0")}E${String(unit.number).padStart(2, "0")}`;
export const formatRuntime = (minutes: number | null | undefined) => minutes == null ? "时长暂缺" : `${Math.ceil(minutes)} 分钟`;
// Pages load display-size copies of a work poster (w<width>/ beside the original, made by scripts/poster-sizes.mjs), never the original.
export const POSTER_WIDTHS = [160, 320, 480] as const;
export const posterSize = (src: string, width: number) => src.replace(/[^/]+$/, file => `w${width}/${file}`);
export function workProgress(work: WorkCard) { return { total: work.episodeCount, watched: work.watchedCount }; }
export function presentationNavigation(currentUrl: URL, nextUrl: URL) {
  if (currentUrl.pathname !== nextUrl.pathname || !["/series", "/movies", "/search"].includes(currentUrl.pathname) || currentUrl.search === nextUrl.search) return false;
  const current = new URLSearchParams(currentUrl.search), next = new URLSearchParams(nextUrl.search);
  for (const key of ["view", "order"]) { current.delete(key); next.delete(key); }
  return current.toString() === next.toString();
}
// Continue watching (B 6.7): the latest playable unfinished unit; otherwise the first unfinished episode after the latest
// finished one. That episode may lack a source: the work then waits on it rather than skipping ahead, so callers check
// playable. at is the update time of the record that earned the place.
export function continuation(work: Work) {
  const latest = (units: Episode[]) => [...units].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const started = latest(work.units.filter(unit => unit.playable && !unit.completed && unit.positionSeconds > 0));
  if (started) return { unit: started, at: started.updatedAt, next: false };
  const finished = work.kind === "series" ? latest(work.units.filter(unit => unit.completed)) : undefined;
  const next = finished && work.units.slice(work.units.indexOf(finished) + 1).find(unit => !unit.completed);
  return finished && next ? { unit: next, at: finished.updatedAt, next: true } : undefined;
}
export function resumeTarget(work: Work) {
  const playable = work.units.filter(unit => unit.playable);
  return continuation(work)?.unit ?? playable.find(unit => !unit.completed) ?? playable[0];
}

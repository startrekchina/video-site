export type Episode = { id: string; number: number; seasonNumber: number; tmdbId: number; titleZh: string | null; titleEn: string | null; overviewZh: string | null; overviewEn: string | null; runtimeMin: number | null; durationSeconds: number | null; still: string | null; playable: boolean; positionSeconds: number; completed: boolean; updatedAt: number; revision: number };
export type WorkCard = { slug: string; kind: "series" | "movie"; tmdbId: number; titleZh: string; titleEn: string; overviewZh: string | null; overviewEn: string | null; year: number | null; poster: string; code: string; seasonCount: number; episodeCount: number; watchedCount: number; runtimeMin?: number | null; unitId?: string; favorite: boolean };
export type Work = WorkCard & { seasons: { id: string; number: number; episodes: Episode[] }[]; units: Episode[] };
export function workCard({ seasons, units, ...card }: Work): WorkCard { return card; }
export const displayTitle = (unit: { titleZh: string | null; titleEn: string | null }) => unit.titleZh || unit.titleEn || "资料暂缺";
export const episodeCode = (unit: Episode) => `S${String(unit.seasonNumber).padStart(2, "0")}E${String(unit.number).padStart(2, "0")}`;
export const formatRuntime = (minutes: number | null | undefined) => minutes == null ? "时长暂缺" : `${Math.ceil(minutes)} 分钟`;
export function workProgress(work: WorkCard) { return { total: work.episodeCount, watched: work.watchedCount }; }
export function presentationNavigation(currentUrl: URL, nextUrl: URL) {
  if (currentUrl.pathname !== nextUrl.pathname || !["/series", "/movies", "/search"].includes(currentUrl.pathname) || currentUrl.search === nextUrl.search) return false;
  const current = new URLSearchParams(currentUrl.search), next = new URLSearchParams(nextUrl.search);
  for (const key of ["view", "order"]) { current.delete(key); next.delete(key); }
  return current.toString() === next.toString();
}
export function resumeTarget(work: Work) {
  const playable = work.units.filter(unit => unit.playable);
  return [...playable].filter(unit => !unit.completed && unit.positionSeconds > 0).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    ?? playable.find(unit => !unit.completed) ?? playable[0];
}

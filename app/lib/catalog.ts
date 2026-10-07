export type Episode = { id: string; number: number; seasonNumber: number; tmdbId: number; titleZh: string | null; titleEn: string | null; overviewZh: string | null; overviewEn: string | null; runtimeMin: number; durationSeconds: number; still: string | null; playable: boolean; positionSeconds: number; completed: boolean; updatedAt: number; revision: number };
export type Work = { slug: string; kind: "series" | "movie"; tmdbId: number; titleZh: string; titleEn: string; overviewZh: string | null; overviewEn: string | null; year: number | null; poster: string; code: string; seasons: { id: string; number: number; episodes: Episode[] }[]; units: Episode[]; runtimeMin?: number; unitId?: string; favorite: boolean };
export const displayTitle = (unit: { titleZh: string | null; titleEn: string | null }) => unit.titleZh || unit.titleEn || "资料暂缺";
export const episodeCode = (unit: Episode) => `S${String(unit.seasonNumber).padStart(2, "0")}E${String(unit.number).padStart(2, "0")}`;
export const formatRuntime = (minutes: number) => `${Math.ceil(minutes)} 分钟`;
export function workProgress(work: Work) { return { total: work.units.length, watched: work.units.filter(unit => unit.completed).length }; }
export function resumeTarget(work: Work) {
  const playable = work.units.filter(unit => unit.playable);
  return [...playable].filter(unit => !unit.completed && unit.positionSeconds > 0).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    ?? playable.find(unit => !unit.completed) ?? playable[0];
}

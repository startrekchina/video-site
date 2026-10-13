import { settings } from "@/lib/settings.server";

export const fixtureTime = Date.UTC(2026, 0, 1);

export const fixtureIds = {
  members: { nova: "nova", quinn: "quinn" },
  works: { movie: "movie", series: "series", otherSeries: "other-series" },
  seasons: { first: "season", other: "other-season" },
  units: { movie: "movie-unit", episode: "episode-unit" },
} as const;

// Fictional identities and catalogue entries only; hashes cannot authenticate a member.
export async function seedCatalog(db: D1Database) {
  const ids = fixtureIds;
  const member = (id: string, username: string) => db.prepare(`INSERT INTO users
    (id, username, username_key, email, email_key, email_verified_at, password_hash,
      role, status, invite_quota, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, username, username.toLowerCase(), `${id}@example.test`, `${id}@example.test`,
    fixtureTime, "fictional-hash-not-for-authentication", "member", "active",
    settings.inviteQuota, fixtureTime,
  );
  const work = (id: string, kind: string, tmdbId: number, titleZh: string, titleEn: string) =>
    db.prepare(`INSERT INTO works (id, kind, tmdb_id, title_zh, title_en, overview_zh, overview_en)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      id, kind, tmdbId, titleZh, titleEn,
      "这是一段虚构的测试资料。", "This is a fictional test description.",
    );
  const season = (id: string, workId: string, tmdbId: number) => db.prepare(`INSERT INTO seasons
    (id, work_id, season_number, tmdb_id, title_zh, title_en)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(id, workId, 1, tmdbId, "第一季", "Season One");

  await db.batch([
    member(ids.members.nova, "Nova"),
    member(ids.members.quinn, "Quinn"),
    work(ids.works.movie, "movie", 910001, "测试信号", "Signal Test"),
    work(ids.works.series, "series", 920001, "虚构勘测队", "Fictional Survey"),
    work(ids.works.otherSeries, "series", 920002, "虚构观测站", "Fictional Outpost"),
    season(ids.seasons.first, ids.works.series, 940001),
    season(ids.seasons.other, ids.works.otherSeries, 940002),
    db.prepare(`INSERT INTO playable_units
      (id, kind, work_id, tmdb_id, duration_seconds)
      VALUES (?, ?, ?, ?, ?)`).bind(ids.units.movie, "movie", ids.works.movie, 910001, 4),
    db.prepare(`INSERT INTO playable_units
      (id, kind, work_id, season_id, episode_number, tmdb_id, duration_seconds, title_zh, title_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      ids.units.episode, "episode", ids.works.series, ids.seasons.first, 1, 930001, 4,
      "虚构的第一集", "A Fictional First Episode",
    ),
  ]);
  return ids;
}

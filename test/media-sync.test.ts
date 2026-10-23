import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { seedCatalog } from "./fixtures/catalog";
import { catalog } from "@/lib/catalog.server";
import { inspectR2Media, mediaIdentity, subtitleLabel, syncMedia } from "@/lib/media-sync.server";
import { playbackSource } from "@/lib/playback.server";
import { probeD1 } from "./fixtures/d1-probe";

const key = "library/series/920001/S01/E01.mp4", subtitleKey = "library/series/920001/S01/E01.zh-CN.main.vtt";
const video = () => Uint8Array.from(atob(env.TEST_MEDIA_BASE64), char => char.charCodeAt(0));
const vtt = "WEBVTT\n\n00:00.000 --> 00:03.000\nA fictional signal.\n";
const media = async () => { await seedCatalog(env.DB); await env.DB.prepare("UPDATE playable_units SET duration_seconds = NULL WHERE id = 'episode-unit'").run(); await env.MEDIA_BUCKET.put(key, video()); };

it("accepts canonical TMDB names and multiple subtitle identities without guessing malformed names", () => {
  expect(mediaIdentity(key)).toMatchObject({ kind: "series", tmdbId: 920001, season: 1, episode: 1, language: null });
  expect(mediaIdentity(subtitleKey)?.trackKey).toBe("zh-CN.main");
  expect(mediaIdentity("library/movie/910001/movie.en.main.vtt")?.trackKey).toBe("en.main");
  expect(mediaIdentity(`library/movie/910001/movie.en${"-US".repeat(12)}.main.vtt`)).toBeNull();
  for (const bad of ["series/920001/S01/E01.mp4", "library/series/920001/S001/E01.mp4", "library/series/0/S01/E01.mp4", "library/series/920001/S01/E00.mp4", "library/series/920001/S01/E01.ass", "library/series/920001/S01/E01.fr.main.vtt", "library/movie/910001/movie.vtt"]) expect(mediaIdentity(bad)).toBeNull();
});

it("labels synced subtitles by language and relabels older synced rows without touching imported names", async () => {
  expect([subtitleLabel("zh-CN", "zh-CN.main"), subtitleLabel("zh-TW", "zh-TW.main"), subtitleLabel("en", "en.sdh")]).toEqual(["中文", "繁体中文", "英文（sdh）"]);
  const index = env.TEST_MIGRATIONS.findIndex(item => item.name === "0014_subtitle_display_names.sql");
  expect(index).toBeGreaterThan(0);
  await reset(); await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, index));
  const tracks = [["zh-CN", "zh-CN.main", "中文 · zh-CN.main"], ["zh-HK", "zh-HK.main", "中文 · zh-HK.main"], ["en", "en.sdh", "English · en.sdh"], ["en", "en.main", "English"]];
  await env.DB.batch([
    env.DB.prepare("INSERT INTO works (id, kind, tmdb_id) VALUES ('movie', 'movie', 910001)"),
    env.DB.prepare("INSERT INTO playable_units (id, kind, work_id, tmdb_id, duration_seconds) VALUES ('unit', 'movie', 'movie', 910001, 4)"),
    ...tracks.map(([language, trackKey, name], n) => env.DB.prepare(`INSERT INTO subtitle_tracks (id, playable_unit_id, language, format, display_name, track_key, object_key, byte_length, checksum_sha256)
      VALUES (?, 'unit', ?, 'vtt', ?, ?, ?, 8, 'hash')`).bind(`track-${n}`, language, name, trackKey, `library/movie/910001/movie.${trackKey}.vtt`)),
  ]);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(index, index + 1));
  expect((await env.DB.prepare("SELECT display_name FROM subtitle_tracks ORDER BY id").all<{ display_name: string }>()).results.map(row => row.display_name))
    .toEqual(["中文", "繁体中文", "英文（sdh）", "English"]);
});

it("validates actual R2 MP4 and VTT, links placeholders, skips a repeat and preserves member progress", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt);
  await env.DB.prepare("INSERT INTO watch_progress VALUES ('nova','episode-unit',2,0,100,1)").run();
  expect((await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0]).toMatchObject({ durationSeconds: null, playable: false });
  expect(await syncMedia(env)).toMatchObject({ linked: 2, conflicts: 0, failed: 0 });
  expect(await syncMedia(env)).toMatchObject({ linked: 0, skipped: 2 });
  expect(await env.DB.prepare("SELECT display_name FROM subtitle_tracks").first("display_name")).toBe("中文");
  expect((await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0]).toMatchObject({ durationSeconds: 4, playable: true, positionSeconds: 2, revision: 1 });
  const row = await env.DB.prepare("SELECT byte_length, checksum_sha256, r2_etag FROM media_files").first<{ byte_length: number; checksum_sha256: string; r2_etag: string }>();
  expect(row?.byte_length).toBe(video().length); expect(row?.checksum_sha256).toMatch(/^[a-f0-9]{64}$/); expect(row?.r2_etag).toBeTruthy();
});

// The parser reads the duration from mvhd only, so rewriting it yields a valid MP4 of another length.
const lasting = (seconds: number) => {
  const bytes = video(), at = bytes.findIndex((_, n) => String.fromCharCode(...bytes.subarray(n, n + 4)) === "mvhd") + 4, view = new DataView(bytes.buffer);
  const scaleAt = at + (bytes[at] === 1 ? 20 : 12), scale = view.getUint32(scaleAt);
  if (bytes[at] === 1) view.setBigUint64(scaleAt + 4, BigInt(Math.round(seconds * scale))); else view.setUint32(scaleAt + 4, Math.round(seconds * scale));
  return bytes;
};
const tierKey = (tier: string) => key.replace(".mp4", `.${tier}.mp4`);

it("recognizes only whitelisted quality tier names", () => {
  expect(mediaIdentity(tierKey("720p"))).toEqual({ kind: "series", tmdbId: 920001, season: 1, episode: 1, language: null, trackKey: null, variant: "720p" });
  expect(mediaIdentity("library/movie/910001/movie.2160p.mp4")?.variant).toBe("2160p");
  expect(mediaIdentity(key)).not.toHaveProperty("variant");
  for (const bad of ["360p", "720P", "1080i", "720p.720p", "original"]) expect(mediaIdentity(tierKey(bad))).toBeNull();
});

it("links quality tiers after their original without changing the unit's duration, and lists them high to low", async () => {
  await media();
  await env.MEDIA_BUCKET.put(tierKey("480p"), video()); await env.MEDIA_BUCKET.put(tierKey("1080p"), lasting(4.5));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    // Tiers list before their original, so the first pass cannot compare them yet.
    expect(await syncMedia(env)).toMatchObject({ linked: 1, unattached: 2, failed: 0 });
    expect(warn.mock.calls.map(([message]) => JSON.parse(String(message)))).toEqual(["1080p", "480p"].map(variant =>
      expect.objectContaining({ event: "media_sync_variant_unattached", unitId: "episode-unit", reason: "ORIGINAL_MISSING", variant })));
  } finally { warn.mockRestore(); }
  expect(await syncMedia(env)).toMatchObject({ linked: 2, unattached: 0 });
  expect(await syncMedia(env)).toMatchObject({ linked: 0, skipped: 3 });
  expect((await env.DB.prepare("SELECT variant FROM media_files ORDER BY variant").all()).results.map(row => row.variant)).toEqual(["1080p", "480p", "original"]);
  expect(await env.DB.prepare("SELECT duration_seconds FROM playable_units WHERE id = 'episode-unit'").first("duration_seconds")).toBe(4);
  expect((await playbackSource(env.DB, "episode-unit"))?.qualities.map(item => item.label)).toEqual(["原画", "1080p", "480p"]);
});

it("does not link a tier whose duration differs beyond the tolerance or whose unit has no original, and isolates a failed tier", async () => {
  await media(); expect(await syncMedia(env)).toMatchObject({ linked: 1 });
  await env.MEDIA_BUCKET.put(tierKey("1080p"), lasting(5)); await env.MEDIA_BUCKET.put(tierKey("720p"), lasting(6));
  await env.MEDIA_BUCKET.put(tierKey("480p"), video().slice(0, 32));
  await env.MEDIA_BUCKET.put("library/movie/910001/movie.720p.mp4", video());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await syncMedia(env)).toMatchObject({ linked: 1, unattached: 2, failed: 1 });
    const events = warn.mock.calls.map(([message]) => JSON.parse(String(message)));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "media_sync_variant_unattached", unitId: "episode-unit", reason: "DURATION_MISMATCH", variant: "720p" }),
      expect.objectContaining({ event: "media_sync_variant_unattached", unitId: "movie-unit", reason: "ORIGINAL_MISSING", variant: "720p" }),
    ]));
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/library\/|object_key|checksum_sha256|r2_etag/u);
  } finally { warn.mockRestore(); }
  expect((await env.DB.prepare("SELECT playable_unit_id AS unit, variant FROM media_files ORDER BY variant").all()).results).toEqual([
    { unit: "episode-unit", variant: "1080p" }, { unit: "episode-unit", variant: "original" }]);
  expect((await playbackSource(env.DB, "episode-unit"))?.qualities.map(item => item.label)).toEqual(["原画", "1080p"]);
  expect(await playbackSource(env.DB, "movie-unit")).toBeNull();
  expect((await catalog(env.DB, "nova")).find(work => work.slug === "movie")?.units[0].playable).toBe(false);
});

it("reports a changed tier as a conflict and keeps its verified reference", async () => {
  await media(); await syncMedia(env); await env.MEDIA_BUCKET.put(tierKey("720p"), video()); await syncMedia(env);
  const before = (await env.DB.prepare("SELECT * FROM media_files WHERE variant = '720p'").first())!;
  const changed = video(); changed[changed.length - 1] ^= 1; await env.MEDIA_BUCKET.put(tierKey("720p"), changed);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await syncMedia(env)).toMatchObject({ linked: 0, conflicts: 1 });
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "media_sync_conflict", unitId: "episode-unit", resourceType: "video", variant: "720p" });
  } finally { warn.mockRestore(); }
  expect(await env.DB.prepare("SELECT * FROM media_files WHERE variant = '720p'").first()).toEqual(before);
});

it("clears versions of deleted objects only after a complete pass and restores them after revalidation", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 2, cleared: 0 });
  const playable = async () => (await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0].playable;
  await env.MEDIA_BUCKET.delete([key, subtitleKey]);
  await env.DB.prepare("UPDATE media_sync_state SET cursor = 'library/000'").run();
  expect(await syncMedia(env)).toMatchObject({ cleared: 0, deferred: false });
  expect(await playable()).toBe(true);
  expect(await syncMedia(env)).toMatchObject({ cleared: 2, deferred: false });
  expect(await playable()).toBe(false);
  expect((await env.DB.prepare("SELECT r2_etag FROM media_files UNION ALL SELECT r2_etag FROM subtitle_tracks").all()).results).toEqual([{ r2_etag: null }, { r2_etag: null }]);
  await env.MEDIA_BUCKET.put(key, video()); await env.MEDIA_BUCKET.put(subtitleKey, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 0, conflicts: 0, failed: 0, cleared: 0 });
  expect(await playable()).toBe(true);
});

it("clears any number of deleted objects with one set-based statement per table", async () => {
  await media(); expect(await syncMedia(env)).toMatchObject({ linked: 1 });
  await env.DB.batch(Array.from({ length: 40 }, (_, n) => env.DB.prepare(`INSERT INTO subtitle_tracks (id, playable_unit_id, language, format, display_name, track_key, object_key, byte_length, checksum_sha256, r2_etag)
    VALUES (?, 'episode-unit', 'en', 'vtt', 'English', ?, ?, 8, 'hash', 'fictional-version')`).bind(`gone-${n}`, `en.gone${n}`, `library/series/920001/S01/E01.en.gone${n}.vtt`)));
  await env.MEDIA_BUCKET.delete(key);
  const probe = probeD1(env.DB);
  expect(await syncMedia({ ...env, DB: probe.db })).toMatchObject({ cleared: 41, deferred: false });
  const cleanup = probe.calls.find(call => call.method === "batch" && call.statements.every(kind => kind === "media"));
  expect(cleanup?.statements).toHaveLength(2);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM subtitle_tracks WHERE r2_etag IS NOT NULL").first<number>("n")).toBe(0);
  expect(await env.DB.prepare("SELECT r2_etag FROM media_files").first("r2_etag")).toBeNull();
});

it("rejects changed content and unsafe subtitles while retaining the original complete object and D1 reference", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt); await syncMedia(env);
  const original = await env.DB.prepare("SELECT checksum_sha256 FROM media_files").first<string>("checksum_sha256");
  const changed = video(); changed[changed.length - 1] ^= 1; await env.MEDIA_BUCKET.put(key, changed);
  await env.MEDIA_BUCKET.put(subtitleKey, vtt.replace("A fictional signal.", "<script>unsafe</script>"));
  expect(await syncMedia(env)).toMatchObject({ linked: 0, conflicts: 1, failed: 1 });
  expect(await env.DB.prepare("SELECT checksum_sha256 FROM media_files").first<string>("checksum_sha256")).toBe(original);
  expect((await env.MEDIA_BUCKET.head(key))?.size).toBe(changed.length);
  expect((await env.DB.prepare("SELECT id FROM subtitle_tracks").all()).results).toHaveLength(1);
});

it.each(["checksum", "length"])("reports logical identities for %s conflicts without exposing storage details or replacing references", async mismatch => {
  const movieKey = "library/movie/910001/movie.mp4", englishKey = "library/series/920001/S01/E01.en.main.vtt";
  await media();
  await env.MEDIA_BUCKET.put(movieKey, video());
  for (const objectKey of [subtitleKey, englishKey]) await env.MEDIA_BUCKET.put(objectKey, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 4, conflicts: 0 });
  if (mismatch === "checksum") {
    const changed = video(); changed[changed.length - 1] ^= 1;
    for (const objectKey of [key, movieKey]) await env.MEDIA_BUCKET.put(objectKey, changed);
    for (const objectKey of [subtitleKey, englishKey]) await env.MEDIA_BUCKET.put(objectKey, vtt.replace("fictional", "different"));
  } else await env.DB.batch([
    env.DB.prepare("UPDATE media_files SET byte_length = byte_length - 1"),
    env.DB.prepare("UPDATE subtitle_tracks SET byte_length = byte_length - 1"),
  ]);
  const files = (await env.DB.prepare("SELECT * FROM media_files ORDER BY id").all()).results;
  const tracks = (await env.DB.prepare("SELECT * FROM subtitle_tracks ORDER BY id").all()).results;
  const series = { event: "media_sync_conflict", unitId: "episode-unit", kind: "series", tmdbId: 920001, season: 1, episode: 1 };
  const expected = [
    { event: "media_sync_conflict", unitId: "movie-unit", resourceType: "video", kind: "movie", tmdbId: 910001, season: null, episode: null, language: null, trackKey: null },
    { ...series, resourceType: "video", language: null, trackKey: null },
    { ...series, resourceType: "subtitle", language: "zh-CN", trackKey: "zh-CN.main" },
    { ...series, resourceType: "subtitle", language: "en", trackKey: "en.main" },
  ];
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {}), info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    for (let run = 0; run < 2; run++) {
      warn.mockClear(); info.mockClear();
      expect(await syncMedia(env)).toMatchObject({ linked: 0, conflicts: 4, failed: 0, deferred: false });
      const events = warn.mock.calls.map(([message]) => JSON.parse(String(message)));
      expect(events).toHaveLength(4);
      expect(events).toEqual(expect.arrayContaining(expected));
      expect(info.mock.calls.map(([message]) => JSON.parse(String(message)))).toEqual([
        expect.objectContaining({ event: "media_sync_completed", linked: 0, conflicts: 4, failed: 0 }),
      ]);
      expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toMatch(/library\/|object_key|checksum_sha256|r2_etag|\?token=/u);
    }
    expect((await env.DB.prepare("SELECT * FROM media_files ORDER BY id").all()).results).toEqual(files);
    expect((await env.DB.prepare("SELECT * FROM subtitle_tracks ORDER BY id").all()).results).toEqual(tracks);
    for (const objectKey of [key, movieKey, subtitleKey, englishKey]) expect(await env.MEDIA_BUCKET.head(objectKey)).not.toBeNull();
    await env.MEDIA_BUCKET.put("library/series/920001/S01/E01.en.secondary.vtt", vtt);
    warn.mockClear();
    expect(await syncMedia(env)).toMatchObject({ linked: 1, conflicts: 4, failed: 0, deferred: false });
    expect(warn).toHaveBeenCalledTimes(4);
  } finally { warn.mockRestore(); info.mockRestore(); }
});

it("rejects partial/changed/aborted MP4 and never publishes invalid or unknown resources", async () => {
  await media(); const head = (await env.MEDIA_BUCKET.head(key))!;
  await expect(inspectR2Media(env.MEDIA_BUCKET, key, head, false, AbortSignal.abort())).rejects.toThrow();
  await env.MEDIA_BUCKET.put(key, video().slice(0, 32));
  await expect(inspectR2Media(env.MEDIA_BUCKET, key, head, false, new AbortController().signal)).rejects.toThrow();
  await env.MEDIA_BUCKET.put("library/series/999999/S01/E01.mp4", video());
  expect(await syncMedia(env)).toMatchObject({ linked: 0, failed: 1, unknown: 1 });
  expect((await env.DB.prepare("SELECT id FROM media_files").all()).results).toHaveLength(0);
});

it("keeps D1 association atomic on a failed commit and retries the retained R2 object", async () => {
  await media();
  await env.DB.exec("CREATE TRIGGER fail_media_insert BEFORE INSERT ON media_files BEGIN SELECT RAISE(ABORT, 'fictional commit failure'); END;");
  expect(await syncMedia(env)).toMatchObject({ linked: 0, failed: 1 });
  expect(await env.DB.prepare("SELECT duration_seconds FROM playable_units WHERE id = 'episode-unit'").first("duration_seconds")).toBeNull();
  expect(await env.MEDIA_BUCKET.head(key)).not.toBeNull();
  await env.DB.exec("DROP TRIGGER fail_media_insert;");
  expect(await syncMedia(env)).toMatchObject({ linked: 1 });
});

it("serializes overlapping schedules, follows list cursors and resumes bounded validation on the next run", async () => {
  await media();
  await env.DB.prepare("INSERT INTO media_sync_state VALUES ('catalog',NULL,'fictional-lease',?,0)").bind(Date.now() + 100000).run();
  expect(await syncMedia(env)).toMatchObject({ busy: true, linked: 0 });
  await env.DB.prepare("UPDATE media_sync_state SET lease_until = 0").run();
  const page = await env.MEDIA_BUCKET.list({ prefix: "library/" });
  const list = vi.spyOn(env.MEDIA_BUCKET, "list").mockResolvedValueOnce({ objects: [{ ...page.objects[0], key: "library/000", writeHttpMetadata: page.objects[0].writeHttpMetadata }], delimitedPrefixes: [], truncated: true, cursor: "fictional-page-two" }).mockResolvedValueOnce({ ...page, truncated: false });
  try { expect(await syncMedia(env)).toMatchObject({ linked: 1 }); expect(list).toHaveBeenCalledWith(expect.objectContaining({ startAfter: "library/000" })); }
  finally { list.mockRestore(); }
  for (let n = 0; n < 21; n++) await env.MEDIA_BUCKET.put(`library/series/920001/S01/E01.en.track${n}.vtt`, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 20, deferred: true });
  expect(await syncMedia(env)).toMatchObject({ linked: 1, deferred: false });
  for (let n = 0; n < 20; n++) await env.MEDIA_BUCKET.put(`library/series/920001/S01/E01.en.aaa${n}.vtt`, "invalid VTT");
  await env.MEDIA_BUCKET.put("library/series/920001/S01/E01.en.zzz.vtt", vtt);
  expect(await syncMedia(env)).toMatchObject({ failed: 20, deferred: true });
  expect(await syncMedia(env)).toMatchObject({ linked: 1, failed: 0, deferred: false });
});

it("migrates existing unit dependencies without losing IDs, media, progress or discussions", async () => {
  await reset(); const index = env.TEST_MIGRATIONS.findIndex(item => item.name === "0012_catalog_placeholders.sql");
  expect(index).toBeGreaterThan(0); await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, index)); await seedCatalog(env.DB);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO watch_progress VALUES ('nova','episode-unit',2,0,100,1)"),
    env.DB.prepare("INSERT INTO comments(id,playable_unit_id,author_user_id,body_markdown,created_at) VALUES ('comment','episode-unit','nova','Fictional discussion.',100)"),
    env.DB.prepare("INSERT INTO media_files VALUES ('source','episode-unit','mp4','original','fictional-private-object',4,'hash',4,'h264','aac',100)"),
  ]);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(index));
  for (const table of ["watch_progress", "comments", "media_files"]) expect((await env.DB.prepare(`SELECT playable_unit_id FROM ${table}`).all()).results[0].playable_unit_id).toBe("episode-unit");
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toHaveLength(0);
  await env.DB.prepare("UPDATE playable_units SET duration_seconds = NULL WHERE id = 'movie-unit'").run();
  await expect(env.DB.prepare("UPDATE playable_units SET duration_seconds = 0 WHERE id = 'movie-unit'").run()).rejects.toThrow();
});

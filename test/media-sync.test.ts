import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { seedCatalog } from "./fixtures/catalog";
import { catalog } from "@/lib/catalog.server";
import { subtitleTrack } from "@/lib/media-format";
import { inspectR2Media, mediaIdentity, syncMedia } from "@/lib/media-sync.server";
import { playbackSource } from "@/lib/playback.server";
import { probeD1 } from "./fixtures/d1-probe";

const key = "library/series/920001/S01/E01.mp4", subtitleKey = "library/series/920001/S01/E01.zh-CN.main.vtt";
const video = () => Uint8Array.from(atob(env.TEST_MEDIA_BASE64), char => char.charCodeAt(0));
const vtt = "WEBVTT\n\n00:00.000 --> 00:03.000\nA fictional signal.\n";
const media = async () => { await seedCatalog(env.DB); await env.DB.prepare("UPDATE playable_units SET duration_seconds = NULL WHERE id = 'episode-unit'").run(); await env.MEDIA_BUCKET.put(key, video()); };
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

it("accepts canonical TMDB names and multiple subtitle identities without guessing malformed names", () => {
  expect(mediaIdentity(key)).toMatchObject({ kind: "series", tmdbId: 920001, season: 1, episode: 1, language: null });
  expect(mediaIdentity(subtitleKey)?.trackKey).toBe("zh-CN.main");
  expect(mediaIdentity("library/movie/910001/movie.zh-TW.bilingual.vtt")?.trackKey).toBe("zh-TW.bilingual");
  expect(mediaIdentity(`library/movie/910001/movie.en${"-US".repeat(12)}.main.vtt`)).toBeNull();
  for (const bad of ["series/920001/S01/E01.mp4", "library/series/920001/S001/E01.mp4", "library/series/0/S01/E01.mp4", "library/series/920001/S01/E00.mp4", "library/series/920001/S01/E01.ass", "library/series/920001/S01/E01.fr.main.vtt", "library/movie/910001/movie.en.main.vtt", "library/movie/910001/movie.vtt"]) expect(mediaIdentity(bad)).toBeNull();
});

it("accepts only the four SUB1 subtitle kinds and their suffixed extras, labelled by kind", () => {
  for (const [key, language, trackKey, label] of [
    ["library/series/920001/S01/E01.zh-CN.main.vtt", "zh-CN", "zh-CN.main", "简中"],
    ["library/series/920001/S01/E01.zh-CN.bilingual.vtt", "zh-CN", "zh-CN.bilingual", "简英"],
    ["library/movie/910001/movie.zh-TW.main.vtt", "zh-TW", "zh-TW.main", "繁中"],
    ["library/movie/910001/movie.zh-TW.bilingual.vtt", "zh-TW", "zh-TW.bilingual", "繁英"],
    ["library/series/920001/S01/E01.zh-CN.main.alt.vtt", "zh-CN", "zh-CN.main.alt", "简中（alt）"],
    ["library/movie/910001/movie.zh-TW.bilingual.sdh.vtt", "zh-TW", "zh-TW.bilingual.sdh", "繁英（sdh）"],
  ]) {
    expect(mediaIdentity(key)).toMatchObject({ language, trackKey });
    expect(subtitleTrack(trackKey)).toEqual({ language, label });
  }
  for (const track of ["en.main", "zh.main", "zh-HK.main", "zh-Hant.main", "zh-cn.main", "zh-CN.alternate", "zh-CN.sdh", "zh-CN.mainx", "zh-CN.main."]) {
    expect(mediaIdentity(`library/series/920001/S01/E01.${track}.vtt`)).toBeNull();
    expect(subtitleTrack(track)).toBeNull();
  }
});

it("labels synced subtitles by language and relabels older synced rows without touching imported names", async () => {
  expect(["zh-CN.main", "zh-TW.main", "zh-TW.bilingual.sdh"].map(trackKey => subtitleTrack(trackKey)?.label)).toEqual(["简中", "繁中", "繁英（sdh）"]);
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
  expect(await syncMedia(env)).toMatchObject({ linked: 2, replaced: 0, failed: 0 });
  expect(await syncMedia(env)).toMatchObject({ linked: 0, skipped: 2 });
  expect(await env.DB.prepare("SELECT display_name FROM subtitle_tracks").first("display_name")).toBe("简中");
  expect((await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0]).toMatchObject({ durationSeconds: 4, playable: true, positionSeconds: 2, revision: 1 });
  const row = await env.DB.prepare("SELECT byte_length, checksum_sha256, r2_etag FROM media_files").first<{ byte_length: number; checksum_sha256: string; r2_etag: string }>();
  expect(row?.byte_length).toBe(video().length); expect(row?.checksum_sha256).toMatch(/^[a-f0-9]{64}$/); expect(row?.r2_etag).toBeTruthy();
});

it("links the four subtitle kinds in B 6.6 order with extras after their kind and skips non-compliant subtitles", async () => {
  await media();
  for (const track of ["zh-TW.bilingual", "zh-CN.main.alt", "zh-TW.main", "zh-CN.bilingual", "zh-CN.main", "en.main", "zh.main", "zh-HK.main"]) await env.MEDIA_BUCKET.put(`library/series/920001/S01/E01.${track}.vtt`, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 6, unknown: 3, failed: 0 });
  expect((await playbackSource(env.DB, "episode-unit"))?.tracks.map(track => track.displayName)).toEqual(["简中", "简中（alt）", "简英", "繁中", "繁英"]);
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

it("replaces a changed tier in place and logs its variant", async () => {
  await media(); await syncMedia(env); await env.MEDIA_BUCKET.put(tierKey("720p"), video()); await syncMedia(env);
  const before = (await env.DB.prepare("SELECT * FROM media_files WHERE variant = '720p'").first())!;
  const changed = video(); changed[changed.length - 1] ^= 1; const object = (await env.MEDIA_BUCKET.put(tierKey("720p"), changed))!;
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 1 });
    expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({ event: "media_sync_replaced", unitId: "episode-unit", resourceType: "video", variant: "720p" });
  } finally { info.mockRestore(); }
  expect(await env.DB.prepare("SELECT * FROM media_files WHERE variant = '720p'").first()).toEqual({ ...before, checksum_sha256: sha(changed), r2_etag: object.etag });
});

it("withdraws a tier replaced by a file of another duration and leaves the original untouched", async () => {
  await media(); await syncMedia(env); await env.MEDIA_BUCKET.put(tierKey("720p"), video()); await syncMedia(env);
  const original = await env.DB.prepare("SELECT * FROM media_files WHERE variant = 'original'").first();
  await env.MEDIA_BUCKET.put(tierKey("720p"), lasting(6));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await syncMedia(env)).toMatchObject({ replaced: 0, unattached: 1, failed: 0 });
    expect(warn.mock.calls.map(([message]) => JSON.parse(String(message)))).toEqual([
      expect.objectContaining({ event: "media_sync_variant_unattached", unitId: "episode-unit", reason: "DURATION_MISMATCH", variant: "720p" })]);
  } finally { warn.mockRestore(); }
  expect(await env.DB.prepare("SELECT r2_etag FROM media_files WHERE variant = '720p'").first("r2_etag")).toBeNull();
  expect((await playbackSource(env.DB, "episode-unit"))?.qualities.map(item => item.label)).toEqual(["原画"]);
  expect(await env.DB.prepare("SELECT * FROM media_files WHERE variant = 'original'").first()).toEqual(original);
});

// Links an original, a 720p tier and a subtitle, and adds member data to the unit.
const linkedWithTier = async (position: number) => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt); await syncMedia(env);
  await env.MEDIA_BUCKET.put(tierKey("720p"), video()); expect(await syncMedia(env)).toMatchObject({ linked: 1 });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO watch_progress VALUES ('nova','episode-unit',?,0,100,1)").bind(position),
    env.DB.prepare("INSERT INTO comments(id,playable_unit_id,author_user_id,body_markdown,created_at) VALUES ('comment','episode-unit','nova','Fictional discussion.',100)"),
    env.DB.prepare("INSERT INTO danmaku VALUES ('danmaku','episode-unit','nova',1,'虚构弹幕',0,'#FFFFFF',100)"),
  ]);
  const snapshot = async () => Promise.all([
    "SELECT id FROM media_files UNION ALL SELECT id FROM subtitle_tracks ORDER BY id", "SELECT * FROM watch_progress", "SELECT * FROM comments", "SELECT * FROM danmaku",
  ].map(async sql => (await env.DB.prepare(sql).all()).results));
  return { snapshot, before: await snapshot() };
};
const qualities = async () => (await playbackSource(env.DB, "episode-unit"))?.qualities.map(item => item.label);
const episode = async () => (await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0];

it("replaces an original in place, keeps ids and member data, and offers only tiers of its new duration", async () => {
  const { snapshot, before } = await linkedWithTier(2);
  const previous = (await env.DB.prepare("SELECT * FROM media_files WHERE variant = 'original'").first())!;
  const longer = lasting(6), object = (await env.MEDIA_BUCKET.put(key, longer))!;
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try { expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 1, failed: 0, unattached: 0 }); } finally { info.mockRestore(); }
  expect(await env.DB.prepare("SELECT * FROM media_files WHERE variant = 'original'").first()).toEqual({
    ...previous, checksum_sha256: sha(longer), duration_seconds: 6, bitrate: Math.round(longer.length * 8 / 6), r2_etag: object.etag });
  expect(await episode()).toMatchObject({ durationSeconds: 6, playable: true, positionSeconds: 2 });
  // The 720p row keeps its verified version but no longer matches the original.
  expect(await env.DB.prepare("SELECT r2_etag FROM media_files WHERE variant = '720p'").first("r2_etag")).toBeTruthy();
  expect(await qualities()).toEqual(["原画"]);
  await env.MEDIA_BUCKET.put(tierKey("720p"), lasting(6));
  expect(await syncMedia(env)).toMatchObject({ replaced: 1, unattached: 0 });
  expect(await qualities()).toEqual(["原画", "720p"]);
  expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 0, skipped: 3 });
  expect(await snapshot()).toEqual(before);
});

it("needs a second pass when an original and its tier are replaced together and keeps progress beyond a shorter duration", async () => {
  const { snapshot, before } = await linkedWithTier(3.5);
  for (const objectKey of [key, tierKey("720p")]) await env.MEDIA_BUCKET.put(objectKey, lasting(2));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    // The tier lists first and is compared with the previous original duration.
    expect(await syncMedia(env)).toMatchObject({ replaced: 1, unattached: 1, failed: 0 });
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "media_sync_variant_unattached", reason: "DURATION_MISMATCH", variant: "720p" });
  } finally { warn.mockRestore(); }
  expect(await qualities()).toEqual(["原画"]);
  expect(await syncMedia(env)).toMatchObject({ replaced: 1, unattached: 0 });
  expect(await qualities()).toEqual(["原画", "720p"]);
  expect(await episode()).toMatchObject({ durationSeconds: 2, playable: true, positionSeconds: 3.5 });
  expect(await snapshot()).toEqual(before);
});

it("replaces a subtitle in place, keeping its id and display name", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt); await syncMedia(env);
  const before = (await env.DB.prepare("SELECT * FROM subtitle_tracks").first<{ id: string }>())!;
  const text = vtt.replace("A fictional signal.", "A different fictional signal."), object = (await env.MEDIA_BUCKET.put(subtitleKey, text))!;
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try { expect(await syncMedia(env)).toMatchObject({ replaced: 1, skipped: 1 }); } finally { info.mockRestore(); }
  expect(await env.DB.prepare("SELECT * FROM subtitle_tracks").first()).toEqual({ ...before, byte_length: object.size, checksum_sha256: sha(text), r2_etag: object.etag });
  expect((await playbackSource(env.DB, "episode-unit"))?.tracks).toEqual([{ id: before.id, language: "zh-CN", displayName: "简中", url: `/subtitles/${before.id}` }]);
});

it("keeps the unit unavailable after an invalid replacement until a valid file is uploaded", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt); await syncMedia(env);
  const ids = (await env.DB.prepare("SELECT id FROM media_files UNION ALL SELECT id FROM subtitle_tracks ORDER BY id").all()).results;
  await env.MEDIA_BUCKET.put(key, video().slice(0, 32)); await env.MEDIA_BUCKET.put(subtitleKey, vtt.replace("A fictional signal.", "<script>unsafe</script>"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 0, failed: 2 });
    expect((await env.DB.prepare("SELECT r2_etag FROM media_files UNION ALL SELECT r2_etag FROM subtitle_tracks").all()).results).toEqual([{ r2_etag: null }, { r2_etag: null }]);
    expect(await episode()).toMatchObject({ playable: false });
    expect(await playbackSource(env.DB, "episode-unit")).toBeNull();
    for (const objectKey of [key, subtitleKey]) expect(await env.MEDIA_BUCKET.head(objectKey)).not.toBeNull();
    expect(await syncMedia(env)).toMatchObject({ failed: 2 });
  } finally { warn.mockRestore(); }
  const changed = video(); changed[changed.length - 1] ^= 1;
  await env.MEDIA_BUCKET.put(key, changed); await env.MEDIA_BUCKET.put(subtitleKey, vtt.replace("fictional", "different"));
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try { expect(await syncMedia(env)).toMatchObject({ replaced: 2, failed: 0 }); } finally { info.mockRestore(); }
  expect(await episode()).toMatchObject({ playable: true });
  expect((await playbackSource(env.DB, "episode-unit"))?.tracks).toHaveLength(1);
  expect((await env.DB.prepare("SELECT id FROM media_files UNION ALL SELECT id FROM subtitle_tracks ORDER BY id").all()).results).toEqual(ids);
});

it("counts identical bytes under a new version as skipped and only refreshes the version", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt); await syncMedia(env);
  const rows = async () => Promise.all(["media_files", "subtitle_tracks"].map(async table => (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results));
  const before = await rows();
  // R2 gives a re-upload of identical bytes a new ETag when, for example, it arrives as a multipart upload.
  await env.DB.batch(["media_files", "subtitle_tracks"].map(table => env.DB.prepare(`UPDATE ${table} SET r2_etag = 'fictional-earlier-version'`)));
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 0, skipped: 2, failed: 0 });
    expect(info.mock.calls.map(([message]) => JSON.parse(String(message)).event)).toEqual(["media_sync_completed"]);
  } finally { info.mockRestore(); }
  expect(await rows()).toEqual(before);
});

it("clears versions of deleted objects only after a complete pass and restores them after revalidation", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 2, cleared: 0 });
  const playable = async () => (await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0].playable;
  await env.MEDIA_BUCKET.delete([key, subtitleKey]);
  await env.DB.prepare("UPDATE media_sync_state SET cursor = 'library/000'").run();
  expect(await syncMedia(env)).toMatchObject({ cleared: 2, deferred: false });
  expect(await playable()).toBe(false);
  expect(await syncMedia(env)).toMatchObject({ cleared: 0, deferred: false });
  expect(await playable()).toBe(false);
  expect((await env.DB.prepare("SELECT r2_etag FROM media_files UNION ALL SELECT r2_etag FROM subtitle_tracks").all()).results).toEqual([{ r2_etag: null }, { r2_etag: null }]);
  await env.MEDIA_BUCKET.put(key, video()); await env.MEDIA_BUCKET.put(subtitleKey, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 0, failed: 0, cleared: 0 });
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

it("clears deleted media while repeatedly invalid files exhaust the validation budget", async () => {
  await media(); expect(await syncMedia(env)).toMatchObject({ linked: 1 });
  await env.MEDIA_BUCKET.delete(key);
  for (let n = 0; n < 21; n++) await env.MEDIA_BUCKET.put(`library/series/920001/S01/E01.zh-CN.main.bad${String(n).padStart(2, "0")}.vtt`, "INVALID");
  await env.MEDIA_BUCKET.put("library/series/920001/S01/E01.zh-CN.main.zzz.vtt", vtt);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await syncMedia(env)).toMatchObject({ failed: 20, cleared: 1, deferred: true });
    expect((await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0].playable).toBe(false);
    expect(await syncMedia(env)).toMatchObject({ failed: 1, linked: 1, deferred: false });
    await env.MEDIA_BUCKET.delete("library/series/920001/S01/E01.zh-CN.main.zzz.vtt");
    expect(await syncMedia(env)).toMatchObject({ failed: 20, cleared: 1, deferred: true });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM subtitle_tracks WHERE r2_etag IS NOT NULL").first("n")).toBe(0);
  } finally { warn.mockRestore(); }
});

it("does not clear unseen media when listing fails before the end of the prefix", async () => {
  await media(); expect(await syncMedia(env)).toMatchObject({ linked: 1 });
  const original = await env.DB.prepare("SELECT r2_etag FROM media_files").first("r2_etag");
  const page = await env.MEDIA_BUCKET.list({ prefix: "library/" });
  const list = vi.spyOn(env.MEDIA_BUCKET, "list")
    .mockResolvedValueOnce({ ...page, objects: [{ ...page.objects[0], key: "library/000", writeHttpMetadata: page.objects[0].writeHttpMetadata }], truncated: true, cursor: "fictional-next" })
    .mockRejectedValueOnce(new Error("fictional listing failure"));
  try { await expect(syncMedia(env)).rejects.toThrow("fictional listing failure"); }
  finally { list.mockRestore(); }
  expect(await env.DB.prepare("SELECT r2_etag FROM media_files").first("r2_etag")).toBe(original);
  expect(await env.DB.prepare("SELECT lease_until FROM media_sync_state").first("lease_until")).toBe(0);
});

it("clears pre-SUB1 subtitle rows so the scanner relinks only compliant objects under the new labels", async () => {
  const index = env.TEST_MIGRATIONS.findIndex(item => item.name === "0016_subtitle_kinds.sql");
  expect(index).toBeGreaterThan(0);
  await reset(); await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, index));
  const tracks = [["zh-CN", "zh-CN.main", "中文"], ["en", "en.main", "英文"]], objectKey = (trackKey: string) => `library/movie/910001/movie.${trackKey}.vtt`;
  const objects = await Promise.all(tracks.map(([, trackKey]) => env.MEDIA_BUCKET.put(objectKey(trackKey), vtt)));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO works (id, kind, tmdb_id) VALUES ('movie', 'movie', 910001)"),
    env.DB.prepare("INSERT INTO playable_units (id, kind, work_id, tmdb_id, duration_seconds) VALUES ('unit', 'movie', 'movie', 910001, 4)"),
    ...tracks.map(([language, trackKey, name], n) => env.DB.prepare(`INSERT INTO subtitle_tracks (id, playable_unit_id, language, format, display_name, track_key, object_key, byte_length, checksum_sha256, r2_etag)
      VALUES (?, 'unit', ?, 'vtt', ?, ?, ?, ?, 'hash', ?)`).bind(`track-${n}`, language, name, trackKey, objectKey(trackKey), objects[n]!.size, objects[n]!.etag)),
  ]);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(index));
  expect(await env.DB.prepare("SELECT count(*) AS n FROM subtitle_tracks").first("n")).toBe(0);
  expect(await syncMedia(env)).toMatchObject({ linked: 1, unknown: 1, failed: 0 });
  expect((await env.DB.prepare("SELECT track_key, display_name FROM subtitle_tracks").all()).results).toEqual([{ track_key: "zh-CN.main", display_name: "简中" }]);
  for (const [, trackKey] of tracks) expect(await env.MEDIA_BUCKET.head(objectKey(trackKey))).not.toBeNull();
});

it("drops the verified version of a row whose key no longer follows the naming rules but keeps its object", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt);
  const english = "library/series/920001/S01/E01.en.main.vtt", object = (await env.MEDIA_BUCKET.put(english, vtt))!;
  // A Worker still on the old rules can link such a row between migration 0016 and the new release.
  await env.DB.prepare(`INSERT INTO subtitle_tracks (id, playable_unit_id, language, format, display_name, track_key, object_key, byte_length, checksum_sha256, r2_etag)
    VALUES ('leftover', 'episode-unit', 'en', 'vtt', '英文', 'en.main', ?, ?, 'hash', ?)`).bind(english, object.size, object.etag).run();
  expect(await syncMedia(env)).toMatchObject({ linked: 2, unknown: 1, cleared: 1 });
  expect((await playbackSource(env.DB, "episode-unit"))?.tracks.map(track => track.displayName)).toEqual(["简中"]);
  expect(await env.DB.prepare("SELECT r2_etag FROM subtitle_tracks WHERE id = 'leftover'").first("r2_etag")).toBeNull();
  expect(await env.MEDIA_BUCKET.head(english)).not.toBeNull();
  expect(await syncMedia(env)).toMatchObject({ linked: 0, skipped: 2, unknown: 1, cleared: 0 });
});

it("replaces valid changed content, rejects an unsafe subtitle and keeps both complete objects and D1 references", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt); await syncMedia(env);
  const changed = video(); changed[changed.length - 1] ^= 1; await env.MEDIA_BUCKET.put(key, changed);
  await env.MEDIA_BUCKET.put(subtitleKey, vtt.replace("A fictional signal.", "<script>unsafe</script>"));
  expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 1, failed: 1 });
  expect(await env.DB.prepare("SELECT checksum_sha256 FROM media_files").first<string>("checksum_sha256")).toBe(sha(changed));
  expect((await env.MEDIA_BUCKET.head(key))?.size).toBe(changed.length);
  expect((await env.DB.prepare("SELECT id FROM subtitle_tracks").all()).results).toHaveLength(1);
  expect(await env.DB.prepare("SELECT r2_etag FROM subtitle_tracks").first("r2_etag")).toBeNull();
});

it.each(["checksum", "length"])("replaces %s mismatches in place and logs logical identities without exposing storage details", async mismatch => {
  const movieKey = "library/movie/910001/movie.mp4", traditionalKey = "library/series/920001/S01/E01.zh-TW.main.vtt";
  await media();
  await env.MEDIA_BUCKET.put(movieKey, video());
  for (const objectKey of [subtitleKey, traditionalKey]) await env.MEDIA_BUCKET.put(objectKey, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 4, replaced: 0 });
  if (mismatch === "checksum") {
    const changed = video(); changed[changed.length - 1] ^= 1;
    for (const objectKey of [key, movieKey]) await env.MEDIA_BUCKET.put(objectKey, changed);
    for (const objectKey of [subtitleKey, traditionalKey]) await env.MEDIA_BUCKET.put(objectKey, vtt.replace("fictional", "different"));
  } else await env.DB.batch([
    env.DB.prepare("UPDATE media_files SET byte_length = byte_length - 1"),
    env.DB.prepare("UPDATE subtitle_tracks SET byte_length = byte_length - 1"),
  ]);
  const files = (await env.DB.prepare("SELECT * FROM media_files ORDER BY id").all()).results;
  const tracks = (await env.DB.prepare("SELECT * FROM subtitle_tracks ORDER BY id").all()).results;
  const series = { event: "media_sync_replaced", unitId: "episode-unit", kind: "series", tmdbId: 920001, season: 1, episode: 1 };
  const expected = [
    { event: "media_sync_replaced", unitId: "movie-unit", resourceType: "video", kind: "movie", tmdbId: 910001, season: null, episode: null, language: null, trackKey: null },
    { ...series, resourceType: "video", language: null, trackKey: null },
    { ...series, resourceType: "subtitle", language: "zh-CN", trackKey: "zh-CN.main" },
    { ...series, resourceType: "subtitle", language: "zh-TW", trackKey: "zh-TW.main" },
  ];
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {}), info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 4, failed: 0, deferred: false });
    const events = info.mock.calls.map(([message]) => JSON.parse(String(message)));
    expect(events).toHaveLength(5);
    expect(events).toEqual(expect.arrayContaining([...expected, expect.objectContaining({ event: "media_sync_completed", linked: 0, replaced: 4, failed: 0 })]));
    expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toMatch(/library\/|object_key|checksum_sha256|r2_etag|\?token=/u);
    // Rows keep their ids and now describe the current objects.
    for (const [table, before] of [["media_files", files], ["subtitle_tracks", tracks]] as const) {
      const after = (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id`).all<{ id: string; object_key: string }>()).results;
      expect(after.map(row => row.id)).toEqual(before.map(row => row.id));
      for (const row of after) {
        const object = (await env.MEDIA_BUCKET.get(row.object_key))!;
        expect(row).toMatchObject({ byte_length: object.size, checksum_sha256: sha(new Uint8Array(await object.arrayBuffer())), r2_etag: object.etag });
      }
    }
    for (const objectKey of [key, movieKey, subtitleKey, traditionalKey]) expect(await env.MEDIA_BUCKET.head(objectKey)).not.toBeNull();
    expect(await syncMedia(env)).toMatchObject({ linked: 0, replaced: 0, skipped: 4, failed: 0, deferred: false });
    await env.MEDIA_BUCKET.put("library/series/920001/S01/E01.zh-CN.main.secondary.vtt", vtt);
    expect(await syncMedia(env)).toMatchObject({ linked: 1, replaced: 0, failed: 0, deferred: false });
    expect(warn).not.toHaveBeenCalled();
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
  for (let n = 0; n < 21; n++) await env.MEDIA_BUCKET.put(`library/series/920001/S01/E01.zh-CN.main.track${n}.vtt`, vtt);
  expect(await syncMedia(env)).toMatchObject({ linked: 20, deferred: true });
  expect(await syncMedia(env)).toMatchObject({ linked: 1, deferred: false });
  for (let n = 0; n < 20; n++) await env.MEDIA_BUCKET.put(`library/series/920001/S01/E01.zh-CN.main.aaa${n}.vtt`, "invalid VTT");
  await env.MEDIA_BUCKET.put("library/series/920001/S01/E01.zh-CN.main.zzz.vtt", vtt);
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

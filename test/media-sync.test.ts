import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { seedCatalog } from "./fixtures/catalog";
import { catalog } from "@/lib/catalog.server";
import { inspectR2Media, mediaIdentity, syncMedia } from "@/lib/media-sync.server";

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

it("validates actual R2 MP4 and VTT, links placeholders, skips a repeat and preserves member progress", async () => {
  await media(); await env.MEDIA_BUCKET.put(subtitleKey, vtt);
  await env.DB.prepare("INSERT INTO watch_progress VALUES ('nova','episode-unit',2,0,100,1)").run();
  expect((await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0]).toMatchObject({ durationSeconds: null, playable: false });
  expect(await syncMedia(env)).toMatchObject({ linked: 2, conflicts: 0, failed: 0 });
  expect(await syncMedia(env)).toMatchObject({ linked: 0, skipped: 2 });
  expect((await catalog(env.DB, "nova")).find(work => work.slug === "series")?.units[0]).toMatchObject({ durationSeconds: 4, playable: true, positionSeconds: 2, revision: 1 });
  const row = await env.DB.prepare("SELECT byte_length, checksum_sha256, r2_etag FROM media_files").first<{ byte_length: number; checksum_sha256: string; r2_etag: string }>();
  expect(row?.byte_length).toBe(video().length); expect(row?.checksum_sha256).toMatch(/^[a-f0-9]{64}$/); expect(row?.r2_etag).toBeTruthy();
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

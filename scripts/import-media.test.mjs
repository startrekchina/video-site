import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { catalogQueries, inspectMp4, preflight, report, validateVtt } from "./import-media.mjs";

let directory, repository, server, base, movieVideo, seriesVideo, mappingPath;
let mode = "normal", calls = [];
const env = { TMDB_API_KEY: "fictional-private-key", STAGING_D1_DATABASE_ID: "00000000-0000-4000-8000-000000000001", STAGING_MEDIA_BUCKET_NAME: "fictional-staging-media", PRODUCTION_D1_DATABASE_ID: "00000000-0000-4000-8000-000000000002", PRODUCTION_MEDIA_BUCKET_NAME: "fictional-prod-media" };
const entries = [
  { kind: "movie", tmdb_id: 800001, season: null, file: "fictional-movie.jpg" },
  { kind: "series", tmdb_id: 800002, season: null, file: "fictional-series.jpg" },
  { kind: "series", tmdb_id: 800002, season: 2, file: "fictional-season.jpg" },
];
const mapping = () => ({ environment: "staging", resources: { d1DatabaseId: env.STAGING_D1_DATABASE_ID, mediaBucketName: env.STAGING_MEDIA_BUCKET_NAME }, media: [
  { kind: "movie", tmdbId: 800001, videoPath: "movie.mp4", subtitles: [{ language: "zh-CN", displayName: "简体中文", trackKey: "zh", sourcePath: "chinese.ass" }] },
  { kind: "series", tmdbId: 800002, seasonNumber: 2, episodeNumber: 3, videoPath: "episode.mp4", subtitles: [{ language: "en", displayName: "English", trackKey: "en", sourcePath: "english.vtt" }] },
] });
const data = {
  "movie/800001": { id: 800001, title: "Fictional film", overview: "English film", release_date: "2020-01-01" },
  "tv/800002": { id: 800002, name: "Fictional show", overview: "English show", first_air_date: "2021-01-01", seasons: [{ id: 800003, season_number: 2 }] },
  "tv/800002/season/2": { id: 800003, name: "Second season", season_number: 2, episodes: [{ id: 800004, season_number: 2, episode_number: 3 }] },
  "tv/800002/season/2/episode/3": { id: 800004, name: "Fictional third episode", season_number: 2, episode_number: 3 },
};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "video-import-802b-"));
  repository = join(directory, "repository");
  const assets = join(repository, "public/assets/posters/star-trek");
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, "manifest.json"), JSON.stringify(entries));
  // Identity tests use a tiny synthetic WebP header; no third-party artwork is copied.
  for (const entry of entries) await writeFile(join(assets, entry.file.replace(".jpg", ".webp")), Buffer.from("RIFF\x04\0\0\0WEBP"));
  const video = join(directory, "movie.mp4");
  execFileSync(process.execPath, [resolve("scripts/gen-test-media.mjs")], { stdio: "pipe", windowsHide: true });
  movieVideo = await readFile(resolve("test/fixtures/media/signal-test.mp4"));
  await writeFile(video, movieVideo);
  seriesVideo = join(directory, "episode.mp4");
  await writeFile(seriesVideo, movieVideo);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-c", "copy", join(directory, "not-faststart.mp4")], { windowsHide: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-c:v", "mpeg4", "-c:a", "copy", "-movflags", "+faststart", join(directory, "wrong-codec.mp4")], { windowsHide: true });
  await writeFile(join(directory, "truncated.mp4"), movieVideo.subarray(0, movieVideo.length - 100));
  await writeFile(join(directory, "english.vtt"), "WEBVTT\n\n00:00.000 --> 00:00.500\n<v Observer><i>Test signal</i>\n");
  await writeFile(join(directory, "chinese.ass"), "[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:00.50,Default,,0,0,0,,虚构 & <信号> {\\i1}启动{\\i0}\n");
  mappingPath = join(directory, "mapping.json");
  server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    calls.push({ path: url.pathname, key: url.searchParams.get("api_key") });
    if (mode === "failure") { response.writeHead(503); response.end("fictional-private-key must not be printed"); return; }
    if (mode === "rate-limit" && calls.length === 1) { response.writeHead(429, { "Retry-After": "0" }); response.end(); return; }
    if (mode === "redirect") { response.writeHead(302, { Location: "/credential-leak" }); response.end(); return; }
    const path = url.pathname.replace(/^\/3\//u, ""), translations = path.endsWith("/translations");
    const identity = data[translations ? path.replace(/\/translations$/u, "") : path];
    if (!identity) { response.writeHead(404); response.end(); return; }
    const result = translations ? { id: identity.id, translations: path.startsWith("tv/") ? [{ iso_639_1: "zh", iso_3166_1: "CN", data: { name: "虚构中文标题", overview: "中文简介" } }] : [] } : structuredClone(identity);
    if (mode === "wrong-season" && !translations && path === "tv/800002/season/2") result.id++;
    if (mode === "wrong-translation" && translations) result.id++;
    response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(result));
  });
  await new Promise(accept => server.listen(0, "127.0.0.1", accept));
  base = `http://127.0.0.1:${server.address().port}/3/`;
});
after(async () => { if (server) await new Promise(accept => server.close(accept)); if (directory) await rm(directory, { recursive: true, force: true }); });

async function run(input = mapping(), options = {}) {
  await writeFile(mappingPath, JSON.stringify(input));
  calls = [];
  return preflight({ environment: "staging", mappingPath, env, repository, tmdbMockUrl: base, retryDelays: [], ...options });
}

test("real MP4: codec, box order, corruption, streamed checksum", async () => {
  const result = await inspectMp4(join(directory, "movie.mp4"));
  assert.equal(result.checksumSha256, createHash("sha256").update(movieVideo).digest("hex"));
  assert.equal(result.byteLength, movieVideo.length);
  assert.equal(result.videoCodec, "h264"); assert.equal(result.audioCodec, "aac"); assert.ok(result.durationSeconds > 0);
  await assert.rejects(inspectMp4(join(directory, "not-faststart.mp4")), /faststart/u);
  await assert.rejects(inspectMp4(join(directory, "wrong-codec.mp4")), /H.264/u);
  await assert.rejects(inspectMp4(join(directory, "truncated.mp4")), /长度损坏/u);
});

test("VTT syntax, safe markup, numeric entities and UTF-8", () => {
  const cue = text => Buffer.from(`WEBVTT\n\n00:00.000 --> 00:02.000\n${text}\n`);
  assert.equal(validateVtt(cue("<v Observer><i>安全 &amp; &#20013;</i>")).cueCount, 1);
  assert.equal(validateVtt(Buffer.from("\ufeffWEBVTT\r\n\r\n00:00.000 --> 00:00.000\r\n\r\n")).cueCount, 1);
  for (const bad of ["<script>bad</script>", "<b onclick=alert(1)>bad</b>", "<b><i>bad</b></i>", "<", "&#0;", "&#xD800;", "&bad;"]) assert.throws(() => validateVtt(cue(bad)));
  for (const bad of ["00:02.000 --> 00:01.000", "00:99.000 --> 00:02.000", "0:00.000 --> 00:02.000", "00:00.000 --> 00:02.000 size:101%", "00:00.000 --> 00:02.000 line:1 line:2"]) assert.throws(() => validateVtt(Buffer.from(`WEBVTT\n\n${bad}\nx\n`)));
  assert.throws(() => validateVtt(Buffer.from([0xff])));
  assert.throws(() => validateVtt(Buffer.from("WEBVTT\nx")));
});

test("two read-only preflights: identity, bilingual fallback, ASS conversion, redaction", async () => {
  const first = await run(), second = await run();
  assert.deepEqual(report(first), report(second));
  assert.equal(first.works[0].titleZh, null); assert.equal(first.works[0].titleEn, "Fictional film");
  assert.equal(first.seasons[0].tmdbId, 800003); assert.equal(first.media[1].tmdbId, 800004);
  assert.equal(first.media[1].titleZh, "虚构中文标题");
  assert.match(first.works[0].posterAsset, /fictional-movie\.webp$/u);
  assert.match(first.media[0].subtitles[0].bytes.toString(), /虚构 &amp; &lt;信号&gt; <i>启动<\/i>/u);
  assert.equal(first.warnings.length, 1);
  assert.ok(calls.every(call => call.key === "fictional-test-key"));
  const output = JSON.stringify(report(first));
  for (const privateValue of [directory, env.TMDB_API_KEY, env.STAGING_D1_DATABASE_ID, env.STAGING_MEDIA_BUCKET_NAME]) assert.ok(!output.includes(privateValue));
  assert.equal(report(first).cloudWrites, 0); assert.equal(report(first).counts.imported, 0);
});

test("input/environment rejection happens before any TMDB request", async () => {
  const cases = [
    input => { input.environment = "prod"; },
    input => { input.resources.mediaBucketName = "other-bucket"; },
    input => { input.apiKey = "must-not-be-in-mapping"; },
    input => { input.media.push(input.media[0]); },
    input => { input.media[1].seasonNumber = 9; },
    input => { input.media[0].seasonNumber = 1; },
    input => { input.media[0].subtitles[0].language = "fr"; },
    input => { input.media[0].subtitles.push(input.media[0].subtitles[0]); },
    input => { input.media[0].videoPath = "https://private.example.test/video.mp4"; },
  ];
  for (const modify of cases) { const input = mapping(); modify(input); await assert.rejects(run(input)); assert.equal(calls.length, 0); }
  await assert.rejects(run(mapping(), { env: { ...env, PRODUCTION_MEDIA_BUCKET_NAME: env.STAGING_MEDIA_BUCKET_NAME } }), /隔离/u);
  await assert.rejects(run(mapping(), { environment: "production" }), /明确/u);
  await assert.rejects(run(mapping(), { tmdbMockUrl: "https://example.test/3/" }), /回环/u);
});

test("wrong TMDB season/translation identity and upstream errors cannot become empty success", async () => {
  for (const failure of ["wrong-season", "wrong-translation", "failure", "redirect"]) {
    mode = failure;
    await assert.rejects(run(), error => { assert.match(error.message, /TMDB/u); assert.ok(!error.message.includes(env.TMDB_API_KEY)); return true; });
    assert.ok(!calls.some(call => call.path.includes("credential-leak")));
  }
  mode = "rate-limit";
  const result = await run(mapping(), { retryDelays: [0] });
  assert.equal(result.media.length, 2); assert.equal(calls[0].path, calls[1].path);
  mode = "normal";
});

test("missing/duplicate manifest identities and missing JPG to WebP assets", async () => {
  const path = join(repository, "public/assets/posters/star-trek/manifest.json");
  try {
    for (const invalid of [[...entries, entries[0]], entries.slice(0, 1).concat(entries[2]), [{ ...entries[0], file: "missing.jpg" }]]) {
      await writeFile(path, JSON.stringify(invalid));
      await assert.rejects(run()); assert.equal(calls.length, 0);
    }
  } finally { await writeFile(path, JSON.stringify(entries)); }
});

test("CLI help and blocked import do not read private config or write cloud resources", () => {
  const cli = resolve("scripts/import-media.mjs");
  assert.match(execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }), /仅预检/u);
  assert.throws(() => execFileSync(process.execPath, [cli, "import", "--environment", "prod", "--mapping", "missing.json"], { stdio: "pipe" }), error => error.status === 2 && !error.stdout.length && /catalog/u.test(error.stderr.toString()));
  assert.throws(() => execFileSync(process.execPath, [cli, "preflight", "--environment", "staging", "--environment", "prod"], { stdio: "pipe" }), error => error.status === 1 && /重复/u.test(error.stderr.toString()));
});

test("actual CLI preflight twice: explicit env file wins over conflicting shell variables", async () => {
  const scripts = join(repository, "scripts");
  await mkdir(scripts);
  const cli = join(scripts, "import-media.mjs");
  await writeFile(cli, await readFile(resolve("scripts/import-media.mjs")));
  await mkdir(join(repository, "app/lib"), { recursive: true });
  await writeFile(join(repository, "app/lib/media-format.ts"), await readFile(resolve("app/lib/media-format.ts")));
  const envFile = join(directory, ".env-test");
  await writeFile(envFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n"));
  await writeFile(mappingPath, JSON.stringify(mapping()));
  const args = [cli, "preflight", "--environment", "staging", "--mapping", mappingPath, "--env-file", envFile, "--tmdb-mock-url", base];
  const options = { encoding: "utf8", env: { ...process.env, STAGING_MEDIA_BUCKET_NAME: "conflicting-shell-bucket" }, windowsHide: true };
  const first = await promisify(execFile)(process.execPath, args, options), second = await promisify(execFile)(process.execPath, args, options);
  assert.deepEqual(JSON.parse(first.stdout), JSON.parse(second.stdout));
  assert.equal(JSON.parse(first.stdout).counts.media, 2);
  assert.match(first.stderr, /目标环境：staging/u);
  assert.ok(!first.stdout.includes(directory));
});

test("catalog placeholders: all units, stable upserts, actual media duration and atomic rollback", async () => {
  const input = mapping(); input.media = [];
  const result = await run(input, { allUnits: true });
  assert.equal(result.units.length, 2);
  assert.ok(result.units.every(unit => unit.durationSeconds === null));
  assert.equal(result.units.find(unit => unit.seasonId).titleZh, "虚构中文标题");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(await readFile(resolve("migrations/0001_catalog.sql"), "utf8"));
    db.exec(await readFile(resolve("migrations/0012_catalog_placeholders.sql"), "utf8"));
    const batch = queries => { db.exec("BEGIN"); try { for (const query of queries) db.prepare(query.sql).run(...query.params); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } };
    const queries = catalogQueries(result); batch(queries); batch(queries);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playable_units").get().n, 2);
    const id = "series_800002_s2_e3";
    db.prepare("UPDATE playable_units SET duration_seconds=4 WHERE id=?").run(id);
    db.prepare("INSERT INTO media_files VALUES ('media',?,'mp4','original','fictional.mp4',10,'fictional-checksum',4,'h264','aac',20,NULL)").run(id);
    result.units.find(unit => unit.seasonId).durationSeconds = 1200;
    result.units.find(unit => unit.seasonId).titleEn = "Updated name";
    batch(catalogQueries(result));
    assert.deepEqual({ ...db.prepare("SELECT id,duration_seconds,title_en FROM playable_units WHERE id=?").get(id) }, { id, duration_seconds: 4, title_en: "Updated name" });
    assert.equal(db.prepare("SELECT playable_unit_id FROM media_files").get().playable_unit_id, id);
    const bad = catalogQueries(result); bad[0].params[3] = "Must roll back"; bad.at(-1).params[1] = "invalid-kind";
    assert.throws(() => batch(bad));
    assert.equal(db.prepare("SELECT title_zh FROM works WHERE kind='movie'").get().title_zh, null);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
  const cli = join(repository, "scripts/import-media.mjs"), envFile = join(directory, ".env-test");
  const output = await promisify(execFile)(process.execPath, [cli, "catalog", "--environment", "staging", "--env-file", envFile, "--tmdb-mock-url", base], { encoding: "utf8", windowsHide: true });
  assert.deepEqual(JSON.parse(output.stdout).counts, { works: 2, seasons: 1, units: 2 });
  assert.equal(JSON.parse(output.stdout).cloudWrites, 0);
  assert.ok(!output.stdout.includes(env.STAGING_D1_DATABASE_ID));
});

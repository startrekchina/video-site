import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, parseEnv, promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const runFile = promisify(execFile);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const UPLOAD_BLOCKER = "cf 1.0.0-beta.12 的 R2 put 上限为 300 MB，且没有 multipart 命令。完整导入尚未实现；本工具仅预检，不上传、不写 D1。";

function check(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { name: "ImportInputError" });
}

function fields(value, allowed, label) {
  check(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), `${label} 格式错误或含未支持字段；凭证不得写入映射。`);
}

function localFile(value, base) {
  check(typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/u.test(value) && !/^\w+:\/\//u.test(value), "媒体路径必须是本机文件路径。" );
  return resolve(base, value);
}

function decode(bytes, label) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { check(false, `${label} 不是有效 UTF-8。`); }
}

async function smallFile(path, label, maximum = 5 * 1024 * 1024) {
  let size;
  try { size = await stat(path); } catch { check(false, `${label} 无法读取。`); }
  check(size.isFile() && size.size > 0 && size.size <= maximum, `${label} 为空、不是文件或超过 ${maximum} 字节。`);
  let bytes;
  try { bytes = await readFile(path); } catch { check(false, `${label} 无法读取。`); }
  check(bytes.length <= maximum, `${label} 超过大小限制。`);
  return bytes;
}

async function jsonFile(path, label) {
  const text = decode(await smallFile(path, label), label);
  try { return JSON.parse(text); } catch { check(false, `${label} 不是有效 JSON。`); }
}

async function ffmpeg(command, args, label) {
  try {
    const { stdout } = await runFile(command, args, { encoding: "buffer", maxBuffer: 5 * 1024 * 1024, timeout: 60_000, windowsHide: true });
    return stdout;
  } catch (error) {
    check(false, error.code === "ENOENT" ? `找不到 ${command}，请安装 FFmpeg 并加入 PATH。` : `${label} 解析失败或超时，请检查文件并先在本机转码。`);
  }
}

export async function inspectMp4(path) {
  const label = basename(path);
  check(extname(path).toLowerCase() === ".mp4", `${label}：仅接受 MP4，请先转码。`);
  let file;
  try { file = await open(path, "r"); } catch { check(false, `${label} 无法读取。`); }
  try {
    const before = await file.stat();
    check(before.isFile() && before.size > 0 && Number.isSafeInteger(before.size), `${label} 大小无效。`);
    let offset = 0, moov = -1, mdat = -1, ftyp = false;
    const header = Buffer.alloc(16);
    while (offset < before.size) {
      const { bytesRead } = await file.read(header, 0, Math.min(16, before.size - offset), offset);
      check(bytesRead >= 8, `${label}：MP4 box 头损坏，请先转码。`);
      let size = header.readUInt32BE(0);
      const type = header.toString("ascii", 4, 8);
      const headerSize = size === 1 ? 16 : 8;
      if (size === 1) {
        check(bytesRead === 16 && header.readBigUInt64BE(8) <= BigInt(Number.MAX_SAFE_INTEGER), `${label}：MP4 扩展长度无效。`);
        size = Number(header.readBigUInt64BE(8));
      } else if (size === 0) size = before.size - offset;
      check(size >= headerSize && size <= before.size - offset, `${label}：MP4 box 长度损坏，请先转码。`);
      if (type === "ftyp") {
        check(offset === 0 && size >= headerSize + 8 && !ftyp, `${label}：ftyp 无效。`);
        ftyp = true;
      }
      if (type === "moov") {
        check(moov === -1 && size > headerSize, `${label}：moov 无效。`);
        moov = offset;
      }
      if (type === "mdat") {
        check(size > headerSize, `${label}：媒体数据为空。`);
        if (mdat === -1) mdat = offset;
      }
      offset += size;
    }
    check(ftyp && moov >= 0 && mdat >= 0, `${label}：不是完整 MP4，请先转码。`);
    check(moov < mdat, `${label}：不符合 faststart，请先用 -movflags +faststart 转码。`);
    const probe = JSON.parse(decode(await ffmpeg("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", path], label), label));
    const videos = probe.streams?.filter(stream => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1) ?? [];
    const audios = probe.streams?.filter(stream => stream.codec_type === "audio") ?? [];
    check(probe.format?.format_name?.split(",").includes("mp4") && videos.length === 1 && videos[0].codec_name === "h264" && audios.length > 0 && audios.every(stream => stream.codec_name === "aac"), `${label}：需要 H.264 视频和 AAC 音频，请先转码。`);
    const durationSeconds = Number(probe.format.duration), bitrate = Math.round(Number(probe.format.bit_rate));
    check(Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isSafeInteger(bitrate) && bitrate > 0, `${label}：时长或码率无效，请先转码。`);
    const hash = createHash("sha256");
    for await (const bytes of file.createReadStream({ start: 0, autoClose: false })) hash.update(bytes);
    const after = await stat(path);
    check(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.ino === after.ino, `${label}：预检期间文件变更，请重试。`);
    return { path, byteLength: before.size, checksumSha256: hash.digest("hex"), durationSeconds, bitrate, videoCodec: "h264", audioCodec: "aac" };
  } finally { await file.close(); }
}

function cueTime(value) {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/u.exec(value);
  const time = match ? ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]) : NaN;
  return Number.isSafeInteger(time) ? time : NaN;
}

function cueText(text, start, end, label) {
  check(!/&(?!(amp|lt|gt|lrm|rlm|nbsp|#[0-9]+|#[xX][0-9a-fA-F]+);)/u.test(text), `${label}：字幕实体无效。`);
  for (const [, reference] of text.matchAll(/&#([xX][0-9a-fA-F]+|[0-9]+);/gu)) {
    const point = /^[xX]/u.test(reference) ? parseInt(reference.slice(1), 16) : Number(reference);
    check(Number.isSafeInteger(point) && point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && !(point >= 0x7f && point <= 0x9f) && !(point >= 0xfdd0 && point <= 0xfdef) && point % 0x10000 < 0xfffe, `${label}：字幕实体不是安全字符。`);
  }
  const stack = [];
  let previous = start;
  for (const token of text.matchAll(/<[^>]*>|</gu)) {
    const tag = token[0].slice(1, -1), time = cueTime(tag);
    if (Number.isFinite(time)) {
      check(time > previous && time < end, `${label}：cue 内时间戳无效。`);
      previous = time;
    } else if (tag.startsWith("/")) check(stack.pop() === tag.slice(1), `${label}：字幕标签嵌套错误。`);
    else {
      const match = /^(b|i|u|c|ruby|rt|v|lang)(?:\.[\w-]+)*(?:[ \t]+([^<>]+))?$/u.exec(tag);
      check(match && (match[1] === "v" ? Boolean(match[2]?.trim()) : match[1] === "lang" ? /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/u.test(match[2] ?? "") : match[2] === undefined), `${label}：字幕含不安全标签。`);
      check(match[1] !== "rt" || stack.at(-1) === "ruby", `${label}：rt 必须属于 ruby。`);
      stack.push(match[1]);
    }
  }
  check(stack.length === 0 || (stack.length === 1 && stack[0] === "v" && /^<v[ .\t]/u.test(text)), `${label}：字幕标签未闭合。`);
}

export function validateVtt(bytes, label = "字幕") {
  const text = decode(bytes, label).replace(/\r\n?/gu, "\n");
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text), `${label}：含非法控制字符。`);
  const lines = text.split("\n");
  check(/^WEBVTT(?:[ \t][^<>]*)?$/u.test(lines[0]) && !lines[0].includes("-->") && lines[1] === "", `${label}：缺少 WEBVTT 头或空行。`);
  let cueCount = 0;
  for (const block of lines.slice(2).join("\n").trim().split(/\n[ \t]*\n/gu).filter(Boolean)) {
    const cue = block.split("\n");
    if (/^NOTE(?:[ \t]|$)/u.test(cue[0])) continue;
    // ponytail: reject STYLE/REGION until their rendering and privacy behavior is reviewed.
    check(!/^(STYLE|REGION)$/u.test(cue[0]), `${label}：尚不支持 STYLE/REGION。`);
    if (!cue[0].includes("-->")) check(!/[<>&]/u.test(cue.shift()), `${label}：cue 标识符无效。`);
    const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(.*)$/u.exec(cue.shift() ?? "");
    check(match, `${label}：cue 时间语法无效。`);
    const start = cueTime(match[1]), end = cueTime(match[2]);
    check(Number.isFinite(start) && Number.isFinite(end) && start <= end, `${label}：cue 时间越界或开始晚于结束。`);
    const seen = new Set();
    for (const setting of match[3].trim().split(/\s+/u).filter(Boolean)) {
      const [name, value, extra] = setting.split(":");
      const percent = value && /^(\d+(?:\.\d+)?)%(?:,(line-left|center|line-right|auto))?$/u.exec(value);
      const line = value && /^(auto|-?\d+|\d+(?:\.\d+)?%)(?:,(start|center|end))?$/u.exec(value);
      const valid = name === "align" ? /^(start|center|end|left|right)$/u.test(value) : name === "vertical" ? /^(rl|lr)$/u.test(value) : ["size", "position"].includes(name) ? percent && Number(percent[1]) <= 100 && (name !== "size" || !percent[2]) : name === "line" && line && (!line[1].endsWith("%") || Number(line[1].slice(0, -1)) <= 100);
      check(valid && !extra && !seen.has(name), `${label}：cue 设置无效或重复。`);
      seen.add(name);
    }
    const payload = cue.join("\n");
    check(!payload.includes("-->"), `${label}：cue 文本无效。`);
    cueText(payload, start, end, label);
    cueCount++;
  }
  return { bytes: Buffer.from(text.endsWith("\n") ? text : `${text}\n`), cueCount };
}

async function subtitle(input, base, logicalId, warnings) {
  fields(input, ["language", "displayName", "trackKey", "sourcePath"], `${logicalId} 字幕`);
  check(typeof input.language === "string" && /^(zh|en)(?:-[A-Za-z0-9]{2,8})*$/u.test(input.language) && input.language.length <= 35, `${logicalId}：字幕只接受中文或英文。`);
  check(typeof input.trackKey === "string" && /^[A-Za-z0-9][\w.-]{0,63}$/u.test(input.trackKey), `${logicalId}：trackKey 无效。`);
  check(typeof input.displayName === "string" && input.displayName.trim() && input.displayName.length <= 160 && !/[\u0000-\u001f\u007f<>]/u.test(input.displayName), `${logicalId}：displayName 无效。`);
  const path = localFile(input.sourcePath, base), label = `${logicalId}/${basename(path)}`;
  check([".vtt", ".ass"].includes(extname(path).toLowerCase()), `${label}：仅支持 VTT/ASS。`);
  let bytes = await smallFile(path, label);
  decode(bytes, label);
  if (extname(path).toLowerCase() === ".ass") {
    bytes = await ffmpeg("ffmpeg", ["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-f", "ass", "-i", path, "-f", "webvtt", "pipe:1"], label);
    // FFmpeg escapes ASS styling but emits literal &, < and > in cue text.
    let payload = false;
    bytes = Buffer.from(decode(bytes, label).split(/\r?\n/u).map(line => {
      if (!line) { payload = false; return line; }
      if (line.includes("-->")) { payload = true; return line; }
      return payload ? line.split(/(<\/?[biu]>)/u).map((part, index) => index % 2 ? part : part.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")).join("") : line;
    }).join("\n"));
    warnings.push(`${logicalId}/${input.trackKey}：ASS 转 VTT 丢失字体、定位等样式。`);
  }
  const validated = validateVtt(bytes, label);
  return { language: input.language, displayName: input.displayName, trackKey: input.trackKey, ...validated, byteLength: validated.bytes.length, checksumSha256: sha256(validated.bytes) };
}

async function manifest(repository) {
  const directory = join(repository, "public/assets/posters/star-trek");
  const entries = await jsonFile(join(directory, "manifest.json"), "仓库 manifest");
  check(Array.isArray(entries) && entries.length > 0, "manifest 必须是非空数组。" );
  const result = [], identities = new Set(), assetRoot = await realpath(directory);
  for (const entry of entries) {
    check(entry && ["movie", "series"].includes(entry.kind) && Number.isSafeInteger(entry.tmdb_id) && entry.tmdb_id > 0 && (entry.season === null || (entry.kind === "series" && Number.isSafeInteger(entry.season) && entry.season >= 0)), "manifest 作品/季身份无效。" );
    check(typeof entry.file === "string" && /^[\w-]+\.jpg$/u.test(entry.file), "manifest file 必须是无目录的 JPG 文件名。" );
    const workId = `${entry.kind}:${entry.tmdb_id}`, id = entry.season === null ? workId : `${workId}:season:${entry.season}`;
    check(!identities.has(id), `${id}：manifest 身份重复。`);
    identities.add(id);
    const filename = entry.file.replace(/\.jpg$/u, ".webp");
    let asset;
    try { asset = await realpath(join(directory, filename)); } catch { check(false, `${id}：缺少对应 WebP 海报。`); }
    const within = relative(assetRoot, asset);
    check(!within.startsWith("..") && !isAbsolute(within), `${id}：海报超出静态素材目录。`);
    const handle = await open(asset, "r");
    try {
      const bytes = Buffer.alloc(12), read = await handle.read(bytes, 0, 12, 0);
      check(read.bytesRead === 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP", `${id}：海报不是 WebP。`);
    } finally { await handle.close(); }
    result.push({ id, workId, kind: entry.kind, tmdbId: entry.tmdb_id, seasonNumber: entry.season, posterAsset: `/assets/posters/star-trek/${filename}` });
  }
  for (const entry of result) check(entry.seasonNumber === null || identities.has(entry.workId), `${entry.id}：缺少所属作品主海报。`);
  return result;
}

function tmdbClient(key, mockUrl, timeoutMs, retryDelays) {
  let base;
  try { base = new URL(mockUrl ?? "https://api.themoviedb.org/3/"); } catch { check(false, "TMDB 模拟地址无效。" ); }
  check(!mockUrl || (base.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(base.hostname) && !base.username && !base.password && !base.search && !base.hash), "模拟 TMDB 仅允许无凭证的回环 HTTP 地址。" );
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return async (path, language) => {
    const url = new URL(path, base);
    url.searchParams.set("api_key", mockUrl ? "fictional-test-key" : key);
    if (language) url.searchParams.set("language", language);
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
        if (response.ok) {
          let length = 0;
          const chunks = [];
          for await (const chunk of response.body) {
            length += chunk.length;
            check(length <= 5 * 1024 * 1024, "TMDB 响应超出大小限制。" );
            chunks.push(chunk);
          }
          const data = JSON.parse(decode(Buffer.concat(chunks), "TMDB 响应"));
          check(data && typeof data === "object" && !Array.isArray(data), "TMDB 响应不是资料对象。" );
          return data;
        }
        await response.body?.cancel();
      } catch (error) { if (error.name === "ImportInputError") throw error; }
      check(attempt < retryDelays.length && (!response || response.ok || response.status === 429 || response.status >= 500), `TMDB ${path} 请求失败或超时${response ? `（HTTP ${response.status}）` : ""}；未生成可写入资料。`);
      const retryAfter = Number(response?.headers.get("Retry-After"));
      await delay(response?.status === 429 && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : retryDelays[attempt]);
    }
  };
}

async function metadata(request, path, identity, movie = false) {
  const english = await request(path, "en-US");
  check(identity(english), `TMDB ${path} 身份不匹配。`);
  const translations = await request(`${path}/translations`);
  check(translations.id === english.id && Array.isArray(translations.translations), `TMDB ${path} 翻译身份无效。`);
  check(translations.translations.every(item => item && typeof item.iso_639_1 === "string" && typeof item.iso_3166_1 === "string"), `TMDB ${path} 翻译语言无效。`);
  const chinese = translations.translations.filter(item => item?.iso_639_1 === "zh" && item.iso_3166_1 === "CN");
  check(chinese.length <= 1, `TMDB ${path} 中文翻译身份歧义。`);
  const zh = chinese.length ? chinese[0].data : {};
  check(zh && typeof zh === "object" && !Array.isArray(zh), `TMDB ${path} 中文资料无效。`);
  const localized = {};
  for (const [suffix, data] of [["Zh", zh], ["En", english]]) {
    for (const [target, source] of [["title", movie ? "title" : "name"], ["overview", "overview"]]) {
      check(data[source] == null || typeof data[source] === "string", `TMDB ${path} 文本字段无效。`);
      localized[`${target}${suffix}`] = data[source]?.trim() || null;
    }
  }
  check(localized.titleZh || localized.titleEn, `TMDB ${path} 标题缺失。`);
  return { english, localized };
}

export async function preflight({ environment, mappingPath, env = process.env, repository = root, tmdbMockUrl, timeoutMs = 15_000, retryDelays = [1000, 2000] }) {
  check(["staging", "prod"].includes(environment), "必须明确选择 staging 或 prod。" );
  const input = await jsonFile(mappingPath, "媒体映射");
  fields(input, ["environment", "resources", "media"], "媒体映射");
  fields(input.resources, ["d1DatabaseId", "mediaBucketName"], "resources");
  check(input.environment === environment, "映射环境与命令环境不一致。" );
  const prefix = environment === "prod" ? "PRODUCTION" : "STAGING", other = environment === "prod" ? "STAGING" : "PRODUCTION";
  const database = env[`${prefix}_D1_DATABASE_ID`], bucket = env[`${prefix}_MEDIA_BUCKET_NAME`];
  check(typeof database === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(database) && typeof bucket === "string" && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucket), "目标环境 D1/R2 配置缺失或无效。" );
  check(database.toLowerCase() !== env[`${other}_D1_DATABASE_ID`]?.toLowerCase() && bucket !== env[`${other}_MEDIA_BUCKET_NAME`] && database === input.resources.d1DatabaseId && bucket === input.resources.mediaBucketName, "D1/R2 资源未隔离或映射不匹配。" );
  check(typeof env.TMDB_API_KEY === "string" && env.TMDB_API_KEY.trim(), "本机环境变量 TMDB_API_KEY 未配置。" );
  const request = tmdbClient(env.TMDB_API_KEY, tmdbMockUrl, timeoutMs, retryDelays);
  const entries = await manifest(repository), byId = new Map(entries.map(entry => [entry.id, entry]));
  check(Array.isArray(input.media) && input.media.length <= 2000, "media 必须是至多 2000 项的数组。" );
  const media = [], warnings = [], seen = new Set();
  for (const item of input.media) {
    fields(item, ["kind", "tmdbId", "seasonNumber", "episodeNumber", "videoPath", "subtitles"], "媒体条目");
    check(["series", "movie"].includes(item.kind) && Number.isSafeInteger(item.tmdbId) && item.tmdbId > 0, "媒体作品身份无效。" );
    const workId = `${item.kind}:${item.tmdbId}`, seasonId = `${workId}:season:${item.seasonNumber}`;
    check(byId.has(workId), `${workId} 不在 manifest 中。`);
    check(item.kind === "movie" ? item.seasonNumber == null && item.episodeNumber == null : Number.isSafeInteger(item.seasonNumber) && item.seasonNumber >= 0 && Number.isSafeInteger(item.episodeNumber) && item.episodeNumber > 0 && byId.has(seasonId), `${workId} 季/集身份无效。`);
    const id = item.kind === "movie" ? workId : `${seasonId}:episode:${item.episodeNumber}`;
    check(!seen.has(id), `${id} 媒体重复。`);
    seen.add(id);
    check(Array.isArray(item.subtitles) && item.subtitles.length <= 32, `${id} subtitles 必须是至多 32 项的数组。`);
    const video = await inspectMp4(localFile(item.videoPath, dirname(mappingPath))), subtitles = [], tracks = new Set();
    for (const track of item.subtitles) {
      const validated = await subtitle(track, dirname(mappingPath), id, warnings);
      check(!tracks.has(validated.trackKey), `${id} 字幕 trackKey 重复。`);
      tracks.add(validated.trackKey);
      subtitles.push(validated);
    }
    media.push({ id, workId, seasonId: item.kind === "movie" ? null : seasonId, episodeNumber: item.episodeNumber ?? null, video, subtitles });
  }
  const works = [], seasons = [], workDetails = new Map(), unitDetails = new Map();
  for (const entry of entries.filter(entry => entry.seasonNumber === null)) {
    const path = `${entry.kind === "movie" ? "movie" : "tv"}/${entry.tmdbId}`;
    const { english, localized } = await metadata(request, path, data => data.id === entry.tmdbId, entry.kind === "movie");
    const date = english[entry.kind === "movie" ? "release_date" : "first_air_date"];
    check(date == null || date === "" || typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(date), `${entry.id} 首映日期无效。`);
    works.push({ ...entry, ...localized, year: date ? Number(date.slice(0, 4)) : null });
    workDetails.set(entry.id, english);
    if (entry.kind === "movie") unitDetails.set(entry.id, { tmdbId: entry.tmdbId, ...localized });
  }
  for (const entry of entries.filter(entry => entry.seasonNumber !== null)) {
    const identities = workDetails.get(entry.workId).seasons;
    check(Array.isArray(identities), `${entry.id} TMDB 季清单缺失。`);
    const matching = identities.filter(season => season.season_number === entry.seasonNumber);
    check(matching.length === 1 && Number.isSafeInteger(matching[0].id) && matching[0].id > 0, `${entry.id} TMDB 季身份歧义或缺失。`);
    const path = `tv/${entry.tmdbId}/season/${entry.seasonNumber}`;
    const { english, localized } = await metadata(request, path, data => data.id === matching[0].id && data.season_number === entry.seasonNumber);
    seasons.push({ ...entry, tmdbId: english.id, ...localized });
    check(Array.isArray(english.episodes), `${entry.id} TMDB 集清单缺失。`);
    for (const episode of english.episodes) {
      const id = `${entry.id}:episode:${episode.episode_number}`;
      check(Number.isSafeInteger(episode.id) && episode.id > 0 && Number.isSafeInteger(episode.episode_number) && episode.episode_number > 0 && episode.season_number === entry.seasonNumber && (episode.show_id === undefined || episode.show_id === entry.tmdbId) && !unitDetails.has(id), `${entry.id} TMDB 集身份错误或重复。`);
      unitDetails.set(id, { tmdbId: episode.id, path: `${path}/episode/${episode.episode_number}` });
    }
  }
  for (const unit of media) {
    const identity = unitDetails.get(unit.id);
    check(identity, `${unit.id} 在 TMDB 中不存在。`);
    if (unit.seasonId) {
      const { localized } = await metadata(request, identity.path, data => data.id === identity.tmdbId && data.season_number === byId.get(unit.seasonId).seasonNumber && data.episode_number === unit.episodeNumber);
      Object.assign(unit, { tmdbId: identity.tmdbId }, localized);
    } else Object.assign(unit, identity);
  }
  return { environment, simulatedTmdb: Boolean(tmdbMockUrl), works, seasons, media, warnings };
}

export function report(result) {
  return { ...result, status: "preflight-only", cloudWrites: 0, blocker: UPLOAD_BLOCKER,
    counts: { works: result.works.length, seasons: result.seasons.length, media: result.media.length, imported: 0 },
    media: result.media.map(({ video: { path, ...video }, subtitles, ...identity }) => ({ ...identity, video, subtitles: subtitles.map(({ bytes, ...track }) => track) })),
  };
}

const help = `用法：node scripts/import-media.mjs preflight --environment staging|prod --mapping <本机 JSON> [--env-file <本机 env>] [--tmdb-mock-url <回环 HTTP 地址>]
仅预检本机 MP4/VTT/ASS 和 TMDB 资料；不运行 cf，不写入 D1/R2，不保存转换文件。
默认读取本工作树 .env，shell 变量优先；显式 --env-file 仅使用指定文件中的变量。
输入契约与运行限制见 docs/import-media.md。
${UPLOAD_BLOCKER}`;

async function main() {
  const { values, positionals, tokens } = parseArgs({ tokens: true, allowPositionals: true, options: { environment: { type: "string" }, mapping: { type: "string" }, "env-file": { type: "string" }, "tmdb-mock-url": { type: "string" }, help: { type: "boolean" } } });
  const names = tokens.filter(token => token.kind === "option").map(token => token.name);
  check(new Set(names).size === names.length, "命令参数重复，请使用 --help。" );
  if (values.help) { console.log(help); return; }
  if (positionals.length === 1 && positionals[0] === "import") { console.error(UPLOAD_BLOCKER); process.exitCode = 2; return; }
  check(positionals.length === 1 && positionals[0] === "preflight" && ["staging", "prod"].includes(values.environment) && values.mapping, help);
  console.error(`目标环境：${values.environment}；仅预检。`);
  let env = process.env;
  const envFile = values["env-file"] ? resolve(values["env-file"]) : join(root, ".env");
  try {
    const parsed = parseEnv(await readFile(envFile, "utf8"));
    env = values["env-file"] ? parsed : { ...parsed, ...process.env };
  } catch (error) { check(!values["env-file"] && error.code === "ENOENT", "本机 env 文件无法读取。" ); }
  console.log(JSON.stringify(report(await preflight({ environment: values.environment, mappingPath: resolve(values.mapping), env, tmdbMockUrl: values["tmdb-mock-url"] })), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.name === "ImportInputError" ? error.message : "预检失败：请核对命令参数、本机文件和配置；原始错误不输出。" );
    process.exitCode = 1;
  });
}

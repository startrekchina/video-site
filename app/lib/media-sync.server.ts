import { createHash } from "node:crypto";
import { mp4BoxHeader, mp4Metadata, subtitleTrack, validateVtt } from "./media-format";
import { settings } from "./settings.server";

export const mediaSyncCron = "*/5 * * * *";
const windowMs = 6 * 60_000;
const tierSuffix = new RegExp(`^\\.(${settings.qualityTiers.join("|")})\\.mp4$`, "u");
// variant is present only on quality tiers; the plain MP4 is the original.
type Identity = { kind: "movie" | "series"; tmdbId: number; season: number | null; episode: number | null; language: string | null; trackKey: string | null; variant?: string };
export function mediaIdentity(key: string): Identity | null {
  const series = /^library\/series\/([1-9]\d*)\/S(\d{2,})\/E(\d{2,})(.*)$/u.exec(key);
  const movie = /^library\/movie\/([1-9]\d*)\/movie(.*)$/u.exec(key);
  if (!series && !movie) return null;
  const tmdbId = Number((series ?? movie)![1]), season = series ? Number(series[2]) : null, episode = series ? Number(series[3]) : null;
  if (!Number.isSafeInteger(tmdbId) || series && (!Number.isSafeInteger(season) || !Number.isSafeInteger(episode) || String(season).padStart(2, "0") !== series[2] || String(episode).padStart(2, "0") !== series[3] || episode === 0)) return null;
  const suffix = series ? series[4] : movie![2];
  const trackKey = /^\.(.+)\.vtt$/u.exec(suffix)?.[1], subtitle = trackKey ? subtitleTrack(trackKey) : null, tier = tierSuffix.exec(suffix);
  if (suffix !== ".mp4" && !tier && !subtitle) return null;
  return { kind: series ? "series" : "movie", tmdbId, season, episode, language: subtitle?.language ?? null, trackKey: subtitle ? trackKey! : null, ...tier ? { variant: tier[1] } : {} };
}
const identityKey = (value: Pick<Identity, "kind" | "tmdbId" | "season" | "episode">) => `${value.kind}:${value.tmdbId}:${value.season}:${value.episode}`;
function requireValid(condition: unknown) { if (!condition) throw new Error("MEDIA_INVALID"); }
async function consume(body: ReadableStream<Uint8Array>, signal: AbortSignal, accept: (chunk: Uint8Array) => void) {
  const reader = body.getReader(), cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) { const next = await reader.read(); signal.throwIfAborted(); if (next.done) break; accept(next.value); }
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); }
}
async function range(bucket: R2Bucket, key: string, head: R2Object, offset: number, length: number, signal: AbortSignal) {
  const object = await bucket.get(key, { range: { offset, length }, onlyIf: { etagMatches: head.etag } });
  requireValid(object && "body" in object && object.etag === head.etag);
  if (!object || !("body" in object)) throw new Error("MEDIA_CHANGED");
  const bytes = new Uint8Array(length); let at = 0;
  await consume(object.body, signal, chunk => { requireValid(at + chunk.length <= length); bytes.set(chunk, at); at += chunk.length; });
  requireValid(at === length); return bytes;
}
export async function inspectR2Media(bucket: R2Bucket, key: string, head: R2Object, subtitle: boolean, signal: AbortSignal) {
  requireValid(Number.isSafeInteger(head.size) && head.size > 0); let metadata: ReturnType<typeof mp4Metadata> | undefined;
  if (!subtitle) {
    let at = 0, ftyp = false, moov = -1, mdat = -1, count = 0;
    while (at < head.size) {
      requireValid(++count <= 10000);
      const bytes = await range(bucket, key, head, at, Math.min(16, head.size - at), signal), box = mp4BoxHeader(bytes, head.size - at);
      if (box.type === "ftyp") { requireValid(!ftyp && at === 0 && box.size >= box.headerSize + 8); ftyp = true; }
      if (box.type === "moov") {
        requireValid(moov < 0 && box.size <= 32 * 1024 * 1024); moov = at;
        metadata = mp4Metadata(await range(bucket, key, head, at, box.size, signal), head.size);
      }
      if (box.type === "mdat") { requireValid(box.size > box.headerSize); if (mdat < 0) mdat = at; }
      at += box.size;
    }
    requireValid(ftyp && moov >= 0 && mdat > moov && metadata);
  } else requireValid(head.size <= 5 * 1024 * 1024);
  const object = await bucket.get(key, { onlyIf: { etagMatches: head.etag } });
  if (!object || !("body" in object) || object.etag !== head.etag || object.size !== head.size) throw new Error("MEDIA_CHANGED");
  const hash = createHash("sha256"), bytes = subtitle ? new Uint8Array(head.size) : null; let length = 0;
  await consume(object.body, signal, chunk => { requireValid(length + chunk.length <= head.size); hash.update(chunk); bytes?.set(chunk, length); length += chunk.length; });
  requireValid(length === head.size); if (bytes) validateVtt(bytes);
  const after = await bucket.head(key); requireValid(after?.etag === head.etag && after.size === head.size);
  return { checksum: hash.digest("hex"), byteLength: length, ...metadata };
}

export async function syncMedia(env: Env) {
  const db = env.DB.withSession("first-primary"), started = Date.now(), lease = crypto.randomUUID();
  const locked = await db.prepare(`INSERT INTO media_sync_state VALUES ('catalog', NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET lease_id = excluded.lease_id, lease_until = excluded.lease_until, updated_at = excluded.updated_at
    WHERE media_sync_state.lease_until <= ? RETURNING cursor`).bind(lease, started + windowMs + 120000, started, started).first<{ cursor: string | null }>();
  if (!locked) return { busy: true, linked: 0 };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), windowMs);
  const result = { busy: false, linked: 0, skipped: 0, unknown: 0, replaced: 0, failed: 0, unattached: 0, cleared: 0, deferred: false };
  try {
    const units = await db.prepare(`SELECT u.id, w.kind, w.tmdb_id AS tmdbId, s.season_number AS season, u.episode_number AS episode
      FROM playable_units u JOIN works w ON w.id = u.work_id LEFT JOIN seasons s ON s.id = u.season_id`).all<{ id: string; kind: "movie" | "series"; tmdbId: number; season: number | null; episode: number | null }>();
    const identities = new Map(units.results.map(unit => [identityKey(unit), unit.id]));
    const known = await db.prepare(`SELECT id, object_key, r2_etag, byte_length, playable_unit_id, variant, duration_seconds FROM media_files
      UNION ALL SELECT id, object_key, r2_etag, byte_length, NULL, NULL, NULL FROM subtitle_tracks`).all<{ id: string; object_key: string; r2_etag: string | null; byte_length: number; playable_unit_id: string | null; variant: string | null; duration_seconds: number | null }>();
    const versions = new Map(known.results.map(file => [file.object_key, file]));
    // A tier is checked against its unit's original duration; tiers list before their original, so a fresh upload links them on the next pass.
    const originals = new Map(known.results.filter(file => file.variant === "original").map(file => [file.playable_unit_id!, file.duration_seconds!]));
    const unattached = (unitId: string, identity: Identity, reason: string) => {
      result.unattached++;
      console.warn(JSON.stringify({ event: "media_sync_variant_unattached", unitId, reason, ...identity }));
    };
    // Only a pass that lists the whole prefix in one run can prove that an object is gone.
    const fullPass = !locked.cursor, listed = new Set<string>();
    let cursor = locked.cursor ?? undefined, validated = 0;
    const checkpoint = (key: string | undefined) => db.prepare("UPDATE media_sync_state SET cursor = ?, updated_at = ? WHERE id = 'catalog' AND lease_id = ?").bind(key ?? null, Date.now(), lease).run();
    do {
      const page = await env.MEDIA_BUCKET.list({ prefix: "library/", limit: 1000, startAfter: cursor });
      let last = cursor;
      for (const object of page.objects) {
        listed.add(object.key);
        const identity = mediaIdentity(object.key); if (!identity) { last = object.key; result.unknown++; continue; }
        const unitId = identities.get(identityKey(identity)); if (!unitId) { last = object.key; result.unknown++; continue; }
        const knownObject = versions.get(object.key);
        if (knownObject?.r2_etag === object.etag && knownObject.byte_length === object.size) { last = object.key; result.skipped++; continue; }
        // Without an original there is nothing to compare against, so the tier is not read at all.
        if (identity.variant && !originals.has(unitId)) { last = object.key; unattached(unitId, identity, "ORIGINAL_MISSING"); continue; }
        if (validated++ >= 20 || controller.signal.aborted) { await checkpoint(last); result.deferred = true; return result; }
        last = object.key;
        const table = identity.language ? "subtitle_tracks" : "media_files", variant = identity.variant ?? "original";
        try {
          // The recorded version no longer matches R2, so the record stays unplayable unless the current object passes validation.
          if (knownObject?.r2_etag) await db.prepare(`UPDATE ${table} SET r2_etag = NULL WHERE id = ?`).bind(knownObject.id).run();
          const inspected = await inspectR2Media(env.MEDIA_BUCKET, object.key, object, Boolean(identity.language), controller.signal);
          const existing = await db.prepare(`SELECT checksum_sha256, byte_length FROM ${table} WHERE playable_unit_id = ? AND ${identity.language ? "track_key = ?" : "format = 'mp4' AND variant = ?"}`)
            .bind(unitId, identity.language ? identity.trackKey! : variant).first<{ checksum_sha256: string; byte_length: number }>();
          controller.signal.throwIfAborted();
          if (identity.variant && Math.abs(inspected.durationSeconds! - originals.get(unitId)!) > settings.qualityDurationTolerance) { unattached(unitId, identity, "DURATION_MISMATCH"); continue; }
          // A replacement rewrites the existing row in place, so its id, media URL and member data stay unchanged.
          const upsert = () => db.prepare(`INSERT INTO media_files (id, playable_unit_id, format, variant, object_key, byte_length, checksum_sha256, duration_seconds, video_codec, audio_codec, bitrate, r2_etag)
            VALUES (?, ?, 'mp4', ?, ?, ?, ?, ?, 'h264', 'aac', ?, ?) ON CONFLICT (playable_unit_id, format, variant) DO UPDATE SET object_key = excluded.object_key, byte_length = excluded.byte_length,
            checksum_sha256 = excluded.checksum_sha256, duration_seconds = excluded.duration_seconds, bitrate = excluded.bitrate, r2_etag = excluded.r2_etag`)
            .bind(crypto.randomUUID(), unitId, variant, object.key, inspected.byteLength, inspected.checksum, inspected.durationSeconds!, inspected.bitrate!, object.etag);
          if (identity.language) await db.prepare(`INSERT INTO subtitle_tracks (id, playable_unit_id, language, format, display_name, track_key, object_key, byte_length, checksum_sha256, r2_etag)
            VALUES (?, ?, ?, 'vtt', ?, ?, ?, ?, ?, ?) ON CONFLICT (playable_unit_id, track_key) DO UPDATE SET object_key = excluded.object_key, byte_length = excluded.byte_length,
            checksum_sha256 = excluded.checksum_sha256, r2_etag = excluded.r2_etag`)
            .bind(crypto.randomUUID(), unitId, identity.language, subtitleTrack(identity.trackKey!)!.label, identity.trackKey, object.key, inspected.byteLength, inspected.checksum, object.etag).run();
          // Only the original decides the unit's duration and playability.
          else if (identity.variant) await upsert().run();
          else {
            await db.batch([db.prepare("UPDATE playable_units SET duration_seconds = ? WHERE id = ?").bind(inspected.durationSeconds!, unitId), upsert()]);
            originals.set(unitId, inspected.durationSeconds!);
          }
          if (!existing) result.linked++;
          else if (existing.checksum_sha256 === inspected.checksum && existing.byte_length === inspected.byteLength) result.skipped++;
          else {
            result.replaced++;
            console.info(JSON.stringify({ event: "media_sync_replaced", unitId, resourceType: identity.language ? "subtitle" : "video", ...identity }));
          }
        } catch {
          if (controller.signal.aborted) { await checkpoint(last); result.deferred = true; return result; }
          result.failed++; console.warn(JSON.stringify({ event: "media_sync_rejected", unitId, code: "MEDIA_VALIDATION_OR_COMMIT_FAILED" }));
        }
      }
      requireValid(!page.truncated || page.objects.length > 0);
      cursor = page.truncated ? last : undefined;
      await checkpoint(cursor);
    } while (cursor && !controller.signal.aborted);
    result.deferred = Boolean(cursor);
    if (fullPass && !cursor) {
      // A row whose key no longer follows the naming rules (e.g. a pre-SUB1 subtitle) is treated as gone, although its object stays in R2.
      const gone = known.results.filter(file => file.r2_etag && file.object_key.startsWith("library/") && (!listed.has(file.object_key) || !mediaIdentity(file.object_key))).map(file => file.object_key);
      // One set-based statement per table keeps any number of deletions within the per-invocation query limit.
      if (gone.length) await db.batch(["media_files", "subtitle_tracks"].map(table => db.prepare(`UPDATE ${table} SET r2_etag = NULL WHERE object_key IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(gone))));
      result.cleared = gone.length;
    }
    return result;
  } finally {
    clearTimeout(timer);
    await db.prepare("UPDATE media_sync_state SET lease_until = 0, updated_at = ? WHERE id = 'catalog' AND lease_id = ?").bind(Date.now(), lease).run();
    console.info(JSON.stringify({ event: "media_sync_completed", ...result, elapsedMs: Date.now() - started }));
  }
}

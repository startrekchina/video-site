export class MediaFormatError extends Error { constructor(message: string) { super(message); this.name = "MediaFormatError"; } }
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new MediaFormatError(message); }
function decode(bytes: Uint8Array, label: string) { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new MediaFormatError(`${label}: invalid UTF-8`); } }

function cueTime(value: string) {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/u.exec(value);
  const time = match ? ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]) : NaN;
  return Number.isSafeInteger(time) ? time : NaN;
}

function cueText(text: string, start: number, end: number, label: string) {
  check(!/&(?!(amp|lt|gt|lrm|rlm|nbsp|#[0-9]+|#[xX][0-9a-fA-F]+);)/u.test(text), `${label}：字幕实体无效。`);
  for (const [, reference] of text.matchAll(/&#([xX][0-9a-fA-F]+|[0-9]+);/gu)) {
    const point = /^[xX]/u.test(reference) ? parseInt(reference.slice(1), 16) : Number(reference);
    check(Number.isSafeInteger(point) && point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && !(point >= 0x7f && point <= 0x9f) && !(point >= 0xfdd0 && point <= 0xfdef) && point % 0x10000 < 0xfffe, `${label}：字幕实体不是安全字符。`);
  }
  const stack: string[] = [];
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

export function validateVtt(bytes: Uint8Array, label = "字幕") {
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
    if (!cue[0].includes("-->")) check(!/[<>&]/u.test((cue.shift() ?? "")), `${label}：cue 标识符无效。`);
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
  return { bytes: new TextEncoder().encode(text.endsWith("\n") ? text : `${text}\n`), cueCount };
}

// The required native-resolution main comes first, followed by optional tiers from high to low (B 6.6).
export const qualityTiers = { original: "vp9", "2160p": "vp9", "1080p": "vp9", "720p": "h264", "480p": "h264" } as const;
export type QualityTier = keyof typeof qualityTiers;
// iOS Safari decodes VP9 only from WebM, so the codec fixes the container (B 6.6).
const containers = { vp9: "webm", h264: "mp4" } as const;
export const tierFormat = (tier: QualityTier) => containers[qualityTiers[tier]];

// SUB1 track keys: <zh-CN|zh-TW>.<main|bilingual>[.<suffix>]; an extra track of a kind adds only its suffix to the kind's label.
const subtitleKinds: Record<string, string> = { "zh-CN.main": "简中", "zh-CN.bilingual": "简英", "zh-TW.main": "繁中", "zh-TW.bilingual": "繁英" };
export function subtitleTrack(trackKey: string) {
  const match = /^((zh-CN|zh-TW)\.(?:main|bilingual))(?:\.([A-Za-z0-9][\w.-]{0,47}))?$/u.exec(trackKey);
  return match ? { language: match[2], label: match[3] ? `${subtitleKinds[match[1]]}（${match[3]}）` : subtitleKinds[match[1]] } : null;
}

export function mp4BoxHeader(bytes: Uint8Array, remaining: number) {
  check(bytes.length >= 8, "MP4 box header is incomplete");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(0);
  const headerSize = size === 1 ? 16 : 8;
  if (size === 1) {
    check(bytes.length >= 16 && view.getBigUint64(8) <= BigInt(Number.MAX_SAFE_INTEGER), "MP4 box size is invalid");
    size = Number(view.getBigUint64(8));
  } else if (size === 0) size = remaining;
  check(size >= headerSize && size <= remaining, "MP4 box boundary is invalid");
  return { size, headerSize, type: String.fromCharCode(...bytes.slice(4, 8)) };
}

type Box = { type: string; body: number; end: number };
export function mp4Metadata(bytes: Uint8Array, byteLength: number) {
  // ponytail: bounded metadata for ordinary faststart MP4; remux larger/fragmented metadata locally.
  check(bytes.length <= 32 * 1024 * 1024, "MP4 metadata exceeds 32 MiB");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => { check(at >= 0 && at + 4 <= bytes.length, "MP4 field is incomplete"); return view.getUint32(at); };
  let boxCount = 0;
  const boxes = (start: number, end: number) => {
    const result: Box[] = [];
    for (let at = start; at < end;) {
      check(++boxCount <= 10000, "MP4 has too many metadata boxes");
      const box = mp4BoxHeader(bytes.subarray(at, Math.min(at + 16, end)), end - at);
      result.push({ type: box.type, body: at + box.headerSize, end: at + box.size }); at += box.size;
    }
    return result;
  };
  const one = (items: Box[], type: string) => { const found = items.filter(box => box.type === type); check(found.length === 1, `MP4 ${type} is missing or ambiguous`); return found[0]; };
  const children = (box: Box, skip = 0) => { check(box.body + skip <= box.end, "MP4 child boundary is invalid"); return boxes(box.body + skip, box.end); };
  const root = one(boxes(0, bytes.length), "moov"), top = children(root), header = one(top, "mvhd");
  check(bytes[header.body] === 0 || bytes[header.body] === 1, "MP4 movie version is unsupported");
  const version = bytes[header.body], scaleAt = header.body + (version === 1 ? 20 : 12), durationAt = scaleAt + 4;
  check(durationAt + (version === 1 ? 8 : 4) <= header.end, "MP4 duration is incomplete");
  const scale = u32(scaleAt), duration = version === 1 ? Number(view.getBigUint64(durationAt)) : u32(durationAt);
  const durationSeconds = duration / scale;
  check(scale > 0 && Number.isSafeInteger(duration) && durationSeconds > 0 && Number.isFinite(durationSeconds), "MP4 duration is invalid");
  let videoCount = 0, audioCount = 0, videoCodec: "h264" | "vp9" = "h264";
  const descriptor = (at: number, end: number) => {
    check(at < end, "AAC descriptor is missing"); const tag = bytes[at++]; let length = 0, count = 0, octet: number;
    do { check(at < end && ++count <= 4, "AAC descriptor length is invalid"); octet = bytes[at++]; length = length * 128 + (octet & 127); } while (octet & 128);
    check(length > 0 && at + length <= end, "AAC descriptor boundary is invalid"); return { tag, body: at, end: at + length };
  };
  for (const track of top.filter(box => box.type === "trak")) {
    const mdia = children(one(children(track), "mdia")), handler = one(mdia, "hdlr");
    check(handler.body + 12 <= handler.end, "MP4 handler is incomplete");
    const kind = String.fromCharCode(...bytes.slice(handler.body + 8, handler.body + 12));
    if (!["vide", "soun"].includes(kind)) continue;
    const table = children(one(children(one(mdia, "minf")), "stbl")), description = one(table, "stsd");
    check(description.body + 8 <= description.end && u32(description.body + 4) === 1, "MP4 sample description is ambiguous");
    const entry = children(description, 8); check(entry.length === 1, "MP4 sample entry is invalid");
    const samples = one(table, "stsz"); check(samples.body + 12 <= samples.end && u32(samples.body + 8) > 0, "MP4 track has no samples");
    if (kind === "vide") {
      check(["avc1", "avc3", "vp09"].includes(entry[0].type), "MP4 video must be H.264 or VP9");
      if (entry[0].type === "vp09") {
        // Browsers decode VP9 profile 0: 8-bit 4:2:0 (vpcC record version 1).
        const config = one(children(entry[0], 78), "vpcC");
        check(config.end - config.body >= 12 && bytes[config.body] === 1 && bytes[config.body + 4] === 0 && bytes[config.body + 6] >> 4 === 8 && (bytes[config.body + 6] >> 1 & 7) <= 1, "VP9 must be profile 0, 8-bit 4:2:0");
        videoCodec = "vp9";
      } else {
        // Baseline, Main, Extended and High are the 8-bit 4:2:0 profiles browsers decode; High 10/4:2:2/4:4:4 are not.
        const config = one(children(entry[0], 78), "avcC");
        check(config.end - config.body >= 7 && bytes[config.body] === 1 && (bytes[config.body + 5] & 31) > 0, "H.264 configuration is invalid");
        check([66, 77, 88, 100].includes(bytes[config.body + 1]), "H.264 must be an 8-bit 4:2:0 profile");
      }
      videoCount++;
    } else {
      check(entry[0].type === "mp4a" && entry[0].body + 28 <= entry[0].end, "MP4 requires AAC audio");
      const audioVersion = view.getUint16(entry[0].body + 8); check(audioVersion <= 1, "AAC sample version is unsupported");
      check(view.getUint16(entry[0].body + 16) <= 2, "Audio must be mono or stereo");
      const esds = one(children(entry[0], audioVersion === 1 ? 44 : 28), "esds"), es = descriptor(esds.body + 4, esds.end);
      check(es.tag === 3 && es.body + 3 <= es.end, "AAC ES descriptor is invalid");
      const flags = bytes[es.body + 2]; let next = es.body + 3;
      if (flags & 128) next += 2;
      if (flags & 64) { check(next < es.end, "AAC URL descriptor is invalid"); next += 1 + bytes[next]; }
      if (flags & 32) next += 2;
      const decoder = descriptor(next, es.end);
      check(decoder.tag === 4 && decoder.body + 13 <= decoder.end && bytes[decoder.body] === 64 && bytes[decoder.body + 1] >> 2 === 5, "MP4 audio decoder is not AAC");
      const config = descriptor(decoder.body + 13, decoder.end);
      check(config.tag === 5 && config.end - config.body >= 2, "AAC configuration is incomplete");
      let audioType = bytes[config.body] >> 3;
      if (audioType === 31) audioType = 32 + ((bytes[config.body] & 7) << 3 | bytes[config.body + 1] >> 5);
      check([1, 2, 3, 4, 5, 6, 17, 19, 20, 21, 22, 23, 29, 39].includes(audioType), "MP4 audio profile is not AAC"); audioCount++;
    }
  }
  // Browsers play only the first audio track, so a second one would be silent weight.
  check(videoCount === 1 && audioCount === 1, "MP4 requires one video track and one AAC audio track");
  return { durationSeconds, bitrate: Math.max(1, Math.round(byteLength * 8 / durationSeconds)), videoCodec, audioCodec: "aac" };
}

// Header, track list, index and the first video frame header all sit at the front of a seekable WebM.
export const webmMetadataWindow = 4 * 1024 * 1024;
const ids = { ebml: 0x1a45dfa3, docType: 0x4282, segment: 0x18538067, info: 0x1549a966, scale: 0x2ad7b1, duration: 0x4489, tracks: 0x1654ae6b, entry: 0xae,
  number: 0xd7, type: 0x83, codec: 0x86, audio: 0xe1, channels: 0x9f, encodings: 0x6d80, cues: 0x1c53bb6b, cluster: 0x1f43b675, simpleBlock: 0xa3, group: 0xa0, block: 0xa1 };
// bytes is the file's leading webmMetadataWindow (or the whole file when smaller).
export function webmMetadata(bytes: Uint8Array, byteLength: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vint = (at: number, id: boolean) => {
    check(at < bytes.length, "WebM metadata is incomplete or not at the front");
    let length = 1;
    while (length <= 8 && !(bytes[at] & 0x80 >> length - 1)) length++;
    check(length <= (id ? 4 : 8) && at + length <= bytes.length, "WebM element header is invalid");
    let value = id ? bytes[at] : bytes[at] & 0xff >> length;
    for (let n = 1; n < length; n++) value = value * 256 + bytes[at + n];
    return { value, length, unknown: !id && value === 2 ** (7 * length) - 1 };
  };
  let elementCount = 0;
  const element = (at: number, end: number) => {
    check(++elementCount <= 100000, "WebM has too many metadata elements");
    const id = vint(at, true), size = vint(at + id.length, false), body = at + id.length + size.length;
    // Only the segment may run to the end of the file; a live-recorded WebM must be remuxed first.
    check(!size.unknown || id.value === ids.segment, "WebM element size is unknown");
    const stop = size.unknown ? end : body + size.value;
    check(Number.isSafeInteger(stop) && stop <= end, "WebM element boundary is invalid");
    return { id: id.value, body, end: stop };
  };
  const loaded = <T extends { end: number }>(item: T) => { check(item.end <= bytes.length, "WebM metadata is incomplete or not at the front"); return item; };
  const children = (parent: { body: number; end: number }) => {
    const result: { id: number; body: number; end: number }[] = [];
    for (let at = parent.body; at < parent.end;) { const child = element(at, parent.end); result.push(child); at = child.end; }
    return result;
  };
  const uint = (item: { body: number; end: number }) => {
    check(item.end - item.body <= 6, "WebM integer is too large");
    let value = 0; for (let n = item.body; n < item.end; n++) value = value * 256 + bytes[n]; return value;
  };
  const text = (item: { body: number; end: number }) => String.fromCharCode(...bytes.subarray(item.body, item.end)).replace(/\0+$/u, "");

  const header = loaded(element(0, byteLength));
  check(header.id === ids.ebml && children(header).some(item => item.id === ids.docType && text(item) === "webm"), "File is not WebM");
  const segment = element(header.end, byteLength);
  check(segment.id === ids.segment && segment.end === byteLength, "WebM segment does not cover the file");
  let scale = 1_000_000, duration = NaN, cues = false, profile = -1, videoTrack = -1, audioCount = 0, videoCount = 0;
  for (let at = segment.body; at < segment.end && profile < 0;) {
    const item = element(at, segment.end); at = item.end;
    if (item.id === ids.info) for (const field of children(loaded(item))) {
      if (field.id === ids.scale) scale = uint(field);
      if (field.id === ids.duration) duration = field.end - field.body === 8 ? view.getFloat64(field.body) : field.end - field.body === 4 ? view.getFloat32(field.body) : NaN;
    }
    if (item.id === ids.tracks) for (const entry of children(loaded(item)).filter(child => child.id === ids.entry)) {
      const fields = children(entry), value = (id: number) => fields.find(field => field.id === id);
      check(!value(ids.encodings), "WebM tracks must not be encrypted or compressed");
      const type = value(ids.type), codec = value(ids.codec), number = value(ids.number);
      check(type && codec && number, "WebM track entry is incomplete");
      if (uint(type) === 1) { check(text(codec) === "V_VP9", "WebM video must be VP9"); videoTrack = uint(number); videoCount++; }
      else if (uint(type) === 2) {
        const channels = children(value(ids.audio) ?? { body: 0, end: 0 }).find(field => field.id === ids.channels);
        check(text(codec) === "A_OPUS", "WebM audio must be Opus");
        check((channels ? uint(channels) : 1) <= 2, "Audio must be mono or stereo"); audioCount++;
      } else check(false, "WebM may hold only one video and one audio track");
    }
    if (item.id === ids.cues) cues = true;
    if (item.id === ids.cluster) {
      // Players need the index before the media data to seek without reading the whole file.
      check(cues, "WebM cues must be placed before the first cluster");
      for (let child = item.body; child < item.end && profile < 0;) {
        const block = element(child, item.end); child = block.end;
        // A block group may outgrow the window, so stop at its Block instead of walking every child.
        let payload = block.id === ids.simpleBlock ? block : undefined;
        if (block.id === ids.group) for (let part = block.body; part < block.end && !payload;) { const piece = element(part, block.end); part = piece.end; if (piece.id === ids.block) payload = piece; }
        if (!payload) continue;
        const track = vint(payload.body, false), frame = payload.body + track.length + 3;
        if (track.value !== videoTrack) continue;
        check(frame < bytes.length && frame < payload.end && !(bytes[frame - 1] & 0x06), "WebM first video frame is unreadable");
        // VP9 uncompressed header: frame marker 0b10, then the profile's low and high bits; profile 0 is 8-bit 4:2:0.
        check(bytes[frame] >> 6 === 2, "WebM first video frame is not VP9");
        profile = (bytes[frame] >> 5 & 1) | (bytes[frame] >> 4 & 1) << 1;
      }
      check(profile >= 0, "WebM first cluster has no video frame");
    }
  }
  check(videoCount === 1 && audioCount === 1, "WebM requires one VP9 video track and one Opus audio track");
  check(profile >= 0, "WebM has no video frame");
  check(profile === 0, "VP9 must be profile 0, 8-bit 4:2:0");
  const durationSeconds = duration * scale / 1e9;
  check(scale > 0 && durationSeconds > 0 && Number.isFinite(durationSeconds), "WebM duration is invalid");
  return { durationSeconds, bitrate: Math.max(1, Math.round(byteLength * 8 / durationSeconds)), videoCodec: "vp9" as const, audioCodec: "opus" };
}

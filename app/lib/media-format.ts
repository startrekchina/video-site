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
  let videoCount = 0, audioCount = 0;
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
      check(["avc1", "avc3"].includes(entry[0].type), "MP4 requires H.264 video");
      const config = one(children(entry[0], 78), "avcC");
      check(config.end - config.body >= 7 && bytes[config.body] === 1 && (bytes[config.body + 5] & 31) > 0, "H.264 configuration is invalid");
      videoCount++;
    } else {
      check(entry[0].type === "mp4a" && entry[0].body + 28 <= entry[0].end, "MP4 requires AAC audio");
      const audioVersion = view.getUint16(entry[0].body + 8); check(audioVersion <= 1, "AAC sample version is unsupported");
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
  check(videoCount === 1 && audioCount > 0, "MP4 requires one H.264 video and AAC audio");
  return { durationSeconds, bitrate: Math.max(1, Math.round(byteLength * 8 / durationSeconds)), videoCodec: "h264", audioCodec: "aac" };
}
